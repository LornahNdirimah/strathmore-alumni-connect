#!/usr/bin/env node
/**
 * Mailpit — a local test inbox for development email (DESIGN_BACKLOG #43).
 *
 * Mailpit pretends to be a mail server on port 1025 and shows every message it
 * receives on a web page at http://localhost:8025. The API's default mail
 * settings point at it, so verification and password-reset emails can be
 * opened and their links clicked without anything leaving the machine.
 *
 *   npm run mail      download Mailpit on first use, then run it
 *
 * The binary is fetched from the project's official GitHub releases into
 * .tools/ (git-ignored) — nothing is installed system-wide and no sudo is
 * needed — and its SHA-256 is checked against the digest GitHub records for
 * that release asset before it is ever run. A `mailpit` already on the PATH is used as
 * is. `npm run dev` starts Mailpit too, but only if it is already present; it
 * never downloads anything by itself.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOLS = join(ROOT, '.tools')
const LATEST_RELEASE = 'https://api.github.com/repos/axllent/mailpit/releases/latest'
const BINARY = platform() === 'win32' ? 'mailpit.exe' : 'mailpit'

export const MAILPIT_SMTP = '127.0.0.1:1025'
export const MAILPIT_WEB = '127.0.0.1:8025'

/** Mailpit's release name for this machine, e.g. mailpit-linux-amd64.tar.gz. */
function assetName() {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform()]
  const cpu = { x64: 'amd64', arm64: 'arm64', ia32: '386' }[arch()]
  if (!os || !cpu) throw new Error(`Mailpit has no build for ${platform()}/${arch()}.`)
  return `mailpit-${os}-${cpu}.${os === 'windows' ? 'zip' : 'tar.gz'}`
}

/** Path to a usable Mailpit, or null if it has not been downloaded. */
export function findMailpit() {
  const local = join(TOOLS, BINARY)
  if (existsSync(local)) return local
  const onPath = spawnSync(platform() === 'win32' ? 'where' : 'which', ['mailpit'], { encoding: 'utf8' })
  if (onPath.status === 0) return onPath.stdout.trim().split(/\r?\n/)[0]
  return null
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Downloads, verifies and unpacks Mailpit into .tools/. */
export async function installMailpit() {
  const asset = assetName()
  console.log(`[mail] downloading ${asset} from the official Mailpit releases…`)

  // The release metadata names the file and the SHA-256 GitHub computed when
  // it was uploaded; the download must match it before it is run.
  const release = JSON.parse((await download(LATEST_RELEASE)).toString('utf8'))
  const entry = (release.assets ?? []).find((item) => item.name === asset)
  if (!entry) throw new Error(`release ${release.tag_name} has no ${asset}.`)
  const expected = /^sha256:([0-9a-f]{64})$/.exec(entry.digest ?? '')?.[1]
  if (!expected) throw new Error(`GitHub lists no SHA-256 for ${asset}; refusing to run an unverified binary.`)

  const archive = await download(entry.browser_download_url)
  const actual = createHash('sha256').update(archive).digest('hex')
  if (expected !== actual) {
    throw new Error(`checksum mismatch for ${asset} (expected ${expected}, got ${actual}); refusing to run it.`)
  }
  console.log(`[mail] ${release.tag_name}: sha256 ${actual.slice(0, 16)}… matches GitHub's record.`)

  mkdirSync(TOOLS, { recursive: true })
  const archivePath = join(TOOLS, asset)
  writeFileSync(archivePath, archive)
  // bsdtar (Windows 10+, macOS) and GNU tar both unpack these archives.
  const unpacked = spawnSync('tar', ['-xf', archivePath, '-C', TOOLS, BINARY], { stdio: 'inherit' })
  rmSync(archivePath, { force: true })
  if (unpacked.status !== 0) throw new Error('could not unpack the Mailpit archive (is `tar` installed?).')

  const binary = join(TOOLS, BINARY)
  if (platform() !== 'win32') chmodSync(binary, 0o755)
  console.log(`[mail] Mailpit installed at ${binary}.`)
  return binary
}

/** Starts Mailpit on the local-only ports the API expects. */
export function startMailpit(binary, options = {}) {
  return spawn(binary, ['--smtp', MAILPIT_SMTP, '--listen', MAILPIT_WEB], {
    stdio: options.stdio ?? 'inherit',
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const binary = findMailpit() ?? (await installMailpit())
  const version = spawnSync(binary, ['version'], { encoding: 'utf8' }).stdout?.trim()
  console.log(`[mail] ${version || 'Mailpit'} — SMTP on ${MAILPIT_SMTP}, inbox at http://localhost:8025`)
  const child = startMailpit(binary)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code) => process.exit(code ?? 0))
}
