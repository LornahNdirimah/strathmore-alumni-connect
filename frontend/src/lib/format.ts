/**
 * Client-side date formatting, for the few ISO timestamps the API sends without
 * a display string (a mentorship's term end, when an announcement went out).
 *
 * Rendered on the platform's clock — East Africa Time — rather than the
 * browser's, matching the server's own display strings (ROADMAP D7), so two
 * people never see different dates for the same moment.
 */
const PLATFORM_TIME_ZONE = 'Africa/Nairobi'

const DATE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: PLATFORM_TIME_ZONE,
})

const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: PLATFORM_TIME_ZONE,
})

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: PLATFORM_TIME_ZONE,
})

/** 'December 22, 2026' */
export function formatDate(iso: string | null | undefined): string {
  return iso ? DATE.format(new Date(iso)) : ''
}

/** 'Dec 22' */
export function formatShortDate(iso: string | null | undefined): string {
  return iso ? SHORT_DATE.format(new Date(iso)) : ''
}

/** 'Dec 22, 5:30 PM' */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? DATE_TIME.format(new Date(iso)) : ''
}
