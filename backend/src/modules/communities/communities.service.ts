import { type Database, transaction } from '../../db/connection.js'
import { recordAudit } from '../../lib/audit.js'
import { notify } from '../../lib/notifications.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { nowIso } from '../../lib/time.js'
import type { AuthRole, GroupVisibility } from '../../types/domain.js'
import type { GroupInput, VisibilityInput } from './communities.schemas.js'

type GroupRow = {
  id: string
  name: string
  topic: string
  description: string
  visibility: GroupVisibility
  created_by: string
  created_at: string
  updated_at: string
  creator_name: string
  member_count: number
  is_member: number
}

export type GroupView = {
  id: string
  name: string
  topic: string
  description: string
  visibility: GroupVisibility
  createdBy: string
  creatorName: string
  createdAt: string
  memberCount: number
  isMember: boolean
  /** True only for the creator — drives whether the UI shows the toggle at all. */
  canEditVisibility: boolean
}

const GROUP_SELECT = `
  SELECT g.*, u.name AS creator_name,
         (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
         EXISTS (SELECT 1 FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = ?) AS is_member
  FROM groups g
  JOIN users u ON u.id = g.created_by
`

function toView(row: GroupRow, viewerId: string): GroupView {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    description: row.description,
    visibility: row.visibility,
    createdBy: row.created_by,
    creatorName: row.creator_name,
    createdAt: row.created_at,
    memberCount: row.member_count,
    isMember: row.is_member === 1,
    canEditVisibility: row.created_by === viewerId,
  }
}

/**
 * DESIGN_BACKLOG #1 — visibility is enforced in SQL, not in the UI.
 *
 * Students see a group only if it is explicitly `open-to-students` or they are
 * already a member. Alumni and admins see everything. The mock gated
 * /communities on "is there a session" alone, which made every group visible to
 * every role by accident.
 */
function visibilityClause(role: AuthRole): { sql: string; params: string[] } {
  if (role === 'student') {
    return {
      sql: `WHERE (g.visibility = 'open-to-students'
                   OR EXISTS (SELECT 1 FROM group_members gm3
                              WHERE gm3.group_id = g.id AND gm3.user_id = ?))`,
      params: [],
    }
  }
  return { sql: '', params: [] }
}

export function listGroups(db: Database, userId: string, role: AuthRole): GroupView[] {
  const clause = visibilityClause(role)
  // The `?` inside the visibility EXISTS needs the viewer id too, so students
  // bind it twice: once for is_member, once for the visibility check.
  const params = role === 'student' ? [userId, userId] : [userId]

  const rows = queryAll<GroupRow>(
    db,
    `${GROUP_SELECT} ${clause.sql} ORDER BY g.name ASC`,
    params,
  )
  return rows.map((row) => toView(row, userId))
}

export function getGroup(db: Database, groupId: string, userId: string, role: AuthRole): GroupView {
  const row = queryOne<GroupRow>(db, `${GROUP_SELECT} WHERE g.id = ?`, [userId, groupId])
  if (!row) throw new NotFoundError('Group not found.')

  const view = toView(row, userId)

  // Re-check on the detail route: a student must not reach an alumni-only group
  // by guessing its id, even though the list endpoint would never show it.
  if (role === 'student' && view.visibility === 'alumni-only' && !view.isMember) {
    throw new NotFoundError('Group not found.')
  }

  return view
}

export function listResources(db: Database, groupId: string): Array<{ title: string; url: string | null }> {
  return queryAll<{ title: string; url: string | null }>(
    db,
    'SELECT title, url FROM group_resources WHERE group_id = ? ORDER BY position',
    [groupId],
  )
}

export function createGroup(db: Database, userId: string, input: GroupInput): GroupView {
  const timestamp = nowIso()
  const id = newId('group')

  execute(
    db,
    `INSERT INTO groups (id, name, topic, description, visibility, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.topic, input.description, input.visibility, userId, timestamp, timestamp],
  )

  // The creator is a member by definition; otherwise they could create a group
  // and immediately not see it under the student visibility rule.
  execute(db, 'INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)', [
    id,
    userId,
    timestamp,
  ])

  return getGroup(db, id, userId, 'alumni')
}

export function joinGroup(db: Database, groupId: string, userId: string, role: AuthRole): GroupView {
  // Reuse the read path so the visibility rule is applied once, in one place:
  // a student cannot join a group they are not allowed to see.
  const group = getGroup(db, groupId, userId, role)

  if (role === 'student' && group.visibility === 'alumni-only') {
    throw new ForbiddenError('This group is open to alumni only.')
  }

  if (group.isMember) return group

  execute(db, 'INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)', [
    groupId,
    userId,
    nowIso(),
  ])

  return getGroup(db, groupId, userId, role)
}

export function leaveGroup(db: Database, groupId: string, userId: string, role: AuthRole): GroupView {
  const group = getGroup(db, groupId, userId, role)

  if (group.createdBy === userId) {
    throw new ConflictError('The creator cannot leave their own group.')
  }

  execute(db, 'DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId])
  return getGroup(db, groupId, userId, role)
}

/**
 * DESIGN_BACKLOG #1 — only the creator may change visibility.
 *
 * Enforced here rather than by hiding the button: an ordinary member (or an
 * admin) calling this endpoint directly is rejected.
 */
export function setVisibility(
  db: Database,
  groupId: string,
  userId: string,
  input: VisibilityInput,
): GroupView {
  const row = queryOne<{ created_by: string }>(db, 'SELECT created_by FROM groups WHERE id = ?', [
    groupId,
  ])
  if (!row) throw new NotFoundError('Group not found.')

  if (row.created_by !== userId) {
    throw new ForbiddenError('Only the group’s creator can change its visibility.')
  }

  execute(db, 'UPDATE groups SET visibility = ?, updated_at = ? WHERE id = ?', [
    input.visibility,
    nowIso(),
    groupId,
  ])

  return getGroup(db, groupId, userId, 'alumni')
}

/** Deletes a group and, by cascade, its memberships and resources. */
export function removeGroup(db: Database, groupId: string, adminUserId: string): { name: string } {
  const row = queryOne<{ name: string; created_by: string; member_count: number }>(
    db,
    `SELECT name, created_by,
            (SELECT COUNT(*) FROM group_members WHERE group_id = groups.id) AS member_count
     FROM groups WHERE id = ?`,
    [groupId],
  )
  if (!row) throw new NotFoundError('Group not found.')

  transaction(db, () => {
    execute(db, 'DELETE FROM groups WHERE id = ?', [groupId])
    notify(db, {
      userId: row.created_by,
      type: 'group.removed',
      title: `Your community “${row.name}” was removed`,
      body: 'An administrator removed it. Contact the alumni office if you have questions.',
      link: '/communities',
    })
    recordAudit(db, {
      adminUserId,
      action: 'group.removed',
      targetType: 'group',
      targetId: groupId,
      summary: `Removed the community “${row.name}” (${row.member_count} members).`,
    })
  })
  return { name: row.name }
}
