/**
 * "Download my data" (DESIGN_BACKLOG #44): everything the platform holds about
 * a person, as one JSON file they can keep or take elsewhere.
 *
 * Credentials never appear — not even hashed — and neither do internal
 * matching identifiers. Conversations include both sides' messages, since the
 * person could already read all of them.
 */
import type { Database } from '../../db/connection.js'
import { parseJsonArray, queryAll, queryOne } from '../../db/repository.js'
import { nowIso } from '../../lib/time.js'

export function exportAccount(db: Database, userId: string): Record<string, unknown> {
  const all = <T>(sql: string, params: unknown[] = [userId]) => queryAll<T>(db, sql, params as string[])

  const account = queryOne(
    db,
    `SELECT id, name, email, role, status, created_at, email_verified_at, terms_version, terms_accepted_at,
            directory_visible
     FROM users WHERE id = ?`,
    [userId],
  )

  const seeker = queryOne<Record<string, unknown>>(
    db,
    `SELECT major, year, target_track, career_goal_text, preferred_cadence, format_preference,
            requested_support, interests, skill_tags, hobbies, unique_quality, country, state_province,
            created_at, updated_at
     FROM mentorship_seekers WHERE user_id = ?`,
    [userId],
  )
  const mentor = queryOne<Record<string, unknown> & { id: string }>(
    db,
    `SELECT id, headline, company, industry, location, bio, capacity, availability, cadence, format_pref,
            major, hobbies, unique_quality, country, state_province, timezone_label, session_duration_min,
            created_at, updated_at
     FROM mentor_profiles WHERE user_id = ?`,
    [userId],
  )

  const conversations = all<{ id: string }>(
    'SELECT conversation_id AS id FROM conversation_participants WHERE user_id = ?',
  ).map(({ id }) => ({
    id,
    with: all<{ name: string }>(
      `SELECT u.name FROM conversation_participants p JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = ? AND p.user_id != ?`,
      [id, userId],
    ).map((row) => row.name),
    messages: all<{ sender_user_id: string; body: string; created_at: string }>(
      'SELECT sender_user_id, body, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at',
      [id],
    ).map((message) => ({
      from: message.sender_user_id === userId ? 'me' : 'them',
      text: message.body,
      sentAt: message.created_at,
    })),
  }))

  return {
    exportedAt: nowIso(),
    notice:
      'Everything Strathmore Alumni Connect holds about your account. Passwords are never included, not even in hashed form.',
    account,
    verification: all('SELECT class_year, program, status, created_at, reviewed_at FROM alumni_verifications WHERE user_id = ?'),
    careerGoals: seeker
      ? {
          ...seeker,
          requested_support: parseJsonArray(seeker.requested_support as string),
          interests: parseJsonArray(seeker.interests as string),
          skill_tags: parseJsonArray(seeker.skill_tags as string),
          hobbies: parseJsonArray(seeker.hobbies as string),
        }
      : null,
    mentorProfile: mentor
      ? {
          ...Object.fromEntries(Object.entries(mentor).filter(([key]) => key !== 'id')),
          hobbies: parseJsonArray(mentor.hobbies as string),
          skills: all('SELECT skill FROM mentor_skills WHERE mentor_profile_id = ?', [mentor.id]),
          tracks: all('SELECT track FROM mentor_tracks WHERE mentor_profile_id = ?', [mentor.id]),
          availability: all(
            'SELECT day_of_week, start_minute, end_minute FROM mentor_availability WHERE mentor_profile_id = ?',
            [mentor.id],
          ),
        }
      : null,
    mentorshipRequests: all(
      `SELECT r.interest, r.preferred_slot, r.message, r.status, r.response_notes, r.created_at, r.responded_at,
              su.name AS student, mu.name AS mentor
       FROM mentorship_requests r
       JOIN users su ON su.id = r.student_user_id
       JOIN mentor_profiles mp ON mp.id = r.mentor_profile_id
       JOIN users mu ON mu.id = mp.user_id
       WHERE r.student_user_id = ? OR mp.user_id = ?`,
      [userId, userId],
    ),
    mentorships: all(
      `SELECT rel.status, rel.started_at, rel.ends_on, rel.ended_at, rel.end_reason,
              su.name AS student, mu.name AS mentor
       FROM mentorship_relationships rel
       JOIN users su ON su.id = rel.student_user_id
       JOIN mentor_profiles mp ON mp.id = rel.mentor_profile_id
       JOIN users mu ON mu.id = mp.user_id
       WHERE rel.student_user_id = ? OR mp.user_id = ?`,
      [userId, userId],
    ),
    goals: all(
      `SELECT g.title, g.created_at, g.completed_at FROM mentorship_goals g
       JOIN mentorship_relationships rel ON rel.id = g.relationship_id
       JOIN mentor_profiles mp ON mp.id = rel.mentor_profile_id
       WHERE rel.student_user_id = ? OR mp.user_id = ?`,
      [userId, userId],
    ),
    sessions: all(
      `SELECT title, scheduled_at, duration_min, status, notes, meeting_link, cancelled_reason
       FROM sessions WHERE student_user_id = ? OR booked_by_user_id = ?
          OR mentor_profile_id IN (SELECT id FROM mentor_profiles WHERE user_id = ?)`,
      [userId, userId, userId],
    ),
    sessionRatings: all('SELECT session_id, rating, comment, created_at FROM session_ratings WHERE user_id = ?'),
    checkIns: all('SELECT progress, note, created_at FROM relationship_checkins WHERE user_id = ?'),
    feedback: all(
      `SELECT satisfaction_rating, would_match_again, sessions_held, relationship_status, primary_goal_progress,
              free_text_comments, submitted_at
       FROM feedback WHERE respondent_user_id = ?`,
    ),
    conversations,
    communities: all(
      `SELECT g.name, m.joined_at, (g.created_by = ?) AS created_by_me
       FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ?`,
      [userId, userId],
    ),
    eventRegistrations: all(
      'SELECT e.title, e.starts_at, r.created_at AS registered_at FROM event_registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = ?',
    ),
    opportunitiesPosted: all('SELECT title, type, location, description, posted_at, closes_at FROM mentor_opportunities WHERE posted_by_user_id = ?'),
    applications: all(
      'SELECT o.title, a.message, a.created_at FROM opportunity_applications a JOIN mentor_opportunities o ON o.id = a.opportunity_id WHERE a.user_id = ?',
    ),
    officeHoursJoined: all(
      'SELECT o.title, o.starts_at, b.created_at AS joined_at FROM office_hour_bookings b JOIN office_hours o ON o.id = b.office_hour_id WHERE b.student_user_id = ?',
    ),
    blocked: all(
      'SELECT u.name, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_user_id WHERE b.blocker_user_id = ?',
    ),
    reportsFiled: all('SELECT context_type, reason, details, status, created_at FROM reports WHERE reporter_user_id = ?'),
    notifications: all('SELECT type, title, body, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC'),
  }
}
