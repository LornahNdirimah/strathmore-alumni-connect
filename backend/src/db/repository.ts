/**
 * Thin typed helpers over `node:sqlite`.
 *
 * Every query in this codebase goes through these functions with bound
 * parameters — no string interpolation of user input anywhere — so SQL
 * injection is structurally impossible rather than something reviewers have to
 * catch case by case.
 */
import type { Database } from './connection.js'

/** Values SQLite can bind directly. */
export type SqlValue = string | number | bigint | null | Uint8Array

/**
 * `node:sqlite` returns rows with a null prototype, which trips up things like
 * spread-into-class and some serializers. Copying into a plain object once at
 * the boundary keeps the rest of the codebase dealing in ordinary objects.
 */
function toPlainObject<T>(row: unknown): T {
  return { ...(row as object) } as T
}

export function queryAll<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const rows = db.prepare(sql).all(...params)
  return rows.map((row) => toPlainObject<T>(row))
}

export function queryOne<T>(db: Database, sql: string, params: SqlValue[] = []): T | null {
  const row = db.prepare(sql).get(...params)
  return row === undefined ? null : toPlainObject<T>(row)
}

export function execute(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): { changes: number; lastInsertRowid: number | bigint } {
  const result = db.prepare(sql).run(...params)
  return {
    changes: Number(result.changes),
    lastInsertRowid: result.lastInsertRowid,
  }
}

export function queryScalar<T extends SqlValue>(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): T | null {
  const row = db.prepare(sql).get(...params) as Record<string, T> | undefined
  if (row === undefined) return null
  const first = Object.values(row)[0]
  return first === undefined ? null : first
}

/** SQLite has no boolean type; it stores 0/1. */
export function toBool(value: number | null | undefined): boolean {
  return value === 1
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0
}

/** Columns holding JSON arrays are stored as TEXT. */
export function parseJsonArray<T = string>(value: string | null | undefined): T[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/**
 * Expands an array into `?, ?, ?` placeholders plus its bound values.
 * Needed because SQLite cannot bind a list to a single `IN (?)` parameter.
 */
export function expandIn(values: SqlValue[]): { placeholders: string; values: SqlValue[] } {
  return {
    placeholders: values.map(() => '?').join(', '),
    values,
  }
}
