/**
 * Two things are under test here and they fail for different reasons.
 *
 * **The shipped file.** `public/packs/core.json` is read off disk and put through the
 * real `parsePack` and the real `resolvePacks`. Core is what every other pack extends
 * and what every character sheet references, so a core pack that stopped resolving
 * would break the app everywhere at once and nowhere visibly — the pickers would just
 * be empty. These assertions are the only thing standing between an edit to that file
 * and a silent one.
 *
 * **The loader.** The path join and the four failure paths, with a stubbed fetcher so
 * nothing here touches the network.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_PACK_ID, CORE_PACK_PATH, MAX_PACK_BYTES } from '../constants';
import { dieNotationParts } from '../model/enums';
import { parsePack, type Pack, type Ref } from '../model/pack';
import { normalizeRef, resolvePacks } from '../model/pack-resolver';
import { corePackUrl, loadCorePack, type FetchedResponse } from './core-pack';

/**
 * Vite copies `public/` to the deploy root, so the file the app fetches at
 * `{BASE_URL}packs/core.json` is this one. The path is built from the constant the
 * loader uses rather than written out again, so the test cannot end up reading a
 * different file than the app does.
 *
 * `import.meta.url` is an `http:` URL under jsdom, not a `file:` one, so it is no use
 * for finding a fixture on disk; vitest runs with the project root as its cwd.
 */
const SHIPPED = readFileSync(resolve(process.cwd(), 'public', CORE_PACK_PATH), 'utf8');

/** Parsed once. Every assertion below is about the same file the app fetches. */
const core: Pack = (() => {
  const parsed = parsePack(JSON.parse(SHIPPED));
  if (!parsed.ok) {
    throw new Error(`core.json does not parse:\n${parsed.problems.map((p) => `  ${p.path} — ${p.message}`).join('\n')}`);
  }
  return parsed.pack;
})();

const stack = resolvePacks([core]);

/** Every object in the file, whatever depth it sits at. */
function everyObject(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(everyObject);
  if (typeof value !== 'object' || value === null) return [];

  const self = value as Record<string, unknown>;
  return [self, ...Object.values(self).flatMap(everyObject)];
}

/** The lowest and highest face a notation can produce: `2d6` is 2 through 12. */
function span(notation: string): { low: number; high: number } {
  const parts = dieNotationParts(notation);
  if (parts === null) throw new Error(`not a notation: ${notation}`);
  return { low: parts.count, high: parts.count * Number(parts.die.slice(1)) };
}

const ok = (text: string): FetchedResponse => ({ ok: true, status: 200, text: () => Promise.resolve(text) });

/**
 * How long a core talent row may be. Not a rule of the game and not a schema bound —
 * it is the line between "+1 to melee and ranged attacks" and a sentence of prose, and
 * it lives here because it is a fact about this test rather than about the format.
 */
const MAX_TALENT_ROW_LENGTH = 80;

