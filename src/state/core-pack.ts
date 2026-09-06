/**
 * Fetching the pack the app ships with. PRD.md §5 Phase 2, DATA-MODEL.md §1.
 *
 * Core is a pack like any other and gets no privileges for it. It is fetched, bounded,
 * decoded and put through `parsePack` — the same four steps in the same order as a file
 * a DM picked or a payload a peer sent (CLAUDE.md §2.7: validate inbound, always, even
 * when the data is "ours"). A core pack that stopped parsing would otherwise be the one
 * malformed pack in the app nobody was told about.
 *
 * **The path is relative and joined to `BASE_URL`.** GitHub Pages serves this app from
 * `/lantern/`, so `/packs/core.json` resolves off the site root and 404s — and a 404 on
 * a runtime fetch throws nothing, logs nothing and renders no error. The pickers are
 * simply empty. That failure cost the predecessor project real time (DEPLOY.md §2), so
 * the join lives in one exported function with a test on it rather than inside a fetch
 * call where it cannot be seen.
 *
 * Nothing here throws. Every way the fetch can fail comes back as problems with paths,
 * in DATA-MODEL.md §10's grammar, so a core pack that is missing reports itself the same
 * way a homebrew pack with a bad field does.
 */

import { CORE_PACK_ID, CORE_PACK_PATH, MAX_PACK_BYTES } from '../constants';
import type { Pack, PackProblem } from '../model/pack';
import { parsePack } from '../model/pack';
import { describeError } from './storage';

/** The path a problem is reported against when the failure is the file, not a field. */
const WHOLE_FILE = CORE_PACK_PATH;

/**
 * What this module needs of a response: whether it arrived, and its text. Structural
 * rather than the DOM `Response` type, for the same reason `StorageDriver` is — a test
 * hands in an object, including one that fails on read, so the failure paths are
 * exercised rather than assumed. A real `Response` satisfies it.
 */
export type FetchedResponse = {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
};

/** How the pack is fetched. Injected so a test never touches the network. */
export type Fetcher = (url: string) => Promise<FetchedResponse>;

/** Errors are values at every boundary. CLAUDE.md §2.5. */
export type CorePackResult =
  | { readonly ok: true; readonly pack: Pack }
  | { readonly ok: false; readonly problems: readonly PackProblem[] };

const problem = (message: string): readonly PackProblem[] => [{ path: WHOLE_FILE, message }];

/**
 * `packs/core.json` resolved against the base the app is served from — `./` in dev,
 * `/lantern/` on Pages. 🚫 Never rooted at `/`, in either.
 *
 * The trailing slash is added rather than assumed: Vite always ends `BASE_URL` with one
 * (`environment.test.ts` asserts it), but this function is also called with whatever a
 * caller has, and joining `/lantern` to `packs/core.json` without it silently produces
 * `/lanternpacks/core.json`, which is the same invisible 404 the docblock above is about.
 */
export function corePackUrl(base: string = import.meta.env.BASE_URL): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}${CORE_PACK_PATH}`;
}

/**
 * Fetch, bound, decode, validate — in that order, because each step is only safe once
 * the one before it has passed. The size check is on the decoded text rather than a
 * `Content-Length` header: a header is a claim the server made and the text is what we
 * are actually holding (DATA-MODEL.md §13 makes the same distinction about a picked
 * file's `size`).
 *
 * The id check at the end is not ceremony. Every reference the app stores is written
 * `core:kind:id`, so a core file that declared itself something else would resolve
 * nothing on any existing sheet while parsing perfectly — a fault worth a report rather
 * than an empty screen.
 */
export async function loadCorePack(
  fetcher: Fetcher = (url) => fetch(url),
  base: string = import.meta.env.BASE_URL,
): Promise<CorePackResult> {
  const url = corePackUrl(base);

  let response: FetchedResponse;
  try {
    response = await fetcher(url);
  } catch (error: unknown) {
    return { ok: false, problems: problem(`expected to fetch ${url} — ${describeError(error)}`) };
  }

  if (!response.ok) {
    return { ok: false, problems: problem(`expected ${url} to be served — got HTTP ${response.status}`) };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error: unknown) {
    return { ok: false, problems: problem(`expected to read ${url} — ${describeError(error)}`) };
  }

  if (text.length > MAX_PACK_BYTES) {
    return {
      ok: false,
      problems: problem(`expected at most ${MAX_PACK_BYTES} characters — got ${text.length} characters`),
    };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error: unknown) {
    return { ok: false, problems: problem(`expected JSON — ${describeError(error)}`) };
  }

  const parsed = parsePack(decoded);
  if (!parsed.ok) return parsed;

  if (parsed.pack.id !== CORE_PACK_ID) {
    return {
      ok: false,
      problems: [{ path: `${WHOLE_FILE}.id`, message: `expected "${CORE_PACK_ID}" — got "${parsed.pack.id}"` }],
    };
  }

  return { ok: true, pack: parsed.pack };
}
