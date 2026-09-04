// The lobby's job is to survive a room code making the trip from one person's screen to
// another person's keyboard, via a voice call or a pasted link. So these tests are about
// that trip: a code typed in the wrong case with a hyphen in it, a link opened in a
// second browser, and a clipboard that is not there.
//
// No @testing-library — React 18.3 exports `act`, and CLAUDE.md §12 forbids installing a
// package without asking. createRoot plus native events is the whole harness.

import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ROOM_PASSWORD_LENGTH, ROOM_CODE_LENGTH, ROOM_CODE_QUERY_PARAM } from '../constants';
import { isCompleteRoomCode } from '../net/room-code';
import { App } from './App';

declare global {
  // React reads this off the global to decide whether act() is legal here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<App />);
  });
}

/** Opens the app at a URL, the way following an invite does. */
async function open(search: string): Promise<void> {
  window.history.replaceState({}, '', `/${search}`);
  await mount();
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** React owns the value setter, so a real keystroke goes through the prototype. */
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

function hasField(label: string): boolean {
  return [...container.querySelectorAll('label')].some(
    (element) => element.textContent === label,
  );
}

const CODE = 'ABCDEF';

describe('opening an invite', () => {
  it('prefills the code from ?r=', async () => {
    await open(`?${ROOM_CODE_QUERY_PARAM}=${CODE}`);
    expect(fieldLabelled('Room code').value).toBe(CODE);
  });

  it('tidies a code that arrived in the wrong case', async () => {
    await open(`?${ROOM_CODE_QUERY_PARAM}=abc-def`);
    expect(fieldLabelled('Room code').value).toBe(CODE);
  });

  it('fills in nothing, and says so, when the link is not readable', async () => {
    await open(`?${ROOM_CODE_QUERY_PARAM}=ABC`);

    expect(fieldLabelled('Room code').value).toBe('');
    expect(container.textContent).toContain('did not carry a room code');
  });

  it('starts empty when there is no invite at all', async () => {
    await mount();
    expect(fieldLabelled('Room code').value).toBe('');
    expect(container.textContent).not.toContain('did not carry a room code');
  });
});

describe('the room code', () => {
  it('normalises what is typed, including a code pasted with a hyphen', async () => {
    await mount();
    const field = fieldLabelled('Room code');

    await type(field, 'abc-def');
    expect(field.value).toBe(CODE);
  });

  it('drops a character the alphabet does not have rather than refusing the code', async () => {
    await mount();
    const field = fieldLabelled('Room code');

    await type(field, 'ABC0DEF');
    expect(field.value).toBe(CODE);
  });

  it('stops at a full code', async () => {
    await mount();
    const field = fieldLabelled('Room code');

    await type(field, 'ABCDEFGHJK');
    expect(field.value).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('draws one that is a real code', async () => {
    await mount();
    await click(button('Draw a code'));

    expect(isCompleteRoomCode(fieldLabelled('Room code').value)).toBe(true);
  });
});

describe('the invite link', () => {
  it('appears only once the code is complete', async () => {
    await mount();
    expect(hasField('Invite link')).toBe(false);

    await type(fieldLabelled('Room code'), 'ABCDE');
    expect(hasField('Invite link')).toBe(false);

    await type(fieldLabelled('Room code'), CODE);
    expect(hasField('Invite link')).toBe(true);
  });

  it('carries the code in the query string and never in the path', async () => {
    // DEPLOY.md §1 — Pages cannot rewrite paths, so a path-based invite would 404.
    await mount();
    await type(fieldLabelled('Room code'), CODE);

    const link = new URL(fieldLabelled('Invite link').value);
    expect(link.searchParams.get(ROOM_CODE_QUERY_PARAM)).toBe(CODE);
    expect(link.pathname).toBe(window.location.pathname);
  });

  it('round-trips: the link one browser shows is the code the next one opens with', async () => {
    await mount();
    await type(fieldLabelled('Room code'), CODE);
    const link = fieldLabelled('Invite link').value;

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await open(new URL(link).search);

    expect(fieldLabelled('Room code').value).toBe(CODE);
  });

  it('is read-only, so the link shown is always the link the code makes', async () => {
    await mount();
    await type(fieldLabelled('Room code'), CODE);

    expect(fieldLabelled('Invite link').readOnly).toBe(true);
  });

  it('never carries the password', async () => {
    await mount();
    await type(fieldLabelled('Room code'), CODE);
    await type(fieldLabelled('Password (optional)'), 'moonlight');

    expect(fieldLabelled('Invite link').value).not.toContain('moonlight');
  });
});

describe('copying the link', () => {
  function withClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies the link and says it did', async () => {
    const copied: string[] = [];
    withClipboard(async (text) => {
      copied.push(text);
    });

    await mount();
    await type(fieldLabelled('Room code'), CODE);
    await click(button('Copy link'));

    expect(copied).toEqual([fieldLabelled('Invite link').value]);
    expect(container.textContent).toContain('Copied.');
  });

  it('degrades to copying by hand when there is no clipboard', async () => {
    // jsdom has none, which is also what an http page gets: the API is undefined
    // outside a secure context. DEPLOY.md §1.
    await mount();
    await type(fieldLabelled('Room code'), CODE);
    await click(button('Copy link'));

    expect(container.textContent).toContain('copy it by hand');
    expect(fieldLabelled('Invite link').value).toContain(CODE);
  });

  it('degrades the same way when the clipboard refuses', async () => {
    withClipboard(async () => {
      throw new Error('denied');
    });

    await mount();
    await type(fieldLabelled('Room code'), CODE);
    await click(button('Copy link'));

    expect(container.textContent).toContain('copy it by hand');
  });
});

describe('the password', () => {
  it('is optional, and the room works without one', async () => {
    await mount();
    await type(fieldLabelled('Room code'), CODE);

    expect(fieldLabelled('Password (optional)').value).toBe('');
    expect(hasField('Invite link')).toBe(true);
  });

  it('is not masked, because it is not a secret', async () => {
    // DESIGN.md §2 — a courtesy lock. A masked field would imply a boundary the app
    // does not have (PRD.md principle 3).
    await mount();
    expect(fieldLabelled('Password (optional)').type).toBe('text');
  });

  it('is bounded', async () => {
    await mount();
    const field = fieldLabelled('Password (optional)');

    await type(field, 'x'.repeat(MAX_ROOM_PASSWORD_LENGTH + 50));
    expect(field.value).toHaveLength(MAX_ROOM_PASSWORD_LENGTH);
  });
});

describe('the sheet', () => {
  it('is still there with no room at all', async () => {
    // PRD.md principle 6 — everything is optional except the sheet.
    await mount();
    expect(hasField('Room code')).toBe(true);
    expect(container.querySelector('.sheet')).not.toBeNull();
  });
});
