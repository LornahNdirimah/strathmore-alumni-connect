/**
 * Availability and session booking.
 *
 * The rules enforced here, in order of how badly each would hurt if it were only
 * enforced in the UI:
 *
 *   1. Only the two people in a mentorship may book or change its sessions.
 *   2. A slot must sit on the mentor's declared availability — not merely inside
 *      it, but on the cadence they offered.
 *   3. Neither participant may be double-booked, across every mentorship they
 *      hold, not just this one.
 *   4. Nothing may be booked in the past.
 *
 * (3) is also guaranteed by unique indexes, because two concurrent requests can
 * both pass a check here and both then insert. This layer produces the readable
 * error; the index is what makes the guarantee true.
 */
import type { Database } from '../../db/connection.js'
import { transaction } from '../../db/connection.js'
import { notify, type NotificationType, publish } from '../../lib/notifications.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import {
  generateSlots,
  isSlotAligned,
  minuteToClock,
  weekdayName,
  type AvailabilityWindow,
} from '../../lib/slots.js'
import {
  DEFAULT_TIMEZONE,
  formatDisplayDate,
  formatSlotLabel,
  nowIso,
  offsetMinutesFor,
} from '../../lib/time.js'
import { buildCalendar, calendarFileName } from '../../lib/ics.js'
import * as repo from './scheduling.repository.js'
import type {
  AvailabilityUpdateInput,
  BookSessionInput,
  UpdateSessionInput,
} from './scheduling.schemas.js'

export type AvailabilityWindowView = {
  id: string
  dayOfWeek: number
  dayName: string
  startTime: string
  endTime: string
}

export type AvailabilityView = {
  mentorProfileId: string
  timezoneLabel: string
  sessionDurationMin: number
  windows: AvailabilityWindowView[]
}

export type SlotView = {
  startsAt: string
  endsAt: string
  label: string
  dateLabel: string
}

export type SessionView = {
  id: string
  relationshipId: string
  /** Exposed so a client can fetch this mentor's open slots to reschedule onto. */
  mentorProfileId: string | null
  title: string
  scheduledAt: string
  endsAt: string
  durationMin: number
  slotLabel: string
  dateLabel: string
  timezoneLabel: string
  status: 'upcoming' | 'completed' | 'cancelled'
  notes: string | null
  cancelledReason: string | null
  mentorName: string
  studentName: string
  meetingLink: string | null
  calendarUrl: string
  /** The viewer's own rating of a held session (DESIGN_BACKLOG #33). */
  myRating: number | null
  /** True when the viewer is the one who booked it. */
  bookedByMe: boolean
  /** Whether the viewer may still change it — a past or closed session is fixed. */
  canModify: boolean
}

const DEFAULT_DURATION = 30

function toWindowView(row: repo.AvailabilityRow): AvailabilityWindowView {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    dayName: weekdayName(row.day_of_week),
    startTime: minuteToClock(row.start_minute),
    endTime: minuteToClock(row.end_minute),
  }
}

