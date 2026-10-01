#!/usr/bin/env node
/**
 * Starts the site for the browser tests exactly as it is deployed — one
 * process serving the API and the built frontend (DESIGN_BACKLOG #53) — over a
 * freshly seeded database in a temporary folder. The developer's database is
 * never touched. Playwright starts and stops this (see playwright.config.ts).
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.E2E_PORT ?? '3101'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const shell = process.platform === 'win32'

const env = {
  ...process.env,
  NODE_ENV: 'production',
  SERVE_FRONTEND: 'true',
  PORT,
  HOST: '127.0.0.1',
  DATABASE_PATH: join(mkdtempSync(join(tmpdir(), 'alumni-e2e-')), 'app.db'),
  JWT_SECRET: randomBytes(48).toString('base64url'),
  APP_URL: `http://localhost:${PORT}`,
  CORS_ORIGIN: `http://localhost:${PORT}`,
  MAIL_TRANSPORT: 'console',
  // Every test comes from one address; the sign-in limit is left as it is.
  RATE_LIMIT_PER_MINUTE: '5000',
}

// Preparing the throwaway database is a development task: the reset script
// rightly refuses to run in production mode.
function run(args) {
  const result = spawnSync(npm, args, { cwd: ROOT, env: { ...env, NODE_ENV: 'development' }, stdio: 'inherit', shell })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(join(ROOT, 'frontend', 'dist', 'index.html'))) run(['--prefix', 'frontend', 'run', 'build'])
run(['--prefix', 'backend', 'run', 'reset'])
run(['--prefix', 'backend', 'run', 'seed'])

const server = spawn(npm, ['--prefix', 'backend', 'run', 'start'], { cwd: ROOT, env, stdio: 'inherit', shell })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
server.on('exit', (code) => process.exit(code ?? 0))
