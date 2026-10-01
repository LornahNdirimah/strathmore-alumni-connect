/**
 * Minimal `.env` loader.
 *
 * Node 24 can do this itself with `--env-file`, but that flag has to be repeated
 * on every entry point (server, migrate, seed, reset, plus anything run through
 * `tsx` or `vitest`), and forgetting it fails in a confusing way — the config
 * validator reports JWT_SECRET as missing while a perfectly good `.env` sits
 * next to it. Loading here instead means every entry point behaves the same,
 * with no dependency on dotenv.
 *
 * Two deliberate rules:
 *
 *   - a real environment variable always wins, so `PORT=4000 npm run dev` and a
 *     CI secret both override the file rather than being silently ignored;
 *   - a missing file is not an error, because tests and production deployments
 *     legitimately have none.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** backend/ — two levels up from src/config/. */
const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Strips one matching pair of surrounding quotes, honouring escapes inside them. */
function unquote(value: string): string {
  const first = value[0]
  if ((first === '"' || first === "'") && value.endsWith(first) && value.length > 1) {
    const inner = value.slice(1, -1)
    return first === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner
  }
  return value
}

export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim().replace(/^export\s+/, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = line.slice(separator + 1).trim()
    // An unquoted trailing comment is not part of the value; a quoted one is.
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const comment = value.indexOf(' #')
      if (comment !== -1) value = value.slice(0, comment).trim()
    }

    values[key] = unquote(value)
  }

  return values
}

/** Loads `backend/.env` into process.env without overwriting anything already set. */
export function loadDotEnv(path = resolve(BACKEND_ROOT, '.env')): void {
  let contents: string
  try {
    contents = readFileSync(path, 'utf8')
  } catch {
    return
  }

  for (const [key, value] of Object.entries(parseEnvFile(contents))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
