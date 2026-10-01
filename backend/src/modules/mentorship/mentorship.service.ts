import { type Database, transaction } from '../../db/connection.js'
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import { avatarUrl } from '../../lib/avatars.js'
import { notify } from '../../lib/notifications.js'
import { isBlockedBetween } from '../safety/safety.service.js'
import { nowIso } from '../../lib/time.js'
import * as mentorsRepo from '../mentors/mentors.repository.js'
import * as scheduling from '../scheduling/scheduling.service.js'
import * as repo from './mentorship.repository.js'
import type { CheckInInput, RequestInput, RespondInput } from './mentorship.schemas.js'

/**
 * Lifecycle rules (DESIGN_BACKLOG #7, #34, #35).
 *
 * A mentorship runs for a fixed term, with a check-in at the halfway point, and
 * then closes — freeing the mentor's seat, since capacity is derived from active
 * relationships. Requests are capped per student and expire if unanswered, so
 * a popular mentor is not flooded and a student is not left waiting on someone
 * who never replies.
 */
export const MENTORSHIP_TERM_DAYS = 84 // 12 weeks
export const MAX_PENDING_REQUESTS = 3
export const REQUEST_EXPIRY_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString()
}

export type RequestView = {
  id: string
  studentUserId: string
  studentName: string
  studentAvatarUrl: string | null
  mentorProfileId: string
  mentorName: string
  mentorHeadline: string
  interest: string
  preferredSlot: string
  preferredSlotAt: string | null
  message: string
  status: repo.MentorshipRequestRow['status']
  responseNotes: string | null
  createdAt: string
  respondedAt: string | null
  /** When an unanswered request lapses; null once it has been resolved. */
  expiresAt: string | null
}

function toRequestView(row: repo.MentorshipRequestView): RequestView {
  return {
    id: row.id,
    studentUserId: row.student_user_id,
    studentName: row.student_name,
    studentAvatarUrl: avatarUrl(row.student_user_id, row.student_avatar_at),
    mentorProfileId: row.mentor_profile_id,
    mentorName: row.mentor_name,
    mentorHeadline: row.mentor_headline,
    interest: row.interest,
    preferredSlot: row.preferred_slot,
    preferredSlotAt: row.preferred_slot_at,
    message: row.message,
    status: row.status,
    responseNotes: row.response_notes,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    expiresAt: row.status === 'pending' ? addDays(row.created_at, REQUEST_EXPIRY_DAYS) : null,
  }
}

/** A student asks a mentor for mentorship. */
export function createRequest(db: Database, studentUserId: string, input: RequestInput): RequestView {
  const mentor = mentorsRepo.findMentorById(db, input.mentorProfileId)
  if (!mentor) throw new NotFoundError('Mentor not found.')

  if (mentor.user_id === studentUserId) {
    throw new ConflictError('You cannot request mentorship from yourself.')
  }

  // Deliberately the same answer as for any unavailable mentor: a block is
  // not announced to the person blocked.
  if (isBlockedBetween(db, studentUserId, mentor.user_id)) {
    throw new ConflictError('You cannot send a request to this mentor.')
  }

  const previous = repo.findRelationshipByPair(db, mentor.id, studentUserId)
  if (previous) {
    throw new ConflictError(
      previous.status === 'active'
        ? 'You already have a mentorship with this mentor.'
        : 'You have already completed a mentorship with this mentor. Try someone new.',
    )
  }

  if (repo.countPendingRequestsForStudent(db, studentUserId) >= MAX_PENDING_REQUESTS) {
    throw new ConflictError(
      `You can have at most ${MAX_PENDING_REQUESTS} requests waiting at once. ` +
        'Withdraw one, or wait for a mentor to reply.',
    )
  }

  if (mentorsRepo.getRemainingCapacity(db, mentor.id) <= 0) {
    throw new ConflictError('This mentor has no remaining capacity right now.')
  }

  const id = newId('req')
  const timestamp = nowIso()

  const row: repo.MentorshipRequestRow = {
    id,
    student_user_id: studentUserId,
    mentor_profile_id: mentor.id,
    interest: input.interest,
    preferred_slot: input.preferredSlot,
    preferred_slot_at: input.preferredSlotAt ?? null,
    message: input.message,
    status: 'pending',
    response_notes: null,
    created_at: timestamp,
    responded_at: null,
  }

  try {
    transaction(db, () => {
      repo.insertRequest(db, row)
      repo.recordMatchEvent(db, {
        id: newId('evt'),
        event_type: 'requested',
        student_user_id: studentUserId,
        mentor_profile_id: mentor.id,
        occurred_at: timestamp,
        metadata: JSON.stringify({ requestId: id, interest: input.interest }),
      })
      notify(db, {
        userId: mentor.user_id,
        type: 'request.received',
        title: `New mentorship request from ${userName(db, studentUserId)}`,
        body: input.interest,
        link: LINKS.mentorRequests,
      })
    })
  } catch (error) {
    // The partial unique index allows only one pending request per pair.
    if (String(error).includes('UNIQUE')) {
      throw new ConflictError('You already have a pending request with this mentor.')
    }
    throw error
  }

  const created = repo.findRequestById(db, id)
  if (!created) throw new NotFoundError('Request could not be created.')
  return toRequestView(created)
}

