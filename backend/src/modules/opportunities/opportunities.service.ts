/**
 * Opportunities: jobs, internships and volunteering posted by alumni.
 *
 * Any verified alumnus may post one (ROADMAP D5) — sharing an opening is not a
 * mentoring act, so it is not tied to a mentor profile. Students see open ones
 * on a feed and apply; the poster sees who applied. Applications were recorded
 * before this module existed, but nobody could ever read them.
 */
import { type Database, transaction } from '../../db/connection.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { notify } from '../../lib/notifications.js'
import { DEFAULT_TIMEZONE, nowIso, offsetMinutesFor, wallClockToIso } from '../../lib/time.js'
import { z } from 'zod'

export const opportunitySchema = z.object({
  title: z.string().trim().min(2).max(160),
  type: z.enum(['Internship', 'Full-time', 'Volunteer']),
  location: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  closesAt: z
    .string()
    .datetime()
    .transform((value) => new Date(value).toISOString())
    .optional(),
  /**
   * The application deadline as a person picks it: a date. Applications close
   * at the end of that day in East Africa Time, the platform's own clock.
   */
  closesOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a closing date.')
    .optional(),
})

export const feedQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.enum(['Internship', 'Full-time', 'Volunteer']).optional(),
})

export const applicationSchema = z.object({
  message: z.string().trim().max(1000).optional(),
})

export type OpportunityInput = z.infer<typeof opportunitySchema>

export type OpportunityView = {
  id: string
  title: string
  type: 'Internship' | 'Full-time' | 'Volunteer'
  location: string | null
  description: string | null
  postedAt: string
  closesAt: string | null
  postedBy: { userId: string; name: string; mentorProfileId: string | null }
  /** Whether the viewer has applied. */
  applied: boolean
  applicantCount: number
}

export type ApplicantView = {
  userId: string
  name: string
  email: string
  message: string | null
  appliedAt: string
}

type OpportunityQueryRow = {
  id: string
  title: string
  type: OpportunityView['type']
  location: string | null
  description: string | null
  posted_at: string
  closes_at: string | null
  posted_by_user_id: string
  poster_name: string
  poster_mentor_profile_id: string | null
  applied: number
  applicant_count: number
}

const OPPORTUNITY_SELECT = `
  SELECT o.id, o.title, o.type, o.location, o.description, o.posted_at, o.closes_at,
         o.posted_by_user_id, u.name AS poster_name, mp.id AS poster_mentor_profile_id,
         EXISTS (SELECT 1 FROM opportunity_applications a
                 WHERE a.opportunity_id = o.id AND a.user_id = ?) AS applied,
         (SELECT COUNT(*) FROM opportunity_applications a2 WHERE a2.opportunity_id = o.id) AS applicant_count
  FROM mentor_opportunities o
  JOIN users u ON u.id = o.posted_by_user_id
  LEFT JOIN mentor_profiles mp ON mp.user_id = o.posted_by_user_id
`

function toView(row: OpportunityQueryRow): OpportunityView {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    location: row.location,
    description: row.description,
    postedAt: row.posted_at,
    closesAt: row.closes_at,
    postedBy: {
      userId: row.posted_by_user_id,
      name: row.poster_name,
      mentorProfileId: row.poster_mentor_profile_id,
    },
    applied: row.applied === 1,
    applicantCount: row.applicant_count,
  }
}

function isOpen(closesAt: string | null, now: string): boolean {
  return closesAt === null || closesAt > now
}

/**
 * The board (DESIGN_BACKLOG #38): every open opportunity from an active poster,
 * newest first, optionally narrowed by type and a text search over the title,
 * description, location and poster's name.
 */
export function listOpen(
  db: Database,
  viewerId: string,
  filters: { q?: string; type?: string } = {},
  limit = 100,
): OpportunityView[] {
  const conditions = ['(o.closes_at IS NULL OR o.closes_at > ?)', "u.status = 'active'"]
  const params: (string | number)[] = [viewerId, nowIso()]

  if (filters.type) {
    conditions.push('o.type = ?')
    params.push(filters.type)
  }
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    conditions.push(
      `(o.title LIKE ? ESCAPE '\\' OR o.description LIKE ? ESCAPE '\\'
        OR o.location LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')`,
    )
    params.push(like, like, like, like)
  }

  params.push(limit)
  return queryAll<OpportunityQueryRow>(
    db,
    `${OPPORTUNITY_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY o.posted_at DESC LIMIT ?`,
    params,
  ).map(toView)
}

