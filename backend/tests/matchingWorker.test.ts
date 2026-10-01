/**
 * The worker supervisor: restart behaviour and re-priming after a crash.
 *
 * Drives a tiny fake worker (tests/fixtures/fake-worker) that speaks the real
 * protocol without importing pandas, so a restart takes about a second.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MatchingWorker } from '../src/services/matching/MatchingWorker.js'

const FAKE_ENGINE_DIR = resolve(import.meta.dirname, 'fixtures', 'fake-worker')
const silent = { info: () => {}, warn: () => {}, error: () => {} }

let worker: MatchingWorker | null = null

afterEach(async () => {
  await worker?.stop()
  worker = null
  delete process.env.CRASH_MARKER
})

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise((settle) => setTimeout(settle, 25))
  }
}

describe('MatchingWorker', () => {
  it('runs ready listeners again after a crash, so the new process is re-primed', async () => {
    process.env.CRASH_MARKER = join(mkdtempSync(join(tmpdir(), 'worker-crash-')), 'crashed')
    worker = new MatchingWorker({ engineDir: FAKE_ENGINE_DIR, enabled: true, logger: silent })

    let readyCount = 0
    worker.onReady(() => {
      readyCount += 1
    })

    worker.start()

    // First process: ready, then crash. Supervisor restarts it after ~1s backoff.
    await waitFor(() => readyCount >= 2)
    await waitFor(() => worker!.isUsable())

    expect(readyCount).toBe(2)
  })

  it('serves requests once ready', async () => {
    worker = new MatchingWorker({ engineDir: FAKE_ENGINE_DIR, enabled: true, logger: silent })
    worker.start()
    await worker.waitUntilReady(10_000)

    await expect(worker.buildIndex([])).resolves.toEqual({ count: 0 })
  })
})
