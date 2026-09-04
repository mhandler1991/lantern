/**
 * The lobby: a room code, an optional password, and a link to send.
 *
 * Three things it deliberately does not do.
 *
 * **It does not connect.** A code and a link are all this panel owns; presence and the
 * transport are #43. The panel says so out loud rather than implying a room somebody has
 * joined, because software that looks connected and is not is worse than software that
 * says it is not.
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
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import { MAX_ROOM_PASSWORD_LENGTH, ROOM_CODE_LENGTH } from '../constants';
import type { Room } from '../state/use-room';
import { EmptyNote, Panel, TextField, Warning } from './fields';

/** What the last copy attempt did. Cleared by any edit, never on a timer. */
type CopyState = 'idle' | 'copied' | 'unavailable';

export function Lobby({ room }: { readonly room: Room }): ReactElement {
  const { code, setCode, password, setPassword, invite, isReady, link, generate, lastGenerated } =
    room;
  const [copy, setCopy] = useState<CopyState>('idle');

  async function copyLink(): Promise<void> {
    if (link === null) return;

    // Undefined outside a secure context, so this branch is the http case as well as
    // the browser-does-not-support-it one.
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      setCopy('unavailable');
      return;
    }

    try {
      await clipboard.writeText(link);
      setCopy('copied');
    } catch {
      setCopy('unavailable');
    }
  }

  return (
    <Panel title="Room" aside={isReady ? code : undefined}>
      <Warning>
        Lantern does not join rooms yet. The code and the invite link are real; nobody
        appears in them until presence lands.
      </Warning>

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
    </Panel>
  );
}
