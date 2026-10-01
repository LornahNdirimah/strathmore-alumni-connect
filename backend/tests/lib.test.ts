/**
 * Unit tests for the pure helpers. These are cheap to test directly and each one
 * here previously produced wrong output that only showed up as odd text in the
 * UI ("9:00 AM PM", "open to-students"), which is exactly the kind of defect a
 * route-level test does not notice.
 */
import { describe, expect, it } from 'vitest'

import { parseEnvFile } from '../src/config/dotenv.js'
import {
  formatDisplayDate,
  formatDisplayTimeRange,
  formatRelativeTimestamp,
  formatSlotLabel,
  offsetMinutesFor,
} from '../src/lib/time.js'

describe('formatDisplayTimeRange', () => {
  it('renders a single time on the labelled wall clock', () => {
    // 15:00 UTC is 6 PM in Nairobi. Before timezone offsets this printed the
    // UTC clock with 'EAT' stuck on, three hours off.
    expect(formatDisplayTimeRange('2026-10-05T15:00:00.000Z', null, 'EAT')).toBe('6:00 PM EAT')
  })

  it('renders a range with the label applied once', () => {
    // The seeded 'Tech Career Fair' is a 9-to-4 event. Appending the label to
    // each half would read '9:00 AM EAT - 4:00 PM EAT'.
    expect(formatDisplayTimeRange('2026-10-12T06:00:00.000Z', '2026-10-12T13:00:00.000Z', 'EAT')).toBe(
      '9:00 AM - 4:00 PM EAT',
    )
  })

  it('does not mistake a range’s meridiem for a zone label', () => {
    // Regression: parsing '9:00 AM – 4:00 PM' captured the trailing 'PM' as the
    // timezone, so the event rendered as '9:00 AM PM'.
    const rendered = formatDisplayTimeRange('2026-10-12T09:00:00.000Z', null, 'EAT')
    expect(rendered).not.toMatch(/AM PM/)
  })

  it('tolerates a missing zone label without leaving a trailing space', () => {
    expect(formatDisplayTimeRange('2026-10-05T18:00:00.000Z', null, '')).toBe('6:00 PM')
  })
})

describe('formatDisplayDate', () => {
  it('formats in UTC so the date does not shift with the host timezone', () => {
    expect(formatDisplayDate('2026-10-05T18:00:00.000Z')).toBe('October 5, 2026')
    // Late-evening UTC must not roll forward a day.
    expect(formatDisplayDate('2026-10-05T23:30:00.000Z')).toBe('October 5, 2026')
  })
})

describe('timezone offsets', () => {
  it('knows the supported labels and treats anything else as UTC', () => {
    expect(offsetMinutesFor('EAT')).toBe(180)
    expect(offsetMinutesFor('eat')).toBe(180)
    expect(offsetMinutesFor('WAT')).toBe(60)
    expect(offsetMinutesFor('XYZ')).toBe(0)
    expect(offsetMinutesFor(null)).toBe(0)
  })

  it('moves the date across midnight when the local day differs from UTC', () => {
    // 22:30 UTC on the 5th is 01:30 on the 6th in Nairobi.
    expect(formatDisplayDate('2026-10-05T22:30:00.000Z', 180)).toBe('October 6, 2026')
    expect(formatSlotLabel('2026-10-05T22:30:00.000Z', 180)).toBe('Tuesday 1:30 AM')
  })

  it('buckets "today" by the local day', () => {
    const now = new Date('2026-09-28T22:00:00.000Z') // 01:00 on the 29th in EAT
    expect(formatRelativeTimestamp('2026-09-28T21:30:00.000Z', now, 180)).toBe('12:30 AM')
    expect(formatRelativeTimestamp('2026-09-28T12:00:00.000Z', now, 180)).toBe('Yesterday')
  })
})

describe('formatRelativeTimestamp', () => {
  const now = new Date('2026-09-28T12:00:00.000Z')

  it('shows a clock time for today', () => {
    expect(formatRelativeTimestamp('2026-09-28T10:32:00.000Z', now)).toBe('10:32 AM')
  })

  it('shows "Yesterday" for the previous day', () => {
    expect(formatRelativeTimestamp('2026-09-27T22:00:00.000Z', now)).toBe('Yesterday')
  })

  it('shows a weekday within the last week', () => {
    expect(formatRelativeTimestamp('2026-09-24T09:00:00.000Z', now)).toBe('Thu')
  })

  it('shows a short date beyond a week', () => {
    expect(formatRelativeTimestamp('2026-09-01T09:00:00.000Z', now)).toBe('Sep 1')
  })
})

describe('formatSlotLabel', () => {
  it('names the weekday and time', () => {
    expect(formatSlotLabel('2026-09-30T17:30:00.000Z')).toBe('Wednesday 5:30 PM')
  })
})

describe('parseEnvFile', () => {
  it('reads plain assignments and ignores comments and blank lines', () => {
    const parsed = parseEnvFile(
      ['# a comment', '', 'PORT=3001', 'HOST=127.0.0.1', '  ', '# another'].join('\n'),
    )

    expect(parsed).toEqual({ PORT: '3001', HOST: '127.0.0.1' })
  })

  it('keeps base64url secrets intact', () => {
    // A JWT secret can legitimately contain '=' and '-'; splitting on every '='
    // or trimming too eagerly would corrupt it and produce confusing 401s.
    const secret = 'abc-DEF_123=='
    expect(parseEnvFile(`JWT_SECRET=${secret}`).JWT_SECRET).toBe(secret)
  })

  it('strips surrounding quotes but not inner content', () => {
    expect(parseEnvFile('CORS_ORIGIN="http://localhost:5173"').CORS_ORIGIN).toBe(
      'http://localhost:5173',
    )
    expect(parseEnvFile("NAME='Jane Doe'").NAME).toBe('Jane Doe')
  })

  it('drops an unquoted trailing comment but keeps a quoted one', () => {
    expect(parseEnvFile('PORT=3001 # the API port').PORT).toBe('3001')
    expect(parseEnvFile('MOTD="hello # world"').MOTD).toBe('hello # world')
  })

  it('accepts an "export" prefix and skips malformed lines', () => {
    const parsed = parseEnvFile(['export PORT=4000', 'not-an-assignment', '123BAD=x'].join('\n'))

    expect(parsed.PORT).toBe('4000')
    expect(Object.keys(parsed)).toEqual(['PORT'])
  })

  it('handles CRLF line endings', () => {
    expect(parseEnvFile('PORT=3001\r\nHOST=localhost\r\n')).toEqual({
      PORT: '3001',
      HOST: 'localhost',
    })
  })
})
