import type { Database } from '../../db/connection.js'
import { execute, queryAll, queryOne, queryScalar } from '../../db/repository.js'
import type { Availability, Cadence, FormatPreference } from '../../types/domain.js'

export type MentorProfileRow = {
  id: string
  user_id: string
  name: string
  email: string
  headline: string
  company: string
  industry: string
  location: string
  bio: string | null
  capacity: number
  availability: Availability
  cadence: Cadence | null
  format_pref: FormatPreference | null
  ml_person_id: string | null
  avatar_updated_at: string | null
  major: string
  hobbies: string
  unique_quality: string
  country: string
  state_province: string
  created_at: string
  updated_at: string
}

export type MentorSearchFilters = {
  query?: string
  industry?: string
  track?: string
  availableOnly?: boolean
  limit: number
  offset: number
}

/**
 * Base projection joining the mentor profile to its owning user.
 *
 * The mock data had no join key at all between an alumnus and their mentor row
 * — AlumniDashboardPage matched them by display name — so this join is the
 * thing that makes "my mentor profile" a well-defined question.
 */
const BASE_SELECT = `
  SELECT mp.id, mp.user_id, u.name, u.email, u.avatar_updated_at, mp.headline, mp.company, mp.industry,
         mp.location, mp.bio, mp.capacity, mp.availability, mp.cadence,
         mp.format_pref, mp.ml_person_id, mp.major, mp.hobbies, mp.unique_quality,
         mp.country, mp.state_province, mp.created_at, mp.updated_at
  FROM mentor_profiles mp
  JOIN users u ON u.id = mp.user_id
`

/**
 * Builds the WHERE clause for a search.
 *
 * Every user-supplied value becomes a bound parameter — the LIKE patterns are
 * built around `?` rather than interpolated — so a `q` of `%' OR 1=1 --` is
 * matched as literal text instead of being parsed as SQL.
 */
function buildSearchClause(filters: MentorSearchFilters): {
  where: string
  params: (string | number)[]
} {
  // Only active accounts are discoverable. A pending (unverified) alumnus cannot
  // act on a request, and a suspended one must not be offered at all.
  const conditions: string[] = ["u.status = 'active'"]
  const params: (string | number)[] = []

  if (filters.query) {
    conditions.push(`(
      u.name LIKE ? COLLATE NOCASE
      OR mp.company LIKE ? COLLATE NOCASE
      OR EXISTS (
        SELECT 1 FROM mentor_skills ms
        WHERE ms.mentor_profile_id = mp.id AND ms.skill LIKE ? COLLATE NOCASE
      )
    )`)
    const pattern = `%${filters.query}%`
    params.push(pattern, pattern, pattern)
  }

  if (filters.industry) {
    conditions.push('mp.industry = ?')
    params.push(filters.industry)
  }

  if (filters.track) {
    conditions.push(
      'EXISTS (SELECT 1 FROM mentor_tracks mt WHERE mt.mentor_profile_id = mp.id AND mt.track = ?)',
    )
    params.push(filters.track)
  }

  if (filters.availableOnly) {
    conditions.push("mp.availability = 'Available'")
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params }
}

export function searchMentors(
  db: Database,
  filters: MentorSearchFilters,
): { items: MentorProfileRow[]; total: number } {
  const { where, params } = buildSearchClause(filters)

  const total =
    queryScalar<number>(
      db,
      `SELECT COUNT(*) AS count FROM mentor_profiles mp JOIN users u ON u.id = mp.user_id ${where}`,
      params,
    ) ?? 0

  const items = queryAll<MentorProfileRow>(
    db,
    `${BASE_SELECT} ${where} ORDER BY u.name ASC LIMIT ? OFFSET ?`,
    [...params, filters.limit, filters.offset],
  )

  return { items, total }
}

/** Distinct industries, for the search page's filter dropdown. */
export function listIndustries(db: Database): string[] {
  return queryAll<{ industry: string }>(
    db,
    "SELECT DISTINCT industry FROM mentor_profiles WHERE industry != '' ORDER BY industry ASC",
  ).map((row) => row.industry)
}

export function findMentorById(db: Database, id: string): MentorProfileRow | null {
  return queryOne<MentorProfileRow>(db, `${BASE_SELECT} WHERE mp.id = ?`, [id])
}

export function findMentorByUserId(db: Database, userId: string): MentorProfileRow | null {
  return queryOne<MentorProfileRow>(db, `${BASE_SELECT} WHERE mp.user_id = ?`, [userId])
}

