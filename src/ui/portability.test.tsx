// Export is the only thing standing between a cleared browser and a lost character
// (DESIGN.md §8), and import is the only control in the app that can destroy one. So
// these tests are about those two sentences: what the browser is handed when a player
// exports, and what does — and does not — happen to the sheet on screen when they pick
// a file.
//
// The round trip at the bottom is the acceptance criterion for #16 in one test: a sheet
// exported from one browser profile, imported into an empty one, and the two copies
// compared as the bytes that reach storage.
//
// No @testing-library — React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking. createRoot plus native events is the whole harness.

import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTER_KEY } from '../state/character-storage';
import { App } from './App';

declare global {
  // React reads this off the global to decide whether act() is legal here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** Whether `root` currently holds a tree, so unmounting twice is not an error. */
let isMounted = false;

/** Every blob the app asked the browser to make a URL for, in order. */
let saved: Blob[] = [];

/** The file name of every download, in order. Clicking for real is a jsdom navigation. */
let downloads: string[] = [];

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  saved = [];
  downloads = [];

  // jsdom has no blob URL store, which is exactly the branch `saveTextFile` guards. The
  // stub is what puts the test on the other side of that guard.
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
  // A mounted sheet keeps a debounced write in flight — `usePersistentCharacter` writes
  // `PERSIST_DEBOUNCE_MS` after an edit and flushes on unmount. A test that ends still
  // mounted leaves that timer to fire during a *later* test and overwrite the storage it
  // is asserting on, which is what CI caught on the round trip: it read back a character
  // from a test three above it. Unmounting here is the app's own tab-closed path.
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

/**
 * The Character file panel rather than the whole page. The content screen reports pack
 * problems through the same component (`ui/ProblemReport.tsx`), so "Copy the problems"
 * is no longer a unique label on screen — and a test about importing a character that
 * clicked the content screen's copy button would pass for the wrong reason.
 */
function panel(title: string): HTMLElement {
  const found = [...container.querySelectorAll('section.panel')].find(
    (section) => section.querySelector('.panel__title')?.textContent === title,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`no panel titled ${title}`);
  return found;
}

function button(label: string): HTMLButtonElement {
  const found = [...panel('Character file').querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

function hasButton(label: string): boolean {
  return [...panel('Character file').querySelectorAll('button')].some(
    (element) => element.textContent?.trim() === label,
  );
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

/** React owns the value setter, so a real keystroke goes through the prototype. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Choose a file. A `FileList` cannot be built in jsdom, and nothing in the app needs one
 * — the component takes `size` and `text()` off whatever the picker handed it, which is
 * why `PickedFile` is a structural type.
 */
async function pick(text: string, name = 'vess.json'): Promise<void> {
  const input = fieldLabelled('Character file');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name, size: text.length, text: () => Promise.resolve(text) }],
  });

  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function exportText(): Promise<string> {
  await click(button('Export character'));
  const blob = saved.at(-1);
  if (blob === undefined) throw new Error('nothing was handed to the browser');
  return blob.text();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe('exporting a character', () => {
  it('hands the browser the whole sheet, named after the character', async () => {
    await mount();
    await type(fieldLabelled('Name'), 'Vess of the Low Road');

    const text = await exportText();

    expect(downloads.at(-1)).toBe('lantern-character-vess-of-the-low-road.json');
    expect(JSON.parse(text)).toMatchObject({
      format: 'lantern-character',
      name: 'Vess of the Low Road',
    });
  });

  it('says what it wrote, so a player knows there is a file to keep', async () => {
    await mount();
    await click(button('Export character'));

    expect(container.textContent).toContain('Saved as lantern-character.json');
  });

  it('reports a browser that will not build a file rather than failing silently', async () => {
    // The private-mode and hardened-profile case, and jsdom's own state before the stub.
    URL.createObjectURL = vi.fn(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    await mount();
    await click(button('Export character'));

    expect(container.textContent).toContain('would not take the file');
  });
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

describe('importing a character', () => {
  it('changes nothing when the file is malformed, and says where it broke', async () => {
    await mount();
    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    const before = localStorage.getItem(CHARACTER_KEY);

    await pick('{ not json at all');

    expect(container.textContent).toContain('nothing has changed');
    expect(container.textContent).toContain('(root)');
    expect(fieldLabelled('Name').value).toBe('Vess of the Low Road');
    expect(localStorage.getItem(CHARACTER_KEY)).toBe(before);
  });

  it('changes nothing when the file is a character from a newer build', async () => {
    await mount();
    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    const text = await exportText();
    const fromTheFuture = JSON.stringify({ ...JSON.parse(text), formatVersion: 99 });

    await pick(fromTheFuture);

    expect(container.textContent).toContain('formatVersion');
    expect(fieldLabelled('Name').value).toBe('Vess of the Low Road');
  });

  it('asks before replacing the sheet, and leaves it alone when told to', async () => {
    await mount();
    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    const text = await exportText();

    await type(fieldLabelled('Name'), 'Someone else entirely');
    await pick(text);

    // Read, validated, named back — and nothing replaced yet.
    expect(container.textContent).toContain('Vess of the Low Road');
    expect(fieldLabelled('Name').value).toBe('Someone else entirely');

    await click(button('Keep this one'));

    expect(fieldLabelled('Name').value).toBe('Someone else entirely');
    expect(hasButton('Replace the sheet')).toBe(false);
  });

  it('replaces the sheet when told to', async () => {
    await mount();
    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    const text = await exportText();

    await type(fieldLabelled('Name'), 'Someone else entirely');
    await pick(text);
    await click(button('Replace the sheet'));

    expect(fieldLabelled('Name').value).toBe('Vess of the Low Road');
    expect(container.textContent).toContain('Opened Vess of the Low Road');
  });
});

// ---------------------------------------------------------------------------
// The round trip — the acceptance criterion for #16
// ---------------------------------------------------------------------------

// #21 — most people will not read a schema; they paste what the app says back into the
// thing that wrote the file (DATA-MODEL.md §11). So what is asserted here is the block a
// player is asked to paste: what it says, and that one button takes all of it.
describe('the problems, ready to paste', () => {
  function withClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  /** A file that is a character in every way but one. */
  async function pickABrokenFile(): Promise<void> {
    await mount();
    const text = await exportText();
    const broken = { ...JSON.parse(text), level: 99, luck: -1 };
    await pick(JSON.stringify(broken), 'vess-of-the-low-road.json');
  }

  it('names the file, and gives every problem a path, an expectation and a value', async () => {
    await pickABrokenFile();

    expect(container.textContent).toContain('2 problems in "vess-of-the-low-road.json":');
    expect(container.textContent).toContain('level — expected at most 10 — got 99');
    expect(container.textContent).toContain('luck — expected at least 0 — got -1');
  });

  it('copies the whole block, heading and every line, in one click', async () => {
    const copied: string[] = [];
    withClipboard(async (text) => {
      copied.push(text);
    });

    await pickABrokenFile();
    await click(button('Copy the problems'));

    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain('2 problems in "vess-of-the-low-road.json":');
    expect(copied[0]).toContain('level — expected at most 10 — got 99');
    expect(copied[0]).toContain('luck — expected at least 0 — got -1');
    expect(container.textContent).toContain('Copied.');
  });

  it('leaves the lines on screen to be selected when the clipboard refuses', async () => {
    withClipboard(async () => {
      throw new Error('denied');
    });

    await pickABrokenFile();
    await click(button('Copy the problems'));

    expect(container.textContent).toContain('select the lines above');
    expect(container.textContent).toContain('level — expected at most 10 — got 99');
  });
});

describe('the round trip', () => {
  it('is the same character in a browser that has never seen it', async () => {
    await mount();
    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    await type(fieldLabelled('Ancestry'), 'Human');
    await type(fieldLabelled('XP'), '6');

    const exported = await exportText();
    // Unmounting flushes the debounced write, which is what a closed tab does.
    await unmount();
    const before = localStorage.getItem(CHARACTER_KEY);

    // A fresh browser profile: nothing stored, nothing carried over.
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await mount();
    await pick(exported);
    await click(button('Replace the sheet'));
    await unmount();

    expect(localStorage.getItem(CHARACTER_KEY)).toBe(before);
    expect(localStorage.getItem(CHARACTER_KEY)).toBe(exported);
  });
});
