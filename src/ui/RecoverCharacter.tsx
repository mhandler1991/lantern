/**
 * The way back to a character the app could not read. Issue #89.
 *
 * #15 shipped the quarantine half of "never destroy player data": a stored value that
 * fails to load is copied to `lantern:character.rejected` before autosave is allowed to
 * write over it (DATA-MODEL.md §12). Nothing ever offered it back, so recovering it
 * meant devtools — which for the people this app is for is the same as gone. This is the
 * other half: one button, inside the warning that is already on screen.
 *
 * Three rules shape it, and each is an acceptance criterion rather than a preference.
 *
 * **The bytes are handed over exactly as stored.** Not parsed, not migrated, not
 * pretty-printed. This build is the build that could not read them; anything it did to
 * them on the way out would be a repair by a program that does not know what it is
 * repairing. A value that is not JSON at all downloads the same way as one that is — the
 * point is to get it off this machine and in front of a human, not to make it valid.
 *
 * **Nothing here writes.** `readRejectedCharacter` reaches for one key and returns a
 * string; there is no write, no clear, and no "recovered" flag to set afterwards. The
 * quarantined copy survives every click, a failed download, and a browser that refuses
 * the file, because a recovery path that can lose the thing it is recovering is worse
 * than none.
 *
 * **It warns, it does not block** (PRD.md principle 4). It is a button in a notice above
 * a working sheet, never a modal and never a gate: a player who does not care can ignore
 * it forever, and the sheet underneath is already usable.
 *
 * The read happens on the click rather than at boot. A quarantined value is bounded by
 * nothing this build applied — the oversize path is one of the ways a value gets rejected
 * in the first place — so holding it in React state for the whole session to power a
 * button most players never press is the wrong trade.
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import { CHARACTER_FILE_TYPE, REJECTED_CHARACTER_FILE_NAME } from '../state/character-file';
import { readRejectedCharacter } from '../state/character-storage';
import { saveTextFile } from './download';

/** What the last attempt did. Cleared by the next one, never on a timer. */
type RecoverState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved' }
  /** The browser would not build the file. `ui/download.ts` says why. */
  | { readonly kind: 'refused'; readonly message: string }
  /** Storage answered, and there was nothing under the key. */
  | { readonly kind: 'empty' }
  /** Storage would not answer at all — private mode, blocked site data. */
  | { readonly kind: 'unavailable'; readonly detail: string };

export function RecoverCharacter(): ReactElement {
  const [recovered, setRecovered] = useState<RecoverState>({ kind: 'idle' });

  function recover(): void {
    const read = readRejectedCharacter();
    if (!read.ok) {
      setRecovered(
        read.reason === 'empty'
          ? { kind: 'empty' }
          : { kind: 'unavailable', detail: read.failure.detail },
      );
      return;
    }

    const saved = saveTextFile(REJECTED_CHARACTER_FILE_NAME, read.text, CHARACTER_FILE_TYPE);
    setRecovered(saved.ok ? { kind: 'saved' } : { kind: 'refused', message: saved.message });
  }

  return (
    <>
      <div className="row-actions">
        <button type="button" className="button" onClick={recover}>
          Download the old value
        </button>
      </div>

      {recovered.kind === 'saved' && (
        <p role="status">
          Saved as {REJECTED_CHARACTER_FILE_NAME}, exactly as it was stored. The copy in
          this browser is still there. If it is only slightly wrong, fix it in a text
          editor and open it with Import below.
        </p>
      )}

      {recovered.kind === 'refused' && (
        <p role="status">
          This browser would not take the file ({recovered.message}). The old value is
          untouched — try again, or open Lantern in another browser on this machine.
        </p>
      )}

      {recovered.kind === 'empty' && (
        <p role="status">
          There is nothing set aside to download any more — this browser&rsquo;s storage
          has been cleared since the page loaded.
        </p>
      )}

      {recovered.kind === 'unavailable' && (
        <p role="status">
          This browser will not let Lantern read its storage, so the old value cannot be
          fetched. ({recovered.detail}) Nothing has been changed or removed.
        </p>
      )}
    </>
  );
}
