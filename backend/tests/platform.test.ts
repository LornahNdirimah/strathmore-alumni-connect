/**
 * Phase 9 platform work: one origin (#53), request ids and backups (#57).
 */
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { backupDatabase } from '../src/db/backup.js'
import { getDatabase } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'

describe('serving the built frontend', () => {
  let app: FastifyInstance
  const root = mkdtempSync(join(tmpdir(), 'web-'))

  beforeAll(async () => {
    runMigrations(getDatabase())
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Alumni Connect</title>')
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)')
    app = await buildApp({ quiet: true, webRoot: root })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('serves the page at / and at any app route, uncached', async () => {
    for (const url of ['/', '/admin/insights', '/mentors/abc?tab=1']) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, url).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.headers['cache-control']).toBe('no-cache')
      expect(response.body).toContain('Alumni Connect')
    }
  })

  it('caches hashed assets for good', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toContain('immutable')
  })

  it('keeps API misses as JSON 404s, and never falls back for other methods', async () => {
    const api = await app.inject({ method: 'GET', url: '/api/nothing-here' })
    expect(api.statusCode).toBe(404)
    expect(api.json().error.code).toBe('NOT_FOUND')
    expect((await app.inject({ method: 'POST', url: '/admin' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().status).toBe('ok')
  })

  it('does not let a path escape the build folder', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/..%2f..%2fpackage.json' })
    expect(response.body).not.toContain('"dependencies"')
  })

  it('sends a page policy that allows only its own scripts', async () => {
    const csp = String((await app.inject({ method: 'GET', url: '/' })).headers['content-security-policy'])
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
  })
})

describe('request ids', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ quiet: true })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('gives every response an id, reusing a well-formed one from a proxy', async () => {
    const fresh = await app.inject({ method: 'GET', url: '/api/health' })
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)

    const passed = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'edge-1234abcd' } })
    expect(passed.headers['x-request-id']).toBe('edge-1234abcd')

    const junk = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'bad id\nwith newline' } })
    expect(junk.headers['x-request-id']).not.toContain('bad')
  })

  it('without a built frontend, keeps the API-only policy', async () => {
    const response = await app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(404)
    expect(String(response.headers['content-security-policy'])).toContain("default-src 'none'")
  })
})

describe('backups', () => {
  it('writes a checked, self-contained copy and keeps only the newest', async () => {
    runMigrations(getDatabase())
    const directory = mkdtempSync(join(tmpdir(), 'backups-'))
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 30, 2, minute))

    for (const minute of [1, 2, 3]) {
      await backupDatabase({ databasePath: env.DATABASE_PATH, directory, keep: 2, now: at(minute) })
    }
    expect(readdirSync(directory).sort()).toEqual(['app-20260930-020200.db', 'app-20260930-020300.db'])
  })
})
