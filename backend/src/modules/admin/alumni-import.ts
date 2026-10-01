/**
 * Bulk alumni import (DESIGN_BACKLOG #46): the alumni office's register,
 * uploaded as CSV, becomes verified accounts.
 *
 * Two steps, so nothing is written by accident: a preview reports what each
 * row would do; the import then creates the accounts that previewed cleanly.
 * Imported alumni are active and verified — the register is the evidence an
 * admin would otherwise check by hand — but have no password: each receives an
 * invitation link, valid for a week, to choose one. Following it also confirms
 * their email address. They accept the privacy notice and code of conduct at
 * first sign-in, like anyone else.
 */
import { randomBytes } from 'node:crypto'

import { z } from 'zod'

import type { ImportResult, ImportRow } from '../../contract/index.js'

import { type Database, transaction } from '../../db/connection.js'
import { execute, queryAll } from '../../db/repository.js'
import { recordAudit } from '../../lib/audit.js'
import { parseCsv } from '../../lib/csv.js'
import { issueToken } from '../../lib/emailTokens.js'
import { BadRequestError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import { appUrl, invitationEmail, sendEmail } from '../../lib/mailer.js'
import { nowIso } from '../../lib/time.js'

export const MAX_IMPORT_ROWS = 500

export const importSchema = z.object({
  csv: z.string().min(1, 'Paste or upload the CSV.').max(500_000),
  dryRun: z.boolean().default(true),
})

const rowSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short.').max(120),
  email: z.string().trim().toLowerCase().email('Not a valid email address.').max(254),
  classYear: z
    .string()
    .trim()
    .regex(/^(19|20)\d{2}$/, 'Class year must be a year such as 2018.'),
  program: z.string().trim().min(2, 'Programme is missing.').max(160),
})

/** Header spellings a registry export might use, mapped to our fields. */
const HEADERS: Record<string, keyof z.infer<typeof rowSchema>> = {
  name: 'name',
  'full name': 'name',
  email: 'email',
  'email address': 'email',
  'class year': 'classYear',
  classyear: 'classYear',
  class_year: 'classYear',
  'graduation year': 'classYear',
  year: 'classYear',
  program: 'program',
  programme: 'program',
  course: 'program',
}

type ImportRowResult = ImportRow

export function importAlumni(
  db: Database,
  adminId: string,
  input: z.infer<typeof importSchema>,
): ImportResult {
  const table = parseCsv(input.csv)
  if (table.length < 2) throw new BadRequestError('The CSV needs a header row and at least one alumnus.')

  const header = table[0]!.map((cell) => HEADERS[cell.trim().toLowerCase()])
  const missing = (['name', 'email', 'classYear', 'program'] as const).filter((field) => !header.includes(field))
  if (missing.length > 0) {
    throw new BadRequestError(
      `The header row needs columns for ${missing.join(', ')} (for example: name, email, class year, programme).`,
    )
  }

  const body = table.slice(1)
  if (body.length > MAX_IMPORT_ROWS) {
    throw new BadRequestError(`Import at most ${MAX_IMPORT_ROWS} alumni at a time; this file has ${body.length}.`)
  }

  const existing = new Set(
    queryAll<{ email: string }>(db, 'SELECT lower(email) AS email FROM users').map((row) => row.email),
  )
  const seenInFile = new Set<string>()

  const rows: Array<ImportRowResult & { data?: z.infer<typeof rowSchema> }> = body.map((cells, index) => {
    const record: Record<string, string> = {}
    header.forEach((field, column) => {
      if (field) record[field] = cells[column] ?? ''
    })

    const parsed = rowSchema.safeParse(record)
    const base = { line: index + 2, name: (record.name ?? '').trim(), email: (record.email ?? '').trim().toLowerCase() }
    if (!parsed.success) {
      return { ...base, status: 'invalid', problems: parsed.error.issues.map((issue) => issue.message) }
    }
    if (existing.has(parsed.data.email)) {
      return { ...base, status: 'duplicate', problems: ['An account with this email already exists.'] }
    }
    if (seenInFile.has(parsed.data.email)) {
      return { ...base, status: 'duplicate', problems: ['This email appears earlier in the file.'] }
    }
    seenInFile.add(parsed.data.email)
    return { ...base, status: 'ready', problems: [], data: parsed.data }
  })

  const invitations: Array<{ email: string; name: string; token: string }> = []

  if (!input.dryRun) {
    const ready = rows.filter((row) => row.status === 'ready' && row.data)
    transaction(db, () => {
      const now = nowIso()
      for (const row of ready) {
        const data = row.data!
        const userId = newId('user')
        // No usable password: random bytes that match no one's input. The
        // invitation link is how its owner sets a real one.
        execute(
          db,
          `INSERT INTO users (id, name, email, password_hash, password_salt, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'alumni', 'active', ?, ?)`,
          [userId, data.name, data.email, randomBytes(64).toString('base64'), randomBytes(16).toString('base64'), now, now],
        )
        execute(
          db,
          `INSERT INTO alumni_verifications (id, user_id, class_year, program, status, reviewed_by, reviewed_at, created_at)
           VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)`,
          [newId('ver'), userId, data.classYear, data.program, adminId, now, now],
        )
        invitations.push({ email: data.email, name: data.name, token: issueToken(db, userId, 'invite') })
        row.status = 'created'
      }

      if (ready.length > 0) {
        recordAudit(db, {
          adminUserId: adminId,
          action: 'alumni.imported',
          targetType: 'import',
          targetId: newId('import'),
          summary: `Imported ${ready.length} alumni from a CSV and sent their invitations.`,
        })
      }
    })

    // After the commit: an email must never go out for an account that does not exist.
    for (const invitation of invitations) {
      sendEmail(
        invitationEmail(invitation.email, invitation.name, appUrl(`/reset-password?token=${invitation.token}&invite=1`)),
      )
    }
  }

  const summary = { ready: 0, created: 0, duplicate: 0, invalid: 0 }
  for (const row of rows) summary[row.status] += 1

  return { rows: rows.map(({ data: _data, ...row }) => row), summary, dryRun: input.dryRun }
}
