// The corner, mounted. Every assertion here is one of #30's acceptance criteria.
//
// Two of them are only checkable in a rendered tree and are the reason this file exists
// rather than more cases in `use-rolls.test.tsx`:
//
//   - **The number on screen is the number that was rolled.** The overlay is driven by
//     the real hook over a scripted random source, the Roll button is really clicked,
//     and the text that comes back is compared to the face the source was told to draw.
//     Nothing decides a result and then renders toward it, and this is what says so.
//   - **A peer's roll cannot be touched.** The card for one has to contain no control at
//     all — DESIGN.md §4's "nobody's screen gets hijacked" is a fact about the markup,
//     not a promise about behaviour.
//
// No @testing-library: CLAUDE.md §12 forbids installing a package without asking.

import type { ReactElement } from 'react';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_OVERLAY_DWELL_MS } from '../constants';
import type { RandomWords } from '../model/dice';
import type { RollEntry, Rolls } from '../state/use-rolls';
import { useRolls } from '../state/use-rolls';
import { DiceOverlay } from './DiceOverlay';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A source that draws the faces it is told to. See `use-rolls.test.tsx`. */
function scripted(...faces: readonly number[]): RandomWords {
  let index = 0;
  return (words) => {
    words[0] = (faces[index % faces.length] as number) - 1;
    index += 1;
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.replaceChildren();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function find<T extends Element>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (found === null) throw new Error(`nothing matched ${selector}`);
  return found;
}

function findAll(selector: string): Element[] {
  return Array.from(container.querySelectorAll(selector));
}

/** The input a label names. Fields are found the way a player finds them. */
function fieldByLabel(text: string): HTMLInputElement {
  const label = findAll('label').find((element) => element.textContent?.trim() === text);
  if (label === undefined) throw new Error(`no field is labelled "${text}"`);

  return find<HTMLInputElement>(`#${CSS.escape((label as HTMLLabelElement).htmlFor)}`);
}

/** The button whose visible text is exactly this. Buttons are found by their words. */
function button(text: string): HTMLButtonElement {
  const found = findAll('button').find((element) => element.textContent?.trim() === text);
  if (found === undefined) throw new Error(`no button reads "${text}"`);
  return found as HTMLButtonElement;
}

async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function type(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    // React listens for `input`, and the value has to be set through the native setter
    // or React's own value tracker swallows the change as a no-op.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// The corner, driven by the real hook
// ---------------------------------------------------------------------------

/** The overlay wired to `useRolls`, exactly as `App.tsx` wires it. */
function Corner({ random }: { readonly random: RandomWords }): ReactElement {
  return <DiceOverlay rolls={useRolls(random)} />;
}

async function mountCorner(random: RandomWords): Promise<void> {
  await act(async () => {
    root.render(<Corner random={random} />);
  });
}

describe('the handle', () => {
  it('is one component in one corner, closed until it is opened', async () => {
    await mountCorner(scripted(1));

    expect(findAll('.dice')).toHaveLength(1);
    expect(container.querySelector('.dice__panel')).toBeNull();
    expect(button('Dice').getAttribute('aria-expanded')).toBe('false');
  });

  it('rolls, then shows the number — the free roll path end to end', async () => {
    await mountCorner(scripted(17));

    await press(button('Dice'));
    await press(button('Roll d20'));

    // The face the source was told to draw, and nothing else.
    expect(find('.dice__total').textContent).toContain('17');
    expect(find('.die__value').textContent).toBe('17');
    expect(find('.dice__notation').textContent).toBe('d20');
  });

  it('draws a silhouette per die in the pool', async () => {
    await mountCorner(scripted(3, 5, 1));

    await press(button('Dice'));
    await type(fieldByLabel('How many'), '3');
    await press(button('Roll 3d20'));

    expect(findAll('.die__shape')).toHaveLength(3);
    expect(findAll('.die__value').map((die) => die.textContent)).toEqual(['3', '5', '1']);
    expect(find('.dice__total').textContent).toContain('9');
  });

  it('says why nothing was rolled rather than showing a number anyway', async () => {
    await mountCorner(() => {
      throw new Error('no entropy');
    });

    await press(button('Dice'));
    await press(button('Roll d20'));

    expect(container.querySelector('.dice__result')).toBeNull();
    expect(find('.warning').textContent).toContain('the random source failed');
  });

  it('leaves a permanent entry in the feed after the card dismisses itself', async () => {
    await mountCorner(scripted(11));

    await press(button('Dice'));
    await press(button('Roll d20'));
    expect(findAll('.dice__entry')).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(DICE_OVERLAY_DWELL_MS);
    });

    expect(container.querySelector('.dice__result'), 'the card outstayed its dwell').toBeNull();
    expect(findAll('.dice__entry'), 'the feed lost its entry').toHaveLength(1);
    expect(find('.dice__entry-total').textContent).toBe('11');
  });

  it('dismisses your own roll on request', async () => {
    await mountCorner(scripted(4));

    await press(button('Dice'));
    await press(button('Roll d20'));
    await press(button('Dismiss'));

    expect(container.querySelector('.dice__result')).toBeNull();
    expect(findAll('.dice__entry')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The card, driven directly
// ---------------------------------------------------------------------------

/**
 * A `Rolls` that shows exactly what a case needs. Driving the component rather than the
 * hook is the only way to render a peer's roll and a table result side by side without
 * standing up a transport that Phase 5 has not built yet.
 */
function fixedRolls(showing: RollEntry | null): Rolls {
  return {
    feed: showing === null ? [] : [showing],
    showing,
    failure: null,
    roll: () => undefined,
    rollTable: () => undefined,
    record: () => undefined,
    dismiss: () => undefined,
  };
}

const MINE: RollEntry = {
  id: 'r_00000000000000aa',
  at: 0,
  origin: { kind: 'mine' },
  label: 'Longsword',
  roll: { dice: [{ sides: 8, value: 6 }], modifier: 2 },
  lookup: null,
  warnings: [],
};

const THEIRS: RollEntry = {
  ...MINE,
  id: 'r_00000000000000bb',
  origin: { kind: 'peer', who: 'Thorin' },
  label: 'Loot',
};

async function mountCard(showing: RollEntry | null): Promise<void> {
  await act(async () => {
    root.render(<DiceOverlay rolls={fixedRolls(showing)} />);
  });
}

describe('someone else’s roll', () => {
  it('says whose it is', async () => {
    await mountCard(THEIRS);
    expect(find('.dice__who').textContent).toContain('Thorin');
  });

  it('carries no control at all — there is nothing on it to hijack a click', async () => {
    await mountCard(THEIRS);

    const card = find('.dice__result');
    expect(card.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
    // The stylesheet takes it out of the pointer's reach; the class is what selects it.
    expect(card.className).toContain('dice__result--peer');
  });

  it('leaves your own card its dismiss', async () => {
    await mountCard(MINE);

    const card = find('.dice__result');
    expect(card.querySelectorAll('button')).toHaveLength(1);
    expect(card.className).not.toContain('dice__result--peer');
  });
});

describe('a table result', () => {
  const ROLLED: RollEntry = {
    ...MINE,
    label: 'Human talents',
    roll: { dice: [{ sides: 6, value: 3 }, { sides: 6, value: 5 }], modifier: 0 },
    lookup: { row: 'The name of a river' },
  };

  it('shows the row in the same card a free roll uses', async () => {
    await mountCard(ROLLED);

    expect(find('.dice__row').textContent).toBe('The name of a river');
    expect(find('.dice__total').textContent).toContain('8');
    expect(findAll('.die__shape'), 'a table roll draws its dice too').toHaveLength(2);
  });

  it('says a number is uncovered rather than filling the gap in', async () => {
    await mountCard({ ...ROLLED, lookup: { row: null } });
    expect(find('.dice__row').textContent).toContain('gap');
  });

  it('prints a row as a text node and never as markup', async () => {
    // The XSS boundary (CLAUDE.md §2.6). A row's text is a pack author's string, and a
    // pack is a file somebody else wrote.
    const hostile = '<img src=x onerror="alert(1)">';
    await mountCard({ ...ROLLED, lookup: { row: hostile } });

    expect(find('.dice__row').textContent).toBe(hostile);
    expect(container.querySelector('img')).toBeNull();
  });

  it('prints a peer’s name as a text node too', async () => {
    const hostile = '<script>alert(1)</script>';
    await mountCard({ ...THEIRS, origin: { kind: 'peer', who: hostile } });

    expect(find('.dice__who').textContent).toContain(hostile);
    expect(container.querySelector('script')).toBeNull();
  });
});
