import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { execute, queryAll, queryScalar } from '../../db/repository.js'
import { NotFoundError, UnauthorizedError } from '../../lib/errors.js'
import { type LiveEvent, subscribe } from '../../lib/notifications.js'
import { nowIso } from '../../lib/time.js'

/** Comment line sent periodically so proxies and browsers keep the stream open. */
const HEARTBEAT_MS = 25_000

type NotificationRow = {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  created_at: string
  read_at: string | null
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  // Open streams, so shutdown can end them instead of waiting on them. Hooks
  // cannot be added once the server is running, so this one is registered now.
  const openStreams = new Set<() => void>()
  app.addHook('onClose', async () => {
    for (const end of openStreams) end()
  })

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  /** The latest notifications and how many are unread. */
  app.get('/', { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request)

    const notifications = queryAll<NotificationRow>(
      db,
      `SELECT id, type, title, body, link, created_at, read_at FROM notifications
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
      [userId],
    ).map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      createdAt: row.created_at,
      read: row.read_at !== null,
    }))

    const unreadCount =
      queryScalar<number>(
        db,
        'SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL',
        [userId],
      ) ?? 0

    return { notifications, unreadCount }
  })

  app.post('/:notificationId/read', { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request)
    const { notificationId } = request.params as { notificationId: string }

    // Scoped to the owner: someone else's id is simply not found.
    const { changes } = execute(
      db,
      'UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?',
      [nowIso(), notificationId, userId],
    )
    if (changes === 0) throw new NotFoundError('Notification not found.')
    return { message: 'Marked as read.' }
  })

  app.post('/read-all', { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request)
    execute(db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [
      nowIso(),
      userId,
    ])
    return { message: 'All caught up.' }
  })

  /**
   * Live updates as server-sent events (DESIGN_BACKLOG #56).
   *
   * One long-lived response per open tab. Each event is a hint — the client
   * refetches through the ordinary routes — so nothing here bypasses the
   * permission checks those routes make. Polling stays in the client as a
   * slower fallback, so a proxy that buffers or drops the stream degrades
   * freshness, not correctness.
   */
  app.get('/stream', { preHandler: app.requireAuth }, async (request, reply) => {
    const userId = requireUserId(request)

    // Taking over the socket skips Fastify's normal send, so the headers set
    // by the CORS and Helmet hooks are copied across explicitly — without
    // them the browser refuses a cross-origin stream.
    reply.hijack()
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stop nginx and similar proxies from buffering the stream.
      'X-Accel-Buffering': 'no',
    })

    const send = (event: LiveEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    }

    // Tell the client how long to wait before reconnecting, and that it is live.
    reply.raw.write('retry: 5000\n\n')
    send({ type: 'notifications' })

    const unsubscribe = subscribe(userId, send)
    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), HEARTBEAT_MS)
    heartbeat.unref()

    const close = () => {
      clearInterval(heartbeat)
      unsubscribe()
      openStreams.delete(end)
    }
    const end = () => {
      close()
      reply.raw.end()
    }
    openStreams.add(end)
    request.raw.on('close', close)
  })
}
