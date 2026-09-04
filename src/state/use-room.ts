/**
 * The room the player is setting up, and the invite that brought them here.
 *
 * Boot reads `?r=` in the `useState` initialiser rather than in an effect. CLAUDE.md §6
 * — deriving state in an effect is a bug, and here it would be a visible one: an empty
 * code field for one frame, replaced by the invited one, which is exactly long enough to
 * look like the link did not work.
 *
 * 📌 **Nothing here joins anything.** The room is a code, an optional password and a
 * link; presence and the transport are #43. Keeping that boundary in this hook is the
 * point of the hook — when joining lands, it lands behind this same shape and no
 * component changes.
 */

import { useCallback, useMemo, useState } from 'react';
import { MAX_ROOM_PASSWORD_LENGTH } from '../constants';
import type { InviteRead, RoomCodeResult } from '../net/room-code';
import { generateRoomCode, inviteUrl, isCompleteRoomCode, readInvite, typedRoomCode } from '../net/room-code';

/** Where the URL comes from. Injectable so the hook tests without touching `location`. */
export type LocationReader = () => { readonly search: string; readonly href: string };

const browserLocation: LocationReader = () => ({
  search: window.location.search,
  href: window.location.href,
});

export type Room = {
  /** Always normalised and never longer than a code — the box cannot hold anything else. */
  readonly code: string;
  readonly setCode: (input: string) => void;
  /** A courtesy lock, not a security boundary. DESIGN.md §2. */
  readonly password: string;
  readonly setPassword: (input: string) => void;
  /** What the URL said when the tab opened. Read once; the address bar is not watched. */
  readonly invite: InviteRead;
  /** Whether the code in the box is one that could be joined. */
  readonly isReady: boolean;
  /** The link to send, or null when there is no complete code to build one from. */
  readonly link: string | null;
  /** Draws a fresh code. The failed case is reported, never a biased code. */
  readonly generate: () => void;
  /** The most recent draw, or null if none has been asked for. */
  readonly lastGenerated: RoomCodeResult | null;
};

export function useRoom(location: LocationReader = browserLocation): Room {
  const [invite] = useState<InviteRead>(() => readInvite(location().search));
  const [code, setCodeState] = useState<string>(() =>
    invite.kind === 'code' ? invite.code : '',
  );
  const [password, setPasswordState] = useState('');
  const [lastGenerated, setLastGenerated] = useState<RoomCodeResult | null>(null);

  const setCode = useCallback((input: string) => {
    setCodeState(typedRoomCode(input));
    // A code that was typed over is not a code that was drawn, so the draw's report goes
    // with it. Cleared here rather than in an effect watching `code` (CLAUDE.md §6).
    setLastGenerated(null);
  }, []);

  const setPassword = useCallback((input: string) => {
    setPasswordState(input.slice(0, MAX_ROOM_PASSWORD_LENGTH));
  }, []);

  const generate = useCallback(() => {
    const result = generateRoomCode();
    setLastGenerated(result);
    if (result.ok) setCodeState(result.code);
  }, []);

  const isReady = isCompleteRoomCode(code);

  /** Derived on read, never stored — the link is the code plus wherever we are served from. */
  const link = useMemo(
    () => (isReady ? inviteUrl(location().href, code) : null),
    [isReady, code, location],
  );

  return {
    code,
    setCode,
    password,
    setPassword,
    invite,
    isReady,
    link,
    generate,
    lastGenerated,
  };
}
