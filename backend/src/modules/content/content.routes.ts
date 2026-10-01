import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { queryScalar } from '../../db/repository.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { nowIso } from '../../lib/time.js'
import { TRACKS } from '../../types/domain.js'
import { findMentorByUserId, getRemainingCapacity } from '../mentors/mentors.repository.js'
import { landingCopy, testimonials } from './content.copy.js'

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()
  const count = (sql: string, params: string[] = []) => queryScalar<number>(db, sql, params) ?? 0

  /**
   * Landing page content. Public — it is the unauthenticated marketing page.
   * The statistics are counted live rather than hardcoded, so the page tells
   * the truth about the platform's size as it grows.
   */
  app.get('/landing', async () => ({
    ...landingCopy,
    careerTracks: TRACKS,
    testimonials,
    stats: [
      { label: 'mentors in the network', value: String(count('SELECT COUNT(*) AS c FROM mentor_profiles')) },
      {
        label: 'mentors available now',
        value: String(
          count("SELECT COUNT(*) AS c FROM mentor_profiles WHERE availability = 'Available'"),
        ),
      },
      {
        label: 'students in the network',
        value: String(count("SELECT COUNT(*) AS c FROM users WHERE role = 'student'")),
      },
      { label: 'career focus tracks', value: String(TRACKS.length) },
    ],
  }))

  /**
   * Role-aware dashboard tiles. Every number is a real count — the mock derived
   * these from array lengths plus a hardcoded offset (`length + 127`).
   */
  app.get('/dashboard/stats', { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser
    if (!user) throw new UnauthorizedError()

    if (user.role === 'student') {
      return {
        stats: [
          {
            label: 'Mentor matches',
            value: String(
              count("SELECT COUNT(*) AS c FROM match_events WHERE student_user_id = ? AND event_type = 'suggested'", [user.sub]),
            ),
          },
          {
            label: 'Active mentors',
            value: String(
              count("SELECT COUNT(*) AS c FROM mentorship_relationships WHERE student_user_id = ? AND status = 'active'", [user.sub]),
            ),
          },
          {
            label: 'Pending requests',
            value: String(
              count("SELECT COUNT(*) AS c FROM mentorship_requests WHERE student_user_id = ? AND status = 'pending'", [user.sub]),
            ),
          },
          {
            label: 'Upcoming sessions',
            value: String(
              count(
                `SELECT COUNT(*) AS c FROM sessions s
                 JOIN mentorship_relationships r ON r.id = s.relationship_id
                 WHERE r.student_user_id = ? AND s.status = 'upcoming'`,
                [user.sub],
              ),
            ),
          },
        ],
      }
    }

    if (user.role === 'alumni') {
      const mentor = findMentorByUserId(db, user.sub)
      if (!mentor) {
        // Not opted in yet: report zeroes rather than failing the dashboard.
        return {
          stats: [
            { label: 'Students mentored', value: '0' },
            { label: 'Pending requests', value: '0' },
            { label: 'Remaining capacity', value: '0' },
            { label: 'Opportunities posted', value: '0' },
          ],
        }
      }

      return {
        stats: [
          {
            label: 'Students mentored',
            value: String(
              count('SELECT COUNT(*) AS c FROM mentorship_relationships WHERE mentor_profile_id = ?', [mentor.id]),
            ),
          },
          {
            label: 'Pending requests',
            value: String(
              count("SELECT COUNT(*) AS c FROM mentorship_requests WHERE mentor_profile_id = ? AND status = 'pending'", [mentor.id]),
            ),
          },
          { label: 'Remaining capacity', value: String(getRemainingCapacity(db, mentor.id)) },
          {
            label: 'Opportunities posted',
            value: String(
              count('SELECT COUNT(*) AS c FROM mentor_opportunities WHERE mentor_profile_id = ?', [mentor.id]),
            ),
          },
        ],
      }
    }

    return {
      stats: [
        { label: 'Total alumni', value: String(count("SELECT COUNT(*) AS c FROM users WHERE role = 'alumni'")) },
        { label: 'Active mentors', value: String(count('SELECT COUNT(*) AS c FROM mentor_profiles')) },
        {
          label: 'Pending verifications',
          value: String(count("SELECT COUNT(*) AS c FROM alumni_verifications WHERE status = 'pending'")),
        },
        {
          label: 'Upcoming events',
          value: String(count('SELECT COUNT(*) AS c FROM events WHERE starts_at >= ?', [nowIso()])),
        },
      ],
    }
  })
}
