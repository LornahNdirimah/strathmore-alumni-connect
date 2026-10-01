/**
 * The admin audit log (DESIGN_BACKLOG #45): who approved, rejected, suspended,
 * announced, scheduled or removed what, and when.
 *
 * Callers write the entry in the same transaction as the action, so the log
 * can never claim something happened that was rolled back, nor miss something
 * that committed.
 */
import type { Database } from '../db/connection.js'
import { execute, queryAll } from '../db/repository.js'
import { newId } from './id.js'
import { nowIso } from './time.js'

export type AuditAction =
  | 'verification.reviewed'
  | 'user.suspended'
  | 'user.reactivated'
  | 'announcement.published'
  | 'event.created'
  | 'event.updated'
  | 'event.cancelled'
  | 'group.removed'
  | 'avatar.removed'
  | 'report.reviewed'
  | 'alumni.imported'

export function recordAudit(
  db: Database,
  entry: {
    adminUserId: string
    action: AuditAction
    targetType: 'user' | 'verification' | 'announcement' | 'event' | 'group' | 'report' | 'import'
    targetId: string
    /** One human-readable line, written at the time — names can change later. */
    summary: string
  },
): void {
  execute(
    db,
    `INSERT INTO admin_audit (id, admin_user_id, action, target_type, target_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId('audit'), entry.adminUserId, entry.action, entry.targetType, entry.targetId, entry.summary, nowIso()],
  )
}

export type AuditView = {
  id: string
  adminName: string | null
  action: AuditAction
  targetType: string
  targetId: string
  summary: string
  createdAt: string
}

export function listAudit(db: Database, limit = 100): AuditView[] {
  return queryAll<{
    id: string
    admin_name: string | null
    action: AuditAction
    target_type: string
    target_id: string
    summary: string
    created_at: string
  }>(
    db,
    `SELECT a.id, u.name AS admin_name, a.action, a.target_type, a.target_id, a.summary, a.created_at
     FROM admin_audit a
     LEFT JOIN users u ON u.id = a.admin_user_id
     ORDER BY a.created_at DESC LIMIT ?`,
    [limit],
  ).map((row) => ({
    id: row.id,
    adminName: row.admin_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    summary: row.summary,
    createdAt: row.created_at,
  }))
}
