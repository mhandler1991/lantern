/**
 * Handing a file to the browser: the one place in the app that makes something leave it.
 *
 * There is no server to link to, so a download is a blob URL and a synthetic click on an
 * anchor. Every part of that can be refused — `URL.createObjectURL` is absent in a
 * jsdom-shaped environment and blocked by some hardened profiles, and a download can be
 * denied outright — so nothing here throws and nothing assumes: the result says whether
 * the browser took the file, and the caller says so on screen (PRD.md principle 4, the
 * same reading the clipboard gets in `Lobby.tsx`).
 *
 * The anchor is put in the document before it is clicked, because Firefox ignores a
 * click on an element that is not in the tree, and taken out again immediately after.
 */

import { describeError } from '../state/storage';

export type SaveFileResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * A blob URL holds its blob alive until it is revoked, and revoking it in the same task
 * as the click has been observed to cancel the download in Safari. The next task is
 * late enough for every browser and soon enough that nothing is kept: a delay, not a
 * business rule, so it does not belong in `constants.ts`.
 */
const NEXT_TASK_MS = 0;

export function saveTextFile(name: string, text: string, type: string): SaveFileResult {
  // Reading the two off `URL` rather than calling them blind: in a browser without the
  // Blob URL store this is the whole failure, and it is worth reporting as itself.
  if (typeof URL?.createObjectURL !== 'function') {
    return { ok: false, message: 'this browser will not let a page build a file to download' };
  }

  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([text], { type }));

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    const revoked = url;
    setTimeout(() => URL.revokeObjectURL(revoked), NEXT_TASK_MS);
    return { ok: true };
  } catch (error) {
    if (url !== null) URL.revokeObjectURL(url);
    return { ok: false, message: describeError(error) };
  }
}