/** Everything the viewer has posted, open or closed. */
export function listMine(db: Database, userId: string): OpportunityView[] {
  return queryAll<OpportunityQueryRow>(
    db,
    `${OPPORTUNITY_SELECT} WHERE o.posted_by_user_id = ? ORDER BY o.posted_at DESC`,
    [userId, userId],
  ).map(toView)
}

export function post(db: Database, userId: string, input: OpportunityInput): OpportunityView {
  const closesAt = input.closesOn
    ? wallClockToIso(`${input.closesOn}T23:59`, offsetMinutesFor(DEFAULT_TIMEZONE))
    : (input.closesAt ?? null)
  if (input.closesOn && !closesAt) throw new BadRequestError('That closing date does not exist.')
  if (closesAt && closesAt <= nowIso()) throw new BadRequestError('The closing date must be in the future.')

  const mentor = queryOne<{ id: string }>(db, 'SELECT id FROM mentor_profiles WHERE user_id = ?', [
    userId,
  ])
  const id = newId('opp')

  execute(
    db,
    `INSERT INTO mentor_opportunities
       (id, posted_by_user_id, mentor_profile_id, title, type, location, description, posted_at, closes_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      mentor?.id ?? null,
      input.title,
      input.type,
      input.location ?? null,
      input.description ?? null,
      nowIso(),
      closesAt,
    ],
  )

  return findView(db, id, userId)
}

function findView(db: Database, id: string, viewerId: string): OpportunityView {
  const row = queryOne<OpportunityQueryRow>(db, `${OPPORTUNITY_SELECT} WHERE o.id = ?`, [viewerId, id])
  if (!row) throw new NotFoundError('Opportunity not found.')
  return toView(row)
}

function requireOwn(db: Database, id: string, userId: string): { closes_at: string | null } {
  const row = queryOne<{ posted_by_user_id: string; closes_at: string | null }>(
    db,
    'SELECT posted_by_user_id, closes_at FROM mentor_opportunities WHERE id = ?',
    [id],
  )
  // 404 rather than 403 for someone else's: the applicant list is private.
  if (!row || row.posted_by_user_id !== userId) throw new NotFoundError('Opportunity not found.')
  return row
}

/** Stops new applications. The listing and its applicants remain for the poster. */
export function close(db: Database, userId: string, id: string): OpportunityView {
  const row = requireOwn(db, id, userId)
  const now = nowIso()
  if (!isOpen(row.closes_at, now)) throw new ConflictError('This opportunity is already closed.')

  execute(db, 'UPDATE mentor_opportunities SET closes_at = ? WHERE id = ?', [now, id])
  return findView(db, id, userId)
}

export function listApplicants(db: Database, userId: string, id: string): ApplicantView[] {
  requireOwn(db, id, userId)

  return queryAll<{ user_id: string; name: string; email: string; message: string | null; created_at: string }>(
    db,
    `SELECT a.user_id, u.name, u.email, a.message, a.created_at
     FROM opportunity_applications a
     JOIN users u ON u.id = a.user_id
     WHERE a.opportunity_id = ?
     ORDER BY a.created_at ASC`,
    [id],
  ).map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    message: row.message,
    appliedAt: row.created_at,
  }))
}

export function apply(db: Database, userId: string, id: string, message: string | undefined): void {
  const row = queryOne<{ posted_by_user_id: string; closes_at: string | null }>(
    db,
    'SELECT posted_by_user_id, closes_at FROM mentor_opportunities WHERE id = ?',
    [id],
  )
  if (!row) throw new NotFoundError('Opportunity not found.')
  if (row.posted_by_user_id === userId) throw new ForbiddenError('You cannot apply to your own opportunity.')
  if (!isOpen(row.closes_at, nowIso())) throw new ConflictError('Applications for this opportunity have closed.')

  try {
    transaction(db, () => {
      execute(
        db,
        `INSERT INTO opportunity_applications (id, opportunity_id, user_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [newId('app'), id, userId, message ?? null, nowIso()],
      )
      const detail = queryOne<{ title: string; applicant: string }>(
        db,
        `SELECT o.title, u.name AS applicant FROM mentor_opportunities o, users u
         WHERE o.id = ? AND u.id = ?`,
        [id, userId],
      )
      notify(db, {
        userId: row.posted_by_user_id,
        type: 'opportunity.application',
        title: `${detail?.applicant ?? 'A student'} applied for ${detail?.title ?? 'your opportunity'}`,
        body: message ?? null,
        link: '/alumni/opportunities',
      })
    })
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new ConflictError('You have already applied to this opportunity.')
    }
    throw error
  }
}
