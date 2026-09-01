import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves this from a subpath (/lantern/). Absolute asset paths
  // 404 there. DEPLOY.md §2 — never '/'.
  base: './',

  plugins: [react()],

  build: {
    // Two entry points. test-room.html is the peer-discovery harness and must
    // reach a real HTTPS URL alongside the app. DEPLOY.md §5.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        testRoom: resolve(import.meta.dirname, 'test-room.html'),
      },
    },
  },

  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
