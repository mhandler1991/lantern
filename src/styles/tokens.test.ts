// The tokens file is law for anything visual (CLAUDE.md §6), and the rule it carries —
// no raw hex, no raw px in a component — is the kind that holds for a month and then
// quietly stops. So it is a test rather than a habit.
//
// Sources are read off disk rather than imported. Vitest disables CSS processing by
// default (`test.css: false`), and under that setting `import css from './x.css?raw'`
// resolves to an empty string with no error at all — a scan that silently matches
// nothing and passes forever.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// `import.meta.dirname`, not a URL: under Vitest `import.meta.url` is not a file: URL.
const srcDir = resolve(import.meta.dirname, '..');
const tokensPath = join(srcDir, 'styles', 'tokens.css');
const tokensCss = readFileSync(tokensPath, 'utf8');

/** Every custom property this file declares, e.g. `--ink`. */
const declared = new Set(
  Array.from(tokensCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm), (match) => match[1]),
);

/** Every custom property this file reads back, e.g. `var(--ink)`. */
const referenced = Array.from(tokensCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g), (match) => match[1]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/**
 * Components, plus any stylesheet that is not this one. Anything that renders is fair
 * game; `constants.ts` is not, because a number there is the point of the file.
 */
const scanned = walk(srcDir)
  .filter((path) => /\.css$/.test(path) || (/\.tsx?$/.test(path) && path.includes(`${sep}ui${sep}`)))
  .filter((path) => path !== tokensPath && !/\.(test|spec)\.tsx?$/.test(path))
  .map((path) => [relative(srcDir, path), readFileSync(path, 'utf8')] as const);

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
const RAW_PX = /\b\d+(?:\.\d+)?px\b/;

describe('design tokens', () => {
  it('reads the stylesheet it means to check', () => {
    expect(tokensCss.length, 'tokens.css read as empty').toBeGreaterThan(0);
    expect(declared.size).toBeGreaterThan(0);
  });

  it('declares the palette DESIGN.md §6 names', () => {
    for (const token of [
      '--ink',
      '--parchment',
      '--wood',
      '--leather',
      '--torch',
      '--gold',
      '--banner',
    ]) {
      expect(declared, `tokens.css is missing ${token}`).toContain(token);
    }
  });

  it('declares the three faces, each with a fallback behind it', () => {
    for (const [token, family] of [
      ['--font-display', 'Cinzel'],
      ['--font-body', 'EB Garamond'],
      ['--font-label', 'Montserrat'],
    ]) {
      const rule = new RegExp(`${token}:([^;]+);`).exec(tokensCss)?.[1] ?? '';
      expect(rule, `${token} does not name ${family}`).toContain(family);
      // A missing woff2 must degrade to a real face, not to whatever the UA picks (#81).
      expect(rule.split(',').length, `${token} has no fallback stack`).toBeGreaterThan(1);
    }
  });

  it('declares a type scale, a space scale and a layer order', () => {
    for (const token of ['--text-base', '--leading-body', '--space-4', '--z-dice']) {
      expect(declared, `tokens.css is missing ${token}`).toContain(token);
    }
  });

  it('references no token it does not declare', () => {
    const dangling = referenced.filter((token) => token !== undefined && !declared.has(token));
    expect(dangling, `var() points at undeclared tokens: ${dangling.join(', ')}`).toEqual([]);
  });
});

describe('no raw values outside tokens.css', () => {
  it('finds files to scan', () => {
    // A scan that silently matches nothing is a test that silently passes forever.
    expect(scanned.length).toBeGreaterThan(0);
  });

  it.each(scanned)('%s uses tokens, not literals', (_path, source) => {
    expect(RAW_HEX.exec(source)?.[0], 'raw hex — use a var(--…) role').toBeUndefined();
    expect(RAW_PX.exec(source)?.[0], 'raw px — use a var(--space-…)').toBeUndefined();
  });
});
