/**
 * Who this is: name, ancestry, class, alignment, and where they are on the way up.
 *
 * Ancestry and class are typed in. From Phase 2 a pack drives a picker here and sets
 * `ref` alongside the name; until then, and forever for a table running homebrew with
 * no pack at all, the words the player types are the whole record (PRD.md principle 6).
 *
 * A `ref` no loaded pack answers for keeps its box and reads as the reference, marked
 * and read only — a character does not stop being a Frostbound ancestry because the
 * supplement was turned off (DESIGN.md §5).
 */

import type { ReactElement } from 'react';
import { useId } from 'react';
import { MAX_CHARACTER_LEVEL, MAX_CHARACTER_NAME_LENGTH, MAX_NAME_LENGTH, MAX_XP, MIN_CHARACTER_LEVEL } from '../../constants';
import type { Alignment } from '../../model/character';
import type { LevelProgress } from '../../model/derived';
import { packOfRef } from '../../model/orphans';
import { NumberField, OrphanMark, Panel, TextField } from '../fields';
import { orphanLabel } from '../format';
import type { OrphanProps, PanelProps } from './sheet-props';

/** Nothing owed. A floor, not a business rule. */
const NONE = 0;

const ALIGNMENTS: readonly Alignment[] = ['lawful', 'neutral', 'chaotic'];

export function IdentityPanel({
  character,
  setCharacter,
  orphans,
  progress,
}: PanelProps & OrphanProps & { readonly progress: LevelProgress }): ReactElement {
  const alignmentId = useId();
  const { isAncestryOrphaned, isClassOrphaned } = orphans;

  return (
    <Panel title="Character">
      <div className="panel__grid">
        <TextField
          label="Name"
          value={character.name}
          maxLength={MAX_CHARACTER_NAME_LENGTH}
          onChange={(name) => setCharacter((previous) => ({ ...previous, name }))}
        />
        <TextField
          label="Ancestry"
          value={
            isAncestryOrphaned
              ? orphanLabel(character.ancestry.name, character.ancestry.ref)
              : character.ancestry.name
          }
          maxLength={MAX_NAME_LENGTH}
          readOnly={isAncestryOrphaned}
          onChange={(name) =>
            setCharacter((previous) => ({ ...previous, ancestry: { ...previous.ancestry, name } }))
          }
        />
        <TextField
          label="Class"
          value={
            isClassOrphaned
              ? orphanLabel(character.class.name, character.class.ref)
              : character.class.name
          }
          maxLength={MAX_NAME_LENGTH}
          readOnly={isClassOrphaned}
          onChange={(name) =>
            setCharacter((previous) => ({ ...previous, class: { ...previous.class, name } }))
          }
        />

        <div className="field">
          <label className="field__label" htmlFor={alignmentId}>
            Alignment
          </label>
          <select
            id={alignmentId}
            className="field__input"
            value={character.alignment ?? ''}
            onChange={(event) => {
              const { value } = event.target;
              const alignment = ALIGNMENTS.find((option) => option === value) ?? null;
              setCharacter((previous) => ({ ...previous, alignment }));
            }}
          >
            <option value="">Not chosen</option>
            {ALIGNMENTS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <NumberField
          label="Level"
          value={character.level}
          min={MIN_CHARACTER_LEVEL}
          max={MAX_CHARACTER_LEVEL}
          onChange={(level) => setCharacter((previous) => ({ ...previous, level }))}
        />
        <NumberField
          label="XP"
          value={character.xp}
          min={NONE}
          max={MAX_XP}
          onChange={(xp) => setCharacter((previous) => ({ ...previous, xp }))}
        />
      </div>

      {(isAncestryOrphaned || isClassOrphaned) && (
        <p className="row row--orphaned">
          {isAncestryOrphaned && character.ancestry.ref !== null && (
            <OrphanMark pack={packOfRef(character.ancestry.ref)} />
          )}
          {isClassOrphaned && character.class.ref !== null && (
            <OrphanMark pack={packOfRef(character.class.ref)} />
          )}
        </p>
      )}

      {/* Recorded, never acted on: advancing a level is the player's move. */}
      <p className="readout">
        {progress.isMaxLevel
          ? 'At the highest level this app records.'
          : progress.canLevelUp
            ? `Ready to advance — ${character.xp} of ${progress.threshold} XP.`
            : `${progress.remaining} more XP to advance (${character.xp} of ${progress.threshold}).`}
      </p>
    </Panel>
  );
}
