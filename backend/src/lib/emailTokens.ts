/**
 * One-time tokens for emailed links: confirm an address, reset a password.
 *
 * The raw token exists only in the email. The database keeps its SHA-256
 * hash, so a leaked database cannot be used to take over accounts through
 * pending links. Tokens expire, work once, and issuing a new one for the same
 * purpose voids the older ones — only the most recent email's link works.
 */
import { createHash, randomBytes } from 'node:crypto'

import type { Database } from '../db/connection.js'
import { execute, queryOne } from '../db/repository.js'
import { BadRequestError } from './errors.js'
import { newId } from './id.js'
import { nowIso } from './time.js'

export type TokenPurpose = 'verify-email' | 'reset-password' | 'invite'

export const TOKEN_LIFETIME_MINUTES: Record<TokenPurpose, number> = {
  'verify-email': 24 * 60,
  'reset-password': 60,
  // Bulk-imported alumni get a week to set their first password.
  invite: 7 * 24 * 60,
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Creates a token and returns the raw value to put in the link. */
export function issueToken(db: Database, userId: string, purpose: TokenPurpose): string {
  const token = randomBytes(32).toString('base64url')
  const now = nowIso()

  // Void earlier unused tokens for the same purpose.
  execute(
    db,
    'UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
    [now, userId, purpose],
  )
  execute(
    db,
    `INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [
      newId('tok'),
      userId,
      purpose,
      hash(token),
      new Date(Date.now() + TOKEN_LIFETIME_MINUTES[purpose] * 60_000).toISOString(),
      now,
    ],
  )
  return token
}

/**
 * Uses a token and returns whose it was. Every failure reads the same — an
 * expired link, a used one and a made-up one are indistinguishable — so the
 * endpoint cannot be used to probe which tokens exist.
 */
export function consumeToken(db: Database, token: string, purpose: TokenPurpose | TokenPurpose[]): string {
  const purposes = Array.isArray(purpose) ? purpose : [purpose]
  const row = queryOne<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    db,
    `SELECT id, user_id, expires_at, used_at FROM email_tokens
     WHERE token_hash = ? AND purpose IN (${purposes.map(() => '?').join(', ')})`,
    [hash(token), ...purposes],
  )
  const now = nowIso()
  if (!row || row.used_at !== null || row.expires_at <= now) {
    throw new BadRequestError('This link is invalid or has expired. Please request a new one.')
  }

  // Guarded on used_at, so two simultaneous uses cannot both succeed.
  const { changes } = execute(db, 'UPDATE email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', [now, row.id])
  if (changes === 0) {
    throw new BadRequestError('This link is invalid or has expired. Please request a new one.')
  }
  return row.user_id
}
