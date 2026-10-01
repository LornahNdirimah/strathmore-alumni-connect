/**
 * Vitest global setup.
 *
 * Runs before any application module is imported, which matters because
 * `src/config/env.ts` reads process.env once at module load — setting these
 * afterwards would have no effect.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'mentorship-test-')), 'test.db')
// The ML worker is a 6s cold start and is exercised by its own suite with a
// stub; the rest of the tests must not pay for it.
process.env.ML_WORKER_ENABLED = 'false'
