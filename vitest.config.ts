import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Run test files sequentially — Testcontainer suites start Docker containers
    // and share process.env; parallelism causes cross-contamination.
    // Each test file in its own fork (isolated module cache).
    // maxForks: 1 keeps execution sequential so Docker containers don't race.
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 1, minForks: 0 },
    },
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});
