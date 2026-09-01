import { describe, expect, it } from 'vitest';

describe('build environment', () => {
  it('runs tests in a DOM', () => {
    expect(typeof document).toBe('object');
    expect(document.createElement('div')).toBeInstanceOf(HTMLElement);
  });

  // Runtime-fetched paths resolve against BASE_URL, never a hardcoded '/'.
  // A wrong path here fails silently in the browser. DEPLOY.md §2.
  it('exposes a base url to resolve runtime paths against', () => {
    expect(import.meta.env.BASE_URL).toBeTypeOf('string');
    expect(import.meta.env.BASE_URL.endsWith('/')).toBe(true);
  });
});
