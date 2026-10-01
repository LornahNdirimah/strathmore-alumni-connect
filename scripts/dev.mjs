#!/usr/bin/env node
/**
 * Starts the backend and the frontend together for local development.
 *
 * Kept as a script rather than pulling in `concurrently` for two reasons: the
 * project's dependency budget is deliberately small, and a demo needs the two
 * processes genuinely tied together — if the API dies, a frontend left running
 * against nothing is worse than a clean stop. So this supervises both:
 *
 *   - output is line-prefixed and colour-coded per process, so a stack trace is
 *     attributable at a glance;
 *   - the backend is given a health check before the frontend starts, so the
 *     first page load never races an unmigrated database;
 *   - Ctrl-C, or either child exiting, shuts the whole group down.
 */
import { spawn } from 'node:child_process'

import { findMailpit, startMailpit } from './mailpit.mjs'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { createInterface } from 'node:readline'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const BACKEND_PORT = Number(process.env.PORT ?? 3001)
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/health`
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT ?? 5173)
const HEALTH_TIMEOUT_MS = 60_000

const COLOURS = {
  backend: '\u001b[36m', // cyan
  frontend: '\u001b[35m', // magenta
  dev: '\u001b[32m', // green
  mail: '\u001b[33m', // yellow
  error: '\u001b[31m',
  reset: '\u001b[0m',
}

/** npm on Windows is a .cmd shim; resolve it rather than assuming a POSIX host. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const children = new Map()
/** Children started in their own process group, which is signalled as a whole. */
const groupLeaders = new WeakSet()
let shuttingDown = false

function log(label, line) {
  const colour = COLOURS[label] ?? COLOURS.reset
  process.stdout.write(`${colour}[${label}]${COLOURS.reset} ${line}\n`)
}

function start(label, script, cwd) {
  const child = spawn(NPM, ['run', script], {
    cwd: join(ROOT, cwd),
    // Piped rather than inherited so each line can be labelled; a shared stdout
    // interleaves the two servers' logs into something unreadable.
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: process.env,
    // Its own process group, so shutdown can signal the whole tree. `npm run`
    // is only a wrapper: signalling npm alone left the real server (tsx watch,
    // vite) running as an orphan that kept holding its port.
    detached: process.platform !== 'win32',
  })

  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => log(label, line))
  }

  child.on('exit', (code, signal) => {
    children.delete(label)
    if (shuttingDown) return

    log('dev', `${label} exited (${signal ?? `code ${code}`}) — stopping everything else.`)
    void shutdown(code ?? 1)
  })

  child.on('error', (error) => {
    log('dev', `${COLOURS.error}could not start ${label}: ${error.message}${COLOURS.reset}`)
    void shutdown(1)
  })

  if (process.platform !== 'win32') groupLeaders.add(child)
  children.set(label, child)
  return child
}

/**
 * Signals a child's whole process group if it leads one, else just the child.
 * Signalling a group that does not exist would silently reach nobody, and
 * shutdown would then wait for an exit that never comes.
 */
function signalTree(child, signal) {
  try {
    if (groupLeaders.has(child) && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    // Already gone.
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) return
  shuttingDown = true

  for (const [label, child] of children) {
    log('dev', `stopping ${label}…`)
    signalTree(child, 'SIGTERM')
  }

  // Give each child a moment to close its database handle and unlink its socket
  // before escalating; a SIGKILL'd SQLite writer leaves a -wal file behind.
  const deadline = setTimeout(() => {
    for (const child of children.values()) signalTree(child, 'SIGKILL')
  }, 5_000)
  deadline.unref()

  await Promise.all(
    [...children.values()].map((child) => (child.exitCode === null ? once(child, 'exit') : null)),
  )

  process.exit(exitCode)
}

/**
 * Polls /api/health until the backend answers. Returns the parsed payload so the
 * banner can report whether the ML worker came up, which is the single most
 * common thing to be wrong at demo time.
 */
async function waitForBackend() {
  const startedAt = Date.now()

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (shuttingDown) return null

    try {
      const response = await fetch(HEALTH_URL)
      if (response.ok) return await response.json()
    } catch {
      // Not listening yet — expected for the first second or two.
    }

    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  throw new Error(`backend did not answer ${HEALTH_URL} within ${HEALTH_TIMEOUT_MS / 1000}s`)
}

/**
 * Refuses to start if a port is already taken.
 *
 * Without this the health check below is satisfied by whatever is already
 * listening — so a leftover server from an earlier session looks like a healthy
 * start, while the backend this script actually launched has died of EADDRINUSE
 * and its logs scroll past unread. Serving a demo off a stale process with an
 * older schema is the worst possible failure here, so it is made loud instead.
 */
async function assertPortsFree() {
  const ports = [
    { port: BACKEND_PORT, label: 'backend' },
    { port: FRONTEND_PORT, label: 'frontend' },
  ]

  const taken = []
  for (const { port, label } of ports) {
    const free = await new Promise((resolve) => {
      const probe = createServer()
      probe.once('error', () => resolve(false))
      probe.once('listening', () => probe.close(() => resolve(true)))
      probe.listen(port, '127.0.0.1')
    })
    if (!free) taken.push({ port, label })
  }

  if (taken.length > 0) {
    for (const { port, label } of taken) {
      log('dev', `${COLOURS.error}port ${port} (${label}) is already in use.${COLOURS.reset}`)
    }
    log('dev', 'Stop the process using it, or find it with:')
    log('dev', `  ss -ltnp | grep -E '${taken.map((entry) => entry.port).join('|')}'`)
    return false
  }

  return true
}

/**
 * Starts Mailpit, the local test inbox, if it is already installed and its
 * port is free. Optional: without it the API still runs and logs each email it
 * could not deliver. Never downloads anything — that is `npm run mail`'s job.
 */
async function startMailIfAvailable() {
  const binary = findMailpit()
  if (!binary) return false

  const free = await new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(1025, '127.0.0.1')
  })
  // Something is already on 1025 — most likely a Mailpit started separately.
  if (!free) return true

  const child = startMailpit(binary, { stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => log('mail', line))
  }
  // Unlike the API and frontend, losing Mailpit is not a reason to stop.
  child.on('exit', (code) => {
    children.delete('mail')
    if (!shuttingDown) log('dev', `mail exited (code ${code}); emails will be logged as undeliverable.`)
  })
  children.set('mail', child)
  return true
}

async function main() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log('dev', 'shutting down…')
      void shutdown(0)
    })
  }

  if (!(await assertPortsFree())) {
    process.exit(1)
  }

  log('dev', 'starting backend…')
  start('backend', 'dev', 'backend')

  let health
  try {
    health = await waitForBackend()
  } catch (error) {
    log('dev', `${COLOURS.error}${error.message}${COLOURS.reset}`)
    return shutdown(1)
  }
  if (!health) return

  const matching = health.matching ?? 'unknown'
  log('dev', `backend ready on :${BACKEND_PORT} (database ${health.database}, matching ${matching})`)
  if (matching === 'warming') {
    log('dev', 'the matching worker takes a few seconds to fit its encoder; recommendations')
    log('dev', 'fall back to a simpler ranking until it reports ready.')
  }

  log('dev', 'starting frontend…')
  start('frontend', 'dev', 'frontend')

  const mail = await startMailIfAvailable()

  log('dev', '')
  log('dev', 'app          http://localhost:5173')
  log('dev', 'api          http://localhost:3001/api')
  log('dev', mail ? 'email inbox  http://localhost:8025  (Mailpit)' : 'email inbox  not running — `npm run mail` sets up Mailpit')
  log('dev', 'demo logins  student@demo.com / Student123!')
  log('dev', '             alumni@demo.com  / Alumni123!')
  log('dev', '             admin@demo.com   / Admin123!')
  log('dev', '')
}

await main()
