import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Vitest runs the pure game logic in plain Node: no Phaser, no canvas, no browser.
 *
 * That is only possible because `SeededRandom` and `CityGenerator` import nothing
 * from the rendering engine. All this config has to provide is the `@/` path alias
 * used across the codebase.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});