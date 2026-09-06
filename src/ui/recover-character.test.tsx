// #15 set a broken character aside; this is the half that hands it back (issue #89).
//
// Every test here is one of the four acceptance criteria: the offer appears when — and
// only when — there is something parked, what leaves the browser is the stored bytes
// unaltered, a value that was never JSON leaves the same way, and nothing on the path
// can write over the copy. The last one is the point of the whole feature: a recovery
// button that can lose the thing it recovers is worse than no button at all.
//
// The round trip at the bottom is the workflow the issue describes — download it, fix it
// in a text editor, open it with Import — which is only true if the recovered file goes
// back in through the same code a normal file does.
//
// No @testing-library: React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking.

import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTER_KEY, REJECTED_CHARACTER_KEY } from '../state/character-storage';
import { createCharacter } from '../state/new-character';
import { App } from './App';

declare global {
  // React reads this off the global to decide whether act() is legal here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A character that would load, spoiled by one letter, so a hand fix is one edit. */
const misfiled = JSON.stringify({
  ...createCharacter('c_vess', 'Vess of the Low Road'),
  format: 'lantern-charactr',
});

let container: HTMLDivElement;
let root: Root;
let isMounted = false;

/** Every blob the app asked the browser to make a URL for, in order. */
let saved: Blob[] = [];

/** The file name of every download. Clicking an anchor for real is a jsdom navigation. */
let downloads: string[] = [];

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  saved = [];
  downloads = [];

  // jsdom has no blob URL store, which is the branch `saveTextFile` guards. The stub is
  // what puts these tests on the other side of that guard.
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
    if (blob instanceof Blob) saved.push(blob);
    return 'blob:lantern-test';
  });
  URL.revokeObjectURL = vi.fn();

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  isMounted = false;
});

afterEach(async () => {
  // A mounted sheet keeps a debounced write in flight and flushes it on unmount. A test
  // that ends still mounted leaves that timer to fire during a later one.
  await unmount();
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

async function unmount(): Promise<void> {
  if (!isMounted) return;

  isMounted = false;
  await act(async () => {
    root.unmount();
  });
}

function findButton(label: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === label,
    ) ?? null
  );
}

function button(label: string): HTMLButtonElement {
  const found = findButton(label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/**
 * Download the parked value, and give back the text the browser was handed.
 *
 * Decoded from the bytes rather than through `Blob.text()`, which is specified to strip
 * a leading BOM. The file on disk keeps those bytes; only reading one back in JavaScript
 * drops them, and a test that used `.text()` would report the app as having altered a
 * value it passed through untouched.
 */
async function recover(): Promise<string> {
  await click(button('Download the old value'));
  const blob = saved.at(-1);
  if (blob === undefined) throw new Error('nothing was handed to the browser');
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer());
}

/** The Character file panel's own picker — the content screen has one too. */
function characterFileInput(): HTMLInputElement {
  const label = [...container.querySelectorAll('label')].find(
    (element) => element.textContent === 'Character file',
  );
  const input = label === undefined ? null : document.getElementById(label.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error('no Character file input');
  return input;
}

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

describe('a character that could not be read', () => {
  it('offers the parked value back rather than leaving it to devtools', async () => {
    localStorage.setItem(CHARACTER_KEY, misfiled);

    await mount();

    expect(container.textContent).toContain('could not be read');
    expect(findButton('Download the old value')).not.toBeNull();
  });

  it('offers nothing when the sheet loaded, so the notice is never noise', async () => {
    await mount();

    expect(findButton('Download the old value')).toBeNull();
  });

  it('offers nothing when the browser refused the copy, because nothing is parked', async () => {
    localStorage.setItem(CHARACTER_KEY, misfiled);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    await mount();

    expect(container.textContent).toContain('could not be read');
    expect(findButton('Download the old value')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What leaves the browser
// ---------------------------------------------------------------------------

describe('the recovered file', () => {
  it('is the stored text exactly, never re-serialised and never repaired', async () => {
    localStorage.setItem(CHARACTER_KEY, misfiled);
    await mount();

    expect(await recover()).toBe(misfiled);
    expect(downloads.at(-1)).toBe('lantern-character-rejected.json');
  });

  // The value most likely to be worth recovering is the one no parser will touch: a
  // truncated save, a half-written key, an edit that lost a brace.
  it.each([
    ['is not JSON at all', '{"name":"Vess of the Low Ro'],
    ['is not even text-shaped', '\uFEFF  ragged\r\n\ttext '],
    ['is a bare word', 'undefined'],
  ])('leaves the browser unaltered when it %s', async (_label, raw) => {
    localStorage.setItem(CHARACTER_KEY, raw);
    await mount();

    expect(await recover()).toBe(raw);
  });

  it('says what it wrote, so a player knows there is a file to keep', async () => {
    localStorage.setItem(CHARACTER_KEY, misfiled);
    await mount();
    await recover();

    expect(container.textContent).toContain('lantern-character-rejected.json');
  });

  it('reports a browser that will not build a file rather than failing silently', async () => {
    localStorage.setItem(CHARACTER_KEY, misfiled);
    await mount();

    URL.createObjectURL = vi.fn(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await click(button('Download the old value'));

    expect(container.textContent).toContain('would not take the file');
    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe(misfiled);
  });
});

// ---------------------------------------------------------------------------
// What cannot happen to the parked copy
// ---------------------------------------------------------------------------

describe('the parked copy', () => {
  it('survives downloading it, twice, and the autosave that follows', async () => {
    localStorage.setItem(CHARACTER_KEY, misfiled);
    await mount();

    await recover();
    await recover();
    // Unmount flushes any pending write, which is the moment #15 was guarding against.
    await unmount();

    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe(misfiled);
  });

  it('is never cleared by the path that hands it out', async () => {
    localStorage.setItem(CHARACTER_KEY, misfiled);
    await mount();
    await recover();

    const removed = vi.spyOn(Storage.prototype, 'removeItem');
    await recover();

    expect(removed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Download it, fix it, open it
// ---------------------------------------------------------------------------

describe('recovering a character end to end', () => {
  it('goes back in through the same import the Character file panel offers', async () => {
    localStorage.setItem(CHARACTER_KEY, misfiled);
    await mount();

    const text = await recover();
    // What a player does in a text editor: the problem report named `format`, so they
    // fix the one word it named. Nothing in the app touched the file.
    const fixed = text.replace('lantern-charactr', 'lantern-character');

    const input = characterFileInput();
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        {
          name: 'lantern-character-rejected.json',
          size: fixed.length,
          text: () => Promise.resolve(fixed),
        },
      ],
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button('Replace the sheet'));

    expect(container.textContent).toContain('Opened Vess of the Low Road');
    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe(misfiled);
  });
});
