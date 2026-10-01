/**
 * Account settings every role shares (DESIGN_BACKLOG #24, #25): the display
 * name, the password, and the profile photo — plus the route that serves a
 * photo to other signed-in users.
 *
 * Role-specific profile details (a student's goals, a mentor's profile) stay
 * with their own modules; this is only what every account has.
 */
import { createReadStream, existsSync } from 'node:fs'

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { type Database, getDatabase } from '../../db/connection.js'
import { execute, queryOne } from '../../db/repository.js'
import {
  avatarFilePath,
  contentTypeFor,
  decodeAvatarDataUrl,
  deleteAvatarFile,
  storeAvatar,
} from '../../lib/avatars.js'
import { NotFoundError, UnauthorizedError } from '../../lib/errors.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { nowIso } from '../../lib/time.js'
import { parseOrThrow } from '../../lib/validate.js'
import { CURRENT_TERMS_VERSION } from '../../lib/terms.js'
import { getSessionUser } from '../auth/auth.service.js'
import { deleteAccount } from './account.deletion.js'
import { exportAccount } from './account.export.js'
import { name, password } from '../auth/auth.schemas.js'

const nameSchema = z.object({ name })
const privacySchema = z.object({ showInDirectory: z.boolean() })

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    newPassword: password,
  })
  .refine((input) => input.currentPassword !== input.newPassword, {
    message: 'Choose a password different from your current one.',
    path: ['newPassword'],
  })

const deleteSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm.').max(200),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Please confirm you understand this cannot be undone.' }) }),
})

const avatarSchema = z.object({
  // A data URL of the already-resized photo. ~400 KB of base64 covers the
  // 300 KB byte cap in lib/avatars.ts.
  image: z.string().max(420_000),
})

