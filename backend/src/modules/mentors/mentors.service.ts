import type { Database } from '../../db/connection.js'
import { ConflictError, NotFoundError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { nowIso } from '../../lib/time.js'
import type { Availability, OpportunityType } from '../../types/domain.js'
import { parseJsonArray } from '../../db/repository.js'
import { avatarUrl } from '../../lib/avatars.js'
import * as repo from './mentors.repository.js'
import type { MentorProfileInput, MentorSearchQuery } from './mentors.schemas.js'

/**
 * The mentor shape the UI renders. Mirrors `frontend/src/types/index.ts::Mentor`,
 * except `id` is a string here — the mock used numeric mentor ids alongside
 * string user ids, which is the ambiguity this schema set out to remove.
 *
 * `matchScore` is intentionally optional: a score is only meaningful relative
 * to a particular student, so it is populated on recommendations and absent
 * from directory listings rather than being faked with a stored constant.
 */
export type MentorSummary = {
  id: string
  userId: string
  name: string
  role: string
  company: string
  industry: string
  location: string
  availability: Availability
  skills: string[]
  tracks: string[]
  capacity: number
  remainingCapacity: number
  avatarUrl: string | null
  matchScore?: number
}

export type MentorDetail = MentorSummary & {
  bio: string | null
  certifications: string[]
  timeline: Array<{ year: string; title: string; org: string; description?: string }>
  postedOpportunities: Array<{
    id: string
    title: string
    type: OpportunityType
    location: string | null
    postedAt: string
  }>
}

function toSummary(db: Database, row: repo.MentorProfileRow, extras?: repo.MentorExtras): MentorSummary {
  const loaded = extras ?? repo.loadMentorExtras(db, [row.id])
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    role: row.headline,
    company: row.company,
    industry: row.industry,
    location: row.location,
    availability: row.availability,
    skills: loaded.skills.get(row.id) ?? [],
    tracks: loaded.tracks.get(row.id) ?? [],
    capacity: row.capacity,
    remainingCapacity: loaded.remaining.get(row.id) ?? 0,
    avatarUrl: avatarUrl(row.user_id, row.avatar_updated_at),
  }
}

/** Many rows as summaries, with their child collections fetched in bulk. */
export function toSummaries(db: Database, rows: repo.MentorProfileRow[]): MentorSummary[] {
  const extras = repo.loadMentorExtras(db, rows.map((row) => row.id))
  return rows.map((row) => toSummary(db, row, extras))
}

function toDetail(db: Database, row: repo.MentorProfileRow): MentorDetail {
  return {
    ...toSummary(db, row),
    bio: row.bio,
    certifications: repo.listCertifications(db, row.id),
    timeline: repo.listTimeline(db, row.id).map((entry) => ({
      year: entry.year,
      title: entry.title,
      org: entry.org,
      ...(entry.description ? { description: entry.description } : {}),
    })),
    postedOpportunities: repo.listOpenOpportunitiesByPoster(db, row.user_id).map((opportunity) => ({
      id: opportunity.id,
      title: opportunity.title,
      type: opportunity.type,
      location: opportunity.location,
      postedAt: opportunity.posted_at,
    })),
  }
}

export function searchMentors(
  db: Database,
  query: MentorSearchQuery,
): { items: MentorSummary[]; total: number; page: number; limit: number; industries: string[] } {
  const offset = (query.page - 1) * query.limit

  const { items, total } = repo.searchMentors(db, {
    query: query.q,
    industry: query.industry,
    track: query.track,
    availableOnly: query.available,
    limit: query.limit,
    offset,
  })

  return {
    items: toSummaries(db, items),
    total,
    page: query.page,
    limit: query.limit,
    industries: repo.listIndustries(db),
  }
}

export function getMentorDetail(db: Database, id: string): MentorDetail {
  const row = repo.findMentorById(db, id)
  if (!row) throw new NotFoundError('Mentor not found.')
  return toDetail(db, row)
}

/**
 * Every field of the mentor-join form as it is stored, for the owner's edit
 * form. Kept out of MentorDetail, which students see: hobbies, home region and
 * the like are matching inputs, not profile content.
 */
export type EditableMentorProfile = {
  headline: string
  company: string
  industry: string
  location: string
  bio: string
  capacity: number
  availability: Availability
  cadence: string | null
  formatPreference: string | null
  skills: string[]
  tracks: string[]
  major: string
  hobbies: string[]
  uniqueQuality: string
  country: string
  stateProvince: string
}

