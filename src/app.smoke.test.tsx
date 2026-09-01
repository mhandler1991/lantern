// The smoke test. CLAUDE.md §8, docs/workflow.md §2.
//
// The predecessor project shipped a black screen because an import was deleted while
// its call site stayed. `node --check` passed; a browser did not. Nothing short of
// actually mounting the app catches that, so this file mounts it — the real entry
// module, against a real #root — and stays in the suite forever.
//
// No @testing-library: React 18.3 exports `act` itself, and CLAUDE.md §12 forbids
// installing a package without asking. createRoot + act is the whole harness.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './ui/App';

declare global {
  // React reads this off the global to decide whether act() is legal here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every module the app ships, so a missing export is caught by name rather than by a
 * blank page. Non-eager: the loaders run inside the test, where a module that throws
 * on load fails the assertion instead of the file collection.
 */
const appModules = import.meta.glob('./{model,net,state,ui}/**/*.{ts,tsx}', {
  eager: false,
});

/** React reports an invalid element type through console.error before it throws. */
let consoleErrors: unknown[][] = [];

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  vi.resetModules();
  expect(
    consoleErrors,
    `React logged an error while rendering: ${format(consoleErrors)}`,
  ).toHaveLength(0);
});

/** Module namespace objects have a null prototype, so String() on one throws. */
function text(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function format(errors: unknown[][]): string {
  return errors.map((args) => args.map(text).join(' ')).join('\n') || '(none)';
}

describe('app smoke test', () => {
  it('resolves every export in the app module graph', async () => {
    const paths = Object.keys(appModules).filter((path) => !/\.(test|spec)\.tsx?$/.test(path));
    expect(
      paths.length,
      'no app modules matched the glob — the pattern has drifted',
    ).toBeGreaterThan(0);

    for (const path of paths) {
      const loader = appModules[path];
      expect(loader, `${path} produced no loader`).toBeTypeOf('function');

      const loaded: unknown = await loader?.();
      expect(loaded, `${path} loaded as ${typeof loaded}`).toBeTypeOf('object');

      for (const [name, value] of Object.entries(loaded as Record<string, unknown>)) {
        expect(
          value,
          `${path} exports ${name} as undefined — a deleted export with a live call site`,
        ).toBeDefined();
      }
    }
  });

  it('mounts the root component without throwing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });

    expect(
      container.childElementCount,
      'the app mounted to an empty container — a black screen',
    ).toBeGreaterThan(0);
    expect(container.textContent?.trim()).not.toBe('');

    await act(async () => {
      root.unmount();
    });
  });

  it('runs the real entry module against a real #root', async () => {
    // main.tsx is where a deleted import meets a live call site. Importing it here
    // exercises the same path index.html does, side effects and all.
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    await act(async () => {
      await import('./main');
    });

    expect(root.childElementCount, 'main.tsx rendered nothing into #root').toBeGreaterThan(0);
  });
});
