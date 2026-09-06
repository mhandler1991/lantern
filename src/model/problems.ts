/**
 * What is wrong with something that failed validation, in the one format the whole app
 * reports it in.
 *
 * DATA-MODEL.md §10 makes this a contract rather than a convenience: these lines are
 * written to be **pasted back into an AI** along with the file that produced them, so
 * every line carries three things and a model can fix the file in one turn.
 *
 * ```
 * spells[4].range — expected one of: self, close, near, far — got "medium"
 * └ path            └ expectation                              └ actual
 * ```
 *
 * 🚫 "Invalid pack" is never an acceptable message, and neither is anything that says
 * only what was expected. Zod's own text stops one word short of useful — *Invalid
 * option: expected one of "self"|"close"|"near"|"far"* never says what it got — and
 * `finalizeIssue` in the shipped source strips the offending value off every issue
 * unless the parse asked for it. **That is why every boundary parses through `validate`
 * here**, which passes `reportInput` and is the only thing in the app that calls
 * `safeParse` on a document. A parse that skipped it would degrade every message in the
 * app silently, which is exactly the failure this module exists to prevent.
 *
 * A schema may write its own expectation and it will be used verbatim, on one condition:
 * it must be phrased as `expected …`, in house style. Zod's built-in messages never
 * are, so the two are told apart by the sentence rather than by guessing at internals.
 *
 * A character file off disk and a payload off the wire are the same problem wearing
 * different clothes, and two copies of this formatting would eventually disagree about
 * `items[3].qty`.
 *
 * 🚫 Nothing here decides what to do about a problem. `PRD.md` principle 4 — warn,
 * degrade, keep going — is the caller's job; this only says what happened.
 */

import * as z from 'zod';
import { MAX_PROBLEM_VALUE_LENGTH } from '../constants';

/** Zero is the length of an empty path, not a rule of anything. */
const NONE = 0;

/** A count of one, for the singular of a word. */
const ONE = 1;

/** The last segment of a path, counting back from its end. */
const LAST = -1;

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

// ---------------------------------------------------------------------------
// The value that was actually there
// ---------------------------------------------------------------------------

/**
 * The offending value, short enough to sit at the end of a line. A string keeps its
 * quotes because `"3"` and `3` are a real distinction and the whole point of printing it
 * at all; a value too long to read becomes a description of itself rather than a wall.
 */
function renderActual(value: unknown): string {
  if (value === undefined) return 'nothing';

  let written: string;
  try {
    written = JSON.stringify(value) ?? String(value);
  } catch {
    // A cyclic object, or something with a throwing `toJSON`. It came from JSON or from
    // our own state and should be neither, but a report that throws is worse than a
    // vague one (PRD.md principle 4).
    return 'a value that could not be printed';
  }

  if (written.length <= MAX_PROBLEM_VALUE_LENGTH) return written;

  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (typeof value === 'string') {
    return `${written.slice(NONE, MAX_PROBLEM_VALUE_LENGTH)}…"`;
  }
  if (typeof value === 'object' && value !== null) {
    return `an object with ${Object.keys(value).length} fields`;
  }
  return `${written.slice(NONE, MAX_PROBLEM_VALUE_LENGTH)}…`;
}

/** `1 character`, `60 characters`. A count with the right plural on it. */
function count(n: number | bigint, noun: string): string {
  return `${n} ${n === ONE ? noun : `${noun}s`}`;
}

/** How big the thing actually was, for a bound that was overrun. */
function renderSize(value: unknown, noun: string): string {
  if (typeof value === 'string') return count(value.length, noun);
  if (Array.isArray(value)) return count(value.length, noun);
  return renderActual(value);
}

// ---------------------------------------------------------------------------
// The expectation
// ---------------------------------------------------------------------------

/** What Zod calls a type, in the words an author or a model would use for it. */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: 'a string',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  // A pack is JSON, and JSON has no tuples. An author reading `[low, high]` wrote a list.
  tuple: 'a list',
  object: 'an object',
  null: 'null',
  undefined: 'nothing',
  nonoptional: 'a value',
};

function describeType(expected: string): string {
  return TYPE_NAMES[expected] ?? `a ${expected}`;
}

