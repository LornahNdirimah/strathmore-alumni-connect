/**
 * In-app notifications (DESIGN_BACKLOG #26) and the live-update hub (#56).
 *
 * Services call `notify()` inside the transaction that performs the action, so
 * a notification exists exactly when the thing it describes does. They then go
 * out as a hint over each recipient's open event stream (plugins/live.ts).
 *
 * Live events are deliberately hints — "your notifications changed", "a
 * message arrived in conversation X" — not data. The client refetches through
 * the normal authorised routes. That keeps the stream free of anything a
 * permission check has not seen, and means an event published from a
 * transaction that then rolls back costs one wasted refetch, nothing more.
 */
import type { Database } from '../db/connection.js'
import { execute, queryOne } from '../db/repository.js'
import { newId } from './id.js'
import { nowIso } from './time.js'

export type NotificationType =
  | 'request.received'
  | 'request.accepted'
  | 'request.declined'
  | 'request.withdrawn'
  | 'request.expired'
  | 'mentorship.ended'
  | 'session.booked'
  | 'session.rescheduled'
  | 'session.cancelled'
  | 'session.reminder'
  | 'message.received'
  | 'verification.approved'
  | 'verification.rejected'
  | 'announcement'
  | 'event.cancelled'
  | 'opportunity.application'
  | 'group.removed'
  | 'officehour.joined'
  | 'officehour.cancelled'
  | 'report.reviewed'

export type LiveEvent =
  | { type: 'notifications' }
  | { type: 'message'; conversationId: string }
  | { type: 'sessions' }

// --- Hub --------------------------------------------------------------------

type Listener = (event: LiveEvent) => void

/** userId → the listeners of that user's open streams (one per tab). */
const listeners = new Map<string, Set<Listener>>()

export function subscribe(userId: string, listener: Listener): () => void {
  let set = listeners.get(userId)
  if (!set) {
    set = new Set()
    listeners.set(userId, set)
  }
  set.add(listener)

  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(userId)
  }
}

/**
 * Delivers `event` to the user's open streams. Deferred to the next tick so it
 * goes out after the caller's transaction has finished.
 */
export function publish(userId: string, event: LiveEvent): void {
  const set = listeners.get(userId)
  if (!set || set.size === 0) return
  setImmediate(() => {
    for (const listener of set) listener(event)
  })
}

export function publishToEveryone(event: LiveEvent): void {
  for (const userId of listeners.keys()) publish(userId, event)
}

/** For tests and the health endpoint. */
export function connectedUserCount(): number {
  return listeners.size
}

// --- Writing notifications ----------------------------------------------------

export type NotificationInput = {
  userId: string
  type: NotificationType
  title: string
  body?: string | null
  /** In-app path the notification opens. */
  link?: string | null
  /**
   * Notifications about the same thing collapse: while one with this key is
   * unread, a new one replaces its text and time instead of adding a row. Used
   * for conversations, so ten quick messages are one notification, not ten.
   */
  groupKey?: string
}

export function notify(db: Database, input: NotificationInput): void {
  const now = nowIso()

  const existing = input.groupKey
    ? queryOne<{ id: string }>(
        db,
        'SELECT id FROM notifications WHERE user_id = ? AND group_key = ? AND read_at IS NULL',
        [input.userId, input.groupKey],
      )
    : null

  if (existing) {
    execute(db, 'UPDATE notifications SET title = ?, body = ?, link = ?, created_at = ? WHERE id = ?', [
      input.title,
      input.body ?? null,
      input.link ?? null,
      now,
      existing.id,
    ])
  } else {
    execute(
      db,
      `INSERT INTO notifications (id, user_id, type, title, body, link, group_key, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [newId('ntf'), input.userId, input.type, input.title, input.body ?? null, input.link ?? null,
       input.groupKey ?? null, now],
    )
  }

  publish(input.userId, { type: 'notifications' })
}

/**
 * One notification per active account in `roles` — how an announcement
 * reaches its audience. A single INSERT … SELECT, so a thousand recipients is
 * one statement rather than a thousand round trips.
 */
export function notifyRoles(
  db: Database,
  roles: Array<'student' | 'alumni'>,
  input: Omit<NotificationInput, 'userId' | 'groupKey'>,
): number {
  if (roles.length === 0) return 0
  const placeholders = roles.map(() => '?').join(', ')
  const now = nowIso()

  const { changes } = execute(
    db,
    `INSERT INTO notifications (id, user_id, type, title, body, link, group_key, created_at, read_at)
     SELECT 'ntf_' || lower(hex(randomblob(16))), id, ?, ?, ?, ?, NULL, ?, NULL
     FROM users WHERE role IN (${placeholders}) AND status = 'active'`,
    [input.type, input.title, input.body ?? null, input.link ?? null, now, ...roles],
  )

  publishToEveryone({ type: 'notifications' })
  return changes
}
