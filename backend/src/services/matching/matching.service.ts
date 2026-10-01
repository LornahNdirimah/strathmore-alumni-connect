/**
 * Bridges the database to the matching worker.
 *
 * Two responsibilities: translate DB rows into the feature records the engine
 * expects, and degrade gracefully when the worker is unavailable. The fallback
 * is deliberately simple and deterministic (shared track, then shared industry,
 * then remaining capacity) — it keeps the page useful without pretending to be
 * the ML ranking, and the response says which path produced it.
 */
import type { Database } from '../../db/connection.js'
import { queryAll } from '../../db/repository.js'
import { parseJsonArray } from '../../db/repository.js'
import * as mentorsRepo from '../../modules/mentors/mentors.repository.js'
import { mentorReliability, recentExposure, rerank, type Candidate } from './rerank.js'
import type {
  MatchEvaluation,
  MentorFeatureRecord,
  MatchingWorker,
  StudentFeatureRecord,
} from './MatchingWorker.js'

export type RankedMentor = { mentorProfileId: string; score: number; rankScore: number }

/** The matcher is asked for this many times `limit`, so re-ranking has room to work. */
const CANDIDATE_MULTIPLIER = 3
const MAX_CANDIDATES = 30

export type RecommendationOutcome = {
  mentors: RankedMentor[]
  /** Which path produced this ranking, so the UI/tests can tell them apart. */
  source: 'ml' | 'fallback'
}

type MentorFeatureRow = {
  id: string
  ml_person_id: string | null
  major: string
  hobbies: string
  unique_quality: string
  country: string
  state_province: string
  industry: string
}

type SeekerFeatureRow = {
  user_id: string
  ml_person_id: string | null
  major: string
  hobbies: string
  unique_quality: string | null
  country: string | null
  state_province: string | null
  target_track: string
  career_goal_text: string
}

/**
 * Mentors are addressed by `ml_person_id` inside the engine. Any mentor lacking
 * one is given a synthetic id derived from its primary key so mentors created
 * through the join form (rather than seeded) are still matchable.
 */
function mentorPersonId(row: { id: string; ml_person_id: string | null }): string {
  return row.ml_person_id ?? `mp:${row.id}`
}

function loadMentorFeatures(db: Database): MentorFeatureRow[] {
  return queryAll<MentorFeatureRow>(
    db,
    `SELECT mp.id, mp.ml_person_id, mp.major, mp.hobbies, mp.unique_quality,
            mp.country, mp.state_province, mp.industry
     FROM mentor_profiles mp
     JOIN users u ON u.id = mp.user_id
     WHERE u.status = 'active'`,
  )
}

function toMentorFeatureRecord(row: MentorFeatureRow, tracks: string[]): MentorFeatureRecord {
  return {
    person_id: mentorPersonId(row),
    Major: row.major,
    Hobbies: parseJsonArray(row.hobbies),
    'Unique Quality': row.unique_quality,
    Country: row.country,
    'State/Province': row.state_province,
    mentor_tracks: tracks,
  }
}

/** Rebuilds the worker's index from current mentor rows. */
export async function rebuildIndex(
  db: Database,
  worker: MatchingWorker,
): Promise<{ count: number }> {
  const rows = loadMentorFeatures(db)
  const tracksById = mentorsRepo.getTracksById(db)
  const records = rows.map((row) => toMentorFeatureRecord(row, tracksById.get(row.id) ?? []))
  const result = await worker.buildIndex(records)
  return { count: result.count }
}

function loadSeeker(db: Database, userId: string): SeekerFeatureRow | null {
  const rows = queryAll<SeekerFeatureRow>(
    db,
    `SELECT user_id, ml_person_id, major, hobbies, unique_quality, country,
            state_province, target_track, career_goal_text
     FROM mentorship_seekers WHERE user_id = ?`,
    [userId],
  )
  return rows[0] ?? null
}

