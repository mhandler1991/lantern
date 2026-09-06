// The party view draws data that came off the wire, so these tests are about what it
// does with data a peer chose: HP that moves, HP that cannot be divided by, a condition
// sent twice, and a name that is markup. The projection is fabricated directly rather
// than driven through a fake transport — `ui/hostile-peer.test.tsx` already proves the
// whole path from Trystero to the DOM, and what is left to check here is the drawing.
//
// The last test is the acceptance criterion that matters most and the one that would
// otherwise be checked by remembering: the party view must never write to another
// player's character (CLAUDE.md §4). It is asserted structurally — no control of any
// kind in the rendered tree — because a component with nothing to click cannot write.
//
// No @testing-library: CLAUDE.md §11 forbids installing a package without asking, and
// createRoot plus act is the whole harness.

import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PresenceMember } from '../net/presence';
import type { PublicCharacter } from '../net/protocol';
import type { PeerId } from '../net/transport';
import { shortPeerId } from '../net/transport';
import { PartyView } from './PartyView';
import { describeCharacter, distinctConditions, hpBarPercent, isDown, memberName } from './party';

declare global {
  // React reads this off the global to decide whether act() is legal here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SELF: PeerId = 's'.repeat(40);
const PEER: PeerId = 'p'.repeat(40);

const US: PublicCharacter = {
  name: 'Vess',
  ancestry: 'Human',
  className: 'Thief',
  level: 3,
  hp: { current: 9, max: 12 },
  ac: 14,
  conditions: [],
  carryingLight: false,
  luck: 1,
};

function member(
  id: PeerId,
  character: PublicCharacter | null,
  isSelf = false,
): PresenceMember {
  return { id, isSelf, joinedAt: 1_700_000_000_000, character };
}

let container: HTMLDivElement;
let root: Root;

async function draw(members: readonly PresenceMember[], hostId: PeerId | null = SELF): Promise<void> {
  await act(async () => {
    root.render(<PartyView members={members} hostId={hostId} />);
  });
}

function textOf(selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((node) => node.textContent ?? '');
}

/** The fill's own width, as the component set it. */
function barWidths(): string[] {
  return [...container.querySelectorAll<HTMLElement>('.party__bar-fill')].map(
    (node) => node.style.width,
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  document.body.replaceChildren();
});

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

describe('the HP bar', () => {
  it('fills in proportion', () => {
    expect(hpBarPercent({ current: 6, max: 12 })).toBe(50);
    expect(hpBarPercent({ current: 12, max: 12 })).toBe(100);
    expect(hpBarPercent({ current: 0, max: 12 })).toBe(0);
  });

  it('draws an unfilled sheet empty rather than dividing by its maximum', () => {
    // A blank character is a real character (DATA-MODEL.md §12) and it arrives with
    // `max: 0`. Without the guard this is NaN, and a NaN width is a bar that vanishes.
    expect(hpBarPercent({ current: 0, max: 0 })).toBe(0);
    expect(hpBarPercent({ current: 5, max: 0 })).toBe(0);
  });

  it('clamps a peer who is bleeding out or blessed', () => {
    expect(hpBarPercent({ current: -8, max: 12 })).toBe(0);
    expect(hpBarPercent({ current: 20, max: 12 })).toBe(100);
  });

  it('calls nobody down for a sheet whose maximum is not filled in yet', () => {
    expect(isDown({ current: 0, max: 12 })).toBe(true);
    expect(isDown({ current: -3, max: 12 })).toBe(true);
    expect(isDown({ current: 1, max: 12 })).toBe(false);
    expect(isDown({ current: 0, max: 0 })).toBe(false);
  });
});

describe('the line under a name', () => {
  it('reads level, ancestry and class', () => {
    expect(describeCharacter(US)).toBe('Level 3 Human Thief');
  });

  it('says what it has when creation has not finished', () => {
    expect(describeCharacter({ ...US, level: 0, ancestry: '', className: '' })).toBe('Level 0');
    expect(describeCharacter({ ...US, ancestry: '  ', className: 'Wizard' })).toBe(
      'Level 3 Wizard',
    );
  });
});

describe('the name', () => {
  it('falls back to the peer id when no hello has landed', () => {
    expect(memberName(null, PEER)).toBe(`${shortPeerId(PEER)}…`);
  });

  it('names an unnamed character rather than drawing an empty row', () => {
    expect(memberName({ ...US, name: '   ' }, PEER)).toBe('An unnamed character');
  });
});

describe('conditions from a peer', () => {
  it('collapses a repeat, because a bare string is its own React key', () => {
    // Our own sheet cannot hold one; a peer's payload can, and two identical keys is a
    // React warning at best and a dropped row at worst.
    expect(distinctConditions(['poisoned', 'poisoned', 'prone'])).toEqual(['poisoned', 'prone']);
  });
});

// ---------------------------------------------------------------------------
// The drawing
// ---------------------------------------------------------------------------

describe('the party view', () => {
  it("draws every peer's whole public projection", async () => {
    await draw([
      member(SELF, US, true),
      member(PEER, { ...US, name: 'Corvin', className: 'Wizard', ac: 11, luck: 0 }),
    ]);

    expect(textOf('.party__name')).toEqual(['Vess', 'Corvin']);
    expect(textOf('.party__billing')).toEqual(['Level 3 Human Thief', 'Level 3 Human Wizard']);
    expect(container.textContent).toContain('HP 9 / 12');
    expect(container.textContent).toContain('AC 14');
    expect(container.textContent).toContain('AC 11');
    expect(container.textContent).toContain('Luck 0');
  });

  it('numbers the seats in marching order', async () => {
    await draw([member(SELF, US, true), member(PEER, US), member('third', US)]);
    expect(textOf('.party__position')).toEqual(['1', '2', '3']);
  });

  it('marks the host and ourselves, and nobody else', async () => {
    await draw([member(SELF, US, true), member(PEER, US)], PEER);

    const tags = [...container.querySelectorAll('.party__member')].map((row) =>
      [...row.querySelectorAll('.party__tag')].map((tag) => tag.textContent),
    );
    expect(tags).toEqual([['you'], ['host']]);
  });

  it('shows HP changing without anything having to be told to look', async () => {
    await draw([member(PEER, US)]);
    expect(barWidths()).toEqual(['75%']);

    // Exactly what arriving `state` does: the roster hands down a new projection.
    await draw([member(PEER, { ...US, hp: { current: 3, max: 12 } })]);
    expect(barWidths()).toEqual(['25%']);
    expect(container.textContent).toContain('HP 3 / 12');
    expect(container.querySelector('.party__hp-count--down')).toBeNull();

    await draw([member(PEER, { ...US, hp: { current: -2, max: 12 } })]);
    expect(barWidths()).toEqual(['0%']);
    expect(container.querySelector('.party__hp-count--down')?.textContent).toContain('HP -2 / 12');
  });

  it('says who is carrying a light, and says nothing about who is not', async () => {
    await draw([
      member(SELF, { ...US, carryingLight: true }, true),
      member(PEER, { ...US, carryingLight: false }),
    ]);

    const lights = [...container.querySelectorAll('.party__member')].map(
      (row) => row.querySelectorAll('.party__tag--light').length,
    );
    expect(lights).toEqual([1, 0]);
    expect(container.textContent).toContain('carrying light');
  });

  it('draws conditions as chips, once each', async () => {
    await draw([member(PEER, { ...US, conditions: ['poisoned', 'poisoned', 'prone'] })]);
    expect(textOf('.party__conditions .chip')).toEqual(['poisoned', 'prone']);
  });

  it('draws a connected peer that has not introduced itself, without inventing vitals', async () => {
    await draw([member(SELF, US, true), member(PEER, null)]);

    expect(textOf('.party__name')[1]).toBe(`${shortPeerId(PEER)}…`);
    expect(container.textContent).toContain('has not said who they are yet');
    // One projection at the table, so one HP bar — not a zeroed row for the silent peer.
    expect(barWidths()).toHaveLength(1);
  });

  it('renders a peer name as text, with no element made from it', async () => {
    const markup = '<img src=x onerror="document.title=\'pwned\'">';
    document.title = 'lantern under test';
    await draw([member(PEER, { ...US, name: markup, conditions: ['<b>prone</b>'] })]);

    const [name] = [...container.querySelectorAll('.party__name')];
    expect(name?.textContent).toBe(markup);
    expect([...(name?.childNodes ?? [])].every((node) => node.nodeType === Node.TEXT_NODE)).toBe(
      true,
    );
    expect(textOf('.party__conditions .chip')).toEqual(['<b>prone</b>']);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(document.title).toBe('lantern under test');
  });

  it('offers nothing that could write to another character', async () => {
    await draw([
      member(SELF, US, true),
      member(PEER, { ...US, conditions: ['poisoned'], carryingLight: true }),
    ]);

    // CLAUDE.md §4 — one writer per character. The party view is a readout, and this is
    // that rule as a property of the DOM rather than a promise in a comment.
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('select, textarea')).toHaveLength(0);
    expect(container.querySelectorAll('[contenteditable]')).toHaveLength(0);
  });
});
