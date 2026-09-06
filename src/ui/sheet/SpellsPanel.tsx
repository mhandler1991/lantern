/**
 * Spells known, by name, with what the loaded packs say about each.
 *
 * A spell is a reference and a name, and nothing else — tier, range, duration and the
 * words of the spell live in a pack and never on the sheet (CLAUDE.md §2.9). So the tier
 * and the DC that follows from it appear exactly while a pack answers for the row, and
 * are absent rather than guessed at when none does.
 *
 * The picker is narrowed to the character's class, because **a spell names its classes,
 * not the other way round** (DATA-MODEL.md §3). A character with no class, or one from a
 * pack that is off, is offered everything loaded: an empty picker reads as a missing
 * pack, and this panel records what a player says they know (PRD.md principle 1).
 *
 * 🚫 Nothing here is adjudicated. The DC is arithmetic on a tier a pack supplied, and
 * the banner says what the class casts on; neither decides whether a spell may be cast.
 *
 * A spell whose pack is off keeps its row and shows what it points at. The name belongs
 * to the pack either way, so a referenced row's name is read only — the row is a record
 * of a spell known, and a pack being off is not the character forgetting it.
 */

import type { ReactElement } from 'react';
import { MAX_NAME_LENGTH, MAX_SPELLS_KNOWN } from '../../constants';
import { spellDC } from '../../model/derived';
import { packOfRef } from '../../model/orphans';
import { appendRow, isAtLimit, newSpell, removeRow, updateRow } from '../../state/character-edits';
import { displayName, spellTier } from '../choices';
import {
  AddFromPack,
  AddRowButton,
  EmptyNote,
  OrphanMark,
  Panel,
  RemoveRowButton,
  TextField,
} from '../fields';
import { formatModifier } from '../format';
import type { CastingProps, ContentProps, OrphanProps, PanelProps } from './sheet-props';

/** Nothing known yet. A floor, not a business rule. */
const NONE = 0;

export function SpellsPanel({
  character,
  setCharacter,
  orphans,
  stack,
  choices,
  casting,
}: PanelProps & OrphanProps & ContentProps & CastingProps): ReactElement {
  const full = isAtLimit(character.spells, MAX_SPELLS_KNOWN);

  return (
    <Panel
      title="Spells"
      aside={
        casting === null
          ? undefined
          : `${casting.stat.toUpperCase()} ${formatModifier(casting.modifier)}`
      }
    >
      {casting !== null && (
        <p className="readout">
          {casting.highestTier === null
            ? 'No tier reached at this level yet.'
            : `Casting up to tier ${casting.highestTier}, DC ${spellDC(casting.highestTier)}.`}
        </p>
      )}

      {character.spells.length === NONE ? (
        <EmptyNote>No spells known.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.spells.map((spell) => {
            const isOrphaned = orphans.rows.has(spell.id);
            const label = displayName(stack, spell.ref, spell.name);
            const tier = spellTier(stack, spell.ref);

            return (
              <li
                key={spell.id}
                className={isOrphaned ? 'row row--spell row--orphaned' : 'row row--spell'}
              >
                <TextField
                  label="Spell"
                  hideLabel
                  placeholder="Spell"
                  value={label}
                  maxLength={MAX_NAME_LENGTH}
                  readOnly={spell.ref !== null}
                  onChange={(name) =>
                    setCharacter((previous) => ({
                      ...previous,
                      spells: updateRow(previous.spells, spell.id, { name }),
                    }))
                  }
                />
                {tier !== null && (
                  <span className="provenance provenance--fact">
                    tier {tier} · DC {spellDC(tier)}
                  </span>
                )}
                <RemoveRowButton
                  label={`Remove ${label === '' ? 'this spell' : label}`}
                  onClick={() =>
                    setCharacter((previous) => ({
                      ...previous,
                      spells: removeRow(previous.spells, spell.id),
                    }))
                  }
                />
                {isOrphaned && spell.ref !== null && <OrphanMark pack={packOfRef(spell.ref)} />}
              </li>
            );
          })}
        </ul>
      )}

      <div className="row-actions">
        <AddRowButton
          label="Add spell"
          disabled={full}
          onClick={() =>
            setCharacter((previous) => ({
              ...previous,
              spells: appendRow(previous.spells, newSpell(), MAX_SPELLS_KNOWN),
            }))
          }
        />
        {choices.spells.length > NONE && (
          <AddFromPack
            label="Add a spell from a pack"
            choices={choices.spells}
            disabled={full}
            onAdd={(ref) =>
              setCharacter((previous) => ({
                ...previous,
                spells: appendRow(previous.spells, newSpell(ref), MAX_SPELLS_KNOWN),
              }))
            }
          />
        )}
      </div>
    </Panel>
  );
}