/** `at most 60 characters`, `fewer than 5`, `exactly 6 characters`. */
function describeBound(
  direction: 'at most' | 'at least',
  limit: number | bigint,
  origin: string,
  inclusive: boolean | undefined,
  exact: boolean | undefined,
): string {
  const noun = origin === 'string' ? ' characters' : origin === 'array' ? ' entries' : '';
  if (exact === true) return `exactly ${limit}${noun}`;

  const relation =
    inclusive === false
      ? direction === 'at most'
        ? 'fewer than'
        : 'more than'
      : direction;

  return `${relation} ${limit}${noun}`;
}

/** A format Zod names — a regex, or one of its built-in string formats. */
function describeFormat(issue: z.core.$ZodIssueInvalidStringFormat): string {
  if (issue.format === 'regex') return `text matching ${issue.pattern ?? 'the pattern'}`;
  return `a valid ${issue.format}`;
}

/**
 * A problem before its two halves are joined: kept apart so a union can merge the
 * expectations of its branches without taking the sentence back apart.
 */
type Detail = {
  readonly path: string;
  readonly expectation: string;
  /** Null where naming the value adds nothing — a field that is simply not there. */
  readonly actual: string | null;
};

/**
 * Several shapes one value could have taken, as one expectation: *expected a number or
 * a list*, never *expected a number or expected a list*. The word is said once because
 * the sentence is read by a person before it is read by a model.
 */
function joinExpectations(expectations: readonly string[]): string {
  const prefix = 'expected ';
  if (!expectations.every((expectation) => expectation.startsWith(prefix))) {
    return expectations.join(' or ');
  }

  return prefix + expectations.map((expectation) => expectation.slice(prefix.length)).join(' or ');
}

/** House style, and the one way a schema overrides everything below. */
function ownExpectation(message: string): string | null {
  return message.startsWith('expected ') ? message : null;
}

/**
 * One issue, said in full. Every branch names what was expected; the caller adds what
 * was there.
 */
function expectationOf(issue: z.core.$ZodIssue): string {
  const own = ownExpectation(issue.message);
  if (own !== null) return own;

  switch (issue.code) {
    case 'invalid_type':
      return `expected ${describeType(issue.expected)}`;

    case 'invalid_value':
      return issue.values.length === ONE
        ? `expected ${renderActual(issue.values[NONE])}`
        : `expected one of: ${issue.values.map((value) => String(value)).join(', ')}`;

    case 'too_big':
      return `expected ${describeBound('at most', issue.maximum, issue.origin, issue.inclusive, issue.exact)}`;

    case 'too_small':
      return `expected ${describeBound('at least', issue.minimum, issue.origin, issue.inclusive, issue.exact)}`;

    case 'invalid_format':
      return `expected ${describeFormat(issue)}`;

    case 'not_multiple_of':
      return `expected a multiple of ${issue.divisor}`;

    default:
      return issue.message;
  }
}

/** What to print as the value, given what the expectation already said about it. */
function actualOf(issue: z.core.$ZodIssue): string | null {
  const input = 'input' in issue ? issue.input : undefined;

  switch (issue.code) {
    // The bound was on a size, so the size is the answer — a 2,000-character `text`
    // printed back at an author tells them nothing they can act on.
    case 'too_big':
    case 'too_small':
      return renderSize(input, issue.origin === 'array' ? 'entry' : 'character');
    default:
      return renderActual(input);
  }
}

// ---------------------------------------------------------------------------
// Issues in, details out
// ---------------------------------------------------------------------------

/**
 * A field that is not there is reported **against the object that should have held it**,
 * naming the field — `spells[7] — missing required field: tier`, DATA-MODEL.md §10. The
 * path Zod gives points at a value that does not exist, which is the one path an author
 * cannot search their file for.
 */
function missingField(path: ReadonlyArray<PropertyKey>): Detail | null {
  const field = path.at(LAST);
  if (typeof field !== 'string') return null;

  return {
    path: formatPath(path.slice(NONE, LAST)),
    expectation: `missing required field: ${field}`,
    actual: null,
  };
}

/**
 * Every branch of a failed union, flattened. Zod reports one *Invalid input* at the
 * union and hides the reasons inside `errors`, which is the "Invalid pack" message this
 * module exists to refuse.
 *
 * Where every branch failed on the union's own value — `2` or `[3, 6]` given `"x"` —
 * the branches are one problem with one value and several shapes it could have taken,
 * so they are merged into a single line rather than printed as contradictory advice.
 */