export function findMentorsByIds(db: Database, ids: string[]): MentorProfileRow[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  return queryAll<MentorProfileRow>(db, `${BASE_SELECT} WHERE mp.id IN (${placeholders})`, ids)
}

export function findMentorByMlPersonId(db: Database, mlPersonId: string): MentorProfileRow | null {
  return queryOne<MentorProfileRow>(db, `${BASE_SELECT} WHERE mp.ml_person_id = ?`, [mlPersonId])
}

// --- Child collections -----------------------------------------------------

export function listCertifications(db: Database, mentorProfileId: string): string[] {
  return queryAll<{ name: string }>(
    db,
    'SELECT name FROM mentor_certifications WHERE mentor_profile_id = ? ORDER BY position, name',
    [mentorProfileId],
  ).map((row) => row.name)
}

export type TimelineRow = {
  year: string
  title: string
  org: string
  description: string | null
}

export function listTimeline(db: Database, mentorProfileId: string): TimelineRow[] {
  return queryAll<TimelineRow>(
    db,
    'SELECT year, title, org, description FROM mentor_timeline WHERE mentor_profile_id = ? ORDER BY position',
    [mentorProfileId],
  )
}

export type OpportunityRow = {
  id: string
  posted_by_user_id: string
  mentor_profile_id: string | null
  title: string
  type: 'Internship' | 'Full-time' | 'Volunteer'
  location: string | null
  description: string | null
  posted_at: string
  closes_at: string | null
}

/** What a poster has open, for their mentor profile. Closed ones drop off. */
export function listOpenOpportunitiesByPoster(db: Database, userId: string): OpportunityRow[] {
  return queryAll<OpportunityRow>(
    db,
    `SELECT * FROM mentor_opportunities
     WHERE posted_by_user_id = ? AND (closes_at IS NULL OR closes_at > ?)
     ORDER BY posted_at DESC`,
    [userId, new Date().toISOString()],
  )
}

// --- Capacity --------------------------------------------------------------

/**
 * Remaining capacity = self-reported capacity minus active relationships
 * (DESIGN_BACKLOG #2). Derived rather than stored so it can never drift out of
 * sync with the relationships that consume it.
 */
export function getRemainingCapacity(db: Database, mentorProfileId: string): number {
  const row = queryOne<{ remaining: number }>(
    db,
    `SELECT mp.capacity - (
       SELECT COUNT(*) FROM mentorship_relationships mr
       WHERE mr.mentor_profile_id = mp.id AND mr.status = 'active'
     ) AS remaining
     FROM mentor_profiles mp WHERE mp.id = ?`,
    [mentorProfileId],
  )
  return row?.remaining ?? 0
}

/**
 * Remaining capacity for every mentor in one query, keyed by mentor profile id.
 * For callers that need it across the whole directory — per-mentor lookups
 * there cost one query each, ~300 per recommendation request.
 */
export function getRemainingCapacityById(db: Database): Map<string, number> {
  const rows = queryAll<{ id: string; remaining: number }>(
    db,
    `SELECT mp.id, mp.capacity - COUNT(mr.id) AS remaining
     FROM mentor_profiles mp
     LEFT JOIN mentorship_relationships mr
       ON mr.mentor_profile_id = mp.id AND mr.status = 'active'
     GROUP BY mp.id`,
  )
  return new Map(rows.map((row) => [row.id, Math.max(0, row.remaining)]))
}

/** Every mentor's tracks in one query, keyed by mentor profile id. */
export function getTracksById(db: Database): Map<string, string[]> {
  const tracks = new Map<string, string[]>()
  const rows = queryAll<{ mentor_profile_id: string; track: string }>(
    db,
    'SELECT mentor_profile_id, track FROM mentor_tracks ORDER BY track',
  )
  for (const row of rows) {
    const list = tracks.get(row.mentor_profile_id)
    if (list) list.push(row.track)
    else tracks.set(row.mentor_profile_id, [row.track])
  }
  return tracks
}

/**
 * Skills, tracks and remaining capacity for a set of mentors, three queries in
 * all (DESIGN_BACKLOG #18). Listing a page of mentors one at a time cost three
 * queries per mentor — ~72 for a page of 24.
 */
export type MentorExtras = { skills: Map<string, string[]>; tracks: Map<string, string[]>; remaining: Map<string, number> }

