import type { Database } from '../../db/connection.js'
import { ConflictError, NotFoundError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { nowIso } from '../../lib/time.js'
import { parseJsonArray } from '../../db/repository.js'
import * as repo from './seekers.repository.js'
import type { SeekerInput } from './seekers.schemas.js'

export type SeekerView = {
  id: string
  userId: string
  major: string
  year: string
  targetTrack: string
  careerGoalText: string
  preferredCadence: string
  formatPreference: string
  requestedSupport: string[]
  interests: string[]
  skillTags: string[]
  hobbies: string[]
  uniqueQuality: string
  country: string
  stateProvince: string
}

function toView(row: repo.SeekerRow): SeekerView {
  return {
    id: row.id,
    userId: row.user_id,
    major: row.major,
    year: row.year,
    targetTrack: row.target_track,
    careerGoalText: row.career_goal_text,
    preferredCadence: row.preferred_cadence,
    formatPreference: row.format_preference,
    requestedSupport: parseJsonArray(row.requested_support),
    interests: parseJsonArray(row.interests),
    skillTags: parseJsonArray(row.skill_tags),
    hobbies: parseJsonArray(row.hobbies),
    uniqueQuality: row.unique_quality ?? '',
    country: row.country ?? '',
    stateProvince: row.state_province ?? '',
  }
}

export function getSeeker(db: Database, userId: string): SeekerView | null {
  const row = repo.findSeekerByUserId(db, userId)
  return row ? toView(row) : null
}

export function createSeeker(db: Database, userId: string, input: SeekerInput): SeekerView {
  if (repo.findSeekerByUserId(db, userId)) {
    throw new ConflictError('You have already completed this form. Update it instead.')
  }

  const timestamp = nowIso()
  const row: repo.SeekerRow = {
    id: newId('seeker'),
    user_id: userId,
    major: input.major,
    year: input.year,
    target_track: input.targetTrack,
    career_goal_text: input.careerGoalText,
    preferred_cadence: input.preferredCadence,
    format_preference: input.formatPreference,
    requested_support: JSON.stringify(input.requestedSupport),
    interests: JSON.stringify(input.interests),
    skill_tags: JSON.stringify(input.skillTags),
    hobbies: JSON.stringify(input.hobbies),
    unique_quality: input.uniqueQuality,
    country: input.country,
    state_province: input.stateProvince,
    ml_person_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  }

  repo.insertSeeker(db, row)
  return toView(row)
}

export function updateSeeker(
  db: Database,
  userId: string,
  input: Partial<SeekerInput>,
): SeekerView {
  if (!repo.findSeekerByUserId(db, userId)) {
    throw new NotFoundError('Complete the career-goals form first.')
  }

  repo.updateSeeker(db, userId, {
    ...(input.major !== undefined ? { major: input.major } : {}),
    ...(input.year !== undefined ? { year: input.year } : {}),
    ...(input.targetTrack !== undefined ? { target_track: input.targetTrack } : {}),
    ...(input.careerGoalText !== undefined ? { career_goal_text: input.careerGoalText } : {}),
    ...(input.preferredCadence !== undefined ? { preferred_cadence: input.preferredCadence } : {}),
    ...(input.formatPreference !== undefined ? { format_preference: input.formatPreference } : {}),
    ...(input.requestedSupport !== undefined
      ? { requested_support: JSON.stringify(input.requestedSupport) }
      : {}),
    ...(input.interests !== undefined ? { interests: JSON.stringify(input.interests) } : {}),
    ...(input.skillTags !== undefined ? { skill_tags: JSON.stringify(input.skillTags) } : {}),
    ...(input.hobbies !== undefined ? { hobbies: JSON.stringify(input.hobbies) } : {}),
    ...(input.uniqueQuality !== undefined ? { unique_quality: input.uniqueQuality } : {}),
    ...(input.country !== undefined ? { country: input.country } : {}),
    ...(input.stateProvince !== undefined ? { state_province: input.stateProvince } : {}),
  })

  const updated = repo.findSeekerByUserId(db, userId)
  if (!updated) throw new NotFoundError('Seeker profile not found.')
  return toView(updated)
}
