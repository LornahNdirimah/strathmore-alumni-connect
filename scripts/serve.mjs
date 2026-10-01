#!/usr/bin/env node
/**
 * Runs the site the way it would be deployed (DESIGN_BACKLOG #53): one
 * process, one origin. The API serves the built frontend, so there is no CORS,
 * no cross-origin cookie and no second port.
 *
 *   npm run serve                 # builds the frontend if needed, then serves
 *   npm run serve -- --rebuild    # always rebuild first
 *
 * It runs in production mode: backend/.env still supplies the secret, the
 * database and mail settings, but PORT, APP_URL and CORS_ORIGIN default to
 * this single origin (http://localhost:3001) unless set in the environment.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'frontend', 'dist', 'index.html')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

if (process.argv.includes('--rebuild') || !existsSync(DIST)) {
  console.log('[serve] building the frontend…')
  const build = spawnSync(npm, ['--prefix', 'frontend', 'run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const port = process.env.PORT ?? '3001'
const origin = `http://localhost:${port}`
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SERVE_FRONTEND: 'true',
  PORT: port,
  APP_URL: process.env.APP_URL ?? origin,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? origin,
}

console.log(`[serve] ${origin}`)
const server = spawn(npm, ['--prefix', 'backend', 'run', 'start'], { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal))
}
server.on('exit', (code) => process.exit(code ?? 0))