/**
 * Capacity-aware, worker-backed recommendations.
 *
 * Keyed by ml person id on the way out to the worker and mapped back to mentor
 * profile ids on the way in, so the rest of the API never has to know the
 * engine's identifier scheme.
 */
export async function recommendMentors(
  db: Database,
  worker: MatchingWorker,
  userId: string,
  options: { limit: number; track?: string; formatPreference?: string },
): Promise<RecommendationOutcome> {
  const seeker = loadSeeker(db, userId)
  const mentorRows = loadMentorFeatures(db)

  const byPersonId = new Map(mentorRows.map((row) => [mentorPersonId(row), row]))

  // Remaining capacity is recomputed per request from live relationship counts
  // — never cached in the worker, which would let it offer seats already taken.
  //
  // It is also this student's eligibility map: a mentor they already have a
  // mentorship or a pending request with is given zero seats *for this query*,
  // which drops them from both the ML ranking and the fallback. Suggesting
  // someone the student is already working with wastes a slot on the dashboard
  // and logs a meaningless "suggested" event into the training data.
  const remainingById = mentorsRepo.getRemainingCapacityById(db)
  const connected = connectedMentorIds(db, userId)
  const capacityByPersonId: Record<string, number> = {}
  for (const row of mentorRows) {
    capacityByPersonId[mentorPersonId(row)] = connected.has(row.id)
      ? 0
      : (remainingById.get(row.id) ?? 0)
  }

  const canUseMl = seeker !== null && worker.isUsable() && mentorRows.length > 0
  const poolSize = Math.min(options.limit * CANDIDATE_MULTIPLIER, MAX_CANDIDATES)
  const reorder = (candidates: Candidate[]) =>
    rerank(
      candidates,
      { reliability: mentorReliability(db), exposure: recentExposure(db, userId), remaining: remainingById },
      options.limit,
    )

  if (canUseMl && seeker) {
    try {
      const student = toStudentFeatureRecord(seeker, options.track)

      const hardFilters = options.track ? { mentor_tracks: options.track } : undefined

      const ranked = await worker.recommend({
        student,
        remainingCapacity: capacityByPersonId,
        ...(hardFilters ? { hardFilters } : {}),
        showK: poolSize,
      })

      const mentors = ranked
        .map((entry) => {
          const row = byPersonId.get(entry.person_id)
          return row ? { mentorProfileId: row.id, score: entry.score } : null
        })
        .filter((value): value is Candidate => value !== null)

      return { mentors: reorder(mentors), source: 'ml' }
    } catch {
      // Fall through to the deterministic ranking below. A matching outage
      // should degrade the page, not break it.
    }
  }

  const pool = fallbackRanking(db, seeker, mentorRows, capacityByPersonId, { ...options, limit: poolSize })
  return { mentors: reorder(pool), source: 'fallback' }
}

function toStudentFeatureRecord(seeker: SeekerFeatureRow, track?: string): StudentFeatureRecord {
  return {
    person_id: seeker.ml_person_id ?? `seeker:${seeker.user_id}`,
    Major: seeker.major,
    Hobbies: parseJsonArray(seeker.hobbies),
    'Unique Quality': seeker.unique_quality ?? '',
    Country: seeker.country ?? '',
    'State/Province': seeker.state_province ?? '',
    target_track: track ?? seeker.target_track,
    career_goal_text: seeker.career_goal_text,
  }
}

/**
 * Scores what really happened with the matcher's own measure (DESIGN_BACKLOG
 * #50): every mentorship that formed, against the best assignment of the same
 * students to the same mentors' capacities, and accepted pairs against the
 * requests mentors declined. Null when the worker is not available — the
 * fallback ranking has no compatibility measure to evaluate with.
 */
