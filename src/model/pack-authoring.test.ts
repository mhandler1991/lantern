/**
 * The five files DATA-MODEL.md §11 ships for authors, tested against the code they claim
 * to describe. All five fail the same way if nobody watches them: they keep describing
 * last month's schema, and the person they mislead is the one who cannot read
 * `model/pack.ts` to check.
 *
 * **`schema/pack.schema.json`.** A hand-written mirror of `Pack`, because a generated
 * one carries no descriptions and an undescribed schema is a worse prompt. It is held
 * to the real thing by generating a JSON Schema from the Zod schema and requiring the
 * committed file to carry every constraint it expresses, with the same fields and the
 * same required lists. The committed file may add what Zod cannot express — a `pattern`
 * for a refinement — and nothing else.
 *
 * **`docs/authoring-prompt.md`.** The enum lists a model is handed. They are compared
 * against `model/enums.ts` member by member: a vocabulary that gained a value and a
 * prompt that did not is a model generating packs the app will refuse.
 *
 * **`packs/example-pack.json`.** Read off disk and put through the real `parsePack` and
 * the real `resolvePacks` alongside core, the way `state/core-pack.test.ts` does with
 * the shipped core pack. It is the file people copy first, so it must parse, resolve,
 * and demonstrate each operation it claims to.
 *
 * **`packs/broken-pack.json`.** The same file with a mistake in every entry, kept so the
 * error report can be *seen* rather than described — §10 promises lines precise enough to
 * paste back into an AI, and a promise nobody has read the output of is a promise. Held
 * to its paths one by one: a schema change that stopped naming one of these would be a
 * report that had quietly got vaguer.
 *
 * **`packs/warning-pack.json`.** The other report: the faults §9 can only *warn* about,
 * which is the report a pack written with an AI actually hits. It parses, so it can be
 * loaded and watched — the broken pack cannot show one, because a pack that does not
 * parse is never resolved — and it is held to its warning lines the same way.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { CORE_PACK_ID, CORE_PACK_PATH, MAX_TABLE_DIE_COUNT } from '../constants';
import {
  ArmorType,
  Currency,
  DamageNotation,
  Die,
  DieNotation,
  Duration,
  Range,
  Stat,
  WeaponType,
} from './enums';
import { Pack, parsePack, reportProblems } from './pack';
import { normalizeRef, resolvePacks } from './pack-resolver';

/** The repository root. `import.meta.url` is an `http:` URL under jsdom, not a file one. */
const root = resolve(import.meta.dirname, '..', '..');

const read = (...path: readonly string[]): string => readFileSync(resolve(root, ...path), 'utf8');

// ---------------------------------------------------------------------------
// A JSON document, described without `any`. CLAUDE.md §2.4.
// ---------------------------------------------------------------------------

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

const isObject = (value: Json): value is { readonly [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asObject = (value: Json, at: string): { readonly [key: string]: Json } => {
  if (!isObject(value)) throw new Error(`${at} is not an object`);
  return value;
};

// ---------------------------------------------------------------------------
// schema/pack.schema.json
// ---------------------------------------------------------------------------

const SCHEMA_PATH = ['schema', 'pack.schema.json'] as const;
const schemaSource = read(...SCHEMA_PATH);
const committed: Json = JSON.parse(schemaSource) as Json;

/**
 * What the committed file may say that the generator cannot. Everything else is
 * annotation — prose for a reader, invisible to a validator — and is stripped before
 * the two are compared.
 */
const UNREPRESENTABLE_IN_ZOD = new Set(['pattern']);
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'examples', '$comment']);

const DEFS = '$defs';
const REF = '$ref';
const REF_PREFIX = `#/${DEFS}/`;

/**
 * The two places whose keys are names an author chose rather than JSON Schema keywords.
 * A pack really does have a field called `description`, and stripping it as an
 * annotation would make the file look like it had lost one.
 */
const NAMED = new Set(['properties', DEFS]);

