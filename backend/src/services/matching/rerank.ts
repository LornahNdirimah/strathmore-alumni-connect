/**
 * Adjusts a ranking by two signals from behaviour rather than profiles
 * (DESIGN_BACKLOG #51, #52). Both are plain arithmetic over the event log — no
 * model — and both only reorder: the score a student sees stays the
 * compatibility the matcher computed.
 *
 * - **Reliability (#52).** A mentor who lets requests expire unanswered is a
 *   poor suggestion however well they fit: the student waits a week for
 *   nothing. The answered share is smoothed towards "answers" so a new mentor,
 *   or one with a single missed request, is barely moved.
 * - **Exposure (#51).** The matcher ranks each student alone, so a handful of
 *   well-described mentors can top everyone's list while others are never
 *   shown. A mentor already shown to many students per free seat this week is
 *   eased down, which rotates the rest in.
 */
import type { Database } from '../../db/connection.js'
import { queryAll } from '../../db/repository.js'

export const RELIABILITY_WINDOW_DAYS = 180
export const EXPOSURE_WINDOW_DAYS = 7

/** Pseudo-requests counted as answered, so thin histories stay near neutral. */
const RELIABILITY_PRIOR = 2
/** The floor: even a mentor who never answers keeps 60% of their score. */
const RELIABILITY_FLOOR = 0.6
/** A typical answer slower than this (the expiry is 7 days) costs a little. */
const SLOW_RESPONSE_HOURS = 72
const SLOW_RESPONSE_FACTOR = 0.9
/** Students shown per free seat in a week before the exposure penalty starts. */
const EXPOSURE_ALLOWANCE = 3
const EXPOSURE_STEP = 0.1
const RANK_FLOOR = 0.05

export type Reliability = {
  answered: number
  expired: number
  medianResponseHours: number | null
  factor: number
}

function daysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function reliabilityFactor(answered: number, expired: number, medianResponseHours: number | null): number {
  const answeredShare = (answered + RELIABILITY_PRIOR) / (answered + expired + RELIABILITY_PRIOR)
  let factor = RELIABILITY_FLOOR + (1 - RELIABILITY_FLOOR) * answeredShare
  if (medianResponseHours !== null && medianResponseHours > SLOW_RESPONSE_HOURS) factor *= SLOW_RESPONSE_FACTOR
  return Number(factor.toFixed(4))
}

/** Every mentor with a decided or expired request in the window. Others are neutral (1). */
export function mentorReliability(db: Database, now = new Date()): Map<string, Reliability> {
  const rows = queryAll<{ mentor_profile_id: string; status: string; created_at: string; responded_at: string | null }>(
    db,
    `SELECT mentor_profile_id, status, created_at, responded_at FROM mentorship_requests
     WHERE created_at >= ? AND status IN ('accepted', 'declined', 'expired')`,
    [daysAgo(RELIABILITY_WINDOW_DAYS, now)],
  )

  const byMentor = new Map<string, { answered: number; expired: number; hours: number[] }>()
  for (const row of rows) {
    const entry = byMentor.get(row.mentor_profile_id) ?? { answered: 0, expired: 0, hours: [] }
    if (row.status === 'expired') {
      entry.expired += 1
    } else {
      entry.answered += 1
      if (row.responded_at) {
        entry.hours.push((Date.parse(row.responded_at) - Date.parse(row.created_at)) / 3_600_000)
      }
    }
    byMentor.set(row.mentor_profile_id, entry)
  }

  const result = new Map<string, Reliability>()
  for (const [mentorId, entry] of byMentor) {
    const medianResponseHours = median(entry.hours)
    result.set(mentorId, {
      answered: entry.answered,
      expired: entry.expired,
      medianResponseHours: medianResponseHours === null ? null : Number(medianResponseHours.toFixed(1)),
      factor: reliabilityFactor(entry.answered, entry.expired, medianResponseHours),
    })
  }
  return result
}

export function exposureFactor(studentsShown: number, remainingSeats: number): number {
  const perSeat = studentsShown / Math.max(1, remainingSeats)
  return Number((1 / (1 + EXPOSURE_STEP * Math.max(0, perSeat - EXPOSURE_ALLOWANCE))).toFixed(4))
}

/** How many other students each mentor was suggested to in the last week. */
export function recentExposure(db: Database, excludingStudentId: string, now = new Date()): Map<string, number> {
  const rows = queryAll<{ mentor_profile_id: string; shown: number }>(
    db,
    `SELECT mentor_profile_id, COUNT(DISTINCT student_user_id) AS shown FROM match_events
     WHERE event_type = 'suggested' AND occurred_at >= ? AND student_user_id != ?
     GROUP BY mentor_profile_id`,
    [daysAgo(EXPOSURE_WINDOW_DAYS, now), excludingStudentId],
  )
  return new Map(rows.map((row) => [row.mentor_profile_id, row.shown]))
}

export type Candidate = { mentorProfileId: string; score: number }
export type Reranked = Candidate & { rankScore: number }

/**
 * Orders candidates by compatibility × reliability × exposure and keeps
 * `limit`. Ties keep the matcher's order, so with no history this is exactly
 * the matcher's ranking.
 */
export function rerank(
  candidates: Candidate[],
  signals: { reliability: Map<string, Reliability>; exposure: Map<string, number>; remaining: Map<string, number> },
  limit: number,
): Reranked[] {
  return candidates
    .map((candidate, position) => {
      const reliability = signals.reliability.get(candidate.mentorProfileId)?.factor ?? 1
      const exposure = exposureFactor(
        signals.exposure.get(candidate.mentorProfileId) ?? 0,
        signals.remaining.get(candidate.mentorProfileId) ?? 0,
      )
      // The small floor lets the factors order candidates the matcher scored
      // equally at zero (the fallback, for a student with no shared track).
      const rankScore = (candidate.score + RANK_FLOOR) * reliability * exposure
      return { ...candidate, rankScore: Number(rankScore.toFixed(4)), position }
    })
    .sort((a, b) => b.rankScore - a.rankScore || a.position - b.position)
    .slice(0, limit)
    .map(({ position: _position, ...rest }) => rest)
}
