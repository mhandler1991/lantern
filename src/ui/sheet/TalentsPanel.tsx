/**
 * Talents, as text.
 *
 * This panel is PRD.md principle 1 made visible: a talent that reads "+1 to melee
 * attacks" is a paragraph on a sheet and nothing more. Nothing here touches a stat, and
 * there is no field that could. A rolled one arrives with its `source` and the number
 * that produced it, and those are shown beside it — a record of where the words came
 * from, so a pack can be re-offered after it is turned off.
 *
 * **Levelling up is what opens the class's talent table** (DESIGN.md §4 — a table roll
 * arrives from context and is never chosen from the corner). The level is watched rather
 * than stored: this panel remembers the one it last settled, and a level above it is an
 * offer to roll. Adjusted during render rather than in an effect, which is the pattern
 * `state/use-recorded-packs.ts` documents — an effect here would be state derived from
 * state, one render late (CLAUDE.md §6). A level typed back down is not a level up, and
 * neither is a different character arriving in the same panel: an imported sheet at
 * level five was not just advanced to it.
 *
 * **The row it lands on is recorded as words and nothing else** — its text, the table it
 * came from, the total that found it. 🚫 No stat moves, no bonus is applied, and nothing
 * reads the text on the way past (PRD.md principle 1, DATA-MODEL.md §8). A roll that
 * lands on a face no row covers writes nothing at all: the corner says the table has a
 * gap, and a blank talent would be worse than none.
 *
 * **The picker is the one on the sheet that copies rather than references.** Every other
 * one stores a reference and reads the word back out of the stack each render; a talent
 * stores the words themselves plus a `source` (DATA-MODEL.md §12), so the box stays the
 * player's to edit and turning the pack off leaves the paragraph exactly where it was.
 * That is the whole reason the format is shaped that way, and it is why this panel takes
 * no orphan report: it has no row that a missing pack could orphan.
 *
 * What it offers is what an extension gave the character's class (DATA-MODEL.md §9), and
 * nothing when they have no class or the class was offered none — the free-text row is
 * how everything else gets recorded, which is what it was already for.
 */

import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { MAX_TALENTS, MAX_TEXT_LENGTH } from '../../constants';
import { rollTotal } from '../../model/dice';
import { talentTableFor } from '../../model/pack-resolver';
import { rollableTable } from '../../model/tables';
import {
  appendRow,
  isAtLimit,
  newTalent,
  removeRow,
  rolledTalent,
  updateRow,
} from '../../state/character-edits';
import { talentWords } from '../choices';
import {
  AddFromPack,
  AddRowButton,
  EmptyNote,
  Panel,
  RemoveRowButton,
  RollButton,
  TextAreaField,
} from '../fields';
import type { ContentProps, PanelProps, RollsProps } from './sheet-props';

/** Nothing written down yet. A floor, not a business rule. */
const NONE = 0;

/** Enough to read a talent without scrolling it, small enough to list several. */
const TALENT_ROWS = 2;

/** The sheet this panel last settled a level for. A different one is not a level up. */
type Settled = {
  readonly id: string;
  readonly level: number;
};

export function TalentsPanel({
  character,
  setCharacter,
  stack,
  choices,
  rolls,
}: PanelProps & ContentProps & RollsProps): ReactElement {
  const full = isAtLimit(character.talents, MAX_TALENTS);

  /** The class's own table, or null when no loaded pack answers for one. */
  const table = useMemo(
    () => talentTableFor(stack, character.class.ref),
    [stack, character.class.ref],
  );

  const [settled, setSettled] = useState<Settled>({ id: character.id, level: character.level });

  // A different character, or one stepped back down, settles where it is: neither is an
  // advance. Adjusted during render, so nothing downstream ever sees the stale answer.
  if (settled.id !== character.id || character.level < settled.level) {
    setSettled({ id: character.id, level: character.level });
  }

  const isLevelUp = settled.id === character.id && character.level > settled.level;

  /**
   * Roll the class's table and write down what it said.
   *
   * The level-up offer is settled first, whatever the dice do: a roll that failed or fell
   * in a gap was still the player taking their level up, and an offer that came back
   * would be the app nagging about a thing it cannot know is undone.
   *
   * **The words are written when the result is the result, not when the dice stop.** A
   * `rerollable` table offers a reroll *before* the result is kept (DATA-MODEL.md §8), so
   * the sheet is told through the corner's callback rather than from the return value —
   * a talent the player rolled away must never have been on the sheet to begin with. On
   * a table that offers nothing the callback fires immediately and the two are the same.
   */
  const rollTalents = (): void => {
    if (table === null) return;
    setSettled({ id: character.id, level: character.level });

    rolls.rollTable(rollableTable(table), table.entry.name, (kept) => {
      const words = kept.lookup?.row ?? null;
      if (words === null) return;

      setCharacter((previous) => ({
        ...previous,
        talents: appendRow(
          previous.talents,
          // 🚫 Recorded, never applied. The words are copied onto the sheet and nothing
          // in the app reads them again (PRD.md principle 1).
          rolledTalent(words, table.ref, rollTotal(kept.roll)),
          MAX_TALENTS,
        ),
      }));
    });
  };

  return (
    <Panel title="Talents">
      {isLevelUp && table !== null && (
        <p className="prompt" role="status">
          Level {character.level}. Roll on {table.entry.name}, or write in what you took.
        </p>
      )}
      {character.talents.length === NONE ? (
        <EmptyNote>No talents yet.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.talents.map((talent) => (
            <li key={talent.id} className="row row--talent">
              <TextAreaField
                label="Talent"
                hideLabel
                placeholder="What the talent says"
                value={talent.text}
                maxLength={MAX_TEXT_LENGTH}
                rows={TALENT_ROWS}
                onChange={(text) =>
                  setCharacter((previous) => ({
                    ...previous,
                    talents: updateRow(previous.talents, talent.id, { text }),
                  }))
                }
              />
              {talent.rolled !== null && (
                <span className="provenance">rolled {talent.rolled}</span>
              )}
              <RemoveRowButton
                label="Remove this talent"
                onClick={() =>
                  setCharacter((previous) => ({
                    ...previous,
                    talents: removeRow(previous.talents, talent.id),
                  }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        {table !== null && (
          <RollButton
            text={`Roll on ${table.entry.name}`}
            label={`Roll on ${table.entry.name}`}
            disabled={full}
            onClick={rollTalents}
          />
        )}
        <AddRowButton
          label="Add talent"
          disabled={full}
          onClick={() =>
            setCharacter((previous) => ({
              ...previous,
              talents: appendRow(previous.talents, newTalent(), MAX_TALENTS),
            }))
          }
        />
        {choices.talents.length > NONE && (
          <AddFromPack
            label="Add a talent from a pack"
            choices={choices.talents}
            disabled={full}
            onAdd={(ref) =>
              setCharacter((previous) => ({
                ...previous,
                talents: appendRow(
                  previous.talents,
                  newTalent(talentWords(stack, ref), ref),
                  MAX_TALENTS,
                ),
              }))
            }
          />
        )}
      </div>
    </Panel>
  );
}
