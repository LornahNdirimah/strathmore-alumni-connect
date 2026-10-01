/**
 * Deleting an account (DESIGN_BACKLOG #44; ROADMAP decision D8, 2026-09-30).
 *
 * The person's identifying data is erased; the records other people depend on
 * keep their shape under "Former member". Concretely:
 *
 *   erased    name, email, password, photo, email/verification details, the
 *             career-goals or mentor profile's content, notifications, tokens,
 *             blocks, memberships, registrations, applications, bookings;
 *             free-text comments in feedback, ratings and check-ins; and the
 *             text of every message they sent ("Message removed").
 *   ended     active mentorships (the other side is told and, for a mentor,
 *             the seat frees); pending requests to or from them; future
 *             office hours they host (attendees are told).
 *   kept      the shape of mentorships, sessions, feedback scores, ratings,
 *             match events and the admin log, now tied to no one identifiable.
 *
 * All of it runs in one transaction: a deletion never half-happens. It is
 * immediate once the password is re-entered, and cannot be undone.
 */
import { randomBytes } from 'node:crypto'

import { type Database, transaction } from '../../db/connection.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import { deleteAvatarFile } from '../../lib/avatars.js'
import { ConflictError } from '../../lib/errors.js'
import { notify } from '../../lib/notifications.js'
import { nowIso } from '../../lib/time.js'

export const FORMER_MEMBER = 'Former member'