function toAvailabilityWindows(rows: repo.AvailabilityRow[]): AvailabilityWindow[] {
  return rows.map((row) => ({
    day: row.day_of_week,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
  }))
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

export function getAvailability(db: Database, mentorProfileId: string): AvailabilityView {
  const prefs = repo.findSchedulingPrefs(db, mentorProfileId)
  if (!prefs) throw new NotFoundError('Mentor profile not found.')

  return {
    mentorProfileId,
    timezoneLabel: prefs.timezone_label ?? DEFAULT_TIMEZONE,
    sessionDurationMin: prefs.session_duration_min ?? DEFAULT_DURATION,
    windows: repo.listAvailability(db, mentorProfileId).map(toWindowView),
  }
}

/** Resolves the caller's own mentor profile, or refuses. */
export function requireOwnMentorProfile(db: Database, userId: string): string {
  const mentorProfileId = repo.findMentorProfileIdForUser(db, userId)
  if (!mentorProfileId) {
    throw new ForbiddenError('Create your mentor profile before setting availability.')
  }
  return mentorProfileId
}

/**
 * Replaces a mentor's whole weekly schedule.
 *
 * Overlapping windows are rejected rather than silently merged: a mentor who
 * enters 17:00-19:00 twice, or 17:00-18:00 and 17:30-19:00, almost certainly
 * made a mistake, and quietly accepting it hides that from them.
 */
export function setAvailability(
  db: Database,
  mentorProfileId: string,
  input: AvailabilityUpdateInput,
): AvailabilityView {
  const sorted = [...input.windows].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime - b.startTime,
  )

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!
    if (current.dayOfWeek === previous.dayOfWeek && current.startTime < previous.endTime) {
      throw new BadRequestError(
        `Your ${weekdayName(current.dayOfWeek)} windows overlap. Merge them into one range.`,
      )
    }
  }

  const timestamp = nowIso()

  transaction(db, () => {
    repo.replaceAvailability(
      db,
      mentorProfileId,
      sorted.map((window) => ({
        id: newId('avail'),
        dayOfWeek: window.dayOfWeek,
        startMinute: window.startTime,
        endMinute: window.endTime,
      })),
      timestamp,
    )

    repo.updateSchedulingPrefs(
      db,
      mentorProfileId,
      input.timezoneLabel,
      input.sessionDurationMin,
      timestamp,
    )
  })

  return getAvailability(db, mentorProfileId)
}

/**
 * Bookable slots for a mentor over the next `days`.
 *
 * Starts from now rather than midnight, so today's already-passed slots are not
 * offered, and subtracts every existing commitment the mentor holds.
 */
export function listOpenSlots(
  db: Database,
  mentorProfileId: string,
  days: number,
  studentUserId?: string,
): { slots: SlotView[]; availability: AvailabilityView } {
  const availability = getAvailability(db, mentorProfileId)
  const from = nowIso()
  const to = addMinutes(from, days * 24 * 60)

  const busy = repo
    .listMentorCommitments(db, mentorProfileId, from)
    .map((row) => ({ startIso: row.scheduled_at, durationMin: row.duration_min }))

  // A student's own commitments elsewhere are excluded too, so the list they see
  // is actually bookable rather than offering times they will be refused for.
  if (studentUserId) {
    for (const row of repo.listStudentCommitments(db, studentUserId, from)) {
      busy.push({ startIso: row.scheduled_at, durationMin: row.duration_min })
    }
  }

  const windows = toAvailabilityWindows(repo.listAvailability(db, mentorProfileId))

  const offset = offsetMinutesFor(availability.timezoneLabel)
  const slots = generateSlots({
    windows,
    fromIso: from,
    toIso: to,
    durationMin: availability.sessionDurationMin,
    busy,
    offsetMinutes: offset,
  }).map((startsAt) => ({
    startsAt,
    endsAt: addMinutes(startsAt, availability.sessionDurationMin),
    label: `${formatSlotLabel(startsAt, offset)} ${availability.timezoneLabel}`.trim(),
    dateLabel: formatDisplayDate(startsAt, offset),
  }))

  return { slots, availability }
}

type Participants = {
  relationshipId: string
  mentorProfileId: string
  studentUserId: string
  mentorUserId: string
  mentorName: string
  studentName: string
}

function requireParticipant(db: Database, relationshipId: string, userId: string): Participants {
  const relationship = repo.findRelationshipForSession(db, relationshipId)
  if (!relationship) throw new NotFoundError('Mentorship not found.')

  if (relationship.student_user_id !== userId && relationship.mentor_user_id !== userId) {
    throw new ForbiddenError('You are not part of this mentorship.')
  }

  return {
    relationshipId: relationship.id,
    mentorProfileId: relationship.mentor_profile_id,
    studentUserId: relationship.student_user_id,
    mentorUserId: relationship.mentor_user_id,
    mentorName: relationship.mentor_name,
    studentName: relationship.student_name,
  }
}

/**
 * Validates a proposed time against availability and both diaries.
 * Shared by booking and rescheduling so the two cannot drift apart.
 */
