// @ts-check

// Lint is the only mechanical enforcement CLAUDE.md's ground rules get. Section 3
// below spells out one rule per ground rule, explicitly rather than by inheriting a
// preset, so that `grep innerHTML eslint.config.js` finds the rule that guards it.

import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },

  // 1. This config file itself, and any other plain ESM in the repo root.
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  // 2. Every TypeScript source. Browser globals; vite.config.ts is re-scoped in §5.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // 3. React. `jsx-runtime` is required for React 18 with "jsx": "react-jsx" —
  // without it, `react/react-in-jsx-scope` demands a React import that the
  // automatic runtime makes unnecessary.
  //
  // Applied to .ts as well as .tsx: a custom hook in state/ is a .ts file, and
  // react-hooks/rules-of-hooks has to see it.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [react.configs.flat.recommended, react.configs.flat['jsx-runtime']],
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      // TypeScript checks prop shapes. react/prop-types duplicates it and fires
      // on every typed component.
      'react/prop-types': 'off',
    },
  },

  // 4. The ground rules, one block, each traceable to CLAUDE.md.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // §2.4 — no `any`. Use `unknown` and narrow it, or define the type.
      '@typescript-eslint/no-explicit-any': 'error',

      // §6 — never dangerouslySetInnerHTML with pack or peer data.
      'react/no-danger': 'error',

      // §6 — deriving state in an effect is a bug; hooks must be unconditional.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // §9 — no console.log in a commit. Warnings and errors are how §4's
      // "warn, do not block" degrades in the open, so both stay allowed. `info` joins
      // them for net/: peer bugs are diagnosed from the console, often on somebody
      // else's machine after the fact, so every peer event has to be printed and
      // `warn` would cry wolf. `log` stays banned, which is what keeps a stray
      // debugging print out of a commit.
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],

      // §2.6 — the other half of the XSS boundary. react/no-danger only sees the
      // JSX attribute; direct DOM assignment is the same hole and no bundled rule
      // covers it. Text nodes only.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression > MemberExpression.left[property.name=/^(inner|outer)HTML$/]',
          message:
            'CLAUDE.md §2.6: never assign innerHTML/outerHTML. Use textContent or a text node.',
        },
      ],
    },
  },

  // 5. Build config runs in Node, not the browser.
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
