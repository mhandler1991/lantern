// The two failures this hook exists to prevent, written as tests: a torch that keeps
// twelve minutes it should have burned while the tab was in the background, and a torch
// that forgets it was lit when the page reloads.
//
// Both are the same mistake — treating elapsed time as something the app counts rather
// than something the clock already knows — so both are tested by moving the clock
// without letting the interval fire.
//
// No @testing-library: CLAUDE.md §12 forbids installing a package without asking, and
// createRoot plus React's own act() is the harness the other hook tests already use.

import type { ReactElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_TICK_MS } from '../constants';
import type { Character, Light } from '../model/character';
import { computeBurn } from '../model/light';
import { loadCharacter, saveCharacter } from './character-storage';
import { newLight } from './character-edits';
import { createCharacter } from './new-character';
import { useLightClock } from './use-light-clock';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MINUTE = 60_000;

/** The clock the hook reported on the most recent render. */
let latest: number | null = null;

function Probe({ lights }: { readonly lights: readonly Light[] }): ReactElement {
  latest = useLightClock(lights);
  return <span>{latest}</span>;
}

async function mount(lights: readonly Light[]): Promise<{ unmount: () => Promise<void> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Probe lights={lights} />);
  });

  return {
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

function clock(): number {
  if (latest === null) throw new Error('the probe never rendered');
  return latest;
}

function litTorch(at: number, minutes: number): Light {
  return { ...newLight(), name: 'Torch', litAt: at, minutes };
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

// ---------------------------------------------------------------------------
// Ticking
// ---------------------------------------------------------------------------

describe('while a light is burning', () => {
  it('re-reads the clock on every tick', async () => {
    const start = Date.now();
    const app = await mount([litTorch(start, 60)]);

    await act(async () => {
      vi.advanceTimersByTime(LIGHT_TICK_MS * 3);
    });

    expect(clock()).toBe(start + LIGHT_TICK_MS * 3);
    await app.unmount();
  });

  // The whole point. The tab was away for twenty minutes and the interval fired once, or
  // never; the number on screen is the clock's answer, not a count of ticks.
  it('reports the whole gap a backgrounded tab skipped, on one reading', async () => {
    const start = Date.now();
    const app = await mount([litTorch(start, 60)]);

    // The clock moves without a single timer firing — exactly what a throttled tab does.
    vi.setSystemTime(start + 20 * MINUTE);
    expect(clock()).toBe(start);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(clock()).toBe(start + 20 * MINUTE);
    await app.unmount();
  });
});

// ---------------------------------------------------------------------------
// Not ticking
// ---------------------------------------------------------------------------

describe('while nothing is burning', () => {
  it('starts no interval for a sheet with no lights', async () => {
    const setInterval = vi.spyOn(window, 'setInterval');

    const app = await mount([]);
    await act(async () => {
      vi.advanceTimersByTime(LIGHT_TICK_MS * 10);
    });

    expect(setInterval).not.toHaveBeenCalled();
    await app.unmount();
  });

  it('starts no interval for a light that has not been lit', async () => {
    const setInterval = vi.spyOn(window, 'setInterval');

    const app = await mount([newLight()]);
    await act(async () => {
      vi.advanceTimersByTime(LIGHT_TICK_MS * 10);
    });

    expect(setInterval).not.toHaveBeenCalled();
    await app.unmount();
  });

  // A spent torch is not a burning one, so the tab goes quiet on its own rather than
  // waking once a second for a light that has nothing left to say.
  it('stops once the last light burns out', async () => {
    const start = Date.now();
    const app = await mount([litTorch(start, 1)]);

    await act(async () => {
      vi.advanceTimersByTime(MINUTE + LIGHT_TICK_MS);
    });
    const whenItWentOut = clock();

    await act(async () => {
      vi.advanceTimersByTime(30 * LIGHT_TICK_MS);
    });

    expect(clock()).toBe(whenItWentOut);
    await app.unmount();
  });
});

// ---------------------------------------------------------------------------
// Across a reload
// ---------------------------------------------------------------------------

describe('a torch lit before the page was reloaded', () => {
  /** What survives a reload is the sheet in storage, so a reload is a load. */
  function reload(): Character {
    const load = loadCharacter();
    if (load.kind !== 'loaded') throw new Error(`expected a stored character, got ${load.kind}`);
    return load.character;
  }

  /** The torch that came back, or a failure that names what came back instead. */
  function onlyLight(character: Character): Light {
    const [light] = character.lights;
    if (light === undefined) throw new Error('the reloaded sheet has no light on it');
    return light;
  }

  it('comes back with the time it spent while the page was gone', async () => {
    const start = Date.now();
    const lit = { ...createCharacter('c_vess', 'Vess'), lights: [litTorch(start, 60)] };
    expect(saveCharacter(lit)).toEqual({ ok: true });

    // The tab is closed for twenty minutes. Nothing runs; the clock keeps going.
    vi.setSystemTime(start + 20 * MINUTE);

    const reopened = reload();
    const app = await mount(reopened.lights);
    const burn = computeBurn(onlyLight(reopened), clock());

    expect(burn.elapsedMs).toBe(20 * MINUTE);
    expect(burn.remainingMs).toBe(40 * MINUTE);
    expect(burn.isBurning).toBe(true);
    await app.unmount();
  });

  it('is out when it was reopened after it would have burned down', async () => {
    const start = Date.now();
    const lit = { ...createCharacter('c_vess', 'Vess'), lights: [litTorch(start, 60)] };
    saveCharacter(lit);

    vi.setSystemTime(start + 3 * 60 * MINUTE);

    const reopened = reload();
    const app = await mount(reopened.lights);

    expect(computeBurn(onlyLight(reopened), clock()).isSpent).toBe(true);
    await app.unmount();
  });

  it('stores when it was lit and nothing about what is left of it', async () => {
    const start = Date.now();
    const lit = { ...createCharacter('c_vess', 'Vess'), lights: [litTorch(start, 60)] };
    saveCharacter(lit);

    vi.setSystemTime(start + 20 * MINUTE);
    const app = await mount(reload().lights);
    await act(async () => {
      vi.advanceTimersByTime(LIGHT_TICK_MS * 5);
    });

    // Twenty minutes of burn and five ticks later, the stored row is byte for byte what
    // was written. Nothing counted down into storage (DATA-MODEL.md §11).
    expect(reload().lights).toEqual(lit.lights);
    await app.unmount();
  });
});