export function listRequestsForStudent(db: Database, studentUserId: string): RequestView[] {
  return repo.listRequestsForStudent(db, studentUserId).map(toRequestView)
}

export function listRequestsForMentorUser(db: Database, userId: string): RequestView[] {
  const mentor = mentorsRepo.findMentorByUserId(db, userId)
  if (!mentor) return []
  return repo.listRequestsForMentor(db, mentor.id).map(toRequestView)
}

/**
 * Accept or decline. The whole thing runs in one transaction because an accept
 * writes four related facts — request status, the new relationship, the match
 * event, and (implicitly) the capacity that relationship consumes — and a
 * partial write would leave a mentor over-committed or a request in limbo.
 */
/** A request plus, when accepting created one, the first booked session. */
export type RespondResult = RequestView & {
  firstSession: scheduling.SessionView | null
}

export function respondToRequest(
  db: Database,
  userId: string,
  requestId: string,
  input: RespondInput,
): RespondResult {
  const request = repo.findRequestById(db, requestId)
  if (!request) throw new NotFoundError('Request not found.')

  const mentor = mentorsRepo.findMentorByUserId(db, userId)
  // Ownership, not just role: holding an alumni account is not permission to
  // answer another mentor's requests.
  if (!mentor || mentor.id !== request.mentor_profile_id) {
    throw new ForbiddenError('This request was not sent to you.')
  }

  if (request.status !== 'pending') {
    throw new ConflictError(`This request was already ${request.status}.`)
  }

  if (input.status === 'accepted' && mentorsRepo.getRemainingCapacity(db, mentor.id) <= 0) {
    throw new ConflictError('You have no remaining capacity. Decline or free up a seat first.')
  }

  const timestamp = nowIso()
  // Captured inside the transaction so the session can be booked after it
  // commits — see bookRequestedSlot for why that is not part of the same unit.
  let relationshipId: string | null = null

  transaction(db, () => {
    const changed = repo.updateRequestStatus(
      db,
      requestId,
      input.status,
      input.notes ?? null,
      timestamp,
    )

    // Zero rows means another writer resolved it first; abort rather than
    // creating a relationship for a request that is no longer pending.
    if (changed === 0) {
      throw new ConflictError('This request was already answered.')
    }

    repo.recordMatchEvent(db, {
      id: newId('evt'),
      event_type: input.status === 'accepted' ? 'accepted' : 'declined',
      student_user_id: request.student_user_id,
      mentor_profile_id: mentor.id,
      occurred_at: timestamp,
      metadata: JSON.stringify({ requestId }),
    })

    notify(db, {
      userId: request.student_user_id,
      type: input.status === 'accepted' ? 'request.accepted' : 'request.declined',
      title:
        input.status === 'accepted'
          ? `${request.mentor_name} accepted your mentorship request`
          : `${request.mentor_name} declined your mentorship request`,
      body: input.notes ?? null,
      link: LINKS.studentMentors,
    })

    if (input.status === 'accepted') {
      relationshipId = newId('rel')
      repo.insertRelationship(db, {
        id: relationshipId,
        mentor_profile_id: mentor.id,
        student_user_id: request.student_user_id,
        source_request_id: requestId,
        status: 'active',
        started_at: timestamp,
        ended_at: null,
        ends_on: addDays(timestamp, MENTORSHIP_TERM_DAYS),
        ended_by_user_id: null,
        end_reason: null,
      })
    }
  })

  const updated = repo.findRequestById(db, requestId)
  if (!updated) throw new NotFoundError('Request not found.')

  return {
    ...toRequestView(updated),
    firstSession: relationshipId ? bookRequestedSlot(db, userId, relationshipId, request) : null,
  }
}