export function getMyMentorProfile(
  db: Database,
  userId: string,
): { mentor: MentorDetail; editable: EditableMentorProfile } | null {
  const row = repo.findMentorByUserId(db, userId)
  if (!row) return null

  const mentor = toDetail(db, row)
  return {
    mentor,
    editable: {
      headline: row.headline,
      company: row.company,
      industry: row.industry,
      location: row.location,
      bio: row.bio ?? '',
      capacity: row.capacity,
      availability: row.availability,
      cadence: row.cadence,
      formatPreference: row.format_pref,
      skills: mentor.skills,
      tracks: mentor.tracks,
      major: row.major,
      hobbies: parseJsonArray(row.hobbies),
      uniqueQuality: row.unique_quality,
      country: row.country,
      stateProvince: row.state_province,
    },
  }
}

/**
 * The alumni mentor-join form (DESIGN_BACKLOG #3, #5).
 *
 * Creating this record is what makes an alumnus matchable — it is the opt-in
 * gate, separate from simply holding an `alumni` account.
 */
export function createMentorProfile(
  db: Database,
  userId: string,
  input: MentorProfileInput,
): MentorDetail {
  if (repo.findMentorByUserId(db, userId)) {
    throw new ConflictError('You already have a mentor profile. Update it instead.')
  }

  const timestamp = nowIso()
  const id = newId('mentor')

  repo.insertMentorProfile(db, {
    id,
    user_id: userId,
    headline: input.headline,
    company: input.company,
    industry: input.industry,
    location: input.location,
    bio: input.bio ?? null,
    capacity: input.capacity,
    availability: input.availability,
    cadence: input.cadence ?? null,
    format_pref: input.formatPreference ?? null,
    ml_person_id: null,
    major: input.major,
    hobbies: JSON.stringify(input.hobbies),
    unique_quality: input.uniqueQuality,
    country: input.country,
    state_province: input.stateProvince,
    created_at: timestamp,
    updated_at: timestamp,
  })

  repo.replaceSkills(db, id, input.skills)
  repo.replaceTracks(db, id, input.tracks)

  const row = repo.findMentorById(db, id)
  if (!row) throw new NotFoundError('Mentor profile could not be created.')
  return toDetail(db, row)
}

export function updateMentorProfile(
  db: Database,
  userId: string,
  input: Partial<MentorProfileInput>,
): MentorDetail {
  const existing = repo.findMentorByUserId(db, userId)
  if (!existing) throw new NotFoundError('You do not have a mentor profile yet.')

  // Capacity may not be lowered below commitments already made — otherwise
  // remaining capacity goes negative and the matcher starts handing out seats
  // that do not exist.
  if (input.capacity !== undefined) {
    const activeCount = existing.capacity - repo.getRemainingCapacity(db, existing.id)
    if (input.capacity < activeCount) {
      throw new ConflictError(
        `You currently mentor ${activeCount} student(s); capacity cannot be set below that.`,
      )
    }
  }

  repo.updateMentorProfile(db, existing.id, {
    ...(input.headline !== undefined ? { headline: input.headline } : {}),
    ...(input.company !== undefined ? { company: input.company } : {}),
    ...(input.industry !== undefined ? { industry: input.industry } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.bio !== undefined ? { bio: input.bio } : {}),
    ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
    ...(input.availability !== undefined ? { availability: input.availability } : {}),
    ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
    ...(input.formatPreference !== undefined ? { format_pref: input.formatPreference } : {}),
    // The matching-engine fields, editable after joining too: a mentor whose
    // details go stale would otherwise keep being matched on who they were.
    ...(input.major !== undefined ? { major: input.major } : {}),
    ...(input.hobbies !== undefined ? { hobbies: JSON.stringify(input.hobbies) } : {}),
    ...(input.uniqueQuality !== undefined ? { unique_quality: input.uniqueQuality } : {}),
    ...(input.country !== undefined ? { country: input.country } : {}),
    ...(input.stateProvince !== undefined ? { state_province: input.stateProvince } : {}),
  })

  if (input.skills) repo.replaceSkills(db, existing.id, input.skills)
  if (input.tracks) repo.replaceTracks(db, existing.id, input.tracks)

  const row = repo.findMentorById(db, existing.id)
  if (!row) throw new NotFoundError('Mentor profile not found.')
  return toDetail(db, row)
}

export { toDetail as serializeMentorDetail, toSummaries as serializeMentorSummaries }
