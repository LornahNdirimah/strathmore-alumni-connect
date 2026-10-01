/**
 * Blocking and reporting (DESIGN_BACKLOG #42).
 *
 * A block works in both directions: neither person can start a conversation,
 * send a message, or send a mentorship request to the other. It is silent —
 * the blocked person is told only that they cannot message this account, the
 * same answer they would get for anyone out of reach.
 *
 * A report goes to the admins' queue with where it happened, so a reviewer can
 * look. The reporter hears the outcome; never who else was involved.
 */
import { z } from 'zod'

import type { Database } from '../../db/connection.js'
import { transaction } from '../../db/connection.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import { recordAudit } from '../../lib/audit.js'
import { avatarUrl } from '../../lib/avatars.js'
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js'
import {
  REPORT_CONTEXTS,
  REPORT_REASONS,
  type AuthRole,
  type ReportContext,
  type ReportItem,
  type ReportReason,
  type UserStatus,
} from '../../contract/index.js'
import { newId } from '../../lib/id.js'
import { notify } from '../../lib/notifications.js'
import { nowIso } from '../../lib/time.js'

export { REPORT_REASONS } from '../../contract/index.js'

export const reportSchema = z.object({
  userId: z.string().trim().min(1),
  contextType: z.enum(REPORT_CONTEXTS),
  contextId: z.string().trim().max(200).optional(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(2000).optional(),
})

export const blockSchema = z.object({ userId: z.string().trim().min(1) })

export const reviewSchema = z.object({
  status: z.enum(['actioned', 'dismissed']),
  note: z.string().trim().max(1000).optional(),
})

/** True if either person has blocked the other. */
export function isBlockedBetween(db: Database, a: string, b: string): boolean {
  return (
    queryOne<{ one: number }>(
      db,
      `SELECT 1 AS one FROM user_blocks
       WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?)`,
      [a, b, b, a],
    ) !== null
  )
}

function requireOtherUser(db: Database, viewerId: string, userId: string): { name: string } {
  if (userId === viewerId) throw new BadRequestError('That is your own account.')
  const user = queryOne<{ name: string }>(db, 'SELECT name FROM users WHERE id = ? AND deleted_at IS NULL', [userId])
  if (!user) throw new NotFoundError('User not found.')
  return user
}

export function block(db: Database, blockerId: string, blockedId: string): { name: string } {
  const user = requireOtherUser(db, blockerId, blockedId)
  execute(
    db,
    'INSERT OR IGNORE INTO user_blocks (blocker_user_id, blocked_user_id, created_at) VALUES (?, ?, ?)',
    [blockerId, blockedId, nowIso()],
  )
  return user
}

export function unblock(db: Database, blockerId: string, blockedId: string): void {
  execute(db, 'DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?', [blockerId, blockedId])
}

export function listBlocked(db: Database, blockerId: string) {
  return queryAll<{ id: string; name: string; avatar_updated_at: string | null; created_at: string }>(
    db,
    `SELECT u.id, u.name, u.avatar_updated_at, b.created_at FROM user_blocks b
     JOIN users u ON u.id = b.blocked_user_id
     WHERE b.blocker_user_id = ? ORDER BY b.created_at DESC`,
    [blockerId],
  ).map((row) => ({
    userId: row.id,
    name: row.name,
    avatarUrl: avatarUrl(row.id, row.avatar_updated_at),
    blockedAt: row.created_at,
  }))
}

export function fileReport(db: Database, reporterId: string, input: z.infer<typeof reportSchema>): void {
  requireOtherUser(db, reporterId, input.userId)

  const duplicate = queryOne<{ id: string }>(
    db,
    `SELECT id FROM reports WHERE reporter_user_id = ? AND reported_user_id = ? AND context_type = ?
       AND COALESCE(context_id, '') = ? AND status = 'open'`,
    [reporterId, input.userId, input.contextType, input.contextId ?? ''],
  )
  if (duplicate) throw new ConflictError('You have already reported this. An administrator will review it.')

  execute(
    db,
    `INSERT INTO reports (id, reporter_user_id, reported_user_id, context_type, context_id, reason, details,
                          status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [newId('rep'), reporterId, input.userId, input.contextType, input.contextId ?? null, input.reason,
     input.details ?? null, nowIso()],
  )
}

type ReportRow = {
  id: string
  reporter_user_id: string | null
  reporter_name: string | null
  reported_user_id: string
  reported_name: string
  reported_role: AuthRole
  reported_status: UserStatus
  context_type: ReportContext
  context_id: string | null
  reason: ReportReason
  details: string | null
  status: ReportItem['status']
  resolution_note: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  created_at: string
}

export function listReports(db: Database, status: 'open' | 'closed' | 'all'): ReportItem[] {
  const filter =
    status === 'open' ? "WHERE r.status = 'open'" : status === 'closed' ? "WHERE r.status != 'open'" : ''
  const rows = queryAll<ReportRow>(
    db,
    `SELECT r.*, rep.name AS reporter_name, u.name AS reported_name, u.role AS reported_role,
            u.status AS reported_status, rv.name AS reviewer_name,
            (SELECT COUNT(*) FROM reports r2 WHERE r2.reported_user_id = r.reported_user_id) AS report_count
     FROM reports r
     LEFT JOIN users rep ON rep.id = r.reporter_user_id
     JOIN users u ON u.id = r.reported_user_id
     LEFT JOIN users rv ON rv.id = r.reviewed_by
     ${filter}
     ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC
     LIMIT 100`,
  ) as Array<ReportRow & { report_count: number }>

  return rows.map((row) => ({
    id: row.id,
    reporter: row.reporter_user_id ? { userId: row.reporter_user_id, name: row.reporter_name } : null,
    reported: {
      userId: row.reported_user_id,
      name: row.reported_name,
      role: row.reported_role,
      status: row.reported_status,
      // How often this person has been reported in total: a pattern matters.
      totalReports: row.report_count,
    },
    contextType: row.context_type,
    contextId: row.context_id,
    // For a message, the text itself, so the reviewer need not go looking.
    excerpt: row.context_type === 'message' && row.context_id ? messageExcerpt(db, row.context_id, row.reported_user_id) : null,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolutionNote: row.resolution_note,
    reviewerName: row.reviewer_name,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  }))
}

function messageExcerpt(db: Database, messageId: string, senderId: string): string | null {
  // Only a message the reported person actually sent: a report cannot be used
  // to pull an arbitrary conversation into the admin view.
  return (
    queryOne<{ body: string }>(db, 'SELECT body FROM messages WHERE id = ? AND sender_user_id = ?', [messageId, senderId])
      ?.body ?? null
  )
}

export function reviewReport(
  db: Database,
  adminId: string,
  reportId: string,
  input: z.infer<typeof reviewSchema>,
): void {
  const report = queryOne<{ reporter_user_id: string | null; reported_name: string; status: string }>(
    db,
    `SELECT r.reporter_user_id, u.name AS reported_name, r.status FROM reports r
     JOIN users u ON u.id = r.reported_user_id WHERE r.id = ?`,
    [reportId],
  )
  if (!report) throw new NotFoundError('Report not found.')
  if (report.status !== 'open') throw new ConflictError('This report has already been reviewed.')

  transaction(db, () => {
    execute(
      db,
      'UPDATE reports SET status = ?, resolution_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
      [input.status, input.note ?? null, adminId, nowIso(), reportId],
    )
    recordAudit(db, {
      adminUserId: adminId,
      action: 'report.reviewed',
      targetType: 'report',
      targetId: reportId,
      summary: `${input.status === 'actioned' ? 'Actioned' : 'Dismissed'} a report about ${report.reported_name}.`,
    })
    if (report.reporter_user_id) {
      notify(db, {
        userId: report.reporter_user_id,
        type: 'report.reviewed',
        title: 'Your report was reviewed',
        body:
          input.status === 'actioned'
            ? 'Thank you — an administrator has taken action.'
            : 'Thank you — an administrator looked into it and took no further action.',
        link: null,
      })
    }
  })
}
