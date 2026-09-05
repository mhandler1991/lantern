/**
 * Putting text on the clipboard: the room code's invite link, and the block of problems
 * a bad file produced.
 *
 * `navigator.clipboard` is undefined outside a secure context (DEPLOY.md §1) and its
 * write can be refused by a permission prompt or a hardened profile, so nothing here
 * throws and nothing assumes: the result says whether the browser took the text, and
 * the caller says so on screen. **A browser that will not copy is never a reason to
 * withhold what would have been copied** — every caller shows the text as well, so the
 * player can select it themselves (PRD.md principle 4, the same reading `download.ts`
 * gets).
 */

import { describeError } from '../state/storage';

export type CopyResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export async function copyText(text: string): Promise<CopyResult> {
  // Read off `navigator` rather than called blind: undefined here is the whole failure
  // in an http context, and it is worth reporting as itself rather than as a throw.
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined) {
    return { ok: false, message: 'this browser will not let a page use the clipboard' };
  }

  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}
