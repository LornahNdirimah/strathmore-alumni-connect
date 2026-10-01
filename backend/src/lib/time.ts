/**
 * Time handling.
 *
 * The database stores ISO 8601 UTC strings; the UI wants human strings like
 * 'October 15, 2026', '6:00 PM EAT' and 'Yesterday'. Keeping the conversion in
 * one place means storage stays sortable and comparable while the frontend
 * still receives exactly the display shapes it already renders.
 */

/**
 * Supported timezone labels and their fixed offsets from UTC, in minutes.
 *
 * Instants are always stored in UTC; a label says which wall clock to show them
 * on. The platform serves one region, and none of these zones observes daylight
 * saving, so a fixed offset per label is exact (ROADMAP decision D7). Before
 * this, the label was only text appended to a UTC time: a mentor in Nairobi
 * who typed 17:00 was stored at 17:00 UTC — 20:00 in Nairobi — and every "has
 * this passed yet?" check ran three hours late.
 *
 * A zone with daylight saving cannot be added here; it needs real tz data.
 */
export const TIMEZONE_OFFSETS = {
  EAT: 180, // East Africa Time — Kenya, Uganda, Tanzania
  CAT: 120, // Central Africa Time
  SAST: 120, // South Africa Standard Time
  WAT: 60, // West Africa Time
  GMT: 0,
  UTC: 0,
} as const

export type TimezoneLabel = keyof typeof TIMEZONE_OFFSETS
export const TIMEZONE_LABELS = Object.keys(TIMEZONE_OFFSETS) as TimezoneLabel[]
export const DEFAULT_TIMEZONE: TimezoneLabel = 'EAT'

/** Offset for a label; an unknown or empty label is treated as UTC. */
export function offsetMinutesFor(label: string | null | undefined): number {
  const key = (label ?? '').trim().toUpperCase() as TimezoneLabel
  return TIMEZONE_OFFSETS[key] ?? 0
}

/** The instant moved onto a wall clock, so the UTC formatters print local time. */
function toWallClock(iso: string, offsetMinutes: number): Date {
  return new Date(new Date(iso).getTime() + offsetMinutes * 60_000)
}

/**
 * '2026-10-15T18:00' on the wall clock `offsetMinutes` from UTC, as the UTC
 * instant it denotes. This is how a person enters a time ("6 PM in Nairobi");
 * null when the text is not a valid local date-time.
 */
export function wallClockToIso(local: string, offsetMinutes: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim())
  if (!match) return null

  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number]
  const utcMs = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(utcMs)
  // Reject dates JavaScript would silently roll over, such as 2026-02-30.
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) {
    return null
  }
  return new Date(utcMs - offsetMinutes * 60_000).toISOString()
}

/** The inverse of wallClockToIso: an instant as 'YYYY-MM-DDTHH:mm' local text. */
export function isoToWallClock(iso: string, offsetMinutes: number): string {
  return toWallClock(iso, offsetMinutes).toISOString().slice(0, 16)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
})

/** 'October 15, 2026', on the wall clock `offsetMinutes` from UTC. */
export function formatDisplayDate(iso: string, offsetMinutes = 0): string {
  return DATE_FORMATTER.format(toWallClock(iso, offsetMinutes))
}

/**
 * '6:00 PM EAT', or '9:00 AM - 4:00 PM EAT' when the event has an end time.
 * The zone label is appended once, to the range as a whole.
 */
export function formatDisplayTimeRange(
  startIso: string,
  endIso: string | null,
  timezoneLabel: string,
): string {
  const offset = offsetMinutesFor(timezoneLabel)
  const start = TIME_FORMATTER.format(toWallClock(startIso, offset))
  if (!endIso) return `${start} ${timezoneLabel}`.trim()

  const end = TIME_FORMATTER.format(toWallClock(endIso, offset))
  return `${start} - ${end} ${timezoneLabel}`.trim()
}

/**
 * Chat-style relative label: '10:32 AM' today, 'Yesterday', a weekday name
 * within the last week, otherwise a short date. Matches what the messaging UI
 * already displays.
 */
export function formatRelativeTimestamp(
  iso: string,
  now: Date = new Date(),
  offsetMinutes = 0,
): string {
  // Both ends on the same wall clock, so "today" and "yesterday" are local days.
  const then = toWallClock(iso, offsetMinutes)
  now = toWallClock(now.toISOString(), offsetMinutes)
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const dayDelta = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)

  if (dayDelta <= 0) return TIME_FORMATTER.format(then)
  if (dayDelta === 1) return 'Yesterday'
  if (dayDelta < 7) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(then)
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(then)
}

/** 'Wednesday 5:30 PM' — the slot label the session lists use. */
export function formatSlotLabel(iso: string, offsetMinutes = 0): string {
  const date = toWallClock(iso, offsetMinutes)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date)
  return `${weekday} ${TIME_FORMATTER.format(date)}`
}