/** The schema with every `$ref` inlined and every annotation removed. */
function flatten(node: Json, defs: { readonly [key: string]: Json }, at: string): Json {
  if (Array.isArray(node)) return node.map((item, index) => flatten(item, defs, `${at}[${index}]`));
  if (!isObject(node)) return node;

  // A `$ref` with siblings takes the definition and drops them; the only sibling this
  // file writes is a `description`, which is stripped either way.
  const reference = node[REF];
  if (typeof reference === 'string') {
    if (!reference.startsWith(REF_PREFIX)) throw new Error(`${at} — unresolvable $ref ${reference}`);
    const name = reference.slice(REF_PREFIX.length);
    const target = defs[name];
    if (target === undefined) throw new Error(`${at} — no such definition: ${reference}`);
    return flatten(target, defs, `${REF_PREFIX}${name}`);
  }

  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== DEFS && !ANNOTATIONS.has(key))
      .map(([key, value]) => [
        key,
        NAMED.has(key)
          ? Object.fromEntries(
              Object.entries(asObject(value, `${at}.${key}`)).map(([name, child]) => [
                name,
                flatten(child, defs, `${at}.${key}.${name}`),
              ]),
            )
          : flatten(value, defs, `${at}.${key}`),
      ]),
  );
}

/**
 * Every way the committed schema says less than the Zod schema does, as lines a reader
 * can act on. Empty is the passing answer, and the whole list is reported at once for
 * the same reason a pack's problems are (DATA-MODEL.md §10).
 */
function shortfalls(expected: Json, actual: Json, at: string): readonly string[] {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      return [`${at} — expected ${JSON.stringify(expected)} — got ${JSON.stringify(actual)}`];
    }
    return expected.flatMap((item, index) => shortfalls(item, actual[index], `${at}[${index}]`));
  }

  if (!isObject(expected) || !isObject(actual)) {
    return expected === actual
      ? []
      : [`${at} — expected ${JSON.stringify(expected)} — got ${JSON.stringify(actual)}`];
  }

  const lines: string[] = [];

  for (const [key, value] of Object.entries(expected)) {
    const found = actual[key];
    if (found === undefined) {
      lines.push(`${at}.${key} — missing — expected ${JSON.stringify(value)}`);
      continue;
    }

    // Property names are compared as a set, so a field added to `pack.ts` and not to the
    // schema reads as one line rather than as a diff of two nested objects.
    if (key === 'properties' && isObject(value) && isObject(found)) {
      const declared = Object.keys(found).sort();
      const real = Object.keys(value).sort();
      if (declared.join() !== real.join()) {
        lines.push(`${at}.properties — expected ${real.join(', ')} — got ${declared.join(', ')}`);
        continue;
      }
    }

    lines.push(...shortfalls(value, found, `${at}.${key}`));
  }

  for (const key of Object.keys(actual)) {
    if (expected[key] === undefined && !UNREPRESENTABLE_IN_ZOD.has(key)) {
      lines.push(`${at}.${key} — unknown constraint — nothing in pack.ts says it`);
    }
  }

  return lines;
}

