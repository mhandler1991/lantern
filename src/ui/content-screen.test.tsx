// The content screen, mounted inside the real app against the real shipped core pack.
//
// Every assertion here is one of #24's acceptance criteria, and the last one is the
// boundary: a pack is a file somebody else wrote, so every string out of it has to reach
// the page as a text node and never as markup (CLAUDE.md §2.6).
//
// The fetch is stubbed with `public/packs/core.json` read off disk rather than mocked
// away, because a content screen tested against a fixture pack would say nothing about
// the one the app actually ships.
//
// No @testing-library — React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CORE_PACK_PATH,
  KEPT_PACKS_FORMAT,
  KEPT_PACKS_FORMAT_VERSION,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
} from '../constants';
import { KEPT_PACKS_KEY, REJECTED_PACKS_KEY } from '../state/pack-storage';
import { App } from './App';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The same file the deployed app fetches — Vite copies `public/` to the deploy root. */
const SHIPPED = readFileSync(resolve(process.cwd(), 'public', CORE_PACK_PATH), 'utf8');

let container: HTMLDivElement;
let root: Root;
let isMounted = false;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');

  // jsdom resolves nothing against an origin here, so a relative URL is what the loader
  // is handed and a stub is what answers it. `loadCorePack` treats it as a `Response`.
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(SHIPPED) }),
  ) as unknown as typeof fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  isMounted = false;
});

afterEach(async () => {
  // A mounted sheet keeps a debounced write in flight; leaving one to fire during a
  // later test is what `portability.test.tsx` was bitten by.
  if (isMounted) {
    isMounted = false;
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<App />);
  });
  isMounted = true;
}

/**
 * A reload: the tab goes away and comes back, and what survives it is storage. The same
 * container is thrown away too, so nothing in the old tree can answer a query by accident.
 */
async function reload(): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await mount();
}

/** Whether a checkbox is ticked, by the name it announces. */
function isTicked(label: string): boolean {
  const element = control(label);
  return element instanceof HTMLInputElement && element.checked;
}

/** The Content panel, so nothing here can match the character sheet's own controls. */
function panel(): HTMLElement {
  const found = [...container.querySelectorAll('section.panel')].find(
    (section) => section.querySelector('.panel__title')?.textContent === 'Content',
  );
  if (!(found instanceof HTMLElement)) throw new Error('the content panel is not on screen');
  return found;
}

const text = (): string => panel().textContent ?? '';

/**
 * A control by the name it announces. A glyph button carries its meaning in a
 * `visually-hidden` span beside an `aria-hidden` arrow, so the label a screen reader
 * would read is the label this looks for — which is also the assertion that those
 * buttons have one.
 */
function control(label: string): HTMLElement {
  const found = [...panel().querySelectorAll('button, input')].find((element) => {
    if (element instanceof HTMLInputElement) return element.labels?.[0]?.textContent === label;

    const hidden = element.querySelector('.visually-hidden');
    return (hidden ?? element).textContent?.trim() === label;
  });
  if (!(found instanceof HTMLElement)) throw new Error(`no control labelled ${label}`);
  return found;
}

async function press(label: string): Promise<void> {
  const element = control(label);
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** The packs in the load order, top to bottom. */
function order(): string[] {
  return [...panel().querySelectorAll('.pack__name')].map((element) => element.textContent ?? '');
}

/** The resolution stack, one line per entry. */
function stack(): string[] {
  return [...panel().querySelectorAll('.stack__line')].map((element) => element.textContent ?? '');
}

/**
 * Pick a file. A `FileList` cannot be built in jsdom, and nothing in the app needs one —
 * `PickedPackFile` takes `name`, `size` and `text()` off whatever the picker handed it.
 */
async function pick(body: string, name = 'frostbound.json'): Promise<void> {
  const input = control('Pack file');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name, size: body.length, text: () => Promise.resolve(body) }],
  });

  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const packText = (input: Record<string, unknown>): string =>
  JSON.stringify({ format: PACK_FORMAT, formatVersion: PACK_FORMAT_VERSION, ...input });

