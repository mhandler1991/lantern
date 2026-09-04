/**
 * What is wrong with something that failed validation, in the one format the whole app
 * reports it in.
 *
 * DATA-MODEL.md §9 makes this a contract rather than a convenience: these lines are
 * written to be pasted back into an AI along with the file that produced them, so the
 * path has to be exact and the message has to say what was expected. A character file
 * off disk and a payload off the wire are the same problem wearing different clothes,
 * and two copies of this formatting would eventually disagree about `items[3].qty`.
 *
 * 🚫 Nothing here decides what to do about a problem. `PRD.md` principle 4 — warn,
 * degrade, keep going — is the caller's job; this only says what happened.
 */

import * as z from 'zod';

/** Zero is the length of an empty path, not a rule of anything. */
const NONE = 0;

export type Problem = {
  readonly path: string;
  readonly message: string;
};

/** `items[3].qty`, and `(root)` for a problem with the value as a whole. */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === NONE) return '(root)';

  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc === '' ? String(segment) : `${acc}.${String(segment)}`;
  }, '');
}

/** Every issue Zod raised, flattened into the reportable shape. */
export function problemsFrom<T>(error: z.ZodError<T>): readonly Problem[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/** The problems, one per line, ready to paste. DATA-MODEL.md §9. */
export function formatProblems(problems: readonly Problem[]): string {
  return problems.map((problem) => `  ${problem.path} — ${problem.message}`).join('\n');
}
