/**
 * iCalendar (.ics) files for sessions and events (DESIGN_BACKLOG #39), so
 * people can put them in the calendar they actually live in.
 *
 * Written by hand rather than with a library: one VEVENT per file is a few
 * lines of RFC 5545, and the two rules that trip up hand-written files are both
 * handled here — text escaping and 75-octet line folding. Times are written in
 * UTC ('...Z'), which every calendar converts to its owner's timezone.
 */

export type CalendarEvent = {
  /** Stable across downloads, so re-importing updates rather than duplicates. */
  uid: string
  start: string
  end: string
  summary: string
  description?: string | null
  location?: string | null
  url?: string | null
  cancelled?: boolean
}

/** 20261015T150000Z from an ISO instant. */
function toIcsTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; newlines become \n. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * RFC 5545 §3.1: lines longer than 75 octets are folded, continuing with a
 * single space. Counted in UTF-8 bytes, and never splitting a multi-byte
 * character, which a naive character count would get wrong for names like
 * "Wanjirũ".
 */
function fold(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  // Continuation lines lose one octet to their leading space.
  let limit = 75

  for (const char of line) {
    const size = encoder.encode(char).length
    if (currentBytes + size > limit) {
      parts.push(current)
      current = ''
      currentBytes = 0
      limit = 74
    }
    current += char
    currentBytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function buildCalendar(event: CalendarEvent, now: string = new Date().toISOString()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Strathmore Alumni Connect//Mentorship//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}@strathmore-alumni-connect`,
    `DTSTAMP:${toIcsTime(now)}`,
    `DTSTART:${toIcsTime(event.start)}`,
    `DTEND:${toIcsTime(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}

/** A safe download name: letters, digits and dashes only. */
export function calendarFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${slug || 'event'}.ics`
}
