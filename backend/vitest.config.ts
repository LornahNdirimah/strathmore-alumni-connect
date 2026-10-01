import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    // SQLite is single-writer and the suites share a temp database file per
    // worker; running files sequentially keeps that deterministic.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    server: {
      deps: {
        // Vite's builtin list predates `node:sqlite`, so it strips the `node:`
        // prefix and then fails to resolve a bare `sqlite` package. Marking it
        // external hands the import back to Node, which resolves it natively.
        external: [/^node:sqlite$/],
      },
    },
  },
  ssr: {
    external: ['node:sqlite'],
  },
})
