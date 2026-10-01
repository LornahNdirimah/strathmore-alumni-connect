/**
 * Turning recurring availability into concrete bookable slots.
 *
 * A mentor declares a repeating rule ("Tuesdays 17:00-19:00"). A student needs
 * to pick an actual moment. This module is the conversion between the two, kept
 * pure and free of database access so the arithmetic — which is where scheduling
 * bugs live — can be tested directly.
 *
 * Windows are wall-clock times in the mentor's timezone ("Tuesdays 17:00-19:00"
 * means 17:00 where the mentor is), because that is what a person types. Every
 * instant going in or out — slots, busy intervals, bounds — is UTC. The only
 * conversion between the two is `offsetMinutes`, applied here and nowhere else,
 * so the arithmetic that places a slot is in one tested place.
 */

export const MINUTES_PER_DAY = 1440

/** A recurring weekly window on the mentor's wall clock. `day`: 0 = Sunday. */
export type AvailabilityWindow = {
  day: number
  startMinute: number
  endMinute: number
}

/** A period a mentor is already committed for, as an ISO instant plus length. */
export type BusyInterval = {
  startIso: string
  durationMin: number
}

export type SlotOptions = {
  windows: AvailabilityWindow[]
  /** Inclusive lower bound; slots starting before this are dropped. */
  fromIso: string
  /** Exclusive upper bound. */
  toIso: string
  durationMin: number
  busy?: BusyInterval[]
  /** Safety valve so an absurd range cannot generate unbounded output. */
  maxSlots?: number
  /** The windows' timezone, as minutes east of UTC. Defaults to UTC. */
  offsetMinutes?: number
}

const DEFAULT_MAX_SLOTS = 500

/** 'Tuesday 5:30 PM' style parts, used for the human-readable slot label. */
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export function weekdayName(day: number): string {
  return WEEKDAY_NAMES[day] ?? 'Unknown'
}

/** '17:30' from 1050. Used for editing availability, where a clock time reads better. */
export function minuteToClock(minute: number): string {
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** 1050 from '17:30'. Returns null on anything that isn't a 24-hour clock time. */
export function clockToMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  return hours * 60 + minutes
}

/** Midnight UTC on the day containing `date`. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function overlaps(
  startMs: number,
  durationMin: number,
  busyStartMs: number,
  busyDurationMin: number,
): boolean {
  const endMs = startMs + durationMin * 60_000
  const busyEndMs = busyStartMs + busyDurationMin * 60_000
  // Touching edges do not overlap: a slot may start exactly when another ends.
  return startMs < busyEndMs && busyStartMs < endMs
}

/**
 * Every slot of `durationMin` that fits inside the given weekly windows between
 * `fromIso` and `toIso`, excluding any that overlaps a busy interval.
 *
 * A slot must fit entirely within its window — a 19:00 start is not offered for
 * a window ending at 19:00, because the session would run past the mentor's
 * stated availability.
 */
export function generateSlots(options: SlotOptions): string[] {
  const { windows, fromIso, toIso, durationMin, busy = [], offsetMinutes = 0 } = options
  const offsetMs = offsetMinutes * 60_000
  const maxSlots = options.maxSlots ?? DEFAULT_MAX_SLOTS

  if (windows.length === 0 || durationMin <= 0) return []

  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return []

  // Pre-resolve busy intervals to epoch millis once, rather than per candidate.
  const busyMs = busy
    .map((interval) => ({
      startMs: new Date(interval.startIso).getTime(),
      durationMin: interval.durationMin,
    }))
    .filter((interval) => !Number.isNaN(interval.startMs))

  // Group windows by weekday so each day only scans its own rules.
  const byDay = new Map<number, AvailabilityWindow[]>()
  for (const window of windows) {
    const existing = byDay.get(window.day)
    if (existing) existing.push(window)
    else byDay.set(window.day, [window])
  }

  const slots: string[] = []
  const fromMs = from.getTime()
  const toMs = to.getTime()

  // Walk the mentor's local days. `day` is a local midnight expressed on a
  // shifted clock (local time + offset reads as UTC), so getUTCDay() is the
  // local weekday; subtracting the offset turns a local slot back into UTC.
  const localTo = toMs + offsetMs
  for (
    let day = startOfUtcDay(new Date(fromMs + offsetMs));
    day.getTime() <= localTo;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const dayWindows = byDay.get(day.getUTCDay())
    if (!dayWindows) continue

    const dayStartMs = day.getTime() - offsetMs

    for (const window of dayWindows) {
      for (
        let minute = window.startMinute;
        minute + durationMin <= window.endMinute;
        minute += durationMin
      ) {
        const slotMs = dayStartMs + minute * 60_000
        if (slotMs < fromMs || slotMs >= toMs) continue

        const isBusy = busyMs.some((interval) =>
          overlaps(slotMs, durationMin, interval.startMs, interval.durationMin),
        )
        if (isBusy) continue

        slots.push(new Date(slotMs).toISOString())
        if (slots.length >= maxSlots) return sortUnique(slots)
      }
    }
  }

  return sortUnique(slots)
}

/**
 * Overlapping windows on the same day can generate the same instant twice, and
 * a caller wants slots in chronological order regardless of window order.
 */
function sortUnique(slots: string[]): string[] {
  return [...new Set(slots)].sort()
}

/**
 * Does `startIso` land exactly on one of the mentor's availability boundaries?
 *
 * Booking is validated against this rather than against the generated slot list,
 * so a client cannot post an arbitrary timestamp that merely happens to fall
 * inside a window — 17:07 is inside 17:00-19:00 but is not a slot the mentor
 * offered, and allowing it would fragment the rest of the day.
 */
export function isSlotAligned(
  startIso: string,
  windows: AvailabilityWindow[],
  durationMin: number,
  offsetMinutes = 0,
): boolean {
  const instant = new Date(startIso)
  if (Number.isNaN(instant.getTime())) return false

  // Read the instant on the mentor's wall clock, where the windows live.
  const start = new Date(instant.getTime() + offsetMinutes * 60_000)

  const minute = start.getUTCHours() * 60 + start.getUTCMinutes()
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) return false

  return windows.some((window) => {
    if (window.day !== start.getUTCDay()) return false
    if (minute < window.startMinute) return false
    if (minute + durationMin > window.endMinute) return false
    // Must sit on the mentor's own cadence from the window's start.
    return (minute - window.startMinute) % durationMin === 0
  })
}
