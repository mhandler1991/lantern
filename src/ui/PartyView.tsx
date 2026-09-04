/**
 * The party view: everyone at the table, and everything one peer is allowed to know
 * about another (DESIGN.md §2).
 *
 * **It has no handlers.** Not a button, not an input, not an `onChange` anywhere in this
 * file — and that is the implementation of "never write to another player's character"
 * (CLAUDE.md §4). The rule is not enforced by review here; there is simply nothing in
 * the component that could write anything. When Phase 6 adds the DM's request queue, the
 * control that sends a request belongs beside it and still does not write a sheet — it
 * asks the owning client to.
 *
 * **Everything drawn is peer data**, so everything drawn is a text node: names,
 * conditions, ancestry and class all arrive from another machine, and React's default
 * interpolation is the whole defence (CLAUDE.md §2.6). Nothing in this file builds
 * markup from a string.
 *
 * **HP is live by construction.** There is no state and no effect here — the rows are
 * the props, the props are the roster, and the roster is updated by `state/use-presence`
 * as `state` events land. A peer taking damage re-renders this list and nothing else has
 * to notice.
 */

import type { ReactElement } from 'react';
import type { PresenceMember } from '../net/presence';
import type { PublicCharacter } from '../net/protocol';
import type { PeerId } from '../net/transport';
import {
  describeCharacter,
  distinctConditions,
  hpBarPercent,
  isDown,
  marchingOrder,
  memberName,
} from './party';

/** An empty list, a zero count. A floor, not a rule of the game. */
const NONE = 0;

/**
 * One character's public projection. Split out so the seat above it stays a list row and
 * this stays the readout — and so the "connected but silent" case is a whole branch
 * rather than six conditionals threaded through one block.
 */
function Vitals({ character }: { readonly character: PublicCharacter }): ReactElement {
  const conditions = distinctConditions(character.conditions);

  return (
    <>
      <p className="party__billing">{describeCharacter(character)}</p>

      <div className="party__vitals">
        <div className="party__hp">
          {/* The track carries no information the count beside it does not, so it is
              hidden from assistive technology rather than labelled twice over. */}
          <div className="party__bar" aria-hidden="true">
            <div
              className="party__bar-fill"
              style={{ width: `${hpBarPercent(character.hp)}%` }}
            />
          </div>
          <p className={isDown(character.hp) ? 'party__hp-count party__hp-count--down' : 'party__hp-count'}>
            <span className="party__stat-label">HP</span> {character.hp.current} /{' '}
            {character.hp.max}
          </p>
        </div>

        <p className="party__stat">
          <span className="party__stat-label">AC</span> {character.ac}
        </p>
        <p className="party__stat">
          <span className="party__stat-label">Luck</span> {character.luck}
        </p>
      </div>

      {conditions.length > NONE && (
        <ul className="chips party__conditions">
          {conditions.map((condition) => (
            <li key={condition} className="chip">
              {condition}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function PartyView({
  members,
  hostId,
}: {
  readonly members: readonly PresenceMember[];
  readonly hostId: PeerId | null;
}): ReactElement {
  return (
    <ol className="party">
      {marchingOrder(members).map(({ member, position }) => (
        <li key={member.id} className="party__member">
          <p className="party__line">
            <span className="party__position">{position}</span>
            <span className="party__name">{memberName(member.character, member.id)}</span>
            {member.id === hostId && <span className="party__tag">host</span>}
            {member.isSelf && <span className="party__tag">you</span>}
            {member.character?.carryingLight === true && (
              <span className="party__tag party__tag--light">carrying light</span>
            )}
          </p>

          {member.character === null ? (
            <p className="party__pending">
              Connected, but has not said who they are yet.
            </p>
          ) : (
            <Vitals character={member.character} />
          )}
        </li>
      ))}
    </ol>
  );
}
