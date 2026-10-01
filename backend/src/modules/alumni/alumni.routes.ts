/**
 * The alumni directory (DESIGN_BACKLOG #41): verified alumni finding each other
 * by name, class year, programme, company or industry.
 *
 * Communities connect alumni by topic; this connects them by who they are. It
 * is alumni-only (`alumni.directory`), shows only verified, active accounts,
 * and exposes what an alumnus already shares with the network — never their
 * email address. Alumni may message one another freely (ROADMAP D2), so a
 * listing is one click from a conversation.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getDatabase } from '../../db/connection.js'
import { queryAll, queryScalar } from '../../db/repository.js'
import { avatarUrl } from '../../lib/avatars.js'
import { parseOrThrow } from '../../lib/validate.js'

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  classYear: z
    .string()
    .trim()
    .regex(/^(19|20)\d{2}$/)
    .optional(),
  industry: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(30),
})

type Row = {
  id: string
  name: string
  avatar_updated_at: string | null
  class_year: string | null
  program: string | null
  mentor_profile_id: string | null
  headline: string | null
  company: string | null
  industry: string | null
  location: string | null
}

export async function alumniRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  app.get('/', { preHandler: app.requireCapability('alumni.directory') }, async (request) => {
    const query = parseOrThrow(querySchema, request.query, 'directory filters')
    const viewerId = request.currentUser!.sub

    // The latest approved verification supplies class year and programme; the
    // mentor profile, when there is one, supplies role, company and industry.
    const from = `
      FROM users u
      LEFT JOIN alumni_verifications v ON v.id = (
        SELECT v2.id FROM alumni_verifications v2
        WHERE v2.user_id = u.id AND v2.status = 'approved'
        ORDER BY v2.created_at DESC LIMIT 1
      )
      LEFT JOIN mentor_profiles mp ON mp.user_id = u.id
    `
    // Someone who chose to leave the directory (#44) is left out of it; a
    // mentor profile of theirs is still found through mentor search.
    const conditions = ["u.role = 'alumni'", "u.status = 'active'", 'u.directory_visible = 1', 'u.id != ?']
    const params: (string | number)[] = [viewerId]

    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
      conditions.push(
        `(u.name LIKE ? ESCAPE '\\' OR v.program LIKE ? ESCAPE '\\'
          OR mp.company LIKE ? ESCAPE '\\' OR mp.headline LIKE ? ESCAPE '\\')`,
      )
      params.push(like, like, like, like)
    }
    if (query.classYear) {
      conditions.push('v.class_year = ?')
      params.push(query.classYear)
    }
    if (query.industry) {
      conditions.push('mp.industry = ?')
      params.push(query.industry)
    }

    const where = `WHERE ${conditions.join(' AND ')}`
    const total = queryScalar<number>(db, `SELECT COUNT(*) ${from} ${where}`, params) ?? 0

    const rows = queryAll<Row>(
      db,
      `SELECT u.id, u.name, u.avatar_updated_at, v.class_year, v.program, mp.id AS mentor_profile_id,
              mp.headline, mp.company, mp.industry, mp.location
       ${from} ${where}
       ORDER BY u.name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
      [...params, query.limit, (query.page - 1) * query.limit],
    )

    // Facets for the filters, over the whole directory rather than this page.
    const classYears = queryAll<{ class_year: string }>(
      db,
      // Only well-formed years: older data may hold free text.
      `SELECT DISTINCT class_year FROM alumni_verifications
       WHERE status = 'approved' AND class_year GLOB '[12][0-9][0-9][0-9]'
       ORDER BY class_year DESC`,
    ).map((row) => row.class_year)
    const industries = queryAll<{ industry: string }>(
      db,
      "SELECT DISTINCT industry FROM mentor_profiles WHERE industry != '' ORDER BY industry ASC",
    ).map((row) => row.industry)

    return {
      alumni: rows.map((row) => ({
        userId: row.id,
        name: row.name,
        avatarUrl: avatarUrl(row.id, row.avatar_updated_at),
        classYear: row.class_year,
        program: row.program,
        headline: row.headline,
        company: row.company,
        industry: row.industry,
        location: row.location,
        mentorProfileId: row.mentor_profile_id,
      })),
      total,
      page: query.page,
      limit: query.limit,
      classYears,
      industries,
    }
  })
}