export function loadMentorExtras(db: Database, mentorProfileIds: string[]): MentorExtras {
  const extras: MentorExtras = { skills: new Map(), tracks: new Map(), remaining: new Map() }
  if (mentorProfileIds.length === 0) return extras
  const placeholders = mentorProfileIds.map(() => '?').join(', ')

  const group = (target: Map<string, string[]>, key: string, value: string) => {
    const list = target.get(key)
    if (list) list.push(value)
    else target.set(key, [value])
  }
  for (const row of queryAll<{ mentor_profile_id: string; skill: string }>(
    db,
    `SELECT mentor_profile_id, skill FROM mentor_skills WHERE mentor_profile_id IN (${placeholders}) ORDER BY skill`,
    mentorProfileIds,
  )) {
    group(extras.skills, row.mentor_profile_id, row.skill)
  }
  for (const row of queryAll<{ mentor_profile_id: string; track: string }>(
    db,
    `SELECT mentor_profile_id, track FROM mentor_tracks WHERE mentor_profile_id IN (${placeholders}) ORDER BY track`,
    mentorProfileIds,
  )) {
    group(extras.tracks, row.mentor_profile_id, row.track)
  }
  for (const row of queryAll<{ id: string; remaining: number }>(
    db,
    `SELECT mp.id, mp.capacity - COUNT(mr.id) AS remaining
     FROM mentor_profiles mp
     LEFT JOIN mentorship_relationships mr ON mr.mentor_profile_id = mp.id AND mr.status = 'active'
     WHERE mp.id IN (${placeholders})
     GROUP BY mp.id`,
    mentorProfileIds,
  )) {
    extras.remaining.set(row.id, row.remaining)
  }
  return extras
}

// --- Writes ----------------------------------------------------------------

export type UpsertMentorProfileInput = {
  id: string
  user_id: string
  headline: string
  company: string
  industry: string
  location: string
  bio: string | null
  capacity: number
  availability: Availability
  cadence: Cadence | null
  format_pref: FormatPreference | null
  ml_person_id: string | null
  major: string
  hobbies: string
  unique_quality: string
  country: string
  state_province: string
  created_at: string
  updated_at: string
}

export function insertMentorProfile(db: Database, row: UpsertMentorProfileInput): void {
  execute(
    db,
    `INSERT INTO mentor_profiles
       (id, user_id, headline, company, industry, location, bio, capacity, availability,
        cadence, format_pref, ml_person_id, major, hobbies, unique_quality, country,
        state_province, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.user_id,
      row.headline,
      row.company,
      row.industry,
      row.location,
      row.bio,
      row.capacity,
      row.availability,
      row.cadence,
      row.format_pref,
      row.ml_person_id,
      row.major,
      row.hobbies,
      row.unique_quality,
      row.country,
      row.state_province,
      row.created_at,
      row.updated_at,
    ],
  )
}

export function updateMentorProfile(
  db: Database,
  id: string,
  patch: Partial<
    Pick<
      UpsertMentorProfileInput,
      | 'headline'
      | 'company'
      | 'industry'
      | 'location'
      | 'bio'
      | 'capacity'
      | 'availability'
      | 'cadence'
      | 'format_pref'
      | 'major'
      | 'hobbies'
      | 'unique_quality'
      | 'country'
      | 'state_province'
    >
  >,
): void {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return

  // Column names come from this module's own literal keys, never from request
  // data; only the values are user-supplied and those are bound.
  const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
  const values = entries.map(([, value]) => value as string | number)

  execute(db, `UPDATE mentor_profiles SET ${assignments}, updated_at = ? WHERE id = ?`, [
    ...values,
    new Date().toISOString(),
    id,
  ])
}

export function replaceSkills(db: Database, mentorProfileId: string, skills: string[]): void {
  execute(db, 'DELETE FROM mentor_skills WHERE mentor_profile_id = ?', [mentorProfileId])
  for (const skill of skills) {
    execute(db, 'INSERT OR IGNORE INTO mentor_skills (mentor_profile_id, skill) VALUES (?, ?)', [
      mentorProfileId,
      skill,
    ])
  }
}

export function replaceTracks(db: Database, mentorProfileId: string, tracks: string[]): void {
  execute(db, 'DELETE FROM mentor_tracks WHERE mentor_profile_id = ?', [mentorProfileId])
  for (const track of tracks) {
    execute(db, 'INSERT OR IGNORE INTO mentor_tracks (mentor_profile_id, track) VALUES (?, ?)', [
      mentorProfileId,
      track,
    ])
  }
}
