import type { Database } from '../../db/connection.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import type { MatchEventType, RelationshipStatus, RequestStatus } from '../../types/domain.js'

// --- Match events (DESIGN_BACKLOG #4) --------------------------------------

export type MatchEventRow = {
  id: string
  event_type: MatchEventType
  student_user_id: string
  mentor_profile_id: string
  occurred_at: string
  metadata: string
}

/**
 * Append-only behavioural log. Mirrors matching_engine.events.MatchEvent so it
 * can be exported directly as Tier-2 training data. Records actions only —
 * opinions belong in `feedback`.
 */
export function recordMatchEvent(db: Database, row: MatchEventRow): void {
  execute(
    db,
    `INSERT INTO match_events (id, event_type, student_user_id, mentor_profile_id, occurred_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.event_type,
      row.student_user_id,
      row.mentor_profile_id,
      row.occurred_at,
      row.metadata,
    ],
  )
}

export function listMatchEvents(db: Database, limit = 200): MatchEventRow[] {
  return queryAll<MatchEventRow>(
    db,
    'SELECT * FROM match_events ORDER BY occurred_at DESC LIMIT ?',
    [limit],
  )
}

export function countMatchEvents(db: Database, eventType: MatchEventType): number {
  const row = queryOne<{ count: number }>(
    db,
    'SELECT COUNT(*) AS count FROM match_events WHERE event_type = ?',
    [eventType],
  )
  return row?.count ?? 0
}

// --- Requests --------------------------------------------------------------

export type MentorshipRequestRow = {
  id: string
  student_user_id: string
  mentor_profile_id: string
  interest: string
  preferred_slot: string
  preferred_slot_at: string | null
  message: string
  status: RequestStatus
  response_notes: string | null
  created_at: string
  responded_at: string | null
}

export type MentorshipRequestView = MentorshipRequestRow & {
  student_avatar_at: string | null
  student_name: string
  student_email: string
  mentor_name: string
  mentor_headline: string
}

const REQUEST_SELECT = `
  SELECT r.*, s.name AS student_name, s.email AS student_email, s.avatar_updated_at AS student_avatar_at,
         mu.name AS mentor_name, mp.headline AS mentor_headline
  FROM mentorship_requests r
  JOIN users s ON s.id = r.student_user_id
  JOIN mentor_profiles mp ON mp.id = r.mentor_profile_id
  JOIN users mu ON mu.id = mp.user_id
`

export function insertRequest(db: Database, row: MentorshipRequestRow): void {
  execute(
    db,
    `INSERT INTO mentorship_requests
       (id, student_user_id, mentor_profile_id, interest, preferred_slot, preferred_slot_at,
        message, status, response_notes, created_at, responded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.student_user_id,
      row.mentor_profile_id,
      row.interest,
      row.preferred_slot,
      row.preferred_slot_at,
      row.message,
      row.status,
      row.response_notes,
      row.created_at,
      row.responded_at,
    ],
  )
}

export function findRequestById(db: Database, id: string): MentorshipRequestView | null {
  return queryOne<MentorshipRequestView>(db, `${REQUEST_SELECT} WHERE r.id = ?`, [id])
}

export function listRequestsForStudent(db: Database, studentUserId: string): MentorshipRequestView[] {
  return queryAll<MentorshipRequestView>(
    db,
    `${REQUEST_SELECT} WHERE r.student_user_id = ? ORDER BY r.created_at DESC`,
    [studentUserId],
  )
}

export function listRequestsForMentor(
  db: Database,
  mentorProfileId: string,
  status?: RequestStatus,
): MentorshipRequestView[] {
  if (status) {
    return queryAll<MentorshipRequestView>(
      db,
      `${REQUEST_SELECT} WHERE r.mentor_profile_id = ? AND r.status = ? ORDER BY r.created_at DESC`,
      [mentorProfileId, status],
    )
  }
  return queryAll<MentorshipRequestView>(
    db,
    `${REQUEST_SELECT} WHERE r.mentor_profile_id = ? ORDER BY r.created_at DESC`,
    [mentorProfileId],
  )
}

export function updateRequestStatus(
  db: Database,
  id: string,
  status: RequestStatus,
  notes: string | null,
  respondedAt: string,
): number {
  // The status guard makes this idempotent: a double-click, a retried request
  // or two reviewers acting at once can only transition a pending row once.
  const result = execute(
    db,
    `UPDATE mentorship_requests
     SET status = ?, response_notes = ?, responded_at = ?
     WHERE id = ? AND status = 'pending'`,
    [status, notes, respondedAt, id],
  )
  return result.changes
}

// --- Relationships ---------------------------------------------------------

export type RelationshipRow = {
  id: string
  mentor_profile_id: string
  student_user_id: string
  source_request_id: string | null
  status: RelationshipStatus
  started_at: string
  ended_at: string | null
  ends_on: string | null
  ended_by_user_id: string | null
  end_reason: string | null
}

export type RelationshipView = RelationshipRow & {
  student_avatar_at: string | null
  mentor_avatar_at: string | null
  student_name: string
  mentor_name: string
  mentor_user_id: string
  mentor_headline: string
  mentor_company: string
}

