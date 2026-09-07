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
 * Existence is not enough on its own, though, and #111 is why. Renumbering upward leaves
 * every stale reference naming a section that still exists — old §7 pointed at what was
 * now Talents rather than Items — so the check above passes on all of them. The section
 * list below is the other half: number *and* title, pinned, so that a renumber fails and
 * says which references to sweep.
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
// The section list
// ---------------------------------------------------------------------------

/**
 * `DATA-MODEL.md`'s sections as they stand, pinned by number *and* title.
 *
 * The chore is the point. Editing this list is what a renumber costs, and the edit is
 * the prompt: the suite fails, the author comes here, and the diff shows exactly which
 * sections moved — which is the same thing as which references need sweeping. A rule
 * that only checked contiguity would be silent about every part of that.
 */
const HEADINGS: readonly (readonly [number, string])[] = [
  [1, 'Content packs'],
  [2, 'Enums'],
  [3, 'Spells'],
  [4, 'Items'],
  [5, 'Classes'],
  [6, 'Ancestries'],
  [7, 'Talents'],
  [8, 'Tables'],
  [9, 'Extends'],
  [10, 'Validation'],
  [11, 'Authoring with an AI'],
  [12, 'Characters'],
  [13, 'Storage'],
];

/** One `## N. Title` heading. */
type Heading = {
  readonly number: number;
  readonly title: string;
};

const pinned: readonly Heading[] = HEADINGS.map(([number, title]) => ({ number, title }));

/** Every `## N. Title` in the document, in the order it is written. */
function parseHeadings(markdown: string): readonly Heading[] {
  const headings: Heading[] = [];

  for (const line of markdown.split('\n')) {
    const heading = /^## (\d+)\.\s+(.+?)\s*$/.exec(line);
    const number = heading?.[1];
    const title = heading?.[2];

    if (number !== undefined && title !== undefined) {
      headings.push({ number: Number(number), title });
    }
  }

  return headings;
}

/**
 * Where the citations of `§from` and after live, one line per section.
 *
 * Everything at or after the first section that moved is suspect, because a renumber
 * shifts a run of sections and a reference to any of them may or may not have been
 * rewritten. Narrowing further would mean deciding what a reference is *about*, which
 * #129 settled as something a test cannot do.
 */
function citations(references: readonly Reference[], from: number): readonly string[] {
  const bySection = new Map<number, string[]>();

  for (const reference of references) {
    for (const section of reference.sections) {
      if (section < from) continue;

      const where = `${reference.file}:${reference.line}`;
      const listed = bySection.get(section) ?? [];

      if (!listed.includes(where)) listed.push(where);
      bySection.set(section, listed);
    }
  }

  return [...bySection.entries()]
    .sort(([a], [b]) => a - b)
    .map(([section, where]) => `  §${section} — ${where.join(', ')}`);
}

/**
 * Every way the document and the list disagree, in section order, and — when any section
 * moved — the references to sweep. Empty when they agree.
 *
 * A moved title and a changed title are different failures and say so differently. A
 * renumber invalidates references silently; a rename leaves every reference pointing at
 * the right section and costs nothing but this list.
 */
