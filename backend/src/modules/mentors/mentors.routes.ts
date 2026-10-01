import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { parseJsonArray, queryAll } from '../../db/repository.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { nowIso } from '../../lib/time.js'
import { parseOrThrow } from '../../lib/validate.js'
import { explainMatch, type MatchSubject } from '../../services/matching/explain.js'
import { recommendMentors } from '../../services/matching/matching.service.js'
import { findSeekerByUserId } from '../seekers/seekers.repository.js'
import { recordMatchEvent } from '../mentorship/mentorship.repository.js'
import {
  mentorProfileSchema,
  mentorProfileUpdateSchema,
  mentorSearchQuerySchema,
  recommendationQuerySchema,
} from './mentors.schemas.js'
import * as service from './mentors.service.js'
import { findMentorsByIds } from './mentors.repository.js'

/** How long one "suggested" event covers repeat showings of the same mentor. */
const SUGGESTION_LOG_WINDOW_MS = 24 * 60 * 60 * 1000

export async function mentorRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  /** Directory search. Filtering happens in SQL, not in the browser over the whole table. */
  app.get('/', { preHandler: app.requireCapability('mentors.browse') }, async (request) => {
    const query = parseOrThrow(mentorSearchQuerySchema, request.query, 'search filters')
    return service.searchMentors(db, query)
  })

  /**
   * ML-backed recommendations for the signed-in student.
   *
   * Requires the career-goals opt-in record (DESIGN_BACKLOG #3) — without it
   * there is no goal or track to match against, so 403 is the honest answer
   * rather than silently returning an arbitrary list.
   */
  app.get('/recommendations', { preHandler: app.requireCapability('mentorship.request') }, async (request) => {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()

    const query = parseOrThrow(recommendationQuerySchema, request.query, 'recommendation filters')

    const outcome = await recommendMentors(db, app.matching, userId, {
      limit: query.limit,
      ...(query.track ? { track: query.track } : {}),
      ...(query.formatPreference ? { formatPreference: query.formatPreference } : {}),
    })

    const rows = findMentorsByIds(
      db,
      outcome.mentors.map((entry) => entry.mentorProfileId),
    )
    const scoreById = new Map(outcome.mentors.map((entry) => [entry.mentorProfileId, entry]))

    // Preserve the ranking order; a SQL `IN (...)` gives no ordering guarantee.
    const seeker = findSeekerByUserId(db, userId)
    const student: MatchSubject = {
      targetTrack: query.track ?? seeker?.target_track ?? null,
      major: seeker?.major ?? null,
      interests: [...parseJsonArray(seeker?.skill_tags), ...parseJsonArray(seeker?.interests)],
      hobbies: parseJsonArray(seeker?.hobbies),
      country: seeker?.country ?? null,
      stateProvince: seeker?.state_province ?? null,
    }

    const ordered = outcome.mentors
      .map((entry) => rows.find((row) => row.id === entry.mentorProfileId))
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
    const summaries = service.serializeMentorSummaries(db, ordered)
    const items = ordered
      .map((row, index) => {
        const summary = summaries[index]!
        return {
          ...summary,
          matchScore: scoreById.get(row.id)?.score ?? 0,
          // DESIGN_BACKLOG #37: the overlaps behind the score, in words.
          matchReasons: explainMatch(student, {
            tracks: summary.tracks,
            skills: summary.skills,
            major: row.major,
            hobbies: parseJsonArray(row.hobbies),
            country: row.country,
            stateProvince: row.state_province,
          }),
        }
      })

    // DESIGN_BACKLOG #4: a shown suggestion is itself training signal, so it is
    // logged here rather than only when the student acts on it — but once per
    // mentor per day. The dashboard refetches this on every visit, and logging
    // each reload would record one impression as dozens.
    const recentlySuggested = new Set(
      queryAll<{ mentor_profile_id: string }>(
        db,
        `SELECT DISTINCT mentor_profile_id FROM match_events
         WHERE student_user_id = ? AND event_type = 'suggested' AND occurred_at >= ?`,
        [userId, new Date(Date.now() - SUGGESTION_LOG_WINDOW_MS).toISOString()],
      ).map((row) => row.mentor_profile_id),
    )

    for (const [rank, item] of items.entries()) {
      if (recentlySuggested.has(item.id)) continue
      recordMatchEvent(db, {
        id: newId('evt'),
        event_type: 'suggested',
        student_user_id: userId,
        mentor_profile_id: item.id,
        occurred_at: nowIso(),
        // Rank and the adjusted score let the outcome evaluation (#50) ask
        // whether higher-placed suggestions really are taken up more often.
        metadata: JSON.stringify({
          score: item.matchScore,
          rankScore: scoreById.get(item.id)?.rankScore ?? item.matchScore,
          rank: rank + 1,
          source: outcome.source,
        }),
      })
    }

    return { items, source: outcome.source }
  })

  /** The signed-in alumnus's own mentor profile (null before they opt in). */
  app.get('/me', { preHandler: app.requireRole('alumni') }, async (request) => {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    // `mentor` stays null for an alumnus who does not mentor; `editable`
    // carries the stored form fields for the owner's profile editor.
    const mine = service.getMyMentorProfile(db, userId)
    return { mentor: mine?.mentor ?? null, editable: mine?.editable ?? null }
  })

  /** The alumni mentor-join form — DESIGN_BACKLOG #3, #5. Mentoring is optional for alumni. */
  app.post('/me', { preHandler: app.requireCapability('mentorship.become-mentor') }, async (request, reply) => {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()

    const input = parseOrThrow(mentorProfileSchema, request.body, 'mentor profile')
    const mentor = service.createMentorProfile(db, userId, input)

    // A new mentor must enter the retrieval index or they are invisible to
    // matching until the next restart.
    void app.refreshMatchingIndex()

    return reply.code(201).send({ mentor, message: 'Your mentor profile is live.' })
  })

  app.patch('/me', { preHandler: app.requireCapability('mentorship.mentor') }, async (request) => {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()

    const input = parseOrThrow(mentorProfileUpdateSchema, request.body, 'mentor profile')
    const mentor = service.updateMentorProfile(db, userId, input)

    void app.refreshMatchingIndex()

    return { mentor, message: 'Profile updated.' }
  })

  /**
   * Registered last: a literal path would otherwise be shadowed by this
   * parameterised one if declared earlier.
   */
  app.get('/:mentorId', { preHandler: app.requireCapability('mentors.browse') }, async (request) => {
    const { mentorId } = request.params as { mentorId: string }
    return { mentor: service.getMentorDetail(db, mentorId) }
  })
}