const RELATIONSHIP_SELECT = `
  SELECT rel.*, s.name AS student_name, mu.name AS mentor_name, mp.user_id AS mentor_user_id,
         s.avatar_updated_at AS student_avatar_at, mu.avatar_updated_at AS mentor_avatar_at,
         mp.headline AS mentor_headline, mp.company AS mentor_company
  FROM mentorship_relationships rel
  JOIN users s ON s.id = rel.student_user_id
  JOIN mentor_profiles mp ON mp.id = rel.mentor_profile_id
  JOIN users mu ON mu.id = mp.user_id
`

export function insertRelationship(db: Database, row: RelationshipRow): void {
  execute(
    db,
    `INSERT INTO mentorship_relationships
       (id, mentor_profile_id, student_user_id, source_request_id, status, started_at, ended_at,
        ends_on, ended_by_user_id, end_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.mentor_profile_id,
      row.student_user_id,
      row.source_request_id,
      row.status,
      row.started_at,
      row.ended_at,
      row.ends_on,
      row.ended_by_user_id,
      row.end_reason,
    ],
  )
}

export function listRelationshipsForStudent(db: Database, studentUserId: string): RelationshipView[] {
  return queryAll<RelationshipView>(
    db,
    `${RELATIONSHIP_SELECT} WHERE rel.student_user_id = ? ORDER BY rel.started_at DESC`,
    [studentUserId],
  )
}

export function listRelationshipsForMentor(
  db: Database,
  mentorProfileId: string,
): RelationshipView[] {
  return queryAll<RelationshipView>(
    db,
    `${RELATIONSHIP_SELECT} WHERE rel.mentor_profile_id = ? ORDER BY rel.started_at DESC`,
    [mentorProfileId],
  )
}

export function findRelationshipById(db: Database, id: string): RelationshipView | null {
  return queryOne<RelationshipView>(db, `${RELATIONSHIP_SELECT} WHERE rel.id = ?`, [id])
}

export function findRelationshipByPair(
  db: Database,
  mentorProfileId: string,
  studentUserId: string,
): RelationshipRow | null {
  return queryOne<RelationshipRow>(
    db,
    'SELECT * FROM mentorship_relationships WHERE mentor_profile_id = ? AND student_user_id = ?',
    [mentorProfileId, studentUserId],
  )
}

// --- Lifecycle -------------------------------------------------------------

export function countPendingRequestsForStudent(db: Database, studentUserId: string): number {
  const row = queryOne<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM mentorship_requests WHERE student_user_id = ? AND status = 'pending'",
    [studentUserId],
  )
  return row?.count ?? 0
}

/**
 * Closes an active relationship. Guarded on status, so ending twice (a double
 * click, the sweep racing a person) changes the row once and reports 0 after.
 */
export function endRelationship(
  db: Database,
  id: string,
  endedAt: string,
  endedByUserId: string | null,
  reason: string | null,
): number {
  return execute(
    db,
    `UPDATE mentorship_relationships
     SET status = 'completed', ended_at = ?, ended_by_user_id = ?, end_reason = ?
     WHERE id = ? AND status = 'active'`,
    [endedAt, endedByUserId, reason, id],
  ).changes
}

/** Cancels a relationship's sessions that have not happened yet. */
export function cancelFutureSessions(
  db: Database,
  relationshipId: string,
  now: string,
  reason: string,
): number {
  return execute(
    db,
    `UPDATE sessions SET status = 'cancelled', cancelled_reason = ?
     WHERE relationship_id = ? AND status = 'upcoming' AND scheduled_at > ?`,
    [reason, relationshipId, now],
  ).changes
}

/** Pending requests created before `cutoff`, marked expired. Returns the count. */
export function expireRequestsBefore(db: Database, cutoff: string, now: string): number {
  return execute(
    db,
    `UPDATE mentorship_requests SET status = 'expired', responded_at = ?
     WHERE status = 'pending' AND created_at < ?`,
    [now, cutoff],
  ).changes
}

export function listRelationshipIdsDueToEnd(db: Database, now: string): string[] {
  return queryAll<{ id: string }>(
    db,
    "SELECT id FROM mentorship_relationships WHERE status = 'active' AND ends_on IS NOT NULL AND ends_on <= ?",
    [now],
  ).map((row) => row.id)
}

export type CheckInRow = {
  id: string
  relationship_id: string
  user_id: string
  progress: 'on-track' | 'needs-attention'
  note: string | null
  created_at: string
}

export function insertCheckIn(db: Database, row: CheckInRow): void {
  execute(
    db,
    `INSERT INTO relationship_checkins (id, relationship_id, user_id, progress, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.id, row.relationship_id, row.user_id, row.progress, row.note, row.created_at],
  )
}

export function listCheckIns(db: Database, relationshipIds: string[]): CheckInRow[] {
  if (relationshipIds.length === 0) return []
  const placeholders = relationshipIds.map(() => '?').join(', ')
  return queryAll<CheckInRow>(
    db,
    `SELECT * FROM relationship_checkins WHERE relationship_id IN (${placeholders})`,
    relationshipIds,
  )
}