const frostbound = packText({
  id: 'frostbound',
  name: 'Frostbound',
  version: '1.2.0',
  author: 'Max',
  spells: [
    {
      id: 'hoarfrost',
      name: 'Hoarfrost',
      tier: 1,
      duration: 'instant',
      range: 'near',
      classes: ['core:wizard'],
    },
  ],
  extends: [{ target: 'core:class:wizard', talents: ['frost-affinity'] }],
});

describe('the content screen', () => {
  it('loads the pack the app ships with and labels where it came from', async () => {
    await mount();

    expect(order()).toEqual(['Core']);
    expect(text()).toContain('shipped with Lantern');
    // What core brought, from the resolver's own count rather than from this test.
    expect(text()).toMatch(/\d+ classes/);
  });

  it('says who is responsible for what gets loaded', async () => {
    await mount();

    // DESIGN.md §7 — one line in the upload dialog, beside the picker and not behind a
    // confirmation nobody reads.
    expect(text()).toContain('You are responsible for having the rights to whatever you load.');
  });

  it('loads a pack from the file picker and names what it took', async () => {
    await mount();
    await pick(frostbound);

    expect(order()).toEqual(['Core', 'Frostbound']);
    expect(text()).toContain('Loaded Frostbound 1.2.0');
    expect(text()).toContain('frostbound.json');
    expect(text()).toContain('by Max');
  });

  it('shows the resolution stack, naming every pack that made a class what it is', async () => {
    await mount();
    await pick(frostbound);

    const wizard = stack().find((line) => line.startsWith('Wizard ='));
    expect(wizard).toBeDefined();
    expect(wizard).toContain('Core (');
    expect(wizard).toContain('Frostbound (1 spell, 1 talent)');
  });

  it('reorders the load order, which is what decides an override', async () => {
    const rival = packText({
      id: 'grim',
      name: 'Grim',
      version: '1.0.0',
      classes: [
        {
          id: 'wizard',
          name: 'Warlock',
          hitDie: 'd4',
          weapons: [],
          armor: [],
          talentTable: 'x',
          overrides: 'core:class:wizard',
        },
      ],
    });

    await mount();
    await pick(frostbound);
    await pick(rival, 'grim.json');
    expect(order()).toEqual(['Core', 'Frostbound', 'Grim']);

    await press('Load Grim earlier');
    expect(order()).toEqual(['Core', 'Grim', 'Frostbound']);

    // Frostbound's extension now lands after Grim's replacement, so the talent it adds
    // is on the Warlock. Moving a pack changes the order additions land in.
    const warlock = stack().find((line) => line.startsWith('Warlock ='));
    expect(warlock).toContain('Frostbound');
  });

  it('turns a pack off without moving it, and takes it out of the stack', async () => {
    await mount();
    await pick(frostbound);
    expect(stack().find((line) => line.startsWith('Wizard ='))).toContain('Frostbound');

    await press('Use Frostbound');

    expect(order(), 'a pack that was turned off moved').toEqual(['Core', 'Frostbound']);
    expect(text()).toContain('Turned off');
    expect(stack().find((line) => line.startsWith('Wizard ='))).not.toContain('Frostbound');
  });

  it('removes a pack that came from a file, and never offers to remove core', async () => {
    await mount();
    await pick(frostbound);

    expect(() => control('Remove Core')).toThrow();

    await press('Remove Frostbound');
    expect(order()).toEqual(['Core']);
  });

  it('reports a file that is not a pack and leaves everything loaded', async () => {
    await mount();
    await pick(frostbound);
    await pick(JSON.stringify({ format: 'lantern-pack', formatVersion: 1, id: 'Bad' }), 'broken.json');

    expect(order(), 'a bad file changed the load order').toEqual(['Core', 'Frostbound']);
    expect(text()).toContain('broken.json');
    expect(text()).toContain('problems in "broken.json"');
    expect(text()).toContain('id — expected');
  });

  it('prints the resolver’s warnings without refusing anything', async () => {
    const dangling = packText({
      id: 'dangling',
      name: 'Dangling',
      version: '1.0.0',
      extends: [{ target: 'core:class:skald', talents: ['nothing'] }],
    });

    await mount();
    await pick(dangling, 'dangling.json');

    expect(order()).toEqual(['Core', 'Dangling']);
    expect(text()).toContain('no loaded pack defines core:class:skald');
    expect(text()).toContain('this is a report, not a refusal');
  });

  it('keeps a pack across a reload, in its place and with its on/off state', async () => {
    await mount();
    await pick(frostbound);

    expect(isTicked('Keep Frostbound'), 'a pack was kept without being asked for').toBe(false);

    await press('Keep Frostbound');
    await press('Use Frostbound');
    await reload();

    // Back where it was, still turned off, and still opted in — every one of those was a
    // decision somebody made (DATA-MODEL.md §9).
    expect(order()).toEqual(['Core', 'Frostbound']);
    expect(text()).toContain('Turned off');
    expect(isTicked('Keep Frostbound')).toBe(true);
    expect(isTicked('Use Frostbound')).toBe(false);
  });

  it('forgets a pack that was not kept, which is what room-scoped means', async () => {
    await mount();
    await pick(frostbound);
    expect(order()).toEqual(['Core', 'Frostbound']);

    await reload();

    expect(order()).toEqual(['Core']);
  });

  it('sets a stored pack it can no longer read aside, and says so', async () => {
    // What an older build, another tab, or a hand could have left under the key. The
    // first pack is fine; the second is not a pack at all.
    localStorage.setItem(
      KEPT_PACKS_KEY,
      JSON.stringify({
        format: KEPT_PACKS_FORMAT,
        formatVersion: KEPT_PACKS_FORMAT_VERSION,
        packs: [
          {
            name: 'frostbound.json',
            isEnabled: true,
            pack: JSON.parse(frostbound) as unknown,
          },
          { name: 'broken.json', isEnabled: true, pack: { id: 'Bad' } },
        ],
      }),
    );

    await mount();

    expect(order(), 'a pack that still parsed did not come back').toEqual(['Core', 'Frostbound']);
    expect(text()).toContain('set aside');
    expect(text()).toContain('problems in "the stored packs"');
    expect(text()).toContain('packs[1]');

    // Set aside, not dropped: the bytes are still on this machine and reachable.
    expect(localStorage.getItem(REJECTED_PACKS_KEY)).toContain('broken.json');
    expect(() => control('Download the stored packs')).not.toThrow();
  });

  it('renders every string a pack supplied as a text node', async () => {
    const hostile = packText({
      id: 'hostile',
      name: '<img src=x onerror=alert(1)>',
      version: '1.0.0',
      classes: [
        {
          id: 'rogue',
          name: '<script>alert(2)</script>',
          hitDie: 'd8',
          weapons: [],
          armor: [],
          talentTable: 'x',
        },
      ],
    });

    await mount();
    await pick(hostile, '<b>picked</b>.json');

    expect(panel().querySelector('img'), 'a pack name became an element').toBeNull();
    expect(panel().querySelector('script'), 'a class name became an element').toBeNull();
    expect(panel().querySelector('b'), 'a file name became an element').toBeNull();
    expect(text()).toContain('<img src=x onerror=alert(1)>');
    expect(stack().some((line) => line.startsWith('<script>alert(2)</script> ='))).toBe(true);
  });

  it('warns and keeps the sheet when the core pack cannot be fetched', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    ) as unknown as typeof fetch;

    await mount();

    expect(text()).toContain('could not be loaded');
    expect(text()).toContain('No packs are loaded');
    expect(container.querySelector('.sheet'), 'the sheet went with the pack').not.toBeNull();
  });
});
