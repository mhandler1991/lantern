/**
 * Who this is: name, ancestry, class, alignment, and where they are on the way up.
 *
 * Ancestry and class are the sheet's two single-value references, and from Phase 2 a
 * loaded pack drives a picker for each. Picking stores the reference and nothing else —
 * the word on screen is read back out of the stack every render, so `name` stays the
 * player's own words rather than a copy of a pack's label (DATA-MODEL.md §11).
 *
 * With no pack loaded there is nothing to offer, and the field falls back to the box a
 * player types in. That is not a degraded mode: a table running homebrew with no pack at
 * all is a table the app has to work for (PRD.md principle 6), so the typed-in escape
 * stays offered even when a picker is there.
 *
 * A `ref` no loaded pack answers for keeps its box and reads as the reference, marked
 * and read only — a character does not stop being a Frostbound ancestry because the
 * supplement was turned off (DESIGN.md §5). The picker is not offered for such a field:
 * the pack that could explain it is off, so the row is a record rather than a choice.
 */

import type { ReactElement } from 'react';
import { useId } from 'react';
import { MAX_CHARACTER_LEVEL, MAX_CHARACTER_NAME_LENGTH, MAX_NAME_LENGTH, MAX_XP, MIN_CHARACTER_LEVEL } from '../../constants';
import type { Alignment, ContentRef } from '../../model/character';
import type { LevelProgress } from '../../model/derived';
import { packOfRef } from '../../model/orphans';
import type { ResolvedStack } from '../../model/pack-resolver';
import type { Choice } from '../choices';
import { displayName } from '../choices';
import { ChoiceField, NumberField, OrphanMark, Panel, TextField } from '../fields';
import type { ContentProps, OrphanProps, PanelProps } from './sheet-props';

/** Nothing owed, and nothing offered. A floor, not a business rule. */
const NONE = 0;

const ALIGNMENTS: readonly Alignment[] = ['lawful', 'neutral', 'chaotic'];

/**
 * One of the sheet's two content references, in whichever of its three states it is in:
 * chosen from a pack, typed in, or pointing at a pack that is off.
 *
 * The typed-in box sits below the picker rather than replacing it, so a player who wants
 * their own words never has to find a mode switch first — the picker's own first option
 * is what puts the field back into that state.
 */
function ContentField({
  label,
  held,
  choices,
  stack,
  isOrphaned,
  onSet,
}: {
  readonly label: string;
  readonly held: ContentRef;
  readonly choices: readonly Choice[];
  readonly stack: ResolvedStack;
  readonly isOrphaned: boolean;
  readonly onSet: (held: ContentRef) => void;
}): ReactElement {
  const shown = displayName(stack, held.ref, held.name);

  // Nothing to pick from, or nothing loaded that could explain what is already here.
  if (choices.length === NONE || isOrphaned) {
    return (
      <TextField
        label={label}
        value={shown}
        maxLength={MAX_NAME_LENGTH}
        readOnly={isOrphaned}
        onChange={(name) => onSet({ ref: held.ref, name })}
      />
    );
  }

  return (
    <>
      <ChoiceField
        label={label}
        value={held.ref}
        choices={choices}
        ownWordsLabel="In your own words"
        onChoose={(ref) => onSet({ ref, name: ref === null ? held.name : '' })}
      />
      {held.ref === null && (
        <TextField
          label={`${label}, in your own words`}
          hideLabel
          placeholder={label}
          value={held.name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(name) => onSet({ ref: null, name })}
        />
      )}
    </>
  );
}

export function IdentityPanel({
  character,
  setCharacter,
  orphans,
  stack,
  choices,
  progress,
}: PanelProps & OrphanProps & ContentProps & { readonly progress: LevelProgress }): ReactElement {
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
        <ContentField
          label="Ancestry"
          held={character.ancestry}
          choices={choices.ancestries}
          stack={stack}
          isOrphaned={isAncestryOrphaned}
          onSet={(ancestry) => setCharacter((previous) => ({ ...previous, ancestry }))}
        />
        <ContentField
          label="Class"
          held={character.class}
          choices={choices.classes}
          stack={stack}
          isOrphaned={isClassOrphaned}
          onSet={(chosen) => setCharacter((previous) => ({ ...previous, class: chosen }))}
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
