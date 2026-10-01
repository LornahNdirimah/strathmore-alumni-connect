import type { Database } from '../../db/connection.js'
import { execute, queryOne } from '../../db/repository.js'

export type SeekerRow = {
  id: string
  user_id: string
  major: string
  year: string
  target_track: string
  career_goal_text: string
  preferred_cadence: string
  format_preference: string
  requested_support: string
  interests: string
  skill_tags: string
  hobbies: string
  unique_quality: string | null
  country: string | null
  state_province: string | null
  ml_person_id: string | null
  created_at: string
  updated_at: string
}

export function findSeekerByUserId(db: Database, userId: string): SeekerRow | null {
  return queryOne<SeekerRow>(db, 'SELECT * FROM mentorship_seekers WHERE user_id = ?', [userId])
}

export function insertSeeker(db: Database, row: SeekerRow): void {
  execute(
    db,
    `INSERT INTO mentorship_seekers
       (id, user_id, major, year, target_track, career_goal_text, preferred_cadence,
        format_preference, requested_support, interests, skill_tags, hobbies,
        unique_quality, country, state_province, ml_person_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.user_id, row.major, row.year, row.target_track, row.career_goal_text,
      row.preferred_cadence, row.format_preference, row.requested_support, row.interests,
      row.skill_tags, row.hobbies, row.unique_quality, row.country, row.state_province,
      row.ml_person_id, row.created_at, row.updated_at,
    ],
  )
}

const UPDATABLE_COLUMNS = [
  'major', 'year', 'target_track', 'career_goal_text', 'preferred_cadence',
  'format_preference', 'requested_support', 'interests', 'skill_tags', 'hobbies',
  'unique_quality', 'country', 'state_province',
] as const

export function updateSeeker(
  db: Database,
  userId: string,
  patch: Partial<Record<(typeof UPDATABLE_COLUMNS)[number], string>>,
): void {
  const entries = Object.entries(patch).filter(
    ([column, value]) =>
      value !== undefined && (UPDATABLE_COLUMNS as readonly string[]).includes(column),
  )
  if (entries.length === 0) return

  // Column names are filtered against a fixed allow-list above, so only
  // literals from this module ever reach the SQL string; values stay bound.
  const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
  const values = entries.map(([, value]) => value as string)

  execute(db, `UPDATE mentorship_seekers SET ${assignments}, updated_at = ? WHERE user_id = ?`, [
    ...values,
    new Date().toISOString(),
    userId,
  ])
}