export async function evaluateOutcomes(db: Database, worker: MatchingWorker): Promise<MatchEvaluation | null> {
  if (!worker.isUsable()) return null

  const mentorRows = loadMentorFeatures(db)
  const personIdByMentor = new Map(mentorRows.map((row) => [row.id, mentorPersonId(row)]))
  const formed = queryAll<{ mentor_profile_id: string; student_user_id: string }>(
    db,
    'SELECT mentor_profile_id, student_user_id FROM mentorship_relationships',
  )
  const declined = queryAll<{ mentor_profile_id: string; student_user_id: string }>(
    db,
    "SELECT DISTINCT mentor_profile_id, student_user_id FROM mentorship_requests WHERE status = 'declined'",
  )

  const seekers = new Map(
    queryAll<SeekerFeatureRow>(
      db,
      `SELECT user_id, ml_person_id, major, hobbies, unique_quality, country,
              state_province, target_track, career_goal_text
       FROM mentorship_seekers`,
    ).map((row) => [row.user_id, toStudentFeatureRecord(row)]),
  )

  const involved = new Set<string>()
  const pairs: Record<string, string[]> = {}
  for (const row of formed) {
    const mentor = personIdByMentor.get(row.mentor_profile_id)
    const student = seekers.get(row.student_user_id)
    if (!mentor || !student) continue
    ;(pairs[mentor] ??= []).push(student.person_id)
    involved.add(row.student_user_id)
  }
  const declinedPairs: Array<[string, string]> = []
  for (const row of declined) {
    const mentor = personIdByMentor.get(row.mentor_profile_id)
    const student = seekers.get(row.student_user_id)
    if (!mentor || !student) continue
    declinedPairs.push([mentor, student.person_id])
    involved.add(row.student_user_id)
  }

  const capacity: Record<string, number> = {}
  for (const row of queryAll<{ id: string; capacity: number }>(db, 'SELECT id, capacity FROM mentor_profiles')) {
    const mentor = personIdByMentor.get(row.id)
    // Past and present mentees can outnumber today's capacity; the ceiling
    // gets at least as many seats as the mentor really filled, or the real
    // outcome could "beat" the best possible one.
    if (mentor) capacity[mentor] = Math.max(row.capacity, pairs[mentor]?.length ?? 0)
  }

  return worker.evaluate({
    students: [...involved].map((userId) => seekers.get(userId)!),
    pairs,
    declined: declinedPairs,
    capacity,
  })
}

/** Mentors this student already has a mentorship or an open request with. */
function connectedMentorIds(db: Database, studentUserId: string): Set<string> {
  const rows = queryAll<{ mentor_profile_id: string }>(
    db,
    `SELECT mentor_profile_id FROM mentorship_relationships WHERE student_user_id = ?
     UNION
     SELECT mentor_profile_id FROM mentorship_requests
     WHERE student_user_id = ? AND status = 'pending'`,
    [studentUserId, studentUserId],
  )
  return new Set(rows.map((row) => row.mentor_profile_id))
}

function fallbackRanking(
  db: Database,
  seeker: SeekerFeatureRow | null,
  mentorRows: MentorFeatureRow[],
  capacityByPersonId: Record<string, number>,
  options: { limit: number; track?: string },
): Candidate[] {
  const targetTrack = options.track ?? seeker?.target_track
  const tracksById = mentorsRepo.getTracksById(db)

  const scored = mentorRows
    .filter((row) => (capacityByPersonId[mentorPersonId(row)] ?? 0) > 0)
    .map((row) => {
      const tracks = tracksById.get(row.id) ?? []
      let score = 0
      if (targetTrack && tracks.includes(targetTrack)) score += 0.6
      if (seeker && row.major && seeker.major && row.major === seeker.major) score += 0.2
      if (seeker && row.country && seeker.country && row.country === seeker.country) score += 0.1
      return { mentorProfileId: row.id, score: Number(score.toFixed(4)) }
    })
    .filter((entry) => (options.track ? entry.score > 0 : true))

  scored.sort((a, b) => b.score - a.score || a.mentorProfileId.localeCompare(b.mentorProfileId))
  return scored.slice(0, options.limit)
}
