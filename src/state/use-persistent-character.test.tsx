// The loop the issue is actually about: type, close the tab, come back, still there.
//
// No @testing-library — CLAUDE.md §12 forbids installing a package without asking, and
// createRoot plus React's own act() is the whole harness the smoke test already uses.

import type { ReactElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSIST_DEBOUNCE_MS } from '../constants';
import { CHARACTER_KEY, REJECTED_CHARACTER_KEY, saveCharacter } from './character-storage';
import { createCharacter } from './new-character';
import type { PersistentCharacter } from './use-persistent-character';
import { usePersistentCharacter } from './use-persistent-character';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vess = createCharacter('c_vess', 'Vess of the Low Road');

/** The hook's return value, captured from inside a render. */
let latest: PersistentCharacter | null = null;

function Probe(): ReactElement {
  latest = usePersistentCharacter();
  return <span>{latest.character.name}</span>;
}

type Mounted = { readonly unmount: () => Promise<void>; readonly hook: () => PersistentCharacter };

async function mount(): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Probe />);
  });

  return {
    hook: () => {
      if (!latest) throw new Error('the probe never rendered');
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

function stored(): unknown {
  const raw = localStorage.getItem(CHARACTER_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  latest = null;
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('boot', () => {
  it('opens the stored character rather than a new one', async () => {
    saveCharacter(vess);

    const app = await mount();

    expect(app.hook().character).toEqual(vess);
    expect(app.hook().load.kind).toBe('loaded');
    await app.unmount();
  });

  it('opens a new character when there is nothing stored', async () => {
    const app = await mount();

    expect(app.hook().load.kind).toBe('empty');
    expect(app.hook().character.name).toBe('');
    await app.unmount();
  });

  it('opens a new character when the stored one cannot be read, and keeps the old value', async () => {
    localStorage.setItem(CHARACTER_KEY, '{ not json');

    const app = await mount();

    expect(app.hook().load.kind).toBe('rejected');
    expect(app.hook().character.name).toBe('');
    expect(localStorage.getItem(REJECTED_CHARACTER_KEY)).toBe('{ not json');
    await app.unmount();
  });

  it('writes nothing on boot — a load is not an edit', async () => {
    saveCharacter(vess);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const app = await mount();
    await act(async () => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2);
    });

    expect(setItem).not.toHaveBeenCalled();
    await app.unmount();
  });
});

describe('autosave', () => {
  it('writes an edit once the debounce has elapsed, and not before', async () => {
    const app = await mount();

    await act(async () => {
      app.hook().setCharacter((previous) => ({ ...previous, name: 'Vess' }));
    });

    await act(async () => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
    });
    expect(stored()).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(stored()).toMatchObject({ name: 'Vess' });

    await app.unmount();
  });

  it('coalesces a burst of keystrokes into one write', async () => {
    const app = await mount();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    for (const name of ['V', 'Ve', 'Ves', 'Vess']) {
      await act(async () => {
        app.hook().setCharacter((previous) => ({ ...previous, name }));
      });
      await act(async () => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS / 2);
      });
    }

    await act(async () => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    });

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ name: 'Vess' });
    await app.unmount();
  });

  it('reports a write that failed instead of failing silently', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('exceeded the quota', 'QuotaExceededError');
    });

    const app = await mount();
    await act(async () => {
      app.hook().setCharacter((previous) => ({ ...previous, name: 'Vess' }));
    });
    await act(async () => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    });

    const save = app.hook().lastSave;
    expect(save?.ok).toBe(false);
    if (save && !save.ok && save.reason === 'storage') expect(save.failure.kind).toBe('quota');

    await app.unmount();
  });
});

describe('the last keystroke', () => {
  it('survives the tab going away before the debounce elapses', async () => {
    const app = await mount();

    await act(async () => {
      app.hook().setCharacter((previous) => ({ ...previous, name: 'Vess' }));
    });
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(stored()).toMatchObject({ name: 'Vess' });
    await app.unmount();
  });

  it('survives an unmount before the debounce elapses', async () => {
    const app = await mount();

    await act(async () => {
      app.hook().setCharacter((previous) => ({ ...previous, name: 'Vess' }));
    });
    await app.unmount();

    expect(stored()).toMatchObject({ name: 'Vess' });
  });

  it('reloads as what was typed', async () => {
    const first = await mount();
    await act(async () => {
      first.hook().setCharacter((previous) => ({ ...previous, name: 'Vess' }));
    });
    await first.unmount();

    latest = null;
    const second = await mount();

    expect(second.hook().character.name).toBe('Vess');
    await second.unmount();
  });
});
