// Issue #34's three acceptance criteria, driven through the real app: a step sequence
// with progress, a walkthrough that survives the tab closing, and a valid `Character`
// at the end of it.
//
// The third is the one worth being careful about. The walkthrough writes to the sheet
// rather than to a draft, so "produces a valid character" is a claim about what is under
// the storage key when the tab shuts — not about what some in-memory object looked like
// on the last step. Every assertion below therefore reads storage back and parses it the
// way the next visit will.
//
// No @testing-library: React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking. createRoot plus native events is the whole harness.

import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREATION_FORMAT, CREATION_FORMAT_VERSION } from '../../constants';
import type { Character } from '../../model/character';
import { parseCharacter } from '../../model/character';
import { CHARACTER_KEY } from '../../state/character-storage';
import { CREATION_KEY } from '../../state/creation-storage';
import { createCharacter } from '../../state/new-character';
import { App } from '../App';
import { CREATION_STEPS } from './creation';

declare global {
  // React reads this off the global to decide whether act() is legal here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let isMounted = false;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  isMounted = false;
});

afterEach(async () => {
  // A mounted sheet keeps a debounced write in flight and flushes it on unmount, which
  // is the app's own tab-closed path. A test that ends still mounted leaves that timer
  // to fire during a later one.
  await closeTheTab();
  document.body.replaceChildren();
  localStorage.clear();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<App />);
  });
  isMounted = true;
}

async function closeTheTab(): Promise<void> {
  if (!isMounted) return;

  isMounted = false;
  await act(async () => {
    root.unmount();
  });
}

/** Close the tab and open it again, on the same storage. The resume path exactly. */
async function reopen(): Promise<void> {
  await closeTheTab();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await mount();
}

function buttons(): readonly HTMLButtonElement[] {
  return [...container.querySelectorAll('button')];
}

function button(label: string): HTMLButtonElement {
  const found = buttons().find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

/** The forward button carries the next step's name, so it is matched by its prefix. */
function nextButton(): HTMLButtonElement {
  const found = buttons().find((element) => element.textContent?.startsWith('Next:'));
  if (!found) throw new Error('no Next button');
  return found;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function isWalkingThrough(): boolean {
  return container.querySelector('.walkthrough') !== null;
}

function position(): string {
  const found = container.querySelector('.walkthrough__position');
  if (!found) throw new Error('the walkthrough is not on screen');
  return found.textContent ?? '';
}

/** The step marked as the one we are on, read off the progress list. */
function markedStep(): string {
  const found = container.querySelector('.walkthrough__step--here');
  return found?.textContent ?? '';
}

function panelTitles(): readonly string[] {
  return [...container.querySelectorAll('.panel__title')].map(
    (element) => element.textContent ?? '',
  );
}

/** The panels inside the walkthrough only — the packs and the character file sit above it. */
function stepPanelTitles(): readonly string[] {
  const walkthrough = container.querySelector('.walkthrough');
  if (walkthrough === null) throw new Error('the walkthrough is not on screen');

  return [...walkthrough.querySelectorAll('.panel__title')].map(
    (element) => element.textContent ?? '',
  );
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

/** What is under the storage key, parsed the way the next visit will parse it. */
function stored(): Character {
  const raw = localStorage.getItem(CHARACTER_KEY);
  if (raw === null) throw new Error('nothing was saved');

  const parsed = parseCharacter(JSON.parse(raw));
  if (!parsed.ok) throw new Error(`the saved character does not parse: ${parsed.problems[0]?.path}`);
  return parsed.character;
}

function bookmark(): unknown {
  const raw = localStorage.getItem(CREATION_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/** Press Next until there is no Next — the last step is the one without one. */
async function walkToTheEnd(): Promise<void> {
  for (let guard = 0; guard < CREATION_STEPS.length; guard += 1) {
    const next = buttons().find((element) => element.textContent?.startsWith('Next:'));
    if (next === undefined) return;

    await click(next);
  }
  throw new Error('the sequence never reached a step without a Next button');
}

describe('the creation walkthrough', () => {
  it('is offered rather than imposed, and takes the sheet’s place when accepted', async () => {
    await mount();

    expect(isWalkingThrough()).toBe(false);
    expect(panelTitles()).toContain('Journal');

    await click(button('Walk me through it'));

    expect(isWalkingThrough()).toBe(true);
    expect(position()).toContain('Step 1 of 8');
    // One panel, not the sheet's twelve: the walkthrough is the sheet with everything
    // but one panel put away.
    expect(stepPanelTitles()).toEqual(['Abilities']);
  });

  it('steps forward and back, and says where it is', async () => {
    await mount();
    await click(button('Walk me through it'));

    expect(markedStep()).toBe('Abilities');

    await click(nextButton());
    expect(position()).toContain('Step 2 of 8');
    expect(markedStep()).toBe('Who they are');
    expect(stepPanelTitles()).toEqual(['Character']);

    await click(button('Back'));
    expect(position()).toContain('Step 1 of 8');
    expect(markedStep()).toBe('Abilities');

    // The first step has nowhere to go back to, and says so rather than looping.
    expect(button('Back').disabled).toBe(true);
  });

  it('resumes where it was when the tab closes mid-creation', async () => {
    await mount();
    await click(button('Walk me through it'));
    await click(nextButton());
    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    await reopen();

    expect(isWalkingThrough()).toBe(true);
    expect(position()).toContain('Step 2 of 8');
    expect(fieldLabelled('Name').value).toBe('Vess of the Low Road');
    expect(stored().name).toBe('Vess of the Low Road');
  });

  it('produces a character that parses, and puts the sheet back', async () => {
    await mount();
    await click(button('Walk me through it'));

    await type(fieldLabelled('Strength'), '13');
    await click(nextButton());
    await type(fieldLabelled('Name'), 'Vess of the Low Road');
    await walkToTheEnd();

    expect(position()).toContain('Step 8 of 8');
    expect(container.querySelector('.walkthrough__missing')?.textContent).toContain('an ancestry');

    await click(button('Finish'));

    expect(isWalkingThrough()).toBe(false);
    expect(panelTitles()).toContain('Journal');
    expect(bookmark()).toBeNull();

    await closeTheTab();

    const character = stored();
    expect(character.name).toBe('Vess of the Low Road');
    expect(character.stats.str).toBe(13);
  });

  it('lets a player leave at any step, keeping everything they entered', async () => {
    await mount();
    await click(button('Walk me through it'));
    await type(fieldLabelled('Strength'), '15');
    await click(nextButton());
    await click(button('Leave the walkthrough'));

    expect(isWalkingThrough()).toBe(false);
    expect(bookmark()).toBeNull();
    expect(fieldLabelled('Strength').value).toBe('15');

    await closeTheTab();
    expect(stored().stats.str).toBe(15);
  });

  it('ignores a stored position that belongs to another character', async () => {
    const character = createCharacter('c_0f0f0f', 'Someone else');
    localStorage.setItem(CHARACTER_KEY, JSON.stringify(character));
    localStorage.setItem(
      CREATION_KEY,
      JSON.stringify({
        format: CREATION_FORMAT,
        formatVersion: CREATION_FORMAT_VERSION,
        characterId: 'c_aaaaaa',
        step: 'gear',
      }),
    );

    await mount();

    // A bookmark into a character this browser is not showing points nowhere, and the
    // sheet opens as it would have anyway. The stored value is left where it was.
    expect(isWalkingThrough()).toBe(false);
    expect(bookmark()).not.toBeNull();
  });
});
