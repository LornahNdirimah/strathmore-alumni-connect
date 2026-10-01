/**
 * Announcements as their audience reads them (DESIGN_BACKLOG #22).
 *
 * Admins could always publish, but the only read route was admin-only, so no
 * student or alumnus ever saw an announcement. This is that read side: each
 * account sees what was addressed to everyone plus what was addressed to its
 * own role.
 */
import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { queryAll } from '../../db/repository.js'
import type { AuthRole } from '../../types/domain.js'

/** Which `audience` values a role receives. Admins see everything they sent. */
const AUDIENCES_FOR: Record<AuthRole, string[]> = {
  student: ['all', 'students'],
  alumni: ['all', 'alumni'],
  admin: ['all', 'students', 'alumni'],
}

export async function announcementRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  app.get('/', { preHandler: app.requireAuth }, async (request) => {
    const audiences = AUDIENCES_FOR[request.currentUser!.role]
    const placeholders = audiences.map(() => '?').join(', ')

    return {
      announcements: queryAll<{ id: string; title: string; body: string; audience: string; created_at: string }>(
        db,
        `SELECT id, title, body, audience, created_at FROM announcements
         WHERE audience IN (${placeholders})
         ORDER BY created_at DESC LIMIT 20`,
        audiences,
      ).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        audience: row.audience,
        createdAt: row.created_at,
      })),
    }
  })
}