/** Route-level body limit for the photo upload; everything else keeps 256 KB. */
const AVATAR_BODY_LIMIT = 512 * 1024

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  /** Who can find this account (DESIGN_BACKLOG #44). */
  app.get('/account/privacy', { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request)
    const row = queryOne<{ directory_visible: number }>(db, 'SELECT directory_visible FROM users WHERE id = ?', [userId])
    return { privacy: { showInDirectory: row?.directory_visible === 1 } }
  })

  app.put('/account/privacy', { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request)
    const input = parseOrThrow(privacySchema, request.body, 'privacy settings')
    execute(db, 'UPDATE users SET directory_visible = ?, updated_at = ? WHERE id = ?', [
      input.showInDirectory ? 1 : 0,
      nowIso(),
      userId,
    ])
    return {
      privacy: input,
      message: input.showInDirectory
        ? 'You are listed in the alumni directory.'
        : 'You are no longer listed in the alumni directory.',
    }
  })

  app.patch('/account', { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request)
    const input = parseOrThrow(nameSchema, request.body, 'name')

    execute(db, 'UPDATE users SET name = ?, updated_at = ? WHERE id = ?', [input.name, nowIso(), userId])
    return { user: getSessionUser(db, userId), message: 'Your name was updated.' }
  })

  /**
   * Changing the password signs out every other session: the stored version
   * moves on, so every token issued before now stops working. This request's
   * own session is re-issued at the new version, so the person changing it
   * stays signed in here.
   */
  app.post(
    '/account/password',
    { preHandler: app.requireAuth, config: { rateLimit: app.authRateLimit } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const input = parseOrThrow(passwordChangeSchema, request.body, 'password change')

      const row = queryOne<{ password_hash: string; password_salt: string }>(
        db,
        'SELECT password_hash, password_salt FROM users WHERE id = ?',
        [userId],
      )
      if (!row) throw new UnauthorizedError()

      const valid = await verifyPassword(input.currentPassword, {
        hash: row.password_hash,
        salt: row.password_salt,
      })
      if (!valid) throw new UnauthorizedError('Your current password is not correct.')

      const { hash, salt } = await hashPassword(input.newPassword)
      execute(
        db,
        `UPDATE users SET password_hash = ?, password_salt = ?, session_version = session_version + 1,
                          updated_at = ?
         WHERE id = ?`,
        [hash, salt, nowIso(), userId],
      )

      const user = request.currentUser!
      await app.issueSession(reply, { sub: userId, role: user.role, name: user.name, email: user.email })
      return reply.send({ message: 'Password changed. Other devices have been signed out.' })
    },
  )

  // ── Consent and your data (DESIGN_BACKLOG #44) ──────────────────────────
  // These use requireSession: someone who has not accepted new terms must
  // still be able to accept them, download their data, or leave.

  app.post('/account/accept-terms', { preHandler: app.requireSession }, async (request) => {
    const userId = requireUserId(request)
    execute(db, 'UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?', [
      CURRENT_TERMS_VERSION,
      nowIso(),
      userId,
    ])
    return { user: getSessionUser(db, userId), message: 'Thank you.' }
  })

  app.get('/account/export', { preHandler: app.requireSession }, async (request, reply) => {
    const userId = requireUserId(request)
    const data = exportAccount(db, userId)
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="alumni-connect-data-${nowIso().slice(0, 10)}.json"`)
      .send(JSON.stringify(data, null, 2))
  })

  /** Immediate and permanent, once the password is re-entered (ROADMAP D8). */
  app.post(
    '/account/delete',
    { preHandler: app.requireSession, config: { rateLimit: app.authRateLimit } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const input = parseOrThrow(deleteSchema, request.body, 'confirmation')

      const row = queryOne<{ password_hash: string; password_salt: string }>(
        db,
        'SELECT password_hash, password_salt FROM users WHERE id = ?',
        [userId],
      )
      const valid = row
        ? await verifyPassword(input.password, { hash: row.password_hash, salt: row.password_salt })
        : false
      if (!valid) throw new UnauthorizedError('That password is not correct.')

      deleteAccount(db, userId)
      // A deleted mentor must leave the matching index at once.
      void app.refreshMatchingIndex()
      app.clearSession(reply)
      return reply.send({ message: 'Your account has been deleted. We are sorry to see you go.' })
    },
  )

  app.put(
    '/account/avatar',
    { preHandler: app.requireAuth, bodyLimit: AVATAR_BODY_LIMIT },
    async (request) => {
      const userId = requireUserId(request)
      const input = parseOrThrow(avatarSchema, request.body, 'photo')
      const { bytes, type } = decodeAvatarDataUrl(input.image)

      const previous = queryOne<{ avatar_path: string | null }>(
        db,
        'SELECT avatar_path FROM users WHERE id = ?',
        [userId],
      )
      const fileName = storeAvatar(userId, bytes, type)

      try {
        execute(db, 'UPDATE users SET avatar_path = ?, avatar_updated_at = ? WHERE id = ?', [
          fileName,
          nowIso(),
          userId,
        ])
      } catch (error) {
        deleteAvatarFile(fileName)
        throw error
      }
      // Only once the new photo is recorded, so a failure never leaves the
      // account pointing at a deleted file.
      deleteAvatarFile(previous?.avatar_path ?? null)

      return { user: getSessionUser(db, userId), message: 'Your photo was updated.' }
    },
  )

  app.delete('/account/avatar', { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request)
    const previous = removeAvatar(db, userId)
    deleteAvatarFile(previous)
    return { user: getSessionUser(db, userId), message: 'Your photo was removed.' }
  })

  /**
   * Serves a photo to any signed-in user. People need to recognise each other,
   * but the photos are not public to the whole internet.
   */
  app.get('/users/:userId/avatar', { preHandler: app.requireSession }, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const row = queryOne<{ avatar_path: string | null }>(
      db,
      'SELECT avatar_path FROM users WHERE id = ?',
      [userId],
    )
    if (!row?.avatar_path) throw new NotFoundError('No photo.')

    const path = avatarFilePath(row.avatar_path)
    if (!existsSync(path)) throw new NotFoundError('No photo.')

    return reply
      .header('Content-Type', contentTypeFor(row.avatar_path))
      // The URL changes whenever the photo does (?v=), so it can be cached hard.
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      // Helmet's default is same-origin, which would stop the frontend (a
      // different port in development) from displaying the image at all.
      .header('Cross-Origin-Resource-Policy', 'same-site')
      .send(createReadStream(path))
  })
}

/**
 * Clears a user's photo record and returns the file name that was stored.
 * Opens no transaction of its own — SQLite cannot nest them — so a caller that
 * pairs it with other writes (the admin route's audit entry) wraps both.
 */
export function removeAvatar(db: Database, userId: string): string | null {
  const row = queryOne<{ avatar_path: string | null }>(
    db,
    'SELECT avatar_path FROM users WHERE id = ?',
    [userId],
  )
  execute(db, 'UPDATE users SET avatar_path = NULL, avatar_updated_at = NULL WHERE id = ?', [userId])
  return row?.avatar_path ?? null
}