function assertSlotBookable(
  db: Database,
  participants: Participants,
  scheduledAt: string,
  durationMin: number,
  options: { ignoreSessionId?: string } = {},
): void {
  const now = nowIso()
  if (scheduledAt <= now) {
    throw new BadRequestError('Pick a time in the future.')
  }

  const windows = toAvailabilityWindows(repo.listAvailability(db, participants.mentorProfileId))
  if (windows.length === 0) {
    throw new ConflictError(
      `${participants.mentorName} has not published any availability yet. Send them a message to agree a time.`,
    )
  }

  const offset = offsetMinutesFor(
    repo.findSchedulingPrefs(db, participants.mentorProfileId)?.timezone_label,
  )
  if (!isSlotAligned(scheduledAt, windows, durationMin, offset)) {
    throw new ConflictError(
      `That time is not one of ${participants.mentorName}'s open slots. Pick one from their availability.`,
    )
  }

  const endsAt = addMinutes(scheduledAt, durationMin)

  /**
   * Any commitment whose interval intersects the proposed one, ignoring the
   * session being rescheduled — which would otherwise clash with itself and make
   * every reschedule impossible.
   */
  const clashes = (commitments: repo.Commitment[]): boolean =>
    commitments.some((row) => {
      if (row.id === options.ignoreSessionId) return false
      const otherEnd = addMinutes(row.scheduled_at, row.duration_min)
      return scheduledAt < otherEnd && row.scheduled_at < endsAt
    })

  if (clashes(repo.listMentorCommitments(db, participants.mentorProfileId, now))) {
    throw new ConflictError('That slot has just been taken. Pick another.')
  }

  if (clashes(repo.listStudentCommitments(db, participants.studentUserId, now))) {
    throw new ConflictError('You already have a session booked at that time.')
  }
}

export function bookSession(
  db: Database,
  userId: string,
  input: BookSessionInput,
): SessionView {
  const participants = requireParticipant(db, input.relationshipId, userId)
  const prefs = repo.findSchedulingPrefs(db, participants.mentorProfileId)
  const durationMin = prefs?.session_duration_min ?? DEFAULT_DURATION

  assertSlotBookable(db, participants, input.scheduledAt, durationMin)

  const row = {
    id: newId('sess'),
    relationship_id: participants.relationshipId,
    mentor_profile_id: participants.mentorProfileId,
    student_user_id: participants.studentUserId,
    title: input.title,
    scheduled_at: input.scheduledAt,
    duration_min: durationMin,
    notes: input.notes ?? null,
    meeting_link: input.meetingLink ?? null,
    booked_by_user_id: userId,
    created_at: nowIso(),
  }

  try {
    transaction(db, () => {
      repo.insertSession(db, row)
      const created = repo.findSessionById(db, row.id)
      if (created) {
        tellCounterpart(db, userId, participants, created, {
          type: 'session.booked',
          title: (name) => `${name} booked a session with you`,
        })
      }
    })
  } catch (error) {
    // The unique indexes are the real guarantee; translate their violation into
    // the same message the pre-check gives rather than leaking a SQLite error.
    if (isUniqueViolation(error)) {
      throw new ConflictError('That slot has just been taken. Pick another.')
    }
    throw error
  }

  const created = repo.findSessionById(db, row.id)
  if (!created) throw new NotFoundError('Session could not be read back.')

  return toSessionView(created, userId)
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed/i.test(message)
}

export function listSessions(
  db: Database,
  userId: string,
  scope: 'all' | 'upcoming' | 'past',
): SessionView[] {
  const rows = repo.listSessionsForUser(db, userId, scope, nowIso())
  const ratings = repo.listRatingsBy(db, userId, rows.map((row) => row.id))
  return rows.map((row) => toSessionView(row, userId, ratings.get(row.id) ?? null))
}

/**
 * A one-tap rating after a held session (DESIGN_BACKLOG #33): quicker Tier-2
 * signal than the end-of-mentorship form. Participants only, once each, and
 * only for a session that happened.
 */
