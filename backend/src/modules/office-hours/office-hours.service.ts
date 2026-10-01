/**
 * Office hours (DESIGN_BACKLOG #36): one mentor, one time, several students.
 *
 * Mentors are the scarce side — each can take only a handful of mentees — so a
 * group slot open to any student stretches their time further than one-to-one
 * capacity allows. An office hour counts as a commitment for the mentor and
 * for each student who joins (scheduling.repository), so neither can be
 * double-booked against it.
 */
import { z } from 'zod'

import { type Database, transaction } from '../../db/connection.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import { avatarUrl } from '../../lib/avatars.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { notify } from '../../lib/notifications.js'
import {
  DEFAULT_TIMEZONE,
  formatDisplayDate,
  formatSlotLabel,
  nowIso,
  offsetMinutesFor,
  wallClockToIso,
} from '../../lib/time.js'
import * as scheduling from '../scheduling/scheduling.repository.js'

export const officeHourSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  /** Wall clock in the mentor's own timezone, like their availability. */
  startsAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a date and time.'),
  durationMin: z.coerce.number().int().min(15).max(240),
  capacity: z.coerce.number().int().min(2).max(50),
  meetingLink: z
    .string()
    .trim()
    .max(500)
    .url('Enter the full meeting link, starting with https://')
    .refine((value) => /^https?:\/\//i.test(value), 'Meeting links must start with https://')
    .optional(),
})

export type OfficeHourInput = z.infer<typeof officeHourSchema>

export type OfficeHourView = {
  id: string
  mentorProfileId: string
  mentorName: string
  mentorAvatarUrl: string | null
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  dateLabel: string
  timeLabel: string
  durationMin: number
  capacity: number
  attendeeCount: number
  spotsLeft: number
  joined: boolean
  isHost: boolean
  cancelled: boolean
  /** Shown only to the host and to students who have joined. */
  meetingLink: string | null
}

type OfficeHourRow = {
  id: string
  mentor_profile_id: string
  mentor_user_id: string
  mentor_name: string
  mentor_avatar_at: string | null
  timezone_label: string | null
  title: string
  description: string | null
  starts_at: string
  duration_min: number
  capacity: number
  meeting_link: string | null
  cancelled_at: string | null
  attendee_count: number
  joined: number
}

const SELECT = `
  SELECT o.*, mp.user_id AS mentor_user_id, mp.timezone_label, u.name AS mentor_name,
         u.avatar_updated_at AS mentor_avatar_at,
         (SELECT COUNT(*) FROM office_hour_bookings b WHERE b.office_hour_id = o.id) AS attendee_count,
         EXISTS (SELECT 1 FROM office_hour_bookings b2
                 WHERE b2.office_hour_id = o.id AND b2.student_user_id = ?) AS joined
  FROM office_hours o
  JOIN mentor_profiles mp ON mp.id = o.mentor_profile_id
  JOIN users u ON u.id = mp.user_id
`

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

function toView(row: OfficeHourRow, viewerId: string): OfficeHourView {
  const label = row.timezone_label ?? DEFAULT_TIMEZONE
  const offset = offsetMinutesFor(label)
  const isHost = row.mentor_user_id === viewerId
  const joined = row.joined === 1

  return {
    id: row.id,
    mentorProfileId: row.mentor_profile_id,
    mentorName: row.mentor_name,
    mentorAvatarUrl: avatarUrl(row.mentor_user_id, row.mentor_avatar_at),
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: addMinutes(row.starts_at, row.duration_min),
    dateLabel: formatDisplayDate(row.starts_at, offset),
    timeLabel: `${formatSlotLabel(row.starts_at, offset)} ${label}`,
    durationMin: row.duration_min,
    capacity: row.capacity,
    attendeeCount: row.attendee_count,
    spotsLeft: Math.max(0, row.capacity - row.attendee_count),
    joined,
    isHost,
    cancelled: row.cancelled_at !== null,
    meetingLink: isHost || joined ? row.meeting_link : null,
  }
}

function find(db: Database, id: string, viewerId: string): OfficeHourRow {
  const row = queryOne<OfficeHourRow>(db, `${SELECT} WHERE o.id = ?`, [viewerId, id])
  if (!row) throw new NotFoundError('Office hour not found.')
  return row
}

function clashes(commitments: scheduling.Commitment[], startsAt: string, durationMin: number, ignoreId?: string): boolean {
  const start = new Date(startsAt).getTime()
  const end = start + durationMin * 60_000
  return commitments.some((item) => {
    if (item.id === ignoreId) return false
    const otherStart = new Date(item.scheduled_at).getTime()
    return start < otherStart + item.duration_min * 60_000 && otherStart < end
  })
}

/** Upcoming office hours across all mentors, soonest first. */
export function listUpcoming(db: Database, viewerId: string, mentorProfileId?: string): OfficeHourView[] {
  const params: string[] = [viewerId, nowIso()]
  let filter = ''
  if (mentorProfileId) {
    filter = 'AND o.mentor_profile_id = ?'
    params.push(mentorProfileId)
  }
  return queryAll<OfficeHourRow>(
    db,
    `${SELECT} WHERE o.cancelled_at IS NULL AND o.starts_at >= ? AND u.status = 'active' ${filter}
     ORDER BY o.starts_at ASC LIMIT 50`,
    params,
  ).map((row) => toView(row, viewerId))
}

