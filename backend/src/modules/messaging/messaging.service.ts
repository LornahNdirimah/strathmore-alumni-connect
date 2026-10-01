import { type Database, transaction } from '../../db/connection.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import { ForbiddenError, NotFoundError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import {
  DEFAULT_TIMEZONE,
  formatRelativeTimestamp as formatUtcRelative,
  nowIso,
  offsetMinutesFor,
} from '../../lib/time.js'

/** Message times on the platform's local clock, so "today" means today here. */
function formatRelativeTimestamp(iso: string): string {
  return formatUtcRelative(iso, new Date(), offsetMinutesFor(DEFAULT_TIMEZONE))
}
import { avatarUrl } from '../../lib/avatars.js'
import { isBlockedBetween } from '../safety/safety.service.js'
import { notify, publish } from '../../lib/notifications.js'
import type { AuthRole } from '../../types/domain.js'

export type ConversationView = {
  id: string
  participantId: string
  participantName: string
  participantRole: string
  participantAvatarUrl: string | null
  preview: string
  lastMessageTime: string
  unreadCount: number
}

export type MessageView = {
  id: string
  conversationId: string
  /**
   * Derived per viewer rather than stored. The mock wrote `from: 'me'|'them'`
   * onto the row itself, which meant the same record rendered incorrectly for
   * the other participant.
   */
  from: 'me' | 'them'
  text: string
  time: string
  createdAt: string
}

function assertParticipant(db: Database, conversationId: string, userId: string): void {
  const row = queryOne<{ user_id: string }>(
    db,
    'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId],
  )
  if (!row) throw new ForbiddenError('You are not part of this conversation.')
}

export function listConversations(db: Database, userId: string): ConversationView[] {
  const rows = queryAll<{
    id: string
    other_user_id: string
    other_name: string
    other_role: string
    other_avatar_at: string | null
    preview: string | null
    last_at: string | null
    unread_count: number
  }>(
    db,
    `SELECT c.id,
            other.id AS other_user_id,
            other.name AS other_name,
            other.role AS other_role,
            other.avatar_updated_at AS other_avatar_at,
            (SELECT m.body FROM messages m WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS preview,
            (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_at,
            (SELECT COUNT(*) FROM messages m
             WHERE m.conversation_id = c.id
               AND m.sender_user_id != ?
               AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)) AS unread_count
     FROM conversations c
     JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = ?
     JOIN conversation_participants them ON them.conversation_id = c.id AND them.user_id != ?
     JOIN users other ON other.id = them.user_id
     ORDER BY COALESCE(last_at, c.created_at) DESC`,
    [userId, userId, userId],
  )

  return rows.map((row) => ({
    id: row.id,
    participantId: row.other_user_id,
    participantName: row.other_name,
    participantRole: row.other_role,
    participantAvatarUrl: avatarUrl(row.other_user_id, row.other_avatar_at),
    preview: row.preview ?? 'No messages yet.',
    lastMessageTime: row.last_at ? formatRelativeTimestamp(row.last_at) : '',
    unreadCount: row.unread_count,
  }))
}

export function listMessages(db: Database, conversationId: string, userId: string): MessageView[] {
  assertParticipant(db, conversationId, userId)

  return queryAll<{ id: string; sender_user_id: string; body: string; created_at: string }>(
    db,
    'SELECT id, sender_user_id, body, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId],
  ).map((row) => ({
    id: row.id,
    conversationId,
    from: row.sender_user_id === userId ? ('me' as const) : ('them' as const),
    text: row.body,
    time: formatRelativeTimestamp(row.created_at),
    createdAt: row.created_at,
  }))
}

export function sendMessage(
  db: Database,
  conversationId: string,
  userId: string,
  body: string,
): MessageView {
  assertParticipant(db, conversationId, userId)

  const others = queryAll<{ user_id: string }>(
    db,
    'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?',
    [conversationId, userId],
  )
  if (others.some((other) => isBlockedBetween(db, userId, other.user_id))) {
    throw new ForbiddenError('You cannot message this account.')
  }

  const timestamp = nowIso()
  const id = newId('msg')

  transaction(db, () => {
    execute(
      db,
      'INSERT INTO messages (id, conversation_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, conversationId, userId, body, timestamp],
    )
    execute(db, 'UPDATE conversations SET updated_at = ? WHERE id = ?', [timestamp, conversationId])
    // Sending implies having read everything before it.
    execute(
      db,
      'UPDATE conversation_participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
      [timestamp, conversationId, userId],
    )

    const sender = queryOne<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', [userId])
    const recipients = queryAll<{ user_id: string }>(
      db,
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?',
      [conversationId, userId],
    )
    for (const { user_id: recipientId } of recipients) {
      // One unread notification per conversation, refreshed by each new
      // message, rather than one per message.
      notify(db, {
        userId: recipientId,
        type: 'message.received',
        title: `New message from ${sender?.name ?? 'someone'}`,
        body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
        link: `/messages?c=${encodeURIComponent(conversationId)}`,
        groupKey: `conversation:${conversationId}`,
      })
      publish(recipientId, { type: 'message', conversationId })
    }
    // The sender's other open tabs show the message too.
    publish(userId, { type: 'message', conversationId })
  })

  return {
    id,
    conversationId,
    from: 'me',
    text: body,
    time: formatRelativeTimestamp(timestamp),
    createdAt: timestamp,
  }
}

