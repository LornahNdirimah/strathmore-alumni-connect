/**
 * Supervises the resident Python matching worker.
 *
 * The worker pays a ~6.3s import cost for pandas/scikit-learn once at startup,
 * after which a recommendation is ~4ms. That asymmetry is the whole reason this
 * class exists: spawning per request would make the endpoint unusable, so the
 * process is kept alive, restarted on failure, and its readiness surfaced on
 * /api/health instead.
 *
 * Failure policy: matching is an enhancement, not a prerequisite. If the worker
 * is down the API still serves everything else, and recommendation endpoints
 * fall back to a deterministic non-ML ranking rather than erroring the page.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { resolve } from 'node:path'

import { env } from '../../config/env.js'

export type WorkerState = 'disabled' | 'warming' | 'ready' | 'down'

export type MentorFeatureRecord = {
  person_id: string
  Major: string
  Hobbies: string[]
  'Unique Quality': string
  Country: string
  'State/Province': string
  mentor_tracks?: string[]
}

export type StudentFeatureRecord = {
  person_id: string
  Major: string
  Hobbies: string[]
  'Unique Quality': string
  Country: string
  'State/Province': string
  target_track?: string
  career_goal_text?: string
}

export type { MatchEvaluation } from '../../contract/index.js'
import type { MatchEvaluation } from '../../contract/index.js'

export type RecommendationResult = { person_id: string; score: number }

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type WorkerResponse = {
  id?: string | null
  ok?: boolean
  result?: unknown
  error?: { message?: string }
  event?: string
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESTART_DELAY_MS = 30_000

export type MatchingWorkerOptions = {
  pythonBin?: string
  engineDir?: string
  enabled?: boolean
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
}

export class MatchingWorker {
  private child: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private pending = new Map<string, PendingRequest>()
  private nextId = 1
  private restartAttempts = 0
  private stopping = false
  private state: WorkerState
  private readyWaiters: Array<() => void> = []
  private readyListeners: Array<() => void> = []
  private lastError: string | null = null

  private readonly pythonBin: string
  private readonly engineDir: string
  private readonly enabled: boolean
  private readonly log: NonNullable<MatchingWorkerOptions['logger']>

  constructor(options: MatchingWorkerOptions = {}) {
    this.pythonBin = options.pythonBin ?? env.PYTHON_BIN
    this.engineDir = resolve(options.engineDir ?? env.ML_ENGINE_DIR)
    this.enabled = options.enabled ?? env.ML_WORKER_ENABLED
    this.log = options.logger ?? {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
      error: (msg) => console.error(msg),
    }
    this.state = this.enabled ? 'warming' : 'disabled'
  }

  getState(): WorkerState {
    return this.state
  }

  getStatus(): { state: WorkerState; lastError: string | null } {
    return { state: this.state, lastError: this.lastError }
  }

  isUsable(): boolean {
    return this.state === 'ready'
  }

  start(): void {
    if (!this.enabled || this.stopping) return
    this.spawnChild()
  }

  private spawnChild(): void {
    this.state = 'warming'

    const child = spawn(this.pythonBin, ['-u', '-m', 'ml_bridge.worker'], {
      cwd: this.engineDir,
      // `-u` plus PYTHONUNBUFFERED: the protocol is line-oriented, and buffered
      // stdout would stall every response until the buffer happened to flush.
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child = child
    this.reader = createInterface({ input: child.stdout })
    this.reader.on('line', (line) => this.handleLine(line))

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) this.log.warn(`[matching-worker] ${text}`)
    })

    child.on('error', (error) => {
      this.lastError = error.message
      this.log.error(`[matching-worker] failed to spawn: ${error.message}`)
      this.handleExit()
    })

    child.on('exit', (code, signal) => {
      if (!this.stopping) {
        this.lastError = `worker exited (code=${code}, signal=${signal})`
        this.log.error(`[matching-worker] ${this.lastError}`)
      }
      this.handleExit()
    })
  }

  private handleLine(line: string): void {
    let message: WorkerResponse
    try {
      message = JSON.parse(line) as WorkerResponse
    } catch {
      this.log.warn(`[matching-worker] ignoring non-JSON output: ${line.slice(0, 200)}`)
      return
    }

    if (message.event === 'ready') {
      this.state = 'ready'
      this.restartAttempts = 0
      this.lastError = null
      this.log.info('[matching-worker] ready')
      for (const waiter of this.readyWaiters.splice(0)) waiter()
      for (const listener of this.readyListeners) listener()
      return
    }

    if (!message.id) return

    const pending = this.pending.get(message.id)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pending.delete(message.id)

    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(message.error?.message ?? 'matching worker error'))
    }
  }

  private handleExit(): void {
    this.reader?.close()
    this.reader = null
    this.child = null

    // Fail every in-flight request rather than leaving callers hanging until
    // their individual timeouts fire.
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('matching worker exited'))
    }
    this.pending.clear()

    if (this.stopping) {
      this.state = 'down'
      return
    }

    this.state = 'down'
    this.restartAttempts += 1

    // Exponential backoff, capped: a worker that cannot start (missing Python,
    // broken import) must not become a spawn loop.
    const delay = Math.min(1000 * 2 ** (this.restartAttempts - 1), MAX_RESTART_DELAY_MS)
    this.log.warn(`[matching-worker] restarting in ${delay}ms (attempt ${this.restartAttempts})`)

    const timer = setTimeout(() => this.spawnChild(), delay)
    // Don't hold the event loop open just to schedule a restart.
    timer.unref()
  }

  /**
   * Runs `listener` every time a worker process becomes ready — the first start
   * and every restart after a crash.
   *
   * A restarted process is a fresh Python interpreter with an empty index, so
   * anything that primes the worker must happen again on each start. Wiring
   * that to waitUntilReady() alone ran it once: after a crash the worker came
   * back reporting `ready` while every recommendation failed and silently fell
   * back, with /api/health still green.
   */
  onReady(listener: () => void): void {
    this.readyListeners.push(listener)
  }

  /** Resolves once the worker has finished its warmup, or rejects on timeout. */
  waitUntilReady(timeoutMs = 60_000): Promise<void> {
    if (this.state === 'ready') return Promise.resolve()
    if (!this.enabled) return Promise.reject(new Error('matching worker is disabled'))

    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(
        () => rejectPromise(new Error('timed out waiting for matching worker')),
        timeoutMs,
      )
      this.readyWaiters.push(() => {
        clearTimeout(timer)
        resolvePromise()
      })
    })
  }

  private request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.enabled) return Promise.reject(new Error('matching worker is disabled'))

    const child = this.child
    if (!child || this.state !== 'ready') {
      return Promise.reject(new Error(`matching worker is not ready (state: ${this.state})`))
    }

    const id = String(this.nextId++)

    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectPromise(new Error(`matching worker timed out after ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, {
        resolve: resolvePromise as (value: unknown) => void,
        reject: rejectPromise,
        timer,
      })

      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) {
          clearTimeout(timer)
          this.pending.delete(id)
          rejectPromise(error)
        }
      })
    })
  }

  async buildIndex(mentors: MentorFeatureRecord[]): Promise<{ count: number; ready: boolean }> {
    return this.request('build_index', { mentors })
  }

  async recommend(input: {
    student: StudentFeatureRecord
    remainingCapacity: Record<string, number>
    hardFilters?: Record<string, string>
    showK?: number
  }): Promise<RecommendationResult[]> {
    const result = await this.request<{ mentors: RecommendationResult[] }>('recommend', {
      student: input.student,
      remaining_capacity: input.remainingCapacity,
      hard_filters: input.hardFilters ?? null,
      show_k: input.showK ?? 5,
    })
    return result.mentors ?? []
  }

  /** Real outcomes scored by the engine's own measures (DESIGN_BACKLOG #50). */
  async evaluate(input: {
    students: StudentFeatureRecord[]
    pairs: Record<string, string[]>
    declined: Array<[string, string]>
    capacity: Record<string, number>
  }): Promise<MatchEvaluation> {
    return this.request<MatchEvaluation>('evaluate', input)
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) return

    child.stdin.end()
    child.kill('SIGTERM')

    // Give it a moment to exit cleanly, then stop waiting — a stuck worker
    // must not block server shutdown.
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(resolvePromise, 2000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolvePromise()
      })
    })
  }
}