/** A mentor's own office hours, upcoming first, each with who has joined. */
export function listMine(
  db: Database,
  mentorUserId: string,
): Array<OfficeHourView & { attendees: Array<{ userId: string; name: string; avatarUrl: string | null }> }> {
  const rows = queryAll<OfficeHourRow>(
    db,
    `${SELECT} WHERE mp.user_id = ? ORDER BY o.starts_at DESC LIMIT 50`,
    [mentorUserId, mentorUserId],
  )
  return rows.map((row) => ({
    ...toView(row, mentorUserId),
    attendees: queryAll<{ id: string; name: string; avatar_updated_at: string | null }>(
      db,
      `SELECT u.id, u.name, u.avatar_updated_at FROM office_hour_bookings b
       JOIN users u ON u.id = b.student_user_id
       WHERE b.office_hour_id = ? ORDER BY b.created_at`,
      [row.id],
    ).map((user) => ({ userId: user.id, name: user.name, avatarUrl: avatarUrl(user.id, user.avatar_updated_at) })),
  }))
}

export function create(db: Database, mentorUserId: string, input: OfficeHourInput): OfficeHourView {
  const mentor = queryOne<{ id: string; timezone_label: string | null }>(
    db,
    'SELECT id, timezone_label FROM mentor_profiles WHERE user_id = ?',
    [mentorUserId],
  )
  if (!mentor) throw new ForbiddenError('Only mentors can host office hours.')

  const startsAt = wallClockToIso(input.startsAt, offsetMinutesFor(mentor.timezone_label ?? DEFAULT_TIMEZONE))
  if (!startsAt) throw new BadRequestError('That date does not exist.')
  if (startsAt <= nowIso()) throw new BadRequestError('Schedule office hours in the future.')

  if (clashes(scheduling.listMentorCommitments(db, mentor.id, nowIso()), startsAt, input.durationMin)) {
    throw new ConflictError('You already have a session or office hour at that time.')
  }

  const id = newId('oh')
  execute(
    db,
    `INSERT INTO office_hours (id, mentor_profile_id, title, description, starts_at, duration_min, capacity,
                               meeting_link, cancelled_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [id, mentor.id, input.title, input.description ?? null, startsAt, input.durationMin, input.capacity,
     input.meetingLink ?? null, nowIso()],
  )
  return toView(find(db, id, mentorUserId), mentorUserId)
}

export function join(db: Database, studentUserId: string, id: string): OfficeHourView {
  const row = find(db, id, studentUserId)
  if (row.cancelled_at) throw new ConflictError('This office hour was cancelled.')
  if (row.starts_at <= nowIso()) throw new ConflictError('This office hour has already started.')
  if (row.joined === 1) throw new ConflictError('You have already joined.')
  if (row.attendee_count >= row.capacity) throw new ConflictError('This office hour is full.')
  if (clashes(scheduling.listStudentCommitments(db, studentUserId, nowIso()), row.starts_at, row.duration_min)) {
    throw new ConflictError('You already have a session at that time.')
  }

  transaction(db, () => {
    execute(
      db,
      'INSERT INTO office_hour_bookings (office_hour_id, student_user_id, created_at) VALUES (?, ?, ?)',
      [id, studentUserId, nowIso()],
    )
    const student = queryOne<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', [studentUserId])
    notify(db, {
      userId: row.mentor_user_id,
      type: 'officehour.joined',
      title: `${student?.name ?? 'A student'} joined “${row.title}”`,
      body: `${row.attendee_count + 1} of ${row.capacity} places taken.`,
      link: '/alumni/availability',
      // One unread notification per office hour, however many join.
      groupKey: `office-hour:${id}`,
    })
  })

  return toView(find(db, id, studentUserId), studentUserId)
}

export function leave(db: Database, studentUserId: string, id: string): OfficeHourView {
  const row = find(db, id, studentUserId)
  if (row.joined !== 1) throw new ConflictError('You have not joined this office hour.')
  execute(db, 'DELETE FROM office_hour_bookings WHERE office_hour_id = ? AND student_user_id = ?', [
    id,
    studentUserId,
  ])
  return toView(find(db, id, studentUserId), studentUserId)
}

/** The host cancels; everyone who joined is told. */
export function cancel(db: Database, mentorUserId: string, id: string): OfficeHourView {
  const row = find(db, id, mentorUserId)
  // Someone else's office hour is simply not found.
  if (row.mentor_user_id !== mentorUserId) throw new NotFoundError('Office hour not found.')
  if (row.cancelled_at) throw new ConflictError('This office hour is already cancelled.')

  transaction(db, () => {
    execute(db, 'UPDATE office_hours SET cancelled_at = ? WHERE id = ?', [nowIso(), id])
    const attendees = queryAll<{ student_user_id: string }>(
      db,
      'SELECT student_user_id FROM office_hour_bookings WHERE office_hour_id = ?',
      [id],
    )
    for (const { student_user_id: userId } of attendees) {
      notify(db, {
        userId,
        type: 'officehour.cancelled',
        title: `${row.mentor_name} cancelled “${row.title}”`,
        body: toView(row, userId).timeLabel,
        link: '/student/my-sessions',
      })
    }
  })

  return toView(find(db, id, mentorUserId), mentorUserId)
}