/**
 * Turns the time the student asked for into an actual first session.
 *
 * Deliberately best-effort and outside the acceptance transaction. The mentor's
 * decision to accept must stand on its own: if the requested slot has since been
 * taken, has passed, or falls outside the availability the mentor has published
 * since, that is a scheduling detail to sort out afterwards — not a reason to
 * refuse the mentorship. The two then book a time through the normal flow.
 */
function bookRequestedSlot(
  db: Database,
  mentorUserId: string,
  relationshipId: string,
  request: repo.MentorshipRequestView,
): scheduling.SessionView | null {
  if (!request.preferred_slot_at) return null
  if (request.preferred_slot_at <= nowIso()) return null

  try {
    return scheduling.bookSession(db, mentorUserId, {
      relationshipId,
      title: `Intro session — ${request.interest}`,
      scheduledAt: request.preferred_slot_at,
    })
  } catch {
    // Slot gone, availability changed, or a clash. The mentorship is still on.
    return null
  }
}

export type RelationshipView = {
  id: string
  mentorProfileId: string
  mentorUserId: string
  mentorName: string
  mentorHeadline: string
  mentorCompany: string
  studentUserId: string
  studentName: string
  mentorAvatarUrl: string | null
  studentAvatarUrl: string | null
  status: string
  startedAt: string
  /** The end of the term. */
  endsOn: string | null
  endedAt: string | null
  /** 'term-complete' when the term ran out; otherwise what the person ending it wrote. */
  endReason: string | null
  /** Halfway through the term, when the check-in opens. */
  checkInOpensAt: string | null
  /** Whether the viewer owes a check-in now. */
  checkInDue: boolean
  /** The viewer's own check-in, once given. */
  myCheckIn: { progress: repo.CheckInRow['progress']; note: string | null } | null
  /** What the pair agreed to work on (DESIGN_BACKLOG #32). */
  goals: GoalView[]
}

export type GoalView = { id: string; title: string; completed: boolean; completedAt: string | null }

/** Enough to keep a mentorship focused; a longer list is a to-do app. */
export const MAX_GOALS = 5

function midpointOf(startedAt: string, endsOn: string | null): string | null {
  if (!endsOn) return null
  const start = new Date(startedAt).getTime()
  return new Date(start + (new Date(endsOn).getTime() - start) / 2).toISOString()
}

function toRelationshipView(
  row: repo.RelationshipView,
  viewerId: string,
  checkIns: repo.CheckInRow[],
  now: string,
  goals: GoalView[] = [],
): RelationshipView {
  const opensAt = midpointOf(row.started_at, row.ends_on)
  const mine = checkIns.find((item) => item.relationship_id === row.id && item.user_id === viewerId)

  return {
    id: row.id,
    mentorProfileId: row.mentor_profile_id,
    mentorUserId: row.mentor_user_id,
    mentorName: row.mentor_name,
    mentorHeadline: row.mentor_headline,
    mentorCompany: row.mentor_company,
    studentUserId: row.student_user_id,
    studentName: row.student_name,
    mentorAvatarUrl: avatarUrl(row.mentor_user_id, row.mentor_avatar_at),
    studentAvatarUrl: avatarUrl(row.student_user_id, row.student_avatar_at),
    status: row.status,
    startedAt: row.started_at,
    endsOn: row.ends_on,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    checkInOpensAt: opensAt,
    checkInDue: row.status === 'active' && opensAt !== null && opensAt <= now && !mine,
    myCheckIn: mine ? { progress: mine.progress, note: mine.note } : null,
    goals,
  }
}

export function listRelationships(
  db: Database,
  userId: string,
  role: 'student' | 'alumni',
): RelationshipView[] {
  let rows: repo.RelationshipView[]
  if (role === 'student') {
    rows = repo.listRelationshipsForStudent(db, userId)
  } else {
    const mentor = mentorsRepo.findMentorByUserId(db, userId)
    rows = mentor ? repo.listRelationshipsForMentor(db, mentor.id) : []
  }

  const ids = rows.map((row) => row.id)
  const checkIns = repo.listCheckIns(db, ids)
  const goalsByRelationship = listGoals(db, ids)
  const now = nowIso()
  return rows.map((row) =>
    toRelationshipView(row, userId, checkIns, now, goalsByRelationship.get(row.id) ?? []),
  )
}

