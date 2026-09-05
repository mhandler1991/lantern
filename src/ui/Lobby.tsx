/**
 * The lobby: a room code, an optional password, and a link to send.
 *
 * Three things it deliberately does not do.
 *
 * **It does not mask the password.** DESIGN.md §2 — the room password is a courtesy lock
 * and not a security boundary. A masked field says "secret" and this one is not: it is
 * read aloud down the same call the room code is, and hiding it would only stop the
 * person typing it from checking it. PRD.md principle 3 — never imply an authority the
 * app does not have.
 *
 * **It does not require the clipboard.** Copying needs a secure context (DEPLOY.md §1),
 * and a browser that will not do it is not a reason to withhold the link. The link is
 * always there, selectable, whether the button works or not.
 *
 * **It does not name a host.** The chair is derived from who has been present longest
 * (`net/presence.ts`), so the panel reports it and offers nothing to click: there is
 * nothing to hand over and nobody to ask.
 *
 * The party view below the room controls is `ui/PartyView.tsx`. It lives inside this panel
 * because the table and the room are one thing while a room is all there is to do with
 * a table; when the DM's own view arrives in Phase 6 it is the party view that moves,
 * and this panel goes back to being a code and a link.
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import { MAX_ROOM_PASSWORD_LENGTH, ROOM_CODE_LENGTH } from '../constants';
import { describeRejection } from '../net/protocol';
import type { Presence } from '../state/use-presence';
import type { Room } from '../state/use-room';
import { copyText } from './clipboard';
import { EmptyNote, Panel, TextField, Warning } from './fields';
import { PartyView } from './PartyView';

/** What the last copy attempt did. Cleared by any edit, never on a timer. */
type CopyState = 'idle' | 'copied' | 'unavailable';

export function Lobby({
  room,
  presence,
}: {
  readonly room: Room;
  readonly presence: Presence;
}): ReactElement {
  const { code, setCode, password, setPassword, invite, isReady, link, generate, lastGenerated } =
    room;
  const [copy, setCopy] = useState<CopyState>('idle');
  const isJoined = presence.status === 'joined';

  async function copyLink(): Promise<void> {
    if (link === null) return;

    // Every way this can be refused — an http origin, a permission, a hardened profile —
    // is one answer here: the link stays on screen to be selected by hand.
    const copied = await copyText(link);
    setCopy(copied.ok ? 'copied' : 'unavailable');
  }

  return (
    <Panel title="Room" aside={isReady ? code : undefined}>
      {invite.kind === 'code' && (
        <p className="readout" role="status">
          You followed an invite, so the code is filled in already.
        </p>
      )}

      {invite.kind === 'unreadable' && (
        <Warning>
          That invite link did not carry a room code we could read, so nothing has been
          filled in. Ask whoever sent it to paste it again.
        </Warning>
      )}

      <div className="panel__grid lobby__code">
        <TextField
          label="Room code"
          value={code}
          readOnly={isJoined}
          placeholder={'A'.repeat(ROOM_CODE_LENGTH)}
          onChange={(typed) => {
            setCopy('idle');
            setCode(typed);
          }}
        />
        <div className="row-actions">
          <button
            type="button"
            className="button"
            disabled={isJoined}
            onClick={() => {
              setCopy('idle');
              generate();
            }}
          >
            Draw a code
          </button>
        </div>
      </div>

      {lastGenerated !== null && !lastGenerated.ok && (
        <Warning>
          A code could not be drawn ({lastGenerated.message}). Type one instead — any six
          characters from the codes you have seen will do.
        </Warning>
      )}

      {!isReady && (
        <EmptyNote>
          A room code is {ROOM_CODE_LENGTH} characters. Draw one to start a table, or type
          the one you were given.
        </EmptyNote>
      )}

      <div className="panel__grid">
        <TextField
          label="Password (optional)"
          value={password}
          readOnly={isJoined}
          maxLength={MAX_ROOM_PASSWORD_LENGTH}
          onChange={(typed) => {
            setCopy('idle');
            setPassword(typed);
          }}
        />
      </div>
      <p className="readout">
        A room password keeps strangers who guessed your code from wandering in. It is a
        courtesy lock, not a secret — everyone who joins types the same one, so it travels
        the same way the code does. It is never part of the invite link.
      </p>

      <div className="row-actions lobby__join">
        {isJoined ? (
          <button type="button" className="button" onClick={presence.leave}>
            Leave the room
          </button>
        ) : (
          <button
            type="button"
            className="button"
            disabled={!isReady}
            onClick={() => presence.join(code, password)}
          >
            Join the room
          </button>
        )}
      </div>

      {presence.status === 'failed' && presence.error !== null && (
        <Warning>
          That room could not be opened ({presence.error.message}). Your sheet is
          untouched — try again, or carry on alone.
        </Warning>
      )}

      {isJoined && presence.error !== null && (
        <Warning>The last thing to go wrong on the wire: {presence.error.message}</Warning>
      )}

      {presence.rejection !== null && (
        <Warning>
          A peer sent something Lantern could not read, and it was ignored.{' '}
          {describeRejection(presence.rejection)}
        </Warning>
      )}

      {link !== null && (
        <>
          <p className="subhead">Invite</p>
          <div className="panel__grid lobby__invite">
            <TextField label="Invite link" value={link} readOnly onChange={() => undefined} />
            <div className="row-actions">
              <button type="button" className="button" onClick={() => void copyLink()}>
                Copy link
              </button>
            </div>
          </div>

          {copy === 'copied' && (
            <p className="readout" role="status">
              Copied. Opening it fills the room code in for whoever you send it to.
            </p>
          )}

          {copy === 'unavailable' && (
            <Warning>
              This browser would not let Lantern reach the clipboard — copying needs an
              https page. Select the link above and copy it by hand.
            </Warning>
          )}
        </>
      )}

      {isJoined && (
        <>
          <p className="subhead">At the table</p>
          <PartyView members={presence.members} hostId={presence.hostId} />

          {presence.members.length === 1 && (
            <EmptyNote>
              Nobody else has arrived. Send them the link — the room is open and waiting.
            </EmptyNote>
          )}

          <p className="readout">
            The host is whoever has been here longest. Every browser works it out from what
            it can already see, so nobody hands it over and it moves on its own when that
            person leaves. It settles who goes first and nothing else — it has no say over
            anyone&rsquo;s dice.
          </p>

          <p className="readout">
            The numbers down the left are the marching order, and for now they follow that
            same order. Setting one belongs to the DM, and that arrives with the rest of
            the DM&rsquo;s table in the next phase.
          </p>

          <p className="readout">
            What you can see here is everything anyone at this table can see about you:
            name, ancestry, class, level, HP, AC, luck, conditions, and whether you are
            carrying a light. Your gold, gear, spells, journal and quests are not sent to
            anybody.
          </p>
        </>
      )}
    </Panel>
  );
}