describe('schema/pack.schema.json', () => {
  const defs = asObject(asObject(committed, 'the schema')[DEFS] ?? {}, '$defs');
  const flattened = flatten(committed, defs, 'schema');

  // `io: 'input'` is what an author writes, which is what this file is for: `rerollable`
  // is optional in a file and defaulted by the time anything reads it.
  const generated = flatten(
    z.toJSONSchema(Pack, {
      io: 'input',
      unrepresentable: 'any',
      target: 'draft-2020-12',
    }) as Json,
    {},
    'generated',
  );

  it('says everything pack.ts says, and nothing pack.ts does not', () => {
    expect(shortfalls(generated, flattened, 'pack')).toEqual([]);
  });

  it('declares the dialect an editor needs to validate against it', () => {
    expect(asObject(committed, 'the schema').$schema).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
  });

  it('defines every reference it makes and makes every definition it holds', () => {
    const used = new Set(Array.from(schemaSource.matchAll(/"#\/\$defs\/([a-zA-Z]+)"/g), (m) => m[1]));
    expect(Object.keys(defs).filter((name) => !used.has(name))).toEqual([]);
  });

  /**
   * The two notations are `.refine()`d in `model/enums.ts`, which JSON Schema cannot
   * express, so the file states them as patterns instead. A pattern that drifts from the
   * refinement is worse than no pattern — an editor would mark a valid pack red — so the
   * two are compared over a space of strings rather than over a handful of good ones.
   */
  const notations: readonly string[] = ['1', '2', '9', '10', '11', '01', '00', '99', '100', '']
    .flatMap((count) => ['4', '6', '8', '10', '12', '20', '100', '3', '120', ''].map((sides) => `${count}d${sides}`))
    .concat(['d20', 'D20', 'd', '2 d6', '1d8 + level/2', 'two', '']);

  const patternOf = (name: string): RegExp => {
    const definition = asObject(defs[name] ?? null, name);
    const pattern = definition.pattern;
    if (typeof pattern !== 'string') throw new Error(`${name} declares no pattern`);
    return new RegExp(pattern);
  };

  const maxLengthOf = (name: string): number => {
    const definition = asObject(defs[name] ?? null, name);
    const max = definition.maxLength;
    if (typeof max !== 'number') throw new Error(`${name} declares no maxLength`);
    return max;
  };

  it('describes dice notation exactly as the validator reads it', () => {
    const pattern = patternOf('dieNotation');
    const maxLength = maxLengthOf('dieNotation');

    for (const notation of notations) {
      const bySchema = pattern.test(notation) && notation.length <= maxLength;
      expect([notation, bySchema]).toEqual([notation, DieNotation.safeParse(notation).success]);
    }
  });

  it('describes damage exactly as the validator reads it, formulas included', () => {
    const pattern = patternOf('damageNotation');
    const maxLength = maxLengthOf('damageNotation');
    const damages = notations.concat(
      notations.flatMap((left) => ['1d8', '1d4', 'x'].map((right) => `${left}/${right}`)),
      ['1d4/1d8/1d10', '1d8/'],
    );

    for (const damage of damages) {
      const bySchema = pattern.test(damage) && damage.length <= maxLength;
      expect([damage, bySchema]).toEqual([damage, DamageNotation.safeParse(damage).success]);
    }
  });

  // The die-notation pattern spells out the count it admits, so it cannot be derived
  // from the constant. This is the assertion that notices the constant moving.
  it('admits as many dice in one notation as the constant allows', () => {
    expect(MAX_TABLE_DIE_COUNT).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// docs/authoring-prompt.md
// ---------------------------------------------------------------------------

describe('docs/authoring-prompt.md', () => {
  const prompt = read('docs', 'authoring-prompt.md');

  /** The line `    stat: str dex con int wis cha`, as the set of words after the colon. */
  const listed = (label: string): readonly string[] => {
    const values = new RegExp(`^\\s*${label}: (.+)$`, 'm').exec(prompt)?.[1];
    if (values === undefined) throw new Error(`the prompt lists no ${label}`);
    return values.trim().split(/\s+/);
  };

  const vocabularies: readonly (readonly [string, readonly string[]])[] = [
    ['stat', Stat.options],
    ['range', Range.options],
    ['duration', Duration.options],
    ['die', Die.options],
    ['armorType', ArmorType.options],
    ['weaponType', WeaponType.options],
    ['currency', Currency.options],
  ];

  it.each(vocabularies)('hands a model every %s the app accepts', (label, options) => {
    expect(listed(label)).toEqual([...options]);
  });

  it('points at the file it tells the author to paste', () => {
    expect(prompt).toContain(SCHEMA_PATH.join('/'));
  });
});

// ---------------------------------------------------------------------------
// packs/example-pack.json
// ---------------------------------------------------------------------------

/** Parsed once. Every assertion below is about the file an author will copy. */
const parse = (source: string, what: string): Pack => {
  const parsed = parsePack(JSON.parse(source) as unknown);
  if (!parsed.ok) {
    const problems = parsed.problems.map((problem) => `  ${problem.path} — ${problem.message}`);
    throw new Error(`${what} does not parse:\n${problems.join('\n')}`);
  }
  return parsed.pack;
};

describe('packs/example-pack.json', () => {
  const example = parse(read('packs', 'example-pack.json'), 'example-pack.json');
  const core = parse(read('public', CORE_PACK_PATH), 'core.json');
  const stack = resolvePacks([core, example]);

  it('is one of everything the envelope can hold', () => {
    expect({
      classes: example.classes?.length ?? 0,
      ancestries: example.ancestries?.length ?? 0,
      spells: example.spells?.length ?? 0,
      items: example.items?.length ?? 0,
      talents: example.talents?.length ?? 0,
      tables: example.tables?.length ?? 0,
      extends: example.extends?.length ?? 0,
    }).toEqual({
      classes: 1,
      ancestries: 1,
      spells: 2,
      items: 2,
      talents: 1,
      tables: 1,
      extends: 2,
    });
  });

  // The talent the file's first extension offers the core fighter is defined in the same
  // file, so an author reads the whole loop — entry, then extension — off one page, and
  // resolution holds it to the stack like any other reference.
  it('defines the talent its own extension offers a class', () => {
    const offered = (example.extends ?? []).flatMap((extension) => extension.talents ?? []);
    const defined = (example.talents ?? []).map((talent) => talent.id);

    expect(offered).toEqual(['cold-forged']);
    expect(defined).toEqual(['cold-forged']);
  });

  /**
   * The flag nothing shipped set. #144 made a `rerollable` table's offer reach the
   * corner and every table in the repository said `false`, so the feature worked and no
   * player could see it (#152). The example pack is where a flag gets demonstrated —
   * whether a *core* table offers a reroll is a question about the book, not about us.
   */
  it('sets the one flag a table has, so the offer can be seen by loading a file', () => {
    expect((example.tables ?? []).map((table) => [table.id, table.rerollable])).toEqual([
      ['rimewalker-talents', true],
    ]);
  });

  it('demonstrates define, extend and override', () => {
    const defined = normalizeRef('rimewalker', 'class', example.id);
    const extended = normalizeRef('fighter', 'class', CORE_PACK_ID);
    const overridden = normalizeRef('torch', 'item', CORE_PACK_ID);

    const operations = (reference: string): readonly string[] =>
      (stack.byRef.get(reference)?.sources ?? []).map(
        (source) => `${source.packId} ${source.operation}`,
      );

    expect(operations(defined)).toEqual([`${example.id} define`]);
    expect(operations(extended)).toEqual([`${CORE_PACK_ID} define`, `${example.id} extend`]);
    expect(operations(overridden)).toEqual([
      `${CORE_PACK_ID} define`,
      `${example.id} override`,
    ]);
  });

  /**
   * Every warning it produces is one it means to produce. An override warns by design
   * (DATA-MODEL.md §9) and this file exists partly to show what that looks like; a
   * warning about anything else is a broken reference in the file people copy.
   */
  it('warns about the override it wrote on purpose, and about nothing else', () => {
    expect(stack.warnings.map((warning) => warning.path)).toEqual([`${example.id}.items[1].overrides`]);
  });

  // Every reference in it resolves, so the first pack anybody copies is not also the
  // first "no loaded pack defines …" warning they see. The kind comes from the field, as
  // it does everywhere else (DATA-MODEL.md §1).
  it('names nothing the stack cannot resolve', () => {
    const referenced: readonly string[] = [
      ...(example.classes ?? []).flatMap((entry) => [
        ...entry.weapons.map((weapon) => normalizeRef(weapon, 'item', example.id)),
        normalizeRef(entry.talentTable, 'table', example.id),
      ]),
      ...(example.spells ?? []).flatMap((entry) =>
        entry.classes.map((owner) => normalizeRef(owner, 'class', example.id)),
      ),
      ...(example.extends ?? []).map((extension) => extension.target),
      ...(example.extends ?? []).flatMap((extension) =>
        (extension.talents ?? []).map((talent) => normalizeRef(talent, 'talent', example.id)),
      ),
    ];

    expect(referenced.filter((reference) => !stack.byRef.has(reference))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The pack that is wrong on purpose. DATA-MODEL.md §10, §11.
// ---------------------------------------------------------------------------

describe('packs/broken-pack.json', () => {
  const parsed = parsePack(JSON.parse(read('packs', 'broken-pack.json')) as Json);

  /** Every mistake in the file, and the path each one has to be reported against. */
  const EXPECTED_PATHS: readonly string[] = [
    'classes[0].hitDie',
    'classes[0].armor[0]',
    'classes[0].hp',
    'ancestries[0]',
    'spells[0].tier',
    'spells[0].range',
    'items[0].id',
    'items[0].slots',
    'items[0].cost.currency',
    'items[0].armor',
    'talents[0].grants',
    'tables[0].rows[0].roll',
  ];

  it('is refused, because a pack that loaded would prove nothing', () => {
    expect(parsed.ok).toBe(false);
  });

  it('names every mistake in it, at the exact path holding it', () => {
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    expect(parsed.problems.map((problem) => problem.path)).toEqual(EXPECTED_PATHS);
  });

  it('reports all of them at once, so an author pastes once rather than twelve times', () => {
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    const report = reportProblems(parsed.problems, 'Brokenwood');

    expect(report).toContain(`${EXPECTED_PATHS.length} problems in "Brokenwood":`);
  });

  it('says what was expected and what was there, on every line', () => {
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    for (const problem of parsed.problems) {
      // The three grammars §10 allows, and nothing else: an expectation and the value
      // that failed it, a field that is not there, or a field that should not be.
      expect(problem.message).toMatch(
        /^(expected .+ — got .+|missing required field: .+|unknown field — .+)$/,
      );
    }
  });

  /**
   * Coverage is the one fault in this file the schema does not hold: a gap and an
   * overlap are warnings, not refusals (DATA-MODEL.md §8), so `tables[1]` is well
   * formed and costs the report above nothing. It is here to be *seen* — which for the
   * rest of the file means loading it and reading the refusal, and for this table means
   * fixing the refusals first, because a pack that does not parse is never resolved.
   * So the table is lifted into a pack of its own here, and what comes back is the two
   * lines the content screen prints from `stack.warnings`.
   */
  it('carries a table whose only faults are coverage, and reports them as warnings', () => {
    const file = asObject(JSON.parse(read('packs', 'broken-pack.json')) as Json, 'broken-pack.json');
    const tables = file['tables'];
    if (!Array.isArray(tables)) throw new Error('broken-pack.json has no tables');

    const onlyTheTable = parse(
      JSON.stringify({
        format: 'lantern-pack',
        formatVersion: 1,
        id: 'brokenwood',
        name: 'Brokenwood',
        version: '1.0.0',
        tables: [tables[1]],
      }),
      'the coverage table in broken-pack.json',
    );

    const stack = resolvePacks([onlyTheTable]);

    expect(
      stack.warnings.map((warning) => `${warning.path} — ${warning.message}`),
    ).toEqual([
      'tables[0].rows[1].roll — expected a band no other row covers — 5 is already covered ' +
        'by rows[0] (brokenwood:table:brambleback-loot)',
      'tables[0].rows — expected a row for every roll 2d6 can make — nothing covers 9 ' +
        '(brokenwood:table:brambleback-loot)',
    ]);
    // Warned about, and loaded: the rows are all there to roll on (PRD.md principle 4).
    expect(stack.tables[0]?.rows).toHaveLength(3);
  });

  it('leaves the enum problems readable as the list to choose from', () => {
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    const byPath = new Map(parsed.problems.map((problem) => [problem.path, problem.message]));

    expect(byPath.get('classes[0].hitDie')).toBe(
      'expected one of: d4, d6, d8, d10, d12, d20, d100 — got "d7"',
    );
    expect(byPath.get('items[0].cost.currency')).toBe('expected one of: gp, sp, cp — got "ep"');
  });
});

// ---------------------------------------------------------------------------
// The pack that loads and warns. DATA-MODEL.md §9, §11.
// ---------------------------------------------------------------------------

/**
 * The broken pack above is the schema's report; this one is resolution's, and it is the
 * report a pack written with an AI actually hits. A model invents an `extends` aimed at
 * a supplement nobody has, an `overrides` of content that is turned off, a talent it
 * never got round to defining, and a table one face short — every one of which **loads**
 * (PRD.md principle 4), so an author who never reads the warnings never learns they are
 * there.
 *
 * It cannot be demonstrated by the broken pack for the reason its coverage table cannot:
 * a pack that does not parse is never resolved. So this file parses, and is asserted the
 * way the broken pack's twelve paths are — by path, one line at a time.
 */
describe('packs/warning-pack.json', () => {
  const warning = parse(read('packs', 'warning-pack.json'), 'warning-pack.json');
  const core = parse(read('public', CORE_PACK_PATH), 'core.json');
  const stack = resolvePacks([core, warning]);

  const classRef = normalizeRef('mere-guide', 'class', warning.id);
  const talentRef = normalizeRef('mere-touched', 'talent', warning.id);
  const missingTalentRef = normalizeRef('lantern-sworn', 'talent', warning.id);
  const tableRef = normalizeRef('mere-guide-talents', 'table', warning.id);

  /** The table's place in the resolved stack, which is what a coverage path counts. */
  const tableIndex = stack.tables.findIndex((table) => table.ref === tableRef);

  const talentsOf = (stack: ReturnType<typeof resolvePacks>, ref: string): readonly string[] => {
    const found = stack.byRef.get(ref);
    return found?.kind === 'class' ? found.talents : [];
  };

  it('parses, so the report it demonstrates is the resolution one', () => {
    expect(parsePack(JSON.parse(read('packs', 'warning-pack.json')) as Json).ok).toBe(true);
  });

  it('produces one of each resolution warning, at the exact path holding it', () => {
    expect(stack.warnings.map((problem) => `${problem.path} — ${problem.message}`)).toEqual([
      'hollowmere.items[0].overrides — no loaded pack defines wintergloom:item:drowned-lantern ' +
        '— kept there anyway, so a sheet holding it resolves',
      'hollowmere.extends[0].target — no loaded pack defines frostbound:class:rimewalker ' +
        '— the extension is skipped',
      'hollowmere.extends[1].talents[1] — no loaded pack defines hollowmere:talent:lantern-sworn ' +
        '— offered anyway, and it reads as its reference',
      `tables[${tableIndex}].rows[1].roll — expected a band no other row covers — 3 is already ` +
        `covered by rows[0] (${tableRef})`,
      `tables[${tableIndex}].rows — expected a row for every roll 1d6 can make — nothing covers ` +
        `5 (${tableRef})`,
    ]);
  });

  /**
   * Warned about, and loaded. An override is kept at the reference it names rather than
   * at its own, which is what "kept there anyway" means and why the item is looked for
   * where it is.
   */
  it('resolves — every entry it defines is in the stack, and nothing is refused', () => {
    const defined: readonly string[] = [
      classRef,
      talentRef,
      tableRef,
      'wintergloom:item:drowned-lantern',
    ];

    expect(defined.filter((reference) => !stack.byRef.has(reference))).toEqual([]);
    expect(stack.packs.map((summary) => summary.id)).toContain(warning.id);
  });

  // The talent nothing defines is offered anyway: losing it would lose the class a
  // talent it was offered, and a reference is what a sheet shows (PRD.md principle 1).
  it('offers the class both talents, the one nothing defines included', () => {
    expect(talentsOf(stack, classRef)).toEqual([talentRef, missingTalentRef]);
  });

  // A gap costs a face, never a row: all three are there to roll on, and 5 answers with
  // the number rolled and no row (DATA-MODEL.md §8).
  it('keeps every row of the table with the hole in it', () => {
    expect(stack.tables[tableIndex]?.rows).toHaveLength(3);
  });

  /**
   * The half of "an override of content that is turned off" a static file cannot show:
   * load the pack the extension names and the extension applies, with nothing else about
   * the file changing. It is the same list, resolved again — which is the whole of what
   * reordering or turning a pack on does (DATA-MODEL.md §9).
   */
  it('applies its skipped extension once the pack it names is loaded', () => {
    const example = parse(read('packs', 'example-pack.json'), 'example-pack.json');
    const together = resolvePacks([core, example, warning]);

    expect(together.warnings.map((problem) => problem.path)).not.toContain(
      'hollowmere.extends[0].target',
    );
    expect(talentsOf(together, normalizeRef('rimewalker', 'class', example.id))).toEqual([
      talentRef,
    ]);
  });
});
