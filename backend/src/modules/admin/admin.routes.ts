import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getDatabase, transaction } from '../../db/connection.js'
import { execute, queryAll, queryOne, queryScalar } from '../../db/repository.js'
import { listAudit, recordAudit } from '../../lib/audit.js'
import { notify, notifyRoles } from '../../lib/notifications.js'
import { avatarUrl, deleteAvatarFile } from '../../lib/avatars.js'
import { removeAvatar } from '../account/account.routes.js'
import * as safety from '../safety/safety.service.js'
import { importAlumni, importSchema } from './alumni-import.js'
import type { AdminUser, AdminUserPage, EvaluationResponse, Insights } from '../../contract/index.js'
import * as insights from '../insights/insights.service.js'
import { evaluateOutcomes } from '../../services/matching/matching.service.js'
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { nowIso } from '../../lib/time.js'
import { parseOrThrow } from '../../lib/validate.js'

const verificationPatchSchema = z.object({
  status: z.enum(['approved', 'review', 'rejected', 'pending']),
})

const userStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
})

const announcementSchema = z.object({
  title: z.string().trim().min(2).max(160),
  audience: z.enum(['all', 'students', 'alumni']),
  body: z.string().trim().min(5).max(4000),
})

/** Every route here is admin-only; the guard is applied once for the whole plugin. */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  app.addHook('preHandler', app.requireCapability('admin.manage'))

  app.get('/verifications', async () => ({
    verifications: queryAll(
      db,
      `SELECT v.id, v.user_id, u.name, u.email, v.class_year, v.program, v.status,
              v.created_at, v.reviewed_at
       FROM alumni_verifications v
       JOIN users u ON u.id = v.user_id
       ORDER BY CASE v.status WHEN 'pending' THEN 0 ELSE 1 END, v.created_at DESC`,
    ),
  }))

  app.patch('/verifications/:verificationId', async (request) => {
    const adminId = request.currentUser?.sub
    if (!adminId) throw new UnauthorizedError()

    const { verificationId } = request.params as { verificationId: string }
    const input = parseOrThrow(verificationPatchSchema, request.body, 'verification status')

    const existing = queryOne<{ user_id: string; name: string }>(
      db,
      `SELECT v.user_id, u.name FROM alumni_verifications v JOIN users u ON u.id = v.user_id
       WHERE v.id = ?`,
      [verificationId],
    )
    if (!existing) throw new NotFoundError('Verification entry not found.')

    transaction(db, () => {
      execute(
        db,
        'UPDATE alumni_verifications SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
        [input.status, adminId, nowIso(), verificationId],
      )

      // Approval is what activates a pending alumni account, so the two stay in
      // step rather than an approved alumnus remaining unable to act. Only a
      // *pending* account is activated: approving an old entry must not quietly
      // lift a suspension.
      if (input.status === 'approved') {
        execute(
          db,
          "UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'pending'",
          [nowIso(), existing.user_id],
        )
      }

      if (input.status === 'approved' || input.status === 'rejected') {
        notify(db, {
          userId: existing.user_id,
          type: input.status === 'approved' ? 'verification.approved' : 'verification.rejected',
          title:
            input.status === 'approved'
              ? 'Your alumni account is verified — welcome!'
              : 'We could not verify your alumni account',
          body:
            input.status === 'approved'
              ? 'You now have full access: communities, events, messaging and, if you like, mentoring.'
              : 'Contact the alumni office if you think this is a mistake.',
          link: input.status === 'approved' ? '/alumni' : '/pending',
        })
      }

      const verb = { approved: 'Approved', rejected: 'Rejected', review: 'Flagged', pending: 'Reopened' }
      recordAudit(db, {
        adminUserId: adminId,
        action: 'verification.reviewed',
        targetType: 'verification',
        targetId: verificationId,
        summary: `${verb[input.status]} ${existing.name}'s alumni verification.`,
      })
    })

    return { message: `Verification ${input.status}.` }
  })

  /**
   * One page of accounts, searched and filtered in SQL (DESIGN_BACKLOG #49) —
   * the page used to receive every user and cut the list to 50 itself.
   */
  app.get('/users', async (request) => {
    const query = parseOrThrow(
      z.object({
        role: z.enum(['student', 'alumni', 'admin']).optional(),
        status: z.enum(['active', 'pending', 'suspended']).optional(),
        q: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      request.query,
      'user filters',
    )

    const conditions = ['deleted_at IS NULL']
    const params: (string | number)[] = []
    if (query.role) {
      conditions.push('role = ?')
      params.push(query.role)
    }
    if (query.status) {
      conditions.push('status = ?')
      params.push(query.status)
    }
    if (query.q) {
      conditions.push('(name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE)')
      params.push(`%${query.q}%`, `%${query.q}%`)
    }
    const where = `WHERE ${conditions.join(' AND ')}`

    type Row = Omit<AdminUser, 'avatarUrl'> & { avatar_updated_at: string | null }
    const total = queryScalar<number>(db, `SELECT COUNT(*) AS c FROM users ${where}`, params) ?? 0
    // Note the explicit column list: `SELECT *` here would ship password_hash
    // and password_salt to the browser, which is exactly what the mock did.
    const rows = queryAll<Row>(
      db,
      `SELECT id, name, email, role, status, created_at, avatar_updated_at FROM users ${where}
       ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      [...params, query.limit, (query.page - 1) * query.limit],
    )
    const users = rows.map(({ avatar_updated_at, ...user }) => ({
      ...user,
      avatarUrl: avatarUrl(user.id, avatar_updated_at),
    }))

    return { users, total, page: query.page, limit: query.limit } satisfies AdminUserPage
  })

  /**
   * Suspend or reactivate an account. Takes effect on the user's very next
   * request: the auth guard reads status from the database each time rather
   * than trusting the 12-hour token.
   *
   * Reactivating is how a suspension is undone, not a way around verification:
   * a pending alumnus is activated by approving their verification entry.
   */
  app.patch('/users/:userId/status', async (request) => {
    const { userId } = request.params as { userId: string }
    const input = parseOrThrow(userStatusSchema, request.body, 'account status')

    const user = queryOne<{ role: string; status: string; name: string }>(
      db,
      'SELECT role, status, name FROM users WHERE id = ?',
      [userId],
    )
    if (!user) throw new NotFoundError('User not found.')

    // Admin accounts are seed-created and there is no path to recreate one, so
    // one admin locking out another (or themselves) is not recoverable in-app.
    if (user.role === 'admin') {
      throw new ForbiddenError('Administrator accounts cannot be suspended here.')
    }
    if (input.status === 'active' && user.status === 'pending') {
      throw new ConflictError('This alumnus is awaiting verification. Approve them from the queue instead.')
    }

    transaction(db, () => {
      execute(db, 'UPDATE users SET status = ?, updated_at = ? WHERE id = ?', [
        input.status,
        nowIso(),
        userId,
      ])
      recordAudit(db, {
        adminUserId: request.currentUser!.sub,
        action: input.status === 'suspended' ? 'user.suspended' : 'user.reactivated',
        targetType: 'user',
        targetId: userId,
        summary: `${input.status === 'suspended' ? 'Suspended' : 'Reactivated'} ${user.name} (${user.role}).`,
      })
    })

    return {
      message:
        input.status === 'suspended'
          ? `${user.name} is suspended and has been signed out.`
          : `${user.name} is active again.`,
    }
  })

  app.post('/announcements', async (request, reply) => {
    const adminId = request.currentUser?.sub
    if (!adminId) throw new UnauthorizedError()

    const input = parseOrThrow(announcementSchema, request.body, 'announcement')
    const id = newId('ann')

    transaction(db, () => {
      execute(
        db,
        'INSERT INTO announcements (id, title, body, audience, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, input.title, input.body, input.audience, adminId, nowIso()],
      )
      // Every recipient gets it in their notifications, linked to their own
      // dashboard, where the announcement is shown in full.
      const roles = { all: ['student', 'alumni'], students: ['student'], alumni: ['alumni'] } as const
      for (const role of roles[input.audience]) {
        notifyRoles(db, [role], {
          type: 'announcement',
          title: input.title,
          body: input.body.length > 200 ? `${input.body.slice(0, 197)}…` : input.body,
          link: role === 'student' ? '/student' : '/alumni',
        })
      }

      recordAudit(db, {
        adminUserId: adminId,
        action: 'announcement.published',
        targetType: 'announcement',
        targetId: id,
        summary: `Announced “${input.title}” to ${input.audience}.`,
      })
    })

    return reply.code(201).send({
      announcement: { id, ...input },
      message: `Announcement published to ${input.audience}.`,
    })
  })

  app.get('/announcements', async () => ({
    announcements: queryAll(
      db,
      // Same shape as the audience feed (GET /api/announcements).
      'SELECT id, title, body, audience, created_at AS createdAt FROM announcements ORDER BY created_at DESC LIMIT 50',
    ),
  }))

  /**
   * Removes someone's profile photo — moderation for an inappropriate image
   * (ROADMAP D6). Photos are optional, so removing one takes nothing else away.
   */
  app.delete('/users/:userId/avatar', async (request) => {
    const { userId } = request.params as { userId: string }
    const user = queryOne<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', [userId])
    if (!user) throw new NotFoundError('User not found.')

    const previous = transaction(db, () => {
      const fileName = removeAvatar(db, userId)
      recordAudit(db, {
        adminUserId: request.currentUser!.sub,
        action: 'avatar.removed',
        targetType: 'user',
        targetId: userId,
        summary: `Removed ${user.name}'s profile photo.`,
      })
      return fileName
    })
    deleteAvatarFile(previous)

    return { message: `${user.name}'s photo was removed.` }
  })

  /** Preview (dryRun) or perform a bulk alumni import (DESIGN_BACKLOG #46). */
  app.post('/alumni/import', { bodyLimit: 600 * 1024 }, async (request) => {
    const input = parseOrThrow(importSchema, request.body, 'import')
    return importAlumni(db, request.currentUser!.sub, input)
  })

  // ── Reports (DESIGN_BACKLOG #42) ───────────────────────────────────────────

  app.get('/reports', async (request) => {
    const { status } = parseOrThrow(
      z.object({ status: z.enum(['open', 'closed', 'all']).default('open') }),
      request.query,
      'filter',
    )
    return { reports: safety.listReports(db, status) }
  })

  app.patch('/reports/:reportId', async (request) => {
    const { reportId } = request.params as { reportId: string }
    const input = parseOrThrow(safety.reviewSchema, request.body, 'review')
    safety.reviewReport(db, request.currentUser!.sub, reportId, input)
    return { message: input.status === 'actioned' ? 'Report marked as actioned.' : 'Report dismissed.' }
  })

  // ── Insights (DESIGN_BACKLOG #47, #48, #50, #52) ───────────────────────────

  app.get('/insights', async (request) => {
    const { days } = parseOrThrow(
      z.object({ days: z.coerce.number().int().refine((value) => [30, 90, 365].includes(value)).default(90) }),
      request.query,
      'period',
    )
    return {
      supply: insights.supplyAndDemand(db),
      pipeline: insights.pipeline(db, days),
      responsiveness: insights.leastResponsive(db),
    } satisfies Insights
  })

  /** Separate because it asks the matching worker, which can be slow or down. */
  app.get('/insights/evaluation', async (): Promise<EvaluationResponse> => {
    try {
      return { evaluation: await evaluateOutcomes(db, app.matching), matching: app.matching.isUsable() ? 'ready' : 'unavailable' }
    } catch (error) {
      app.log.warn({ err: error }, 'match evaluation failed')
      return { evaluation: null, matching: 'failed' }
    }
  })

  /** The most recent admin actions, newest first (DESIGN_BACKLOG #45). */
  app.get('/audit', async () => ({ entries: listAudit(db) }))

  /** Platform totals for the admin dashboard, counted rather than hardcoded. */
  app.get('/stats', async () => {
    const count = (sql: string, params: string[] = []) => queryScalar<number>(db, sql, params) ?? 0

    return {
      stats: {
        totalUsers: count('SELECT COUNT(*) AS c FROM users'),
        totalAlumni: count('SELECT COUNT(*) AS c FROM users WHERE role = ?', ['alumni']),
        totalStudents: count('SELECT COUNT(*) AS c FROM users WHERE role = ?', ['student']),
        activeMentors: count('SELECT COUNT(*) AS c FROM mentor_profiles'),
        optedInStudents: count('SELECT COUNT(*) AS c FROM mentorship_seekers'),
        pendingVerifications: count(
          "SELECT COUNT(*) AS c FROM alumni_verifications WHERE status = 'pending'",
        ),
        pendingRequests: count("SELECT COUNT(*) AS c FROM mentorship_requests WHERE status = 'pending'"),
        activeRelationships: count(
          "SELECT COUNT(*) AS c FROM mentorship_relationships WHERE status = 'active'",
        ),
        upcomingEvents: count('SELECT COUNT(*) AS c FROM events WHERE starts_at >= ?', [nowIso()]),
        matchEvents: count('SELECT COUNT(*) AS c FROM match_events'),
        feedbackResponses: count('SELECT COUNT(*) AS c FROM feedback'),
      },
    }
  })
}
