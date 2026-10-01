/**
 * What the platform's own records say about how mentoring is going, for the
 * admin Insights page (DESIGN_BACKLOG #47, #48, #50). Everything is counted
 * from existing tables on request; nothing here is stored or estimated.
 */
import type { OutcomeBucket, Pipeline, Responsiveness, TrackSupply } from '../../contract/index.js'
import type { Database } from '../../db/connection.js'
import { queryAll } from '../../db/repository.js'
import { mentorReliability, RELIABILITY_WINDOW_DAYS } from '../../services/matching/rerank.js'
import { TRACKS } from '../../types/domain.js'

function since(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : Number((part / whole).toFixed(3))
}

// ── #47 Supply and demand ────────────────────────────────────────────────────

export function supplyAndDemand(db: Database): TrackSupply[] {
  const demand = new Map(
    queryAll<{ track: string; seeking: number; waiting: number }>(
      db,
      `SELECT ms.target_track AS track, COUNT(*) AS seeking,
              SUM(CASE WHEN EXISTS (
                SELECT 1 FROM mentorship_relationships mr
                WHERE mr.student_user_id = ms.user_id AND mr.status = 'active'
              ) THEN 0 ELSE 1 END) AS waiting
       FROM mentorship_seekers ms
       JOIN users u ON u.id = ms.user_id AND u.status = 'active'
       GROUP BY ms.target_track`,
    ).map((row) => [row.track, row]),
  )
  const supply = new Map(
    queryAll<{ track: string; mentors: number; free_seats: number }>(
      db,
      `SELECT mt.track, COUNT(*) AS mentors,
              SUM(MAX(0, mp.capacity - (
                SELECT COUNT(*) FROM mentorship_relationships mr
                WHERE mr.mentor_profile_id = mp.id AND mr.status = 'active'
              ))) AS free_seats
       FROM mentor_tracks mt
       JOIN mentor_profiles mp ON mp.id = mt.mentor_profile_id
       JOIN users u ON u.id = mp.user_id AND u.status = 'active'
       GROUP BY mt.track`,
    ).map((row) => [row.track, row]),
  )

  return TRACKS.map((track) => {
    const seeking = demand.get(track)?.seeking ?? 0
    const waiting = demand.get(track)?.waiting ?? 0
    const freeSeats = supply.get(track)?.free_seats ?? 0
    return {
      track,
      seeking,
      waiting,
      mentors: supply.get(track)?.mentors ?? 0,
      freeSeats,
      shortfall: Math.max(0, waiting - freeSeats),
    }
  }).sort((a, b) => b.shortfall - a.shortfall || b.waiting - a.waiting)
}

// ── #48 Pipeline, and #50 outcomes by score and rank ─────────────────────────

type SuggestionRow = {
  metadata: string
  requested: number
  accepted: number
  held: number
  feedback: number
}

/**
 * Every student–mentor pair first suggested in the window, followed forward:
 * did the student ask, did the mentor accept, did a session happen, did
 * anyone give feedback. Each step only counts if it came after the suggestion.
 */
function followSuggestions(db: Database, from: string): SuggestionRow[] {
  return queryAll<SuggestionRow>(
    db,
    `WITH first AS (
       SELECT student_user_id, mentor_profile_id, MIN(occurred_at) AS at
       FROM match_events
       WHERE event_type = 'suggested' AND occurred_at >= ?
       GROUP BY student_user_id, mentor_profile_id
     )
     SELECT
       (SELECT me.metadata FROM match_events me
        WHERE me.event_type = 'suggested' AND me.student_user_id = f.student_user_id
          AND me.mentor_profile_id = f.mentor_profile_id AND me.occurred_at = f.at
        LIMIT 1) AS metadata,
       EXISTS (SELECT 1 FROM mentorship_requests r
               WHERE r.student_user_id = f.student_user_id AND r.mentor_profile_id = f.mentor_profile_id
                 AND r.created_at >= f.at) AS requested,
       EXISTS (SELECT 1 FROM mentorship_requests r
               WHERE r.student_user_id = f.student_user_id AND r.mentor_profile_id = f.mentor_profile_id
                 AND r.created_at >= f.at AND r.status = 'accepted') AS accepted,
       EXISTS (SELECT 1 FROM mentorship_relationships mr JOIN sessions s ON s.relationship_id = mr.id
               WHERE mr.student_user_id = f.student_user_id AND mr.mentor_profile_id = f.mentor_profile_id
                 AND mr.started_at >= f.at AND s.status = 'completed') AS held,
       EXISTS (SELECT 1 FROM mentorship_relationships mr JOIN feedback fb ON fb.relationship_id = mr.id
               WHERE mr.student_user_id = f.student_user_id AND mr.mentor_profile_id = f.mentor_profile_id
                 AND mr.started_at >= f.at) AS feedback
     FROM first f`,
    [from],
  )
}

const SCORE_BANDS = [
  { label: '0.75 – 1', min: 0.75 },
  { label: '0.50 – 0.75', min: 0.5 },
  { label: '0.25 – 0.50', min: 0.25 },
  { label: 'under 0.25', min: -Infinity },
] as const

