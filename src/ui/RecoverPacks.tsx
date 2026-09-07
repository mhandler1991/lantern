/**
 * The way back to a kept pack the app could not read. Issue 120.
 *
 * `state/pack-storage.ts` parks the whole stored value under `lantern:packs.rejected`
 * before the next write is allowed over the live key, which is half of "never destroy
 * player data" (PRD.md principle 4). This is the other half, and it is the same button
 * `RecoverCharacter.tsx` gives a character for the same reason: a copy nobody can reach
 * is indistinguishable from a deleted one, and devtools is not a recovery path for the
 * people this app is for.
 *
 * Two things it does not do. It does not **write** — the read is one key and there is no
 * clear, no flag and no repair, so the parked copy survives every press and a browser
 * that refuses the file. And it does not claim the file can be picked again: what is
 * parked is the *store*, a list of packs with their load order, not a pack file, so the
 * honest offer is "here are the bytes" and a human takes it from there.
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import { PACK_FILE_TYPE, REJECTED_PACKS_FILE_NAME } from '../state/pack-file';
import { readRejectedPacks } from '../state/pack-storage';
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

export function RecoverPacks(): ReactElement {
  const [recovered, setRecovered] = useState<RecoverState>({ kind: 'idle' });

  function recover(): void {
    const read = readRejectedPacks();
    if (!read.ok) {
      setRecovered(
        read.reason === 'empty'
          ? { kind: 'empty' }
          : { kind: 'unavailable', detail: read.failure.detail },
      );
      return;
    }

    const saved = saveTextFile(REJECTED_PACKS_FILE_NAME, read.text, PACK_FILE_TYPE);
    setRecovered(saved.ok ? { kind: 'saved' } : { kind: 'refused', message: saved.message });
  }

  return (
    <>
      <div className="row-actions">
        <button type="button" className="button" onClick={recover}>
          Download the stored packs
        </button>
      </div>

      {recovered.kind === 'saved' && (
        <p role="status">
          Saved as {REJECTED_PACKS_FILE_NAME}, exactly as it was stored. The copy in this
          browser is still there. Each pack is under &ldquo;packs&rdquo; inside it, and
          one lifted back out to a file of its own can be loaded above.
        </p>
      )}

      {recovered.kind === 'refused' && (
        <p role="status">
          This browser would not take the file ({recovered.message}). The stored value is
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
          This browser will not let Lantern read its storage, so the stored value cannot
          be fetched. ({recovered.detail}) Nothing has been changed or removed.
        </p>
      )}
    </>
  );
}