function drift(
  list: readonly Heading[],
  document: readonly Heading[],
  references: readonly Reference[],
): readonly string[] {
  const listed = new Map(list.map(({ number, title }) => [number, title]));
  const written = new Map(document.map(({ number, title }) => [number, title]));
  const listedByTitle = new Map(list.map(({ number, title }) => [title, number]));
  const writtenByTitle = new Map(document.map(({ number, title }) => [title, number]));

  const problems: string[] = [];
  const moved: number[] = [];

  const numbers = [...new Set([...listed.keys(), ...written.keys()])].sort((a, b) => a - b);

  for (const number of numbers) {
    const was = listed.get(number);
    const now = written.get(number);

    if (was === now) continue;

    if (was !== undefined && now !== undefined) {
      const movedTo = writtenByTitle.get(was);

      if (movedTo === undefined) {
        problems.push(
          `§${number} — the list says "${was}", the document says "${now}": renamed, not ` +
            `renumbered. Every reference to §${number} still points at the right section; ` +
            `only this list needs the edit.`,
        );
        continue;
      }

      problems.push(
        `§${number} — the list says "${was}", the document says "${now}": "${was}" is now ` +
          `§${movedTo}.`,
      );
      moved.push(number, movedTo);
      continue;
    }

    if (now === undefined && was !== undefined) {
      const movedTo = writtenByTitle.get(was);

      if (movedTo === undefined) {
        problems.push(`§${number} "${was}" is in the list and not in the document: it was cut.`);
        continue;
      }

      problems.push(`§${number} "${was}" is now §${movedTo}: the document ends before §${number}.`);
      moved.push(number, movedTo);
      continue;
    }

    if (was === undefined && now !== undefined) {
      const cameFrom = listedByTitle.get(now);

      if (cameFrom === undefined) {
        problems.push(`§${number} "${now}" is in the document and not in the list: add it.`);
        continue;
      }

      problems.push(`§${number} "${now}" was §${cameFrom}: the list ends before §${number}.`);
      moved.push(number, cameFrom);
    }
  }

  if (moved.length > 0) {
    const from = Math.min(...moved);

    problems.push(
      `The numbering moved at §${from}. Every citation of §${from} and after is suspect:`,
      ...citations(references, from),
    );
  }

  return problems;
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
  const markdown = readFileSync(resolve(root, DOC), 'utf8');
  const known = parseSections(markdown);
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

  it('has the sections its list pins, by number and by title', () => {
    expect(drift(pinned, parseHeadings(markdown), references)).toEqual([]);
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
// ---------------------------------------------------------------------------
// Holding the list
// ---------------------------------------------------------------------------

describe('holding the section list', () => {
  /** A three-section document, and the list that agrees with it. */
  const list: readonly Heading[] = [
    { number: 1, title: 'Content packs' },
    { number: 2, title: 'Items' },
    { number: 3, title: 'Talents' },
  ];

  /** One citation of §1 and one of §2, so that the sweep block has something to name. */
  const cited = [
    ...referencesIn('src/model/pack.ts', `// ${DOC} §1`, DOC),
    ...referencesIn('DESIGN.md', `First line.\nSecond line, see ${DOC} §2.`, DOC),
  ];

  it('passes when the document says what the list says', () => {
    expect(drift(list, list, cited)).toEqual([]);
  });

  it('fails when a section is renumbered, and says which number changed hands', () => {
    const renumbered: readonly Heading[] = [
      { number: 1, title: 'Content packs' },
      { number: 2, title: 'Enums' },
      { number: 3, title: 'Items' },
      { number: 4, title: 'Talents' },
    ];

    expect(drift(list, renumbered, [])).toEqual([
      '§2 — the list says "Items", the document says "Enums": "Items" is now §3.',
      '§3 — the list says "Talents", the document says "Items": "Talents" is now §4.',
      '§4 "Talents" was §3: the list ends before §4.',
      'The numbering moved at §2. Every citation of §2 and after is suspect:',
    ]);
  });

  it('names the citations of the first section that moved, and of every one after', () => {
    const renumbered: readonly Heading[] = [
      { number: 1, title: 'Content packs' },
      { number: 2, title: 'Enums' },
      { number: 3, title: 'Items' },
      { number: 4, title: 'Talents' },
    ];

    expect(drift(list, renumbered, cited).slice(-2)).toEqual([
      'The numbering moved at §2. Every citation of §2 and after is suspect:',
      '  §2 — DESIGN.md:2',
    ]);
  });

  it('leaves the citations before the move out of the sweep', () => {
    const renumbered: readonly Heading[] = [
      { number: 1, title: 'Content packs' },
      { number: 2, title: 'Items' },
      { number: 3, title: 'Tables' },
      { number: 4, title: 'Talents' },
    ];

    expect(drift(list, renumbered, cited).join('\n')).not.toContain('src/model/pack.ts');
  });

  it('fails differently when a section is renamed rather than renumbered', () => {
    const renamed: readonly Heading[] = [
      { number: 1, title: 'Content packs' },
      { number: 2, title: 'Gear' },
      { number: 3, title: 'Talents' },
    ];

    expect(drift(list, renamed, cited)).toEqual([
      '§2 — the list says "Items", the document says "Gear": renamed, not renumbered. ' +
        'Every reference to §2 still points at the right section; only this list needs the edit.',
    ]);
  });

  it('asks for a new section to be added, and sweeps nothing', () => {
    const added: readonly Heading[] = [...list, { number: 4, title: 'Storage' }];

    expect(drift(list, added, cited)).toEqual([
      '§4 "Storage" is in the document and not in the list: add it.',
    ]);
  });

  it('reports a section that was cut', () => {
    const cut: readonly Heading[] = list.slice(0, 2);

    expect(drift(list, cut, cited)).toEqual([
      '§3 "Talents" is in the list and not in the document: it was cut.',
    ]);
  });

  it('reads a number and a title off a heading, and nothing off a subheading', () => {
    const markdown = ['# Data model', '', '## 1. Content packs', '', '### The envelope'].join('\n');

    expect(parseHeadings(markdown)).toEqual([{ number: 1, title: 'Content packs' }]);
  });
});