describe('the shipped core pack', () => {
  it('parses, and declares the pack id every reference is written against', () => {
    expect(core.id).toBe(CORE_PACK_ID);
    expect(core.format).toBe('lantern-pack');
  });

  it('is well inside the bound the loader enforces', () => {
    expect(SHIPPED.length).toBeLessThan(MAX_PACK_BYTES);
  });

  it('ships every kind a picker needs', () => {
    expect(core.ancestries?.length).toBeGreaterThan(0);
    expect(core.classes?.length).toBeGreaterThan(0);
    expect(core.spells?.length).toBeGreaterThan(0);
    expect(core.items?.length).toBeGreaterThan(0);
    expect(core.tables?.length).toBeGreaterThan(0);
  });

  /**
   * DESIGN.md §7 — the licensing boundary, as an assertion rather than an intention.
   * Core ships names, mechanics and page references; the prose is the book's.
   *
   * It reads the raw JSON rather than the parsed pack, because a key the schema treats
   * as optional is still a key somebody typed, and `"text": null` is not `undefined`.
   *
   * **A table row is the one object exempt, and it is exempt because the schema makes
   * it so** — `TableRow.text` is required, so a talent table cannot exist without it.
   * Those rows carry a terse mechanical statement in our own words, which is DESIGN.md
   * §7's "mechanics" column; the next test is what holds them to that. Every other
   * object in the file must carry no `text` at all.
   */
  it('carries no rules text in any field, at any depth', () => {
    const rows = everyObject(JSON.parse(SHIPPED)).filter((entry) => entry.roll !== undefined);
    const carrying = everyObject(JSON.parse(SHIPPED)).filter(
      (entry) => entry.text !== undefined && entry.roll === undefined,
    );

    expect(carrying).toEqual([]);
    expect(rows.length, 'no table rows found — the exemption below is checking nothing').toBeGreaterThan(0);
  });

  /**
   * The bound on that exemption. A talent row states a mechanic and stops; a row long
   * enough to be a sentence of flavour is the thing DESIGN.md §7 forbids, and the
   * schema's own `MAX_TEXT_LENGTH` is far too generous to catch it. This is a licensing
   * assertion wearing a length check, so it is written where the reason is visible.
   */
  it('keeps every table row to a mechanical statement, not prose', () => {
    for (const table of core.tables ?? []) {
      for (const row of table.rows) {
        expect(row.text.length, `${table.id}: "${row.text}"`).toBeLessThanOrEqual(MAX_TALENT_ROW_LENGTH);
      }
    }
  });

  it('carries no ancestry talent text', () => {
    for (const ancestry of core.ancestries ?? []) {
      expect(ancestry.talent ?? null).toBeNull();
    }
  });

  // `page` is what stands in for the text core does not ship (DATA-MODEL.md §3). The
  // key is asserted present rather than filled: filling it is a page pass against the
  // book, and this is what makes that pass an edit rather than an addition.
  it('gives every entry a page field to be filled', () => {
    const entries = [
      ...(core.ancestries ?? []),
      ...(core.classes ?? []),
      ...(core.spells ?? []),
      ...(core.items ?? []),
      ...(core.tables ?? []),
    ];
    for (const entry of entries) {
      expect(entry, `${entry.id} has no page field`).toHaveProperty('page');
    }
  });

  it('resolves with no warnings at all', () => {
    expect(stack.warnings).toEqual([]);
  });

  it('overrides nothing — core is the bottom of the stack', () => {
    for (const entry of everyObject(JSON.parse(SHIPPED))) {
      expect(entry.overrides).toBeUndefined();
    }
    expect(core.extends).toBeUndefined();
  });
});

describe('every reference inside core lands', () => {
  const resolves = (reference: string, kind: 'class' | 'item' | 'table'): boolean =>
    stack.byRef.has(normalizeRef(reference, kind, CORE_PACK_ID));

  it('points every class at a talent table that exists', () => {
    for (const entry of core.classes ?? []) {
      expect(resolves(entry.talentTable, 'table'), `${entry.id} → ${entry.talentTable}`).toBe(true);
    }
  });

  it('points every class weapon at an item that exists', () => {
    for (const entry of core.classes ?? []) {
      for (const weapon of entry.weapons) {
        expect(resolves(weapon, 'item'), `${entry.id} → ${weapon}`).toBe(true);
      }
    }
  });

  it('puts every spell on a class that exists', () => {
    for (const entry of core.spells ?? []) {
      for (const className of entry.classes) {
        expect(resolves(className, 'class'), `${entry.id} → ${className}`).toBe(true);
      }
    }
  });

  it('gives every spellcasting class at least one spell', () => {
    for (const entry of core.classes ?? []) {
      if (entry.spellcasting === null || entry.spellcasting === undefined) continue;
      const ref: Ref = normalizeRef(entry.id, 'class', CORE_PACK_ID);
      const spells = (core.spells ?? []).filter((spell) =>
        spell.classes.some((name) => normalizeRef(name, 'class', CORE_PACK_ID) === ref),
      );
      expect(spells.length, `${entry.id} has no spells`).toBeGreaterThan(0);
    }
  });

  it('names every class weapon as a weapon, and nothing else', () => {
    const weapons = new Set(
      (core.items ?? []).filter((item) => item.weapon !== undefined).map((item) => item.id),
    );
    for (const entry of core.classes ?? []) {
      for (const weapon of entry.weapons) {
        expect(weapons.has(weapon), `${entry.id} → ${weapon} is not a weapon`).toBe(true);
      }
    }
  });
});

