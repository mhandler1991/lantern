/**
 * The way into the walkthrough, offered rather than imposed.
 *
 * A blank sheet gets the offer in full, because "a new player reaches a complete
 * character without reading instructions" (PRD.md §5, Phase 4) starts with them seeing
 * that there is a guided way through. A sheet with anything on it gets one quiet line
 * instead: that player has already started, and the walkthrough is a thing they can
 * choose rather than a thing that should be in their way.
 *
 * 🚫 It never opens by itself. The app has to be usable by someone who wants the sheet
 * and nothing else (PRD.md principle 6), and a walkthrough that hijacked a sheet on
 * boot would be exactly the kind of block principle 4 rules out. The offer stays after
 * creation is finished for the same reason: leaving is always allowed, so coming back
 * has to be.
 */

import type { ReactElement } from 'react';
import type { Character } from '../../model/character';
import { isUnstarted } from './creation';

export function CreationOffer({
  character,
  onStart,
}: {
  readonly character: Character;
  readonly onStart: () => void;
}): ReactElement {
  const isNew = isUnstarted(character);

  return (
    <div className="creation-offer">
      {isNew && (
        <p className="creation-offer__pitch">
          New character. If you would rather be walked through it, the steps below fill in
          the same sheet one panel at a time — and you can leave at any point.
        </p>
      )}
      <button type="button" className="button" onClick={onStart}>
        {isNew ? 'Walk me through it' : 'Walk through creation'}
      </button>
    </div>
  );
}
