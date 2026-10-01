/**
 * "Was this module executed directly?" for ESM.
 *
 * The obvious `import.meta.url === \`file://${process.argv[1]}\`` is wrong on
 * any path containing characters a URL must escape — this project lives under
 * "Alumni Mentorship Platform Design", so import.meta.url contains %20 while
 * argv[1] contains literal spaces and the comparison silently never matches.
 * Comparing decoded, real (symlink-resolved) paths avoids both traps.
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function isMainModule(importMetaUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false

  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(entry)
  } catch {
    return false
  }
}