describe('every core table covers its own die', () => {
  it('leaves no gap and no overlap between the lowest and highest face', () => {
    for (const table of core.tables ?? []) {
      const { low, high } = span(table.die);
      const covered = new Map<number, number>();

      for (const row of table.rows) {
        const [from, to] = typeof row.roll === 'number' ? [row.roll, row.roll] : row.roll;
        for (let face = from; face <= to; face += 1) {
          covered.set(face, (covered.get(face) ?? 0) + 1);
        }
      }

      for (let face = low; face <= high; face += 1) {
        expect(covered.get(face), `${table.id} has no row for ${face}`).toBe(1);
      }
      for (const face of covered.keys()) {
        expect(face, `${table.id} has a row outside ${low}-${high}`).toBeGreaterThanOrEqual(low);
        expect(face, `${table.id} has a row outside ${low}-${high}`).toBeLessThanOrEqual(high);
      }
    }
  });
});

describe('ids are unique within each array', () => {
  it('defines nothing twice', () => {
    for (const [kind, entries] of [
      ['ancestries', core.ancestries],
      ['classes', core.classes],
      ['spells', core.spells],
      ['items', core.items],
      ['tables', core.tables],
    ] as const) {
      const ids = (entries ?? []).map((entry) => entry.id);
      expect(new Set(ids).size, `${kind} repeats an id`).toBe(ids.length);
    }
  });
});

describe('corePackUrl', () => {
  it('joins the path to the base the app is served from', () => {
    expect(corePackUrl('/lantern/')).toBe(`/lantern/${CORE_PACK_PATH}`);
  });

  it('adds the separator a base without one is missing', () => {
    expect(corePackUrl('/lantern')).toBe(`/lantern/${CORE_PACK_PATH}`);
  });

  // The one that matters. Pages serves from a subpath, so a URL rooted at the site
  // root 404s — silently. CLAUDE.md §1, DEPLOY.md §2.
  it('never roots the URL at / when the base is relative', () => {
    expect(corePackUrl('./')).toBe(`./${CORE_PACK_PATH}`);
    expect(corePackUrl('./').startsWith('/')).toBe(false);
  });

  it('defaults to the base this build was compiled with', () => {
    expect(corePackUrl()).toBe(`${import.meta.env.BASE_URL}${CORE_PACK_PATH}`);
    expect(corePackUrl()).toContain(CORE_PACK_PATH);
  });
});

describe('loadCorePack', () => {
  it('returns the pack the file holds', async () => {
    const result = await loadCorePack(() => Promise.resolve(ok(SHIPPED)));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pack.id).toBe(CORE_PACK_ID);
  });

  it('fetches the path joined to the base, and nothing else', async () => {
    const asked: string[] = [];
    await loadCorePack((url) => {
      asked.push(url);
      return Promise.resolve(ok(SHIPPED));
    }, '/lantern/');

    expect(asked).toEqual([`/lantern/${CORE_PACK_PATH}`]);
  });

  it('reports a response that did not arrive', async () => {
    const result = await loadCorePack(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toContain('404');
  });

  it('reports a fetch that threw rather than throwing itself', async () => {
    const result = await loadCorePack(() => Promise.reject(new Error('offline')));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toContain('offline');
  });

  it('reports a body that could not be read', async () => {
    const result = await loadCorePack(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.reject(new Error('truncated')) }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toContain('truncated');
  });

  it('refuses a body past the bound before decoding it', async () => {
    const result = await loadCorePack(() => Promise.resolve(ok('x'.repeat(MAX_PACK_BYTES + 1))));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toContain(`at most ${MAX_PACK_BYTES}`);
  });

  it('reports something that is not JSON', async () => {
    const result = await loadCorePack(() => Promise.resolve(ok('<!doctype html>')));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toContain('expected JSON');
  });

  // Core is validated like anything else (CLAUDE.md §2.7). A build that shipped a
  // broken core.json must say so, not render an empty screen.
  it('reports a malformed pack with the paths a report is pasted from', async () => {
    const broken = JSON.stringify({ ...JSON.parse(SHIPPED), spells: [{ id: 'x', name: 'X' }] });
    const result = await loadCorePack(() => Promise.resolve(ok(broken)));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.some((p) => p.path.startsWith('spells[0]'))).toBe(true);
  });

  it('refuses a core file that renamed itself', async () => {
    const renamed = JSON.stringify({ ...JSON.parse(SHIPPED), id: 'not-core' });
    const result = await loadCorePack(() => Promise.resolve(ok(renamed)));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.message).toContain('not-core');
  });
});
