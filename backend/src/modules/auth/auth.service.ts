import { randomBytes } from 'node:crypto'

import { type Database, transaction } from '../../db/connection.js'
import { ConflictError, UnauthorizedError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { consumeToken, issueToken } from '../../lib/emailTokens.js'
import { appUrl, passwordResetEmail, sendEmail, verificationEmail } from '../../lib/mailer.js'
import { hashPassword, type PasswordHash, verifyPassword } from '../../lib/password.js'
import { execute } from '../../db/repository.js'
import { avatarUrl } from '../../lib/avatars.js'
import { capabilitiesFor } from '../../lib/policy.js'
import { CURRENT_TERMS_VERSION } from '../../lib/terms.js'
import { nowIso } from '../../lib/time.js'
import {
  findLatestVerification,
  findUserByEmail,
  findUserById,
  getOptInStatus,
  insertUser,
  insertVerification,
  toPublicUser,
  type UserRow,
} from './auth.repository.js'
import type { LoginInput, SignupInput } from './auth.schemas.js'

/**
 * The session as every auth endpoint returns it. `capabilities` is what the
 * client builds its navigation from (lib/policy.ts); `verification` tells an
 * alumnus where their account stands while it is pending.
 */
export type { SessionUser } from '../../contract/index.js'
import type { SessionUser } from '../../contract/index.js'

function toSessionUser(db: Database, user: UserRow): SessionUser {
  const optIn = getOptInStatus(db, user.id)
  return {
    ...toPublicUser(user),
    avatarUrl: avatarUrl(user.id, user.avatar_updated_at),
    emailVerified: Boolean(user.email_verified_at),
    termsAccepted: user.terms_version === CURRENT_TERMS_VERSION,
    optIn,
    capabilities: capabilitiesFor({
      role: user.role,
      status: user.status,
      isMentor: optIn.isMentor,
    }),
    verification: user.role === 'alumni' ? findLatestVerification(db, user.id) : null,
  }
}

/**
 * A real hash of a random password, compared against when the email is unknown.
 *
 * Comparing against an empty hash is not enough: verifyPassword rejects a
 * malformed stored value before running scrypt, so the unknown-account path
 * would answer in microseconds while a real account costs a full derivation —
 * a timing difference that reveals which emails are registered. Made once and
 * reused, so the decoy costs exactly what a genuine check does.
 */
let decoyHash: Promise<PasswordHash> | null = null
function getDecoyHash(): Promise<PasswordHash> {
  decoyHash ??= hashPassword(randomBytes(32).toString('base64'))
  return decoyHash
}

export async function signup(db: Database, input: SignupInput): Promise<SessionUser> {
  if (findUserByEmail(db, input.email)) {
    throw new ConflictError('An account with that email already exists.')
  }

  const { hash, salt } = await hashPassword(input.password)
  const timestamp = nowIso()

  const row = {
    id: newId('user'),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    password_hash: hash,
    password_salt: salt,
    role: input.role,
    // Alumni accounts start pending: an admin verifies them before they can be
    // surfaced as mentors. Students and admins are active immediately.
    status: input.role === 'alumni' ? ('pending' as const) : ('active' as const),
    created_at: timestamp,
    updated_at: timestamp,
  }

  transaction(db, () => {
    insertUser(db, row)
    // The schema only accepts signups that agreed; record which version.
    execute(db, 'UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?', [
      CURRENT_TERMS_VERSION,
      timestamp,
      row.id,
    ])

    // An alumnus is pending until an administrator checks them, so signing up
    // must put them in front of one. Before this, only the seed ever created
    // queue entries and a real alumnus signing up waited forever.
    if (input.role === 'alumni') {
      insertVerification(db, {
        id: newId('ver'),
        userId: row.id,
        classYear: input.classYear as string,
        program: input.program as string,
        createdAt: timestamp,
      })
    }
  })

  // The same shape /auth/me returns. A freshly created account has no opt-in
  // record yet, but the field must still be present: the client's route guard
  // reads session.optIn to decide between the dashboard and the onboarding
  // form, and an absent field crashes that check rather than failing it.
  return toSessionUser(db, row)
}

export async function login(db: Database, input: LoginInput): Promise<SessionUser> {
  const user = findUserByEmail(db, input.email)

  // Same generic message and a real hash comparison whether or not the account
  // exists. Returning "no such user" early would both leak which emails are
  // registered and make the timing difference measurable.
  if (!user) {
    await verifyPassword(input.password, await getDecoyHash())
    throw new UnauthorizedError('Incorrect email or password.')
  }

  const valid = await verifyPassword(input.password, {
    hash: user.password_hash,
    salt: user.password_salt,
  })

  if (!valid) {
    throw new UnauthorizedError('Incorrect email or password.')
  }

  if (user.status === 'suspended') {
    throw new UnauthorizedError('This account has been suspended.')
  }

  return toSessionUser(db, user)
}

/** Rehydrates the session on page load, including opt-in state for route gating. */
export function getSessionUser(db: Database, userId: string): SessionUser | null {
  const user = findUserById(db, userId)
  return user ? toSessionUser(db, user) : null
}

// --- Email verification and password reset (DESIGN_BACKLOG #43) -------------

/** Sends (or re-sends) the confirm-your-email link. */
export function sendVerification(db: Database, userId: string): void {
  const user = findUserById(db, userId)
  if (!user) return
  if (user.email_verified_at) throw new ConflictError('Your email address is already confirmed.')

  const token = issueToken(db, userId, 'verify-email')
  sendEmail(verificationEmail(user.email, user.name, appUrl(`/verify-email?token=${token}`)))
}

export function verifyEmail(db: Database, token: string): void {
  const userId = consumeToken(db, token, 'verify-email')
  execute(db, 'UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', [nowIso(), userId])
}

/**
 * Emails a reset link if the address belongs to an account. The caller answers
 * the same way whether or not it does, so this cannot be used to find out who
 * has an account.
 */
export function requestPasswordReset(db: Database, email: string): void {
  const user = findUserByEmail(db, email)
  if (!user || user.status === 'suspended') return

  const token = issueToken(db, user.id, 'reset-password')
  sendEmail(passwordResetEmail(user.email, user.name, appUrl(`/reset-password?token=${token}`)))
}

/**
 * Sets a new password from a reset link. Signs out every session (the old
 * password may be why they are here) and, since only the address's owner
 * could have followed the link, confirms the address too.
 */
export async function resetPassword(db: Database, token: string, newPassword: string): Promise<void> {
  // Hash before using the token, so a slow hash cannot leave a spent token
  // with the password unchanged.
  const { hash, salt } = await hashPassword(newPassword)
  transaction(db, () => {
    // An invitation for an imported alumnus sets a first password the same way.
    const userId = consumeToken(db, token, ['reset-password', 'invite'])
    const now = nowIso()
    execute(
      db,
      `UPDATE users SET password_hash = ?, password_salt = ?, session_version = session_version + 1,
                        email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?
       WHERE id = ?`,
      [hash, salt, now, now, userId],
    )
  })
}