/** Clears the unread badge — the mock had no way to ever decrement it. */
/**
 * Marks the thread read up to its newest message.
 *
 * Deliberately the newest message's timestamp rather than `now()`: a message
 * that arrives between the reader opening the thread and this write landing has
 * not been read, and stamping the current time would mark it read anyway and
 * lose the notification. Using the newest message the reader could actually have
 * seen keeps anything later genuinely unread.
 *
 * One residual edge remains: because unread is a strict `>` comparison, a message
 * written in the very same millisecond as the newest read one is treated as read.
 * Closing that needs a per-conversation sequence rather than a timestamp, which
 * is not worth a schema change for a sub-millisecond race between two people.
 */
export function markRead(db: Database, conversationId: string, userId: string): void {
  assertParticipant(db, conversationId, userId)

  const newest = queryOne<{ created_at: string }>(
    db,
    'SELECT created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1',
    [conversationId],
  )

  // Nothing to acknowledge in an empty thread; leaving last_read_at null keeps
  // every future message unread, which is correct.
  if (!newest) return

  execute(
    db,
    'UPDATE conversation_participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
    [newest.created_at, conversationId, userId],
  )

  // Reading the thread answers its notification too.
  execute(
    db,
    'UPDATE notifications SET read_at = ? WHERE user_id = ? AND group_key = ? AND read_at IS NULL',
    [nowIso(), userId, `conversation:${conversationId}`],
  )
  publish(userId, { type: 'notifications' })
}

/**
 * Who may start a conversation with whom (ROADMAP decision D2).
 *
 * Messaging exists to support mentorship and the alumni network, not as an open
 * directory of inboxes:
 *   - a student and an alumnus may talk once they share a mentorship or an open
 *     request — so a mentor can ask a requester a question before accepting;
 *   - alumni may message each other freely;
 *   - students may not message each other, and nobody messages an admin
 *     (admins do not have messaging at all — see lib/policy.ts).
 *
 * Checked when a thread is opened. An existing thread stays readable, so ending
 * a mentorship later does not erase what was said.
 */
function assertMayConverse(
  db: Database,
  from: { id: string; role: AuthRole },
  to: { id: string; role: AuthRole; status: string },
): void {
  if (to.status !== 'active' || to.role === 'admin') {
    throw new ForbiddenError('You cannot message this account.')
  }

  if (from.role === 'alumni' && to.role === 'alumni') return

  if (from.role === 'student' && to.role === 'student') {
    throw new ForbiddenError('Students can message their mentors, not other students.')
  }

  const [studentId, alumnusId] = from.role === 'student' ? [from.id, to.id] : [to.id, from.id]
  const linked = queryOne<{ linked: number }>(
    db,
    `SELECT 1 AS linked
     FROM mentor_profiles mp
     WHERE mp.user_id = ?
       AND (
         EXISTS (SELECT 1 FROM mentorship_relationships r
                 WHERE r.mentor_profile_id = mp.id AND r.student_user_id = ?)
         OR EXISTS (SELECT 1 FROM mentorship_requests q
                    WHERE q.mentor_profile_id = mp.id AND q.student_user_id = ?
                      AND q.status IN ('pending', 'accepted'))
       )`,
    [alumnusId, studentId, studentId],
  )

  if (!linked) {
    throw new ForbiddenError(
      from.role === 'student'
        ? 'You can message a mentor once you have sent them a request.'
        : 'You can message a student once they have requested you as a mentor.',
    )
  }
}

/**
 * Finds the existing 1:1 conversation between two users or creates one.
 * Idempotent, so the "Message" button on a mentor profile can be pressed
 * repeatedly without spawning duplicate threads.
 */
export function openConversation(
  db: Database,
  caller: { id: string; role: AuthRole },
  otherUserId: string,
): string {
  const userId = caller.id
  if (userId === otherUserId) throw new ForbiddenError('You cannot message yourself.')

  const other = queryOne<{ id: string; role: AuthRole; status: string }>(
    db,
    'SELECT id, role, status FROM users WHERE id = ?',
    [otherUserId],
  )
  if (!other) throw new NotFoundError('That user does not exist.')

  const existing = queryOne<{ id: string }>(
    db,
    `SELECT c.id FROM conversations c
     JOIN conversation_participants a ON a.conversation_id = c.id AND a.user_id = ?
     JOIN conversation_participants b ON b.conversation_id = c.id AND b.user_id = ?
     LIMIT 1`,
    [userId, otherUserId],
  )
  // A block stops new messages both ways, even in an existing thread.
  if (isBlockedBetween(db, userId, otherUserId)) {
    throw new ForbiddenError('You cannot message this account.')
  }

  if (existing) return existing.id

  assertMayConverse(db, caller, other)

  const id = newId('conv')
  const timestamp = nowIso()

  transaction(db, () => {
    execute(db, 'INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)', [
      id,
      timestamp,
      timestamp,
    ])
    for (const participant of [userId, otherUserId]) {
      // last_read_at stays null for both, including the creator. Stamping the
      // creator as having read "up to now" was wrong twice over: there are no
      // messages in a conversation that was just created, and because unread is
      // counted with a strict `created_at > last_read_at`, the first message
      // sent in the same millisecond as creation was silently counted as read.
      execute(
        db,
        'INSERT INTO conversation_participants (conversation_id, user_id, last_read_at) VALUES (?, ?, NULL)',
        [id, participant],
      )
    }
  })

  return id
}
