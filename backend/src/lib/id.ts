/**
 * Identifier generation.
 *
 * Every table uses TEXT ids. Seeded fixtures pass a readable, stable id
 * (`user-demo-student`) so demo data is greppable and re-seeding is
 * deterministic; everything created at runtime gets a UUID.
 */
import { randomUUID } from 'node:crypto'

export function newId(prefix?: string): string {
  const uuid = randomUUID()
  return prefix ? `${prefix}_${uuid}` : uuid
}