export function rateSession(
  db: Database,
  userId: string,
  sessionId: string,
  input: { rating: number; comment?: string },
): void {
  const row = repo.findSessionById(db, sessionId)
  if (!row) throw new NotFoundError('Session not found.')
  requireParticipant(db, row.relationship_id, userId)
  if (row.status !== 'completed') {
    throw new ConflictError('You can rate a session once it has been marked as held.')
  }

  try {
    repo.insertRating(db, {
      session_id: sessionId,
      user_id: userId,
      rating: input.rating,
      comment: input.comment ?? null,
      created_at: nowIso(),
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('You have already rated this session.')
    throw error
  }
}

export function updateSession(
  db: Database,
  userId: string,
  sessionId: string,
  input: UpdateSessionInput,
): SessionView {
  const existing = repo.findSessionById(db, sessionId)
  if (!existing) throw new NotFoundError('Session not found.')

  const participants = requireParticipant(db, existing.relationship_id, userId)

  if (existing.status === 'cancelled') {
    throw new ConflictError('This session was cancelled. Book a new one instead.')
  }

  const rescheduling = input.scheduledAt !== undefined && input.scheduledAt !== existing.scheduled_at
  const changingStatus = input.status !== undefined && input.status !== existing.status

  // A held session is a record of something that happened. Moving it or
  // reopening it would rewrite the "sessions held" count that feedback and
  // Tier-2 training read; only its title and notes stay editable.
  if (existing.status === 'completed' && (rescheduling || changingStatus)) {
    throw new ConflictError('This session was already held and can no longer be changed.')
  }

  if (rescheduling) {
    // A slot that has passed is history, not a booking to move — the same rule
    // the UI applies with canModify. A missed session is cancelled or marked
    // held, and a new one booked.
    if (existing.scheduled_at <= nowIso()) {
      throw new ConflictError('This session has already passed. Book a new one instead.')
    }

    // Rescheduling revalidates against availability, exactly as a fresh booking
    // does — otherwise a PATCH would be a way around the rules a POST enforces.
    assertSlotBookable(db, participants, input.scheduledAt!, existing.duration_min, {
      ignoreSessionId: sessionId,
    })
  }

  if (input.status === 'completed') {
    // Marking something complete before it has happened is almost always a
    // misclick, and it would corrupt the "sessions held" figure feedback reports.
    // Checked against the time the session will have after this update, so a
    // reschedule cannot be combined with "completed" to skip the check.
    const effectiveTime = input.scheduledAt ?? existing.scheduled_at
    if (effectiveTime > nowIso()) {
      throw new BadRequestError('This session has not happened yet.')
    }
  }

  // A cancelled session was refused above, so this is always a real change.
  const cancelling = input.status === 'cancelled'

  const updated = transaction(db, () => {
    const changed = repo.updateSession(db, sessionId, {
      status: input.status,
      scheduled_at: input.scheduledAt,
      title: input.title,
      notes: input.notes,
      cancelled_reason: input.status === 'cancelled' ? (input.cancelledReason ?? null) : undefined,
      meeting_link: input.meetingLink === undefined ? undefined : input.meetingLink || null,
      // A moved session is reminded again at its new time.
      reminder_sent_at: rescheduling ? null : undefined,
    })
    if (changed === 0) throw new NotFoundError('Session not found.')

    const row = repo.findSessionById(db, sessionId)
    if (!row) throw new NotFoundError('Session not found.')

    if (cancelling) {
      tellCounterpart(db, userId, participants, row, {
        type: 'session.cancelled',
        title: (name) => `${name} cancelled a session`,
        body: input.cancelledReason ?? null,
      })
    } else if (rescheduling) {
      tellCounterpart(db, userId, participants, row, {
        type: 'session.rescheduled',
        title: (name) => `${name} moved a session`,
      })
    }
    return row
  })

  return toSessionView(updated, userId)
}

function toSessionView(row: repo.SessionRow, viewerId: string, myRating: number | null = null): SessionView {
  const timezoneLabel = row.mentor_timezone ?? DEFAULT_TIMEZONE
  const offset = offsetMinutesFor(timezoneLabel)

  return {
    id: row.id,
    relationshipId: row.relationship_id,
    mentorProfileId: row.mentor_profile_id,
    title: row.title,
    scheduledAt: row.scheduled_at,
    endsAt: addMinutes(row.scheduled_at, row.duration_min),
    durationMin: row.duration_min,
    slotLabel: `${formatSlotLabel(row.scheduled_at, offset)} ${timezoneLabel}`.trim(),
    dateLabel: formatDisplayDate(row.scheduled_at, offset),
    timezoneLabel,
    status: row.status,
    notes: row.notes,
    cancelledReason: row.cancelled_reason,
    mentorName: row.mentor_name,
    studentName: row.student_name,
    meetingLink: row.meeting_link,
    // Downloadable .ics for the viewer's own calendar (DESIGN_BACKLOG #39).
    calendarUrl: `/api/scheduling/sessions/${encodeURIComponent(row.id)}/calendar.ics`,
    myRating,
    bookedByMe: row.booked_by_user_id === viewerId,
    canModify: row.status === 'upcoming' && row.scheduled_at > nowIso(),
  }
}

/** Where a session notification takes each side. */
function sessionsLinkFor(userId: string, participants: Participants): string {
  return userId === participants.studentUserId ? '/student/my-sessions' : '/alumni/availability'
}

function describeSession(row: repo.SessionRow): string {
  const label = row.mentor_timezone ?? DEFAULT_TIMEZONE
  const offset = offsetMinutesFor(label)
  return `${row.title} · ${formatDisplayDate(row.scheduled_at, offset)}, ${formatSlotLabel(row.scheduled_at, offset)} ${label}`
}

/**
 * Tells the other participant what the actor did to a session, and nudges both
 * sides' open pages to refresh their session lists.
 */
function tellCounterpart(
  db: Database,
  actorId: string,
  participants: Participants,
  row: repo.SessionRow,
  message: { type: NotificationType; title: (actorName: string) => string; body?: string | null },
): void {
  const actorIsStudent = actorId === participants.studentUserId
  const recipientId = actorIsStudent ? participants.mentorUserId : participants.studentUserId
  const actorName = actorIsStudent ? participants.studentName : participants.mentorName

  notify(db, {
    userId: recipientId,
    type: message.type,
    title: message.title(actorName),
    body: message.body ? `${describeSession(row)} — “${message.body}”` : describeSession(row),
    link: sessionsLinkFor(recipientId, participants),
  })
  publish(actorId, { type: 'sessions' })
  publish(recipientId, { type: 'sessions' })
}

/** How far ahead a session is reminded (DESIGN_BACKLOG #40). */
export const REMINDER_WINDOW_HOURS = 24

/**
 * Reminds both participants of every session starting within the next day,
 * once each. Run by the lifecycle sweep inside its transaction, so it opens
 * none of its own. A session booked less than a day ahead is reminded on the
 * next sweep.
 */
export function sendSessionReminders(db: Database, now: string = nowIso()): number {
  const until = new Date(new Date(now).getTime() + REMINDER_WINDOW_HOURS * 3_600_000).toISOString()
  const due = repo.listSessionsDueForReminder(db, now, until)

  for (const row of due) {
    const studentId = row.student_user_id
    for (const [userId, otherName, link] of [
      [row.mentor_user_id, row.student_name, '/alumni/availability'],
      [studentId, row.mentor_name, '/student/my-sessions'],
    ] as const) {
      if (!userId) continue
      notify(db, {
        userId,
        type: 'session.reminder',
        title: `Coming up: your session with ${otherName}`,
        body: row.meeting_link ? `${describeSession(row)} · ${row.meeting_link}` : describeSession(row),
        link,
      })
    }
    repo.markReminded(db, row.id, now)
  }

  return due.length
}

/** A session as an .ics file, for either participant's own calendar. */
export function sessionCalendar(
  db: Database,
  userId: string,
  sessionId: string,
): { fileName: string; body: string } {
  const row = repo.findSessionById(db, sessionId)
  if (!row) throw new NotFoundError('Session not found.')
  const participants = requireParticipant(db, row.relationship_id, userId)

  const otherName = userId === participants.studentUserId ? row.mentor_name : row.student_name
  const summary = `${row.title} with ${otherName}`

  return {
    fileName: calendarFileName(summary),
    body: buildCalendar({
      uid: row.id,
      start: row.scheduled_at,
      end: addMinutes(row.scheduled_at, row.duration_min),
      summary,
      description: [row.notes, row.meeting_link ? `Join: ${row.meeting_link}` : null]
        .filter(Boolean)
        .join('\n\n'),
      location: row.meeting_link,
      url: row.meeting_link,
      cancelled: row.status === 'cancelled',
    }),
  }
}