export function deleteAccount(db: Database, userId: string): void {
  const user = queryOne<{ role: string; avatar_path: string | null }>(
    db,
    'SELECT role, avatar_path FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )
  if (!user) return

  if (user.role === 'admin') {
    const otherAdmins = queryOne<{ count: number }>(
      db,
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL AND id != ?",
      [userId],
    )?.count ?? 0
    // Admins are seed-created; with none left, nobody could verify alumni again.
    if (otherAdmins === 0) {
      throw new ConflictError('You are the only administrator, so this account cannot be deleted.')
    }
  }

  const now = nowIso()
  const mentor = queryOne<{ id: string }>(db, 'SELECT id FROM mentor_profiles WHERE user_id = ?', [userId])

  transaction(db, () => {
    endMentorships(db, userId, now)
    closeRequests(db, userId, mentor?.id ?? null, now)
    if (mentor) scrubMentorProfile(db, mentor.id, now)

    // Their own records, removed outright.
    for (const sql of [
      'DELETE FROM mentorship_seekers WHERE user_id = ?',
      'DELETE FROM notifications WHERE user_id = ?',
      'DELETE FROM email_tokens WHERE user_id = ?',
      'DELETE FROM alumni_verifications WHERE user_id = ?',
      'DELETE FROM group_members WHERE user_id = ?',
      'DELETE FROM event_registrations WHERE user_id = ?',
      'DELETE FROM opportunity_applications WHERE user_id = ?',
      'DELETE FROM office_hour_bookings WHERE student_user_id = ?',
      'DELETE FROM user_blocks WHERE blocker_user_id = ? OR blocked_user_id = ?',
    ]) {
      execute(db, sql, sql.includes(' OR ') ? [userId, userId] : [userId])
    }

    // Opportunities they posted — and with them any applications.
    execute(db, 'DELETE FROM mentor_opportunities WHERE posted_by_user_id = ?', [userId])

    // Words they wrote, which can identify them, go; the scores stay.
    execute(db, "UPDATE messages SET body = 'Message removed' WHERE sender_user_id = ?", [userId])
    execute(db, 'UPDATE feedback SET free_text_comments = NULL WHERE respondent_user_id = ?', [userId])
    execute(db, 'UPDATE session_ratings SET comment = NULL WHERE user_id = ?', [userId])
    execute(db, 'UPDATE relationship_checkins SET note = NULL WHERE user_id = ?', [userId])

    // The account itself: nothing left that identifies them or signs in.
    execute(
      db,
      `UPDATE users SET name = ?, email = ?, password_hash = ?, password_salt = ?,
                        status = 'suspended', deleted_at = ?, avatar_path = NULL,
                        avatar_updated_at = NULL, email_verified_at = NULL,
                        session_version = session_version + 1, updated_at = ?
       WHERE id = ?`,
      [
        FORMER_MEMBER,
        // Unique (the column is UNIQUE) and undeliverable (.invalid is reserved).
        `deleted-${userId}@deleted.invalid`,
        randomBytes(64).toString('base64'),
        randomBytes(16).toString('base64'),
        now,
        now,
        userId,
      ],
    )
  })

  // After the commit, so a failed deletion never loses the photo.
  deleteAvatarFile(user.avatar_path)
}

function endMentorships(db: Database, userId: string, now: string): void {
  const active = queryAll<{ id: string; student_user_id: string; mentor_user_id: string }>(
    db,
    `SELECT rel.id, rel.student_user_id, mp.user_id AS mentor_user_id
     FROM mentorship_relationships rel
     JOIN mentor_profiles mp ON mp.id = rel.mentor_profile_id
     WHERE rel.status = 'active' AND (rel.student_user_id = ? OR mp.user_id = ?)`,
    [userId, userId],
  )

  for (const relationship of active) {
    execute(
      db,
      `UPDATE mentorship_relationships SET status = 'completed', ended_at = ?, ended_by_user_id = ?,
              end_reason = 'The other member closed their account.'
       WHERE id = ?`,
      [now, userId, relationship.id],
    )
    execute(
      db,
      `UPDATE sessions SET status = 'cancelled', cancelled_reason = 'The mentorship ended.'
       WHERE relationship_id = ? AND status = 'upcoming' AND scheduled_at > ?`,
      [relationship.id, now],
    )

    const otherIsStudent = relationship.mentor_user_id === userId
    notify(db, {
      userId: otherIsStudent ? relationship.student_user_id : relationship.mentor_user_id,
      type: 'mentorship.ended',
      title: 'A mentorship ended because the other member closed their account',
      body: 'Upcoming sessions were cancelled. Your history together is kept.',
      link: otherIsStudent ? '/student/my-mentors' : '/alumni/my-mentees',
    })
  }
}

function closeRequests(db: Database, userId: string, mentorProfileId: string | null, now: string): void {
  // Requests they sent simply go.
  execute(db, "UPDATE mentorship_requests SET status = 'withdrawn', responded_at = ? WHERE student_user_id = ? AND status = 'pending'", [now, userId])

  if (!mentorProfileId) return
  // Requests to them are declined, and each student is told so they can ask someone else.
  const waiting = queryAll<{ id: string; student_user_id: string }>(
    db,
    "SELECT id, student_user_id FROM mentorship_requests WHERE mentor_profile_id = ? AND status = 'pending'",
    [mentorProfileId],
  )
  for (const request of waiting) {
    execute(
      db,
      "UPDATE mentorship_requests SET status = 'declined', response_notes = 'This mentor closed their account.', responded_at = ? WHERE id = ?",
      [now, request.id],
    )
    notify(db, {
      userId: request.student_user_id,
      type: 'request.declined',
      title: 'A mentor you asked closed their account',
      body: 'Your request was closed. You are free to ask another mentor.',
      link: '/student/my-mentors',
    })
  }
}

/**
 * The mentor profile row stays — mentorships, sessions and match events point
 * at it — but everything in it that describes the person goes, and it can no
 * longer be found or booked.
 */
function scrubMentorProfile(db: Database, mentorProfileId: string, now: string): void {
  const upcoming = queryAll<{ id: string; title: string }>(
    db,
    'SELECT id, title FROM office_hours WHERE mentor_profile_id = ? AND cancelled_at IS NULL AND starts_at > ?',
    [mentorProfileId, now],
  )
  for (const officeHour of upcoming) {
    const attendees = queryAll<{ student_user_id: string }>(
      db,
      'SELECT student_user_id FROM office_hour_bookings WHERE office_hour_id = ?',
      [officeHour.id],
    )
    for (const { student_user_id: attendee } of attendees) {
      notify(db, {
        userId: attendee,
        type: 'officehour.cancelled',
        title: `Cancelled: “${officeHour.title}”`,
        body: 'The host closed their account.',
        link: '/student/my-sessions',
      })
    }
    execute(db, 'UPDATE office_hours SET cancelled_at = ?, meeting_link = NULL WHERE id = ?', [now, officeHour.id])
  }

  for (const table of ['mentor_skills', 'mentor_tracks', 'mentor_certifications', 'mentor_timeline', 'mentor_availability']) {
    execute(db, `DELETE FROM ${table} WHERE mentor_profile_id = ?`, [mentorProfileId])
  }

  execute(
    db,
    `UPDATE mentor_profiles SET headline = ?, company = '', industry = '', location = '', bio = NULL,
            capacity = 0, availability = 'Busy', major = '', hobbies = '[]', unique_quality = '',
            country = '', state_province = '', updated_at = ?
     WHERE id = ?`,
    [FORMER_MEMBER, now, mentorProfileId],
  )
}