function bucket(label: string, rows: SuggestionRow[]): OutcomeBucket {
  const requested = rows.filter((row) => row.requested).length
  const accepted = rows.filter((row) => row.accepted).length
  return {
    label,
    suggested: rows.length,
    requested,
    accepted,
    requestRate: rate(requested, rows.length),
    acceptRate: rate(accepted, requested),
  }
}

export function pipeline(db: Database, days: number, now = new Date()): Pipeline {
  const from = since(days, now)
  const followed = followSuggestions(db, from)

  const counts = [
    { key: 'suggested', label: 'Suggested', count: followed.length },
    { key: 'requested', label: 'Requested', count: followed.filter((row) => row.requested).length },
    { key: 'accepted', label: 'Accepted', count: followed.filter((row) => row.accepted).length },
    { key: 'session', label: 'First session held', count: followed.filter((row) => row.held).length },
    { key: 'feedback', label: 'Feedback given', count: followed.filter((row) => row.feedback).length },
  ]
  const stages = counts.map((stage, index) => ({
    ...stage,
    rateFromPrevious: index === 0 ? null : rate(stage.count, counts[index - 1]!.count),
  }))

  const parsed = followed.map((row) => {
    let meta: { score?: number; rank?: number } = {}
    try {
      meta = JSON.parse(row.metadata ?? '{}')
    } catch {
      // An unreadable row still counts in the stages; it just has no score.
    }
    return { row, meta }
  })
  const byScore = SCORE_BANDS.map((band, index) => {
    const upper = index === 0 ? Infinity : SCORE_BANDS[index - 1]!.min
    return bucket(
      band.label,
      parsed
        .filter(({ meta }) => typeof meta.score === 'number' && meta.score >= band.min && meta.score < upper)
        .map(({ row }) => row),
    )
  })
  // Rank is logged from Phase 8 on; older suggestions have none and are left out.
  const byRank = ['1', '2', '3', '4', '5', '6+'].map((label) =>
    bucket(
      label === '6+' ? '6th or lower' : `#${label}`,
      parsed
        .filter(({ meta }) =>
          typeof meta.rank === 'number' && (label === '6+' ? meta.rank >= 6 : meta.rank === Number(label)),
        )
        .map(({ row }) => row),
    ),
  )

  const requests = queryAll<{ status: string; created_at: string; responded_at: string | null; suggested: number }>(
    db,
    `SELECT r.status, r.created_at, r.responded_at,
            EXISTS (SELECT 1 FROM match_events me
                    WHERE me.event_type = 'suggested' AND me.student_user_id = r.student_user_id
                      AND me.mentor_profile_id = r.mentor_profile_id AND me.occurred_at <= r.created_at) AS suggested
     FROM mentorship_requests r WHERE r.created_at >= ?`,
    [from],
  )
  const count = (status: string, list = requests) => list.filter((row) => row.status === status).length
  const decided = (list: typeof requests) => list.filter((row) => row.status === 'accepted' || row.status === 'declined' || row.status === 'expired')
  const afterSuggestion = requests.filter((row) => row.suggested)
  const otherwise = requests.filter((row) => !row.suggested)
  const hours = requests
    .filter((row) => row.responded_at && (row.status === 'accepted' || row.status === 'declined'))
    .map((row) => (Date.parse(row.responded_at!) - Date.parse(row.created_at)) / 3_600_000)
    .sort((a, b) => a - b)
  const middle = Math.floor(hours.length / 2)
  const medianResponseHours =
    hours.length === 0 ? null : Number((hours.length % 2 ? hours[middle]! : (hours[middle - 1]! + hours[middle]!) / 2).toFixed(1))

  return {
    days,
    stages,
    requests: {
      total: requests.length,
      afterSuggestion: afterSuggestion.length,
      accepted: count('accepted'),
      declined: count('declined'),
      expired: count('expired'),
      withdrawn: count('withdrawn'),
      pending: count('pending'),
      acceptRateAfterSuggestion: rate(count('accepted', afterSuggestion), decided(afterSuggestion).length),
      acceptRateOtherwise: rate(count('accepted', otherwise), decided(otherwise).length),
      medianResponseHours,
    },
    byScore,
    byRank,
  }
}

// ── #52 Responsiveness, as the ranking sees it ───────────────────────────────

/** Mentors whose requests have lapsed unanswered, least responsive first — the ones to nudge. */
export function leastResponsive(db: Database, limit = 10): { windowDays: number; mentors: Responsiveness[] } {
  const reliability = mentorReliability(db)
  const lapsed = [...reliability.entries()].filter(([, entry]) => entry.expired > 0)
  if (lapsed.length === 0) return { windowDays: RELIABILITY_WINDOW_DAYS, mentors: [] }

  const names = new Map(
    queryAll<{ id: string; name: string }>(
      db,
      `SELECT mp.id, u.name FROM mentor_profiles mp JOIN users u ON u.id = mp.user_id
       WHERE mp.id IN (${lapsed.map(() => '?').join(', ')})`,
      lapsed.map(([id]) => id),
    ).map((row) => [row.id, row.name]),
  )

  return {
    windowDays: RELIABILITY_WINDOW_DAYS,
    mentors: lapsed
      .map(([mentorProfileId, entry]) => ({ mentorProfileId, name: names.get(mentorProfileId) ?? 'Unknown', ...entry }))
      .sort((a, b) => a.factor - b.factor || b.expired - a.expired)
      .slice(0, limit),
  }
}