function detailsFromUnion(
  issue: z.core.$ZodIssueInvalidUnion,
  path: ReadonlyArray<PropertyKey>,
): readonly Detail[] {
  const here = formatPath(path);
  const branches = issue.errors.flatMap((branch) => detailsFrom(branch, path));

  // A union that reports no branches at all is one whose options overlap — our mistake,
  // not the author's. It still says where and what, because nothing may come back as a
  // bare refusal.
  if (branches.length === NONE) {
    return [
      {
        path: here,
        expectation: 'expected one of the shapes this field allows',
        actual: renderActual('input' in issue ? issue.input : undefined),
      },
    ];
  }

  const isAllAtTheUnion = branches.every(
    (detail) => detail.path === here && detail.actual === branches[NONE]?.actual,
  );
  if (!isAllAtTheUnion) return branches;

  const expectations = [...new Set(branches.map((detail) => detail.expectation))];
  return [
    {
      path: here,
      expectation: joinExpectations(expectations),
      actual: branches[NONE]?.actual ?? null,
    },
  ];
}

/** Every issue, including the ones Zod nests inside another. */
function detailsFrom(
  issues: readonly z.core.$ZodIssue[],
  prefix: ReadonlyArray<PropertyKey>,
): readonly Detail[] {
  return issues.flatMap((issue): readonly Detail[] => {
    const path = [...prefix, ...issue.path];

    /*
     * Checked before the code is looked at, because which code Zod raises for an absent
     * field depends on what the field holds — a missing `tier` is an `invalid_type` and
     * a missing `range` is an `invalid_value` against the enum. Both are one thing to an
     * author: the field is not there.
     */
    if ('input' in issue && issue.input === undefined) {
      const missing = missingField(path);
      if (missing !== null) return [missing];
    }

    if (issue.code === 'invalid_union') return detailsFromUnion(issue, path);

    // A bad key or element carries its own issues about the value inside it.
    if (issue.code === 'invalid_key' || issue.code === 'invalid_element') {
      return detailsFrom(issue.issues, path);
    }

    /*
     * An unknown key is reported **at the key**, not at the object holding it. The path
     * is what an author searches their file for, and a whole strict object is not a
     * search term. One line per key, because a pack with three stray fields has three
     * things to delete.
     */
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: formatPath([...path, key]),
        expectation: 'unknown field — remove it, or check the spelling',
        actual: null,
      }));
    }

    return [{ path: formatPath(path), expectation: expectationOf(issue), actual: actualOf(issue) }];
  });
}

/** Every issue Zod raised, flattened into the reportable shape. */
function problemsFrom<T>(error: z.ZodError<T>): readonly Problem[] {
  const details = detailsFrom(error.issues, []);
  const seen = new Set<string>();

  return details.flatMap((detail) => {
    const message =
      detail.actual === null ? detail.expectation : `${detail.expectation} — got ${detail.actual}`;
    const line = `${detail.path} — ${message}`;

    // Two branches of a union can reach the same conclusion about the same value, and a
    // line repeated is a line a reader has to compare against itself to be sure.
    if (seen.has(line)) return [];
    seen.add(line);

    return [{ path: detail.path, message }];
  });
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/** Errors are values at every boundary. CLAUDE.md §2.5. */
export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/**
 * Parse anything against a schema, and report **every** problem with it rather than the
 * first — an author fixing a pack one refusal at a time is an author pasting six times.
 * Zod collects them all already; asking for `reportInput` is what makes each one say
 * the value it objected to.
 *
 * Never throws, and never returns a half-repaired value.
 */
export function validate<T extends z.ZodType>(schema: T, input: unknown): Validated<z.output<T>> {
  const result = schema.safeParse(input, { reportInput: true });
  if (result.success) return { ok: true, value: result.data };

  return { ok: false, problems: problemsFrom(result.error) };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** The problems, one per line, ready to paste. DATA-MODEL.md §10. */
export function formatProblems(problems: readonly Problem[]): string {
  return problems.map((problem) => `  ${problem.path} — ${problem.message}`).join('\n');
}

/**
 * The whole block, headed by what failed and how much of it did:
 *
 * ```
 * 3 problems in "Frostbound":
 *   spells[4].range — expected one of: self, close, near, far — got "medium"
 * ```
 *
 * The heading is part of the paste, not decoration around it: it is what tells whoever
 * reads it next — a person or a model — which file the paths below belong to.
 */
export function reportProblems(problems: readonly Problem[], subject: string): string {
  const heading = `${count(problems.length, 'problem')} in "${subject}":`;
  if (problems.length === NONE) return heading;

  return `${heading}\n${formatProblems(problems)}`;
}
