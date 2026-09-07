/**
 * `DATA-MODEL.md`'s section numbers are an addressing scheme, and until this file
 * existed nothing held it to anything. Comments across `src/`, `DESIGN.md`,
 * `schema/pack.schema.json` and `docs/authoring-prompt.md` all cite `DATA-MODEL.md §N`;
 * #111 moved §§7-12 to §§8-13 and rewrote 107 of those references in one commit, and
 * `typecheck`, `lint` and 1,023 tests all passed while fifteen of them still pointed at
 * the old section. It was caught by hand.
 *
 * A reference naming the wrong section is worse than no reference: it sends a reader —
 * or a model — to a section that reads plausibly and says the wrong thing. So the
 * headings are parsed once and every citation in the repository is required to name one
 * that exists.
 *
 * Checking the *number* is the whole of it. Whether a reference is about the right
 * subject is not something a test can decide.
 *
 * Two forms the #111 sweep got wrong, both a case below:
 *
 * - **`§7.` and `§2.7` are different things.** A period followed by a digit is a
 *   subsection; a period followed by anything else is the end of a sentence. Treating
 *   them alike is the bug that started this.
 * - **`§§3-9` and `§1, §10` both appear**, and a scanner that reads only the first
 *   number of a line misses most of what is there.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The repository root. `import.meta.url` is an `http:` URL under jsdom, not a file one. */
const root = resolve(import.meta.dirname, '..');

/**
 * The document being addressed. Written once, so that this file's own fixtures can name
 * it without the repository sweep below reading them as real citations.
 */
const DOC = 'DATA-MODEL.md';

// ---------------------------------------------------------------------------
// The headings
// ---------------------------------------------------------------------------

/** What `DATA-MODEL.md` can be addressed by: `## 9. Extends`, and any numbered `###`. */
type Sections = {
  /** Every `N` in a `## N. Title` heading. */
  readonly sections: ReadonlySet<number>;
  /** Every `N.M` in a `### N.M Title` heading, as `'N.M'`. The document writes none. */
  readonly subsections: ReadonlySet<string>;
};

function parseSections(markdown: string): Sections {
  const sections = new Set<number>();
  const subsections = new Set<string>();

  for (const line of markdown.split('\n')) {
    const section = /^## (\d+)\.\s/.exec(line);
    if (section?.[1] !== undefined) sections.add(Number(section[1]));

    const subsection = /^#{3,6} (\d+)\.(\d+)/.exec(line);
    if (subsection?.[1] !== undefined) subsections.add(`${subsection[1]}.${subsection[2]}`);
  }

  return { sections, subsections };
}

// ---------------------------------------------------------------------------
// The references
// ---------------------------------------------------------------------------

/** One `§`-reference, as written and as read. */
type Reference = {
  readonly file: string;
  readonly line: number;
  /** The reference exactly as it appears, for the failure message. */
  readonly text: string;
  /** Every section it names — one, or the whole span of a `§§3-9`. */
  readonly sections: readonly number[];
  /** `'N.M'` when the reference is to a subsection, `null` when it is to a section. */
  readonly subsection: string | null;
};

/**
 * A document name, or a `§`-reference. The two are matched by one pattern so that they
 * come back interleaved in the order they were written, which is what makes a reference
 * attributable to the document mentioned before it: a line saying
 * `(DATA-MODEL.md §5) ... (CLAUDE.md §2.6)` cites two documents and one of them is not
 * this one.
 *
 * The reference alternative, in pieces:
 *
 * - `§(§?)` — a second sign marks a span, as in `§§3-9`
 * - `(\d+)` — the section
 * - `(?:\.(\d+))?` — a subsection, and **only** when a digit follows the period. This is
 *   what separates `§2.7` from a `§7.` that ends a sentence
 * - `(?:[-–](\d+))?` — the far end of a span. No spaces around it: `§2 — spell tiers run
 *   1 to 5` is prose, not a range
 */
const TOKEN = /([A-Za-z][A-Za-z0-9-]*\.md)|§(§?)(\d+)(?:\.(\d+))?(?:[-–](\d+))?/g;

/**
 * Every reference to `doc` in one file's text.
 *
 * Attribution stops at the end of a line. A `§` on a line that has not named a document
 * yet belongs to whatever the comment above it said, and guessing which document that
 * was would invent citations rather than check them.
 */
function referencesIn(file: string, source: string, doc: string): readonly Reference[] {
  const found: Reference[] = [];

  source.split('\n').forEach((line, index) => {
    let current: string | null = null;

    for (const match of line.matchAll(TOKEN)) {
      const [text, document, span, section, subsection, spanEnd] = match;

      if (document !== undefined) {
        current = document;
        continue;
      }
      if (current !== doc || section === undefined) continue;

      const from = Number(section);
      const to = spanEnd === undefined ? from : Number(spanEnd);
      const sections =
        span === '§' && to > from
          ? Array.from({ length: to - from + 1 }, (_, offset) => from + offset)
          : [from];

      found.push({
        file,
        line: index + 1,
        text,
        sections,
        subsection: subsection === undefined ? null : `${section}.${subsection}`,
      });
    }
  });

  return found;
}

