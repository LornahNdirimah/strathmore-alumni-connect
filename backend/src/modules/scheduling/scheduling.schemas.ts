import { z } from 'zod'

import { clockToMinute } from '../../lib/slots.js'
import { DEFAULT_TIMEZONE, TIMEZONE_LABELS, type TimezoneLabel } from '../../lib/time.js'

/**
 * A clock time as the mentor types it ('17:30'), converted to minutes from
 * midnight for storage. Accepting a clock string rather than a raw minute count
 * keeps the API self-explanatory and the form honest about what it collects.
 */
const clockTime = z
  .string()
  .trim()
  .refine((value) => clockToMinute(value) !== null, {
    message: 'Use a 24-hour time such as 17:30.',
  })
  .transform((value) => clockToMinute(value) as number)

/**
 * An ISO 8601 instant, normalised to the canonical `toISOString()` form.
 *
 * Normalising matters because instants are stored and compared as strings:
 * '…T14:00:00Z' and '…T14:00:00.000Z' are the same moment but different text,
 * so without this the double-booking unique indexes could be sidestepped by
 * formatting, and lexical comparisons against `nowIso()` could misorder.
 */
export const isoInstant = (message?: string) =>
  z
    .string()
    .datetime(message ? { message } : undefined)
    .transform((value) => new Date(value).toISOString())

export const availabilityWindowSchema = z
  .object({
    // 0 = Sunday, matching Date#getUTCDay().
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTime: clockTime,
    endTime: clockTime,
  })
  .refine((window) => window.endTime > window.startTime, {
    message: 'The end time must be after the start time.',
    path: ['endTime'],
  })

/**
 * Availability is replaced wholesale rather than patched window by window.
 * Editing a weekly schedule is a "here is my week" action, and a PUT makes
 * removing a window as expressible as adding one — with PATCH semantics a
 * deleted window needs its own endpoint and its own race conditions.
 *
 * An empty list is valid and meaningful: it is how a mentor says they are not
 * taking bookings at the moment.
 */
export const availabilityUpdateSchema = z.object({
  // A known label, because it now decides where the windows fall in UTC — free
  // text would silently be read as UTC.
  timezoneLabel: z
    .enum(TIMEZONE_LABELS as [TimezoneLabel, ...TimezoneLabel[]], {
      errorMap: () => ({ message: `Choose one of ${TIMEZONE_LABELS.join(', ')}.` }),
    })
    .default(DEFAULT_TIMEZONE),
  sessionDurationMin: z.coerce.number().int().min(15).max(240).default(30),
  windows: z.array(availabilityWindowSchema).max(40).default([]),
})

export const slotQuerySchema = z.object({
  /** How far ahead to look. Bounded so one request cannot generate months of slots. */
  days: z.coerce.number().int().min(1).max(60).default(21),
})

/**
 * A meeting URL for a virtual session. http(s) only: this becomes a link people
 * click, and `javascript:` or `data:` URLs must never get that far.
 */
const meetingLink = z
  .string()
  .trim()
  .max(500)
  .url('Enter the full meeting link, starting with https://')
  .refine((value) => /^https?:\/\//i.test(value), 'Meeting links must start with https://')

export const bookSessionSchema = z.object({
  relationshipId: z.string().trim().min(1),
  title: z.string().trim().min(2, 'Give the session a short title.').max(160),
  // ISO 8601. The mock stored 'Wednesday 5:30 PM', which cannot be sorted,
  // compared, or checked against a mentor's actual availability.
  scheduledAt: isoInstant('Pick a slot from the mentor’s availability.'),
  notes: z.string().trim().max(2000).optional(),
  meetingLink: meetingLink.optional(),
})

export const updateSessionSchema = z
  .object({
    status: z.enum(['upcoming', 'completed', 'cancelled']).optional(),
    scheduledAt: isoInstant().optional(),
    title: z.string().trim().min(2).max(160).optional(),
    notes: z.string().trim().max(2000).optional(),
    cancelledReason: z.string().trim().max(500).optional(),
    // An empty string clears the link.
    meetingLink: z.union([meetingLink, z.literal('')]).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Provide at least one field to change.',
  })

export const ratingSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
})

export const sessionListQuerySchema = z.object({
  scope: z.enum(['all', 'upcoming', 'past']).default('all'),
})

export type AvailabilityWindowInput = z.infer<typeof availabilityWindowSchema>
export type AvailabilityUpdateInput = z.infer<typeof availabilityUpdateSchema>
export type SlotQuery = z.infer<typeof slotQuerySchema>
export type BookSessionInput = z.infer<typeof bookSessionSchema>
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>
export type SessionListQuery = z.infer<typeof sessionListQuerySchema>
