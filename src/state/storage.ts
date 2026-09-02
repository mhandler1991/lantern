/**
 * localStorage, as a value rather than an exception.
 *
 * Every browser ships a mode where this API is present and hostile. Safari in private
 * browsing throws on write, an origin with site data blocked throws on read, and a full
 * origin throws part-way through a save. A character sheet has to survive all three:
 * PRD.md principle 4 says the app degrades and keeps going, never refuses to load a
 * character and never destroys one.
 *
 * So nothing in this file throws, and nothing in it knows what a character is. Every
 * call returns a result and the caller decides what that means. CLAUDE.md §2.5.
 */

/**
 * The three methods anything here uses. Structural rather than the DOM `Storage` type,
 * so a test can hand in an object that fails on demand — which is the only way the
 * private-browsing and quota paths get exercised at all.
 */
export type StorageDriver = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * `unavailable` — the API is not there, or the origin is not allowed to touch it.
 * `quota` — it is there and full. The distinction matters to the user: one is a browser
 * setting they can change, the other is data they have to clear.
 */
export type StorageFailure = {
  readonly kind: 'unavailable' | 'quota' | 'failed';
  readonly detail: string;
};

export type ReadResult =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly failure: StorageFailure };

export type WriteResult = { readonly ok: true } | { readonly ok: false; readonly failure: StorageFailure };

/**
 * A full origin reports itself four different ways depending on the browser, and two of
 * them are numeric codes rather than names. Missing one means reporting "storage failed"
 * where the honest message is "your browser storage is full".
 */
const QUOTA_EXCEEDED_CODE = 22;
const FIREFOX_QUOTA_CODE = 1014;
const QUOTA_NAMES: readonly string[] = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'];

/**
 * Errors are inspected by shape rather than by `instanceof Error`, and that is not
 * fussiness. A `DOMException` — which is what every one of these failures actually is —
 * comes from the page's realm, and `Error` in module scope may not be the same one: under
 * Vitest's jsdom environment `new DOMException(...) instanceof Error` is **false**,
 * because jsdom's window and the module share no `Error`. An `instanceof` guard there
 * misreports a full origin as a generic failure, silently and only in the case that
 * matters. Cross-frame code hits the same thing in a real browser.
 */
type ErrorLike = { readonly name?: unknown; readonly message?: unknown; readonly code?: unknown };

function asErrorLike(error: unknown): ErrorLike | null {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : null;
}

export function describeError(error: unknown): string {
  const like = asErrorLike(error);
  if (like && typeof like.name === 'string' && typeof like.message === 'string') {
    return `${like.name}: ${like.message}`;
  }
  return String(error);
}

function isQuotaError(error: unknown): boolean {
  const like = asErrorLike(error);
  if (!like) return false;

  if (typeof like.name === 'string' && QUOTA_NAMES.includes(like.name)) return true;
  return like.code === QUOTA_EXCEEDED_CODE || like.code === FIREFOX_QUOTA_CODE;
}

/**
 * Reading `window.localStorage` is itself a throwing operation when the origin is not
 * allowed site data, so even getting hold of the driver has to be guarded. Resolved per
 * call rather than at module load: a module-level probe would run during import, which
 * is exactly where a throw turns into a blank page.
 */
export function defaultStorageDriver(): StorageDriver | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const NO_DRIVER: StorageFailure = {
  kind: 'unavailable',
  detail: 'localStorage is not available on this origin',
};

export function readText(key: string, driver = defaultStorageDriver()): ReadResult {
  if (!driver) return { ok: false, failure: NO_DRIVER };

  try {
    return { ok: true, value: driver.getItem(key) };
  } catch (error) {
    return { ok: false, failure: { kind: 'unavailable', detail: describeError(error) } };
  }
}

export function writeText(key: string, value: string, driver = defaultStorageDriver()): WriteResult {
  if (!driver) return { ok: false, failure: NO_DRIVER };

  try {
    driver.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      failure: { kind: isQuotaError(error) ? 'quota' : 'failed', detail: describeError(error) },
    };
  }
}

export function removeKey(key: string, driver = defaultStorageDriver()): WriteResult {
  if (!driver) return { ok: false, failure: NO_DRIVER };

  try {
    driver.removeItem(key);
    return { ok: true };
  } catch (error) {
    return { ok: false, failure: { kind: 'failed', detail: describeError(error) } };
  }
}
