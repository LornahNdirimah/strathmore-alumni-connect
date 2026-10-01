import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getDatabase } from '../../db/connection.js'
import { execute, fromBool, queryAll, queryOne } from '../../db/repository.js'
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { nowIso } from '../../lib/time.js'
import { parseOrThrow } from '../../lib/validate.js'

/**
 * Field-for-field with matching_engine.feedback_schema.FeedbackForm
 * (DESIGN_BACKLOG #5), so responses collected here can be exported as Tier-2
 * training data without reshaping. No synthetic feedback is ever generated —
 * these rows only ever come from a real person filling in the form.
 */
const feedbackSchema = z.object({
  relationshipId: z.string().trim().min(1),
  satisfactionRating: z.coerce.number().int().min(1).max(5),
  wouldMatchAgain: z.boolean(),
  sessionsHeld: z.coerce.number().int().min(0).max(500),
  relationshipStatus: z.enum(['ongoing', 'ended', 'never_started']),
  primaryGoalProgress: z.enum(['none', 'some', 'significant']),
  freeTextComments: z.string().trim().max(2000).optional(),
})

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireIdentity(request: {
    currentUser?: { sub: string; role: string }
  }): { userId: string; role: string } {
    const user = request.currentUser
    if (!user) throw new UnauthorizedError()
    return { userId: user.sub, role: user.role }
  }

  /** Relationships this user is part of that they haven't reviewed yet. */
  app.get('/pending', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const { userId } = requireIdentity(request)

    const rows = queryAll<{
      id: string
      mentor_name: string
      student_name: string
      started_at: string
    }>(
      db,
      `SELECT rel.id, mu.name AS mentor_name, s.name AS student_name, rel.started_at
       FROM mentorship_relationships rel
       JOIN users s ON s.id = rel.student_user_id
       JOIN mentor_profiles mp ON mp.id = rel.mentor_profile_id
       JOIN users mu ON mu.id = mp.user_id
       WHERE (rel.student_user_id = ? OR mp.user_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM feedback f
           WHERE f.relationship_id = rel.id AND f.respondent_user_id = ?
         )
       ORDER BY rel.started_at DESC`,
      [userId, userId, userId],
    )

    return {
      pending: rows.map((row) => ({
        relationshipId: row.id,
        mentorName: row.mentor_name,
        studentName: row.student_name,
        startedAt: row.started_at,
      })),
    }
  })

  app.post('/', { preHandler: app.requireCapability('mentorship.participate') }, async (request, reply) => {
    const { userId, role } = requireIdentity(request)
    const input = parseOrThrow(feedbackSchema, request.body, 'feedback')

    // Only a participant may review a mentorship, and only about their own.
    const relationship = queryOne<{ student_user_id: string; mentor_user_id: string }>(
      db,
      `SELECT rel.student_user_id, mp.user_id AS mentor_user_id
       FROM mentorship_relationships rel
       JOIN mentor_profiles mp ON mp.id = rel.mentor_profile_id
       WHERE rel.id = ?`,
      [input.relationshipId],
    )
    if (!relationship) throw new NotFoundError('Mentorship not found.')

    if (relationship.student_user_id !== userId && relationship.mentor_user_id !== userId) {
      throw new ForbiddenError('You are not part of this mentorship.')
    }

    const existing = queryOne<{ id: string }>(
      db,
      'SELECT id FROM feedback WHERE relationship_id = ? AND respondent_user_id = ?',
      [input.relationshipId, userId],
    )
    if (existing) throw new ConflictError('You have already submitted feedback for this mentorship.')

    execute(
      db,
      `INSERT INTO feedback
         (id, relationship_id, respondent_user_id, respondent_role, satisfaction_rating,
          would_match_again, sessions_held, relationship_status, primary_goal_progress,
          free_text_comments, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('fb'),
        input.relationshipId,
        userId,
        role === 'student' ? 'student' : 'alumni',
        input.satisfactionRating,
        fromBool(input.wouldMatchAgain),
        input.sessionsHeld,
        input.relationshipStatus,
        input.primaryGoalProgress,
        input.freeTextComments ?? null,
        nowIso(),
      ],
    )

    return reply.code(201).send({ message: 'Thank you — your feedback was recorded.' })
  })
}