/** One line per reference that names something the document does not have. */
function unresolved(references: readonly Reference[], known: Sections): readonly string[] {
  const broken: string[] = [];

  for (const reference of references) {
    const at = `${reference.file}:${reference.line} — ${reference.text}`;

    if (reference.subsection !== null && !known.subsections.has(reference.subsection)) {
      broken.push(`${at} — no such subsection: §${reference.subsection}`);
      continue;
    }

    for (const section of reference.sections) {
      if (!known.sections.has(section)) broken.push(`${at} — no such section: §${section}`);
    }
  }

  return broken;
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

/**
 * Every tracked file. `git ls-files` rather than a directory walk, so that a build
 * output or somebody's scratch file is never what fails the suite, and so that a new
 * file citing the document is covered the moment it is added.
 */
const tracked = (): readonly string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '');

describe(`${DOC} section references`, () => {
  const known = parseSections(readFileSync(resolve(root, DOC), 'utf8'));
  const references = tracked().flatMap((file) =>
    referencesIn(file, readFileSync(resolve(root, file), 'utf8'), DOC),
  );

  it('numbers its sections 1 to n, with no gap and nothing twice', () => {
    const numbered = [...known.sections].sort((a, b) => a - b);

    expect(numbered).toEqual(numbered.map((_, index) => index + 1));
  });

  // A canary rather than a limit: a scanner whose pattern quietly stopped matching would
  // pass the assertion below by finding nothing at all to check.
  it('is cited widely enough to be worth holding', () => {
    expect(references.length).toBeGreaterThan(100);
  });

  it('has a section for every reference in the repository', () => {
    expect(unresolved(references, known)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The reader itself
// ---------------------------------------------------------------------------

describe('reading a section reference', () => {
  /** Sections 1 to 5, no numbered subsections — what `DATA-MODEL.md` looks like today. */
  const five: Sections = { sections: new Set([1, 2, 3, 4, 5]), subsections: new Set() };

  const read = (line: string): readonly Reference[] => referencesIn('fixture.ts', line, DOC);

  it('reads a period that ends a sentence as punctuation, not a subsection', () => {
    expect(read(`/** ${DOC} §2. Nothing else. */`)).toEqual([
      { file: 'fixture.ts', line: 1, text: '§2', sections: [2], subsection: null },
    ]);
  });

  it('reads a period followed by a digit as a subsection', () => {
    const [reference] = read(`// ${DOC} §2.7`);

    expect(reference?.subsection).toBe('2.7');
    expect(unresolved(read(`// ${DOC} §2.7`), five)).toEqual([
      'fixture.ts:1 — §2.7 — no such subsection: §2.7',
    ]);
  });

  it('expands a span into every section it covers', () => {
    expect(read(`// ${DOC} §§3-9.`)[0]?.sections).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(unresolved(read(`// ${DOC} §§3-9.`), five)).toEqual([
      'fixture.ts:1 — §§3-9 — no such section: §6',
      'fixture.ts:1 — §§3-9 — no such section: §7',
      'fixture.ts:1 — §§3-9 — no such section: §8',
      'fixture.ts:1 — §§3-9 — no such section: §9',
    ]);
  });

  it('reads every reference in a list, not just the first', () => {
    expect(read(`// ${DOC} §1, §10.`).map((reference) => reference.sections)).toEqual([[1], [10]]);
  });

  it('reads a reference that trails a parenthetical', () => {
    expect(read(`// ${DOC} §1 (Content packs), §5.`).map((one) => one.sections)).toEqual([
      [1],
      [5],
    ]);
  });

  it('leaves the sections of another document alone', () => {
    expect(read(`// (${DOC} §1). A reference came out of a pack (CLAUDE.md §2.6).`)).toEqual([
      { file: 'fixture.ts', line: 1, text: '§1', sections: [1], subsection: null },
    ]);
  });

  it('claims no reference for a bare § with no document before it', () => {
    expect(read('// never anything in the payload (§2.8).')).toEqual([]);
  });

  it('reads a possessive and a backticked name the same as a plain one', () => {
    expect(read(`// \`${DOC}\` §4's own example, and ${DOC} §5)`).map((one) => one.text)).toEqual([
      '§4',
      '§5',
    ]);
  });

  it('does not read an em dash and a number as a span', () => {
    expect(read(`// ${DOC} §2 — 5 tiers`)[0]?.sections).toEqual([2]);
  });

  it('fails when a section is renumbered and its references are not', () => {
    const reference = read(`// ${DOC} §5 — the last section.`);
    const renumbered: Sections = { sections: new Set([1, 2, 3, 4]), subsections: new Set() };

    expect(unresolved(reference, five)).toEqual([]);
    expect(unresolved(reference, renumbered)).toEqual([
      'fixture.ts:1 — §5 — no such section: §5',
    ]);
  });

  it('names the file and the line of every reference it reports', () => {
    const source = [`// ${DOC} §1`, '', `// ${DOC} §9`].join('\n');

    expect(unresolved(referencesIn('src/model/pack.ts', source, DOC), five)).toEqual([
      'src/model/pack.ts:3 — §9 — no such section: §9',
    ]);
  });
});
