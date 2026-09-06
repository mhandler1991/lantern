/**
 * The three files DATA-MODEL.md §10 ships for authors, tested against the code they
 * claim to describe. All three fail the same way if nobody watches them: they keep
 * describing last month's schema, and the person they mislead is the one who cannot
 * read `model/pack.ts` to check.
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
import { Pack, parsePack } from './pack';
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
 * the same reason a pack's problems are (DATA-MODEL.md §9).
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

  it('is one of everything DATA-MODEL.md gives a shape', () => {
    expect({
      classes: example.classes?.length ?? 0,
      ancestries: example.ancestries?.length ?? 0,
      spells: example.spells?.length ?? 0,
      items: example.items?.length ?? 0,
      tables: example.tables?.length ?? 0,
      extends: example.extends?.length ?? 0,
    }).toEqual({ classes: 1, ancestries: 1, spells: 2, items: 2, tables: 1, extends: 2 });
  });

  // `talents` is the one array with no shape in DATA-MODEL.md. An example entry would
  // be a shape somebody copied, so the file omits it and the guide says why.
  it('leaves out the array that has no shape to copy', () => {
    expect(example.talents).toBeUndefined();
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
   * (DATA-MODEL.md §8) and this file exists partly to show what that looks like; a
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
    ];

    expect(referenced.filter((reference) => !stack.byRef.has(reference))).toEqual([]);
  });
});
