// PRD.md §5, Phase 1: "you can build a character by hand, close the tab, reopen it".
//
// Component rendering detail is not worth testing during build-out (CLAUDE.md §7), and
// this file does not test any. It tests the one path the sheet exists to serve: an edit
// made through the UI reaches storage as a character that parses. Everything between —
// the row factory, the clamp, the debounce, the flush on unmount, the write-time
// validation — is a place a sheet could silently stop saving.
//
// No @testing-library: React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking. createRoot plus a native input event is the whole harness.

import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCharacter } from '../../model/character';
import { CHARACTER_KEY } from '../../state/character-storage';
import { App } from '../App';

declare global {
  // React reads this off the global to decide whether act() is legal here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<App />);
  });
}

/** Unmounting flushes the pending write, which is what closing the tab does too. */
async function closeTheTab(): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(label),
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/**
 * React installs its own value setter on the element, so assigning `.value` directly is
 * invisible to it. Going through the prototype descriptor is how a real keystroke looks.
 */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function fieldLabelled(label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find(
    (element) => element.textContent === label,
  );
  const input = found === undefined ? null : document.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no input labelled ${label}`);
  return input;
}

/** What is under the storage key, parsed the way the next visit will parse it. */
function stored(): ReturnType<typeof parseCharacter> {
  const raw = localStorage.getItem(CHARACTER_KEY);
  if (raw === null) throw new Error('nothing was saved');
  return parseCharacter(JSON.parse(raw));
}

describe('building a character by hand', () => {
  it('saves a name that parses back', async () => {
    await mount();
    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    await closeTheTab();

    const parsed = stored();
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.character.name).toBe('Vess of the Low Road');
  });

  it('saves gear typed in with no pack loaded, and counts its slots', async () => {
    await mount();
    await click(button('Add item'));

    const row = container.querySelector('.row--item input[type="text"]');
    if (!(row instanceof HTMLInputElement)) throw new Error('the item row has no name field');
    await type(row, 'Silvered dagger');

    // The slot count is derived, so it has to move on the screen without being stored.
    expect(container.textContent).toContain('1 / 10 slots');

    await closeTheTab();

    const parsed = stored();
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.character.items).toHaveLength(1);
    expect(parsed.character.items[0]?.name).toBe('Silvered dagger');
    expect(parsed.character.items[0]?.ref).toBeNull();
  });

  it('clamps a score the schema would refuse rather than failing the save', async () => {
    await mount();
    await type(fieldLabelled('Strength'), '9999');
    await closeTheTab();

    const parsed = stored();
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.character.stats.str).toBe(30);
  });

  it('reopens the tab on what was saved', async () => {
    await mount();
    await type(fieldLabelled('Name'), 'Corvin');
    await closeTheTab();

    root = createRoot(container);
    await mount();

    expect(fieldLabelled('Name').value).toBe('Corvin');
    await closeTheTab();
  });

  it('stores no derived value, however much is filled in', async () => {
    await mount();
    await type(fieldLabelled('Strength'), '16');
    await click(button('Add item'));
    await closeTheTab();

    const raw = localStorage.getItem(CHARACTER_KEY) ?? '';
    expect(raw).not.toContain('"ac"');
    expect(raw).not.toContain('"modifier');
    expect(raw).not.toContain('xpToNext');
    // The one `slots` a sheet may hold is the player's own note on a row, not a total.
    expect(stored().ok).toBe(true);
  });
});
