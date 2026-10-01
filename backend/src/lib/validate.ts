/**
 * Zod → HTTP validation boundary.
 *
 * Every route parses its input through these helpers, so handlers only ever
 * see values that already match their declared type. Failures become a 400
 * carrying per-field messages the UI can render inline, rather than a 500.
 */
import type { ZodType, ZodTypeDef } from 'zod'

import { BadRequestError } from './errors.js'

export type FieldIssue = { field: string; message: string }

/**
 * Generic over input and output separately.
 *
 * `ZodSchema<T>` is shorthand for `ZodType<T, ZodTypeDef, T>`, which asserts
 * that a schema's input and output types are identical — false for any schema
 * using `.default()`, `.coerce` or `.transform()`, and most of ours do.
 * Threading both parameters lets the caller receive the parsed output type
 * (e.g. `limit: number`) rather than the raw input type (`limit?: string`).
 */
export function parseOrThrow<Output, Def extends ZodTypeDef, Input>(
  schema: ZodType<Output, Def, Input>,
  value: unknown,
  label = 'request',
): Output {
  const result = schema.safeParse(value)

  if (!result.success) {
    const issues: FieldIssue[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
    }))

    throw new BadRequestError(`Invalid ${label}.`, issues)
  }

  return result.data
}