/** Goals for many mentorships in one query. */
function listGoals(db: Database, relationshipIds: string[]): Map<string, GoalView[]> {
  const byRelationship = new Map<string, GoalView[]>()
  if (relationshipIds.length === 0) return byRelationship

  const rows = queryAll<{ id: string; relationship_id: string; title: string; completed_at: string | null }>(
    db,
    `SELECT id, relationship_id, title, completed_at FROM mentorship_goals
     WHERE relationship_id IN (${relationshipIds.map(() => '?').join(', ')})
     ORDER BY created_at ASC`,
    relationshipIds,
  )
  for (const row of rows) {
    const list = byRelationship.get(row.relationship_id) ?? []
    list.push({ id: row.id, title: row.title, completed: row.completed_at !== null, completedAt: row.completed_at })
    byRelationship.set(row.relationship_id, list)
  }
  return byRelationship
}

/** Either participant adds a goal to an active mentorship. */
export function addGoal(db: Database, userId: string, relationshipId: string, title: string): GoalView {
  const relationship = requireRelationshipParticipant(db, relationshipId, userId)
  if (relationship.status !== 'active') throw new ConflictError('This mentorship has ended.')

  const count = queryOne<{ count: number }>(
    db,
    'SELECT COUNT(*) AS count FROM mentorship_goals WHERE relationship_id = ?',
    [relationshipId],
  )?.count ?? 0
  if (count >= MAX_GOALS) {
    throw new ConflictError(`A mentorship can have up to ${MAX_GOALS} goals. Remove or finish one first.`)
  }

  const goal = { id: newId('goal'), title: title.trim(), createdAt: nowIso() }
  execute(
    db,
    `INSERT INTO mentorship_goals (id, relationship_id, title, created_by, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [goal.id, relationshipId, goal.title, userId, goal.createdAt],
  )
  return { id: goal.id, title: goal.title, completed: false, completedAt: null }
}

function requireGoalParticipant(db: Database, goalId: string, userId: string): { relationship_id: string } {
  const goal = queryOne<{ relationship_id: string }>(
    db,
    'SELECT relationship_id FROM mentorship_goals WHERE id = ?',
    [goalId],
  )
  if (!goal) throw new NotFoundError('Goal not found.')
  requireRelationshipParticipant(db, goal.relationship_id, userId)
  return goal
}

export function setGoalCompleted(db: Database, userId: string, goalId: string, completed: boolean): void {
  requireGoalParticipant(db, goalId, userId)
  execute(db, 'UPDATE mentorship_goals SET completed_at = ? WHERE id = ?', [completed ? nowIso() : null, goalId])
}

export function removeGoal(db: Database, userId: string, goalId: string): void {
  requireGoalParticipant(db, goalId, userId)
  execute(db, 'DELETE FROM mentorship_goals WHERE id = ?', [goalId])
}

/** Only a mentorship's two participants may act on it. */
function requireRelationshipParticipant(
  db: Database,
  relationshipId: string,
  userId: string,
): repo.RelationshipView {
  const relationship = repo.findRelationshipById(db, relationshipId)
  if (!relationship) throw new NotFoundError('Mentorship not found.')
  if (relationship.student_user_id !== userId && relationship.mentor_user_id !== userId) {
    throw new ForbiddenError('You are not part of this mentorship.')
  }
  return relationship
}

const ENDED_SESSION_REASON = 'The mentorship ended.'

/**
 * Either participant may end a mentorship (ROADMAP D3). It frees the mentor's
 * seat, cancels sessions that have not happened, and leaves the pair's thread
 * and history in place. Feedback is then asked of both.
 */
export function endMentorship(
  db: Database,
  userId: string,
  relationshipId: string,
  reason: string | undefined,
): void {
  const relationship = requireRelationshipParticipant(db, relationshipId, userId)
  if (relationship.status !== 'active') {
    throw new ConflictError('This mentorship has already ended.')
  }

  const now = nowIso()
  transaction(db, () => {
    const changed = repo.endRelationship(db, relationshipId, now, userId, reason?.trim() || null)
    if (changed === 0) throw new ConflictError('This mentorship has already ended.')
    repo.cancelFutureSessions(db, relationshipId, now, ENDED_SESSION_REASON)

    // The other participant, who did not press the button.
    const endedByStudent = userId === relationship.student_user_id
    notify(db, {
      userId: endedByStudent ? relationship.mentor_user_id : relationship.student_user_id,
      type: 'mentorship.ended',
      title: `${endedByStudent ? relationship.student_name : relationship.mentor_name} ended your mentorship`,
      body: reason?.trim() || 'Please share feedback on how it went.',
      link: endedByStudent ? LINKS.mentorRequests : LINKS.studentMentors,
    })
  })
}

/** A student takes back a request the mentor has not answered. */
export function withdrawRequest(db: Database, studentUserId: string, requestId: string): RequestView {
  const request = repo.findRequestById(db, requestId)
  if (!request || request.student_user_id !== studentUserId) {
    throw new NotFoundError('Request not found.')
  }

  transaction(db, () => {
    const changed = repo.updateRequestStatus(db, requestId, 'withdrawn', null, nowIso())
    if (changed === 0) throw new ConflictError(`This request was already ${request.status}.`)

    const mentorUserId = mentorsRepo.findMentorById(db, request.mentor_profile_id)?.user_id
    if (mentorUserId) {
      notify(db, {
        userId: mentorUserId,
        type: 'request.withdrawn',
        title: `${request.student_name} withdrew their mentorship request`,
        link: LINKS.mentorRequests,
      })
    }
  })

  const updated = repo.findRequestById(db, requestId)
  if (!updated) throw new NotFoundError('Request not found.')
  return toRequestView(updated)
}

/** The mid-point check-in: once per person, from halfway through the term. */
export function submitCheckIn(
  db: Database,
  userId: string,
  relationshipId: string,
  input: CheckInInput,
): void {
  const relationship = requireRelationshipParticipant(db, relationshipId, userId)
  if (relationship.status !== 'active') {
    throw new ConflictError('This mentorship has ended.')
  }

  const opensAt = midpointOf(relationship.started_at, relationship.ends_on)
  if (!opensAt || opensAt > nowIso()) {
    throw new ConflictError('The check-in opens halfway through the mentorship.')
  }

  try {
    repo.insertCheckIn(db, {
      id: newId('chk'),
      relationship_id: relationshipId,
      user_id: userId,
      progress: input.progress,
      note: input.note ?? null,
      created_at: nowIso(),
    })
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new ConflictError('You have already checked in on this mentorship.')
    }
    throw error
  }
}

/**
 * Time-based transitions, run on boot and periodically (plugins/lifecycle.ts):
 * unanswered requests expire, and mentorships whose term has run out close.
 * Idempotent — running it twice changes nothing the second time.
 */
export function runLifecycleSweep(
  db: Database,
  now: string = nowIso(),
): { expiredRequests: number; endedMentorships: number; remindersSent: number } {
  return transaction(db, () => {
    const cutoff = addDays(now, -REQUEST_EXPIRY_DAYS)
    const expiring = queryAll<{ student_user_id: string; mentor_name: string }>(
      db,
      `SELECT r.student_user_id, mu.name AS mentor_name
       FROM mentorship_requests r
       JOIN mentor_profiles mp ON mp.id = r.mentor_profile_id
       JOIN users mu ON mu.id = mp.user_id
       WHERE r.status = 'pending' AND r.created_at < ?`,
      [cutoff],
    )
    const expiredRequests = repo.expireRequestsBefore(db, cutoff, now)
    for (const request of expiring) {
      notify(db, {
        userId: request.student_user_id,
        type: 'request.expired',
        title: `Your request to ${request.mentor_name} expired`,
        body: 'They did not reply within a week. You are free to ask another mentor.',
        link: LINKS.studentMentors,
      })
    }

    let endedMentorships = 0
    for (const id of repo.listRelationshipIdsDueToEnd(db, now)) {
      const relationship = repo.findRelationshipById(db, id)
      const ended = repo.endRelationship(db, id, now, null, 'term-complete')
      repo.cancelFutureSessions(db, id, now, ENDED_SESSION_REASON)
      endedMentorships += ended

      if (ended && relationship) {
        for (const [userId, other, link] of [
          [relationship.student_user_id, relationship.mentor_name, LINKS.studentMentors],
          [relationship.mentor_user_id, relationship.student_name, LINKS.mentorRequests],
        ] as const) {
          notify(db, {
            userId,
            type: 'mentorship.ended',
            title: `Your mentorship with ${other} has come to an end`,
            body: 'The 12-week term is over. Please share feedback on how it went.',
            link,
          })
        }
      }
    }

    const remindersSent = scheduling.sendSessionReminders(db, now)

    return { expiredRequests, endedMentorships, remindersSent }
  })
}

/** Where each notification takes its reader. */
const LINKS = {
  mentorRequests: '/alumni/my-mentees',
  studentMentors: '/student/my-mentors',
} as const

function userName(db: Database, userId: string): string {
  return queryOne<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', [userId])?.name ?? 'A student'
}
