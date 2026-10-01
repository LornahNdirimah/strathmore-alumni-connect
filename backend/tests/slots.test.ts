/**
 * Slot arithmetic. Tested directly because this is where scheduling bugs live:
 * an off-by-one on the window edge silently offers a session that runs past a
 * mentor's availability, and a missed overlap double-books them.
 */
import { describe, expect, it } from 'vitest'

import {
  clockToMinute,
  generateSlots,
  isSlotAligned,
  minuteToClock,
  weekdayName,
  type AvailabilityWindow,
} from '../src/lib/slots.js'

// 2026-09-29 is a Tuesday (getUTCDay() === 2).
const TUESDAY = '2026-09-29T00:00:00.000Z'
const NEXT_TUESDAY = '2026-10-06T00:00:00.000Z'

/** Tuesdays, 17:00–19:00 UTC. */
const TUESDAY_EVENING: AvailabilityWindow = { day: 2, startMinute: 17 * 60, endMinute: 19 * 60 }

describe('clock conversion', () => {
  it('round-trips a clock time', () => {
    expect(minuteToClock(1050)).toBe('17:30')
    expect(clockToMinute('17:30')).toBe(1050)
    expect(minuteToClock(0)).toBe('00:00')
    expect(clockToMinute('00:00')).toBe(0)
  })

  it('pads single-digit hours', () => {
    expect(minuteToClock(9 * 60)).toBe('09:00')
    expect(clockToMinute('9:00')).toBe(540)
  })

  it('rejects nonsense rather than coercing it', () => {
    for (const bad of ['25:00', '12:60', 'noon', '', '1200', '12:0']) {
      expect(clockToMinute(bad), bad).toBeNull()
    }
  })
})

describe('generateSlots', () => {
  it('fills a window at the session cadence', () => {
    const slots = generateSlots({
      windows: [TUESDAY_EVENING],
      fromIso: TUESDAY,
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 30,
    })

    expect(slots).toEqual([
      '2026-09-29T17:00:00.000Z',
      '2026-09-29T17:30:00.000Z',
      '2026-09-29T18:00:00.000Z',
      '2026-09-29T18:30:00.000Z',
    ])
  })

  it('never offers a slot that would run past the window', () => {
    // A 45-minute session in a two-hour window fits twice, not three times:
    // 17:00 and 17:45 fit, 18:30 would end at 19:15.
    const slots = generateSlots({
      windows: [TUESDAY_EVENING],
      fromIso: TUESDAY,
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 45,
    })

    expect(slots).toEqual(['2026-09-29T17:00:00.000Z', '2026-09-29T17:45:00.000Z'])
  })

  it('repeats weekly across the range', () => {
    const slots = generateSlots({
      windows: [TUESDAY_EVENING],
      fromIso: TUESDAY,
      toIso: '2026-10-07T00:00:00.000Z',
      durationMin: 60,
    })

    expect(slots).toEqual([
      '2026-09-29T17:00:00.000Z',
      '2026-09-29T18:00:00.000Z',
      '2026-10-06T17:00:00.000Z',
      '2026-10-06T18:00:00.000Z',
    ])
  })

  it('excludes a slot that is already booked', () => {
    const slots = generateSlots({
      windows: [TUESDAY_EVENING],
      fromIso: TUESDAY,
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 30,
      busy: [{ startIso: '2026-09-29T17:30:00.000Z', durationMin: 30 }],
    })

    expect(slots).not.toContain('2026-09-29T17:30:00.000Z')
    expect(slots).toContain('2026-09-29T17:00:00.000Z')
  })

  it('excludes every slot a longer booking overlaps', () => {
    // A 60-minute commitment at 17:00 must remove both 17:00 and 17:30 for a
    // mentor whose slots are 30 minutes — checking equality alone would leave
    // 17:30 bookable and double-book them.
    const slots = generateSlots({
      windows: [TUESDAY_EVENING],
      fromIso: TUESDAY,
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 30,
      busy: [{ startIso: '2026-09-29T17:00:00.000Z', durationMin: 60 }],
    })

    expect(slots).toEqual(['2026-09-29T18:00:00.000Z', '2026-09-29T18:30:00.000Z'])
  })

  it('treats a booking that ends exactly when a slot starts as no conflict', () => {
    const slots = generateSlots({
      windows: [TUESDAY_EVENING],
      fromIso: TUESDAY,
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 30,
      busy: [{ startIso: '2026-09-29T16:30:00.000Z', durationMin: 30 }],
    })

    expect(slots).toContain('2026-09-29T17:00:00.000Z')
  })

  it('drops slots before the from bound, so past times are never offered', () => {
    const slots = generateSlots({
      windows: [TUESDAY_EVENING],
      fromIso: '2026-09-29T18:00:00.000Z',
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 30,
    })

    expect(slots).toEqual(['2026-09-29T18:00:00.000Z', '2026-09-29T18:30:00.000Z'])
  })

  it('returns nothing when the mentor has set no availability', () => {
    expect(
      generateSlots({ windows: [], fromIso: TUESDAY, toIso: NEXT_TUESDAY, durationMin: 30 }),
    ).toEqual([])
  })

  it('returns nothing for an inverted or empty range', () => {
    expect(
      generateSlots({
        windows: [TUESDAY_EVENING],
        fromIso: NEXT_TUESDAY,
        toIso: TUESDAY,
        durationMin: 30,
      }),
    ).toEqual([])
  })

  it('merges overlapping windows without duplicating a slot', () => {
    const slots = generateSlots({
      windows: [
        { day: 2, startMinute: 17 * 60, endMinute: 18 * 60 },
        { day: 2, startMinute: 17 * 60, endMinute: 19 * 60 },
      ],
      fromIso: TUESDAY,
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 60,
    })

    expect(slots).toEqual(['2026-09-29T17:00:00.000Z', '2026-09-29T18:00:00.000Z'])
  })

  it('returns slots in chronological order regardless of window order', () => {
    const slots = generateSlots({
      windows: [
        { day: 2, startMinute: 18 * 60, endMinute: 19 * 60 },
        { day: 2, startMinute: 9 * 60, endMinute: 10 * 60 },
      ],
      fromIso: TUESDAY,
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 60,
    })

    expect(slots).toEqual(['2026-09-29T09:00:00.000Z', '2026-09-29T18:00:00.000Z'])
  })

  it('respects the maxSlots cap', () => {
    const slots = generateSlots({
      windows: [{ day: 2, startMinute: 0, endMinute: MINUTES_IN_DAY }],
      fromIso: TUESDAY,
      toIso: '2026-12-31T00:00:00.000Z',
      durationMin: 15,
      maxSlots: 10,
    })

    expect(slots).toHaveLength(10)
  })

  it('handles a window crossing a month boundary', () => {
    // 2026-10-06 is the Tuesday after 2026-09-29; the day loop must not get
    // stuck or skip when the month rolls over.
    const slots = generateSlots({
      windows: [{ day: 4, startMinute: 10 * 60, endMinute: 11 * 60 }],
      fromIso: '2026-09-28T00:00:00.000Z',
      toIso: '2026-10-09T00:00:00.000Z',
      durationMin: 60,
    })

    // Thursdays 1 October and 8 October.
    expect(slots).toEqual(['2026-10-01T10:00:00.000Z', '2026-10-08T10:00:00.000Z'])
  })
})

const MINUTES_IN_DAY = 1440

describe('isSlotAligned', () => {
  it('accepts a slot on the mentor’s cadence', () => {
    expect(isSlotAligned('2026-09-29T17:00:00.000Z', [TUESDAY_EVENING], 30)).toBe(true)
    expect(isSlotAligned('2026-09-29T18:30:00.000Z', [TUESDAY_EVENING], 30)).toBe(true)
  })

  it('rejects a time inside the window but off the cadence', () => {
    // 17:07 is within 17:00-19:00 but is not a slot the mentor offered; allowing
    // arbitrary minutes would fragment the rest of their day.
    expect(isSlotAligned('2026-09-29T17:07:00.000Z', [TUESDAY_EVENING], 30)).toBe(false)
    expect(isSlotAligned('2026-09-29T17:15:00.000Z', [TUESDAY_EVENING], 30)).toBe(false)
  })

  it('rejects a slot that would overrun the window', () => {
    expect(isSlotAligned('2026-09-29T18:30:00.000Z', [TUESDAY_EVENING], 60)).toBe(false)
    expect(isSlotAligned('2026-09-29T18:00:00.000Z', [TUESDAY_EVENING], 60)).toBe(true)
  })

  it('rejects the right time on the wrong weekday', () => {
    // Wednesday 30 September, same clock time.
    expect(isSlotAligned('2026-09-30T17:00:00.000Z', [TUESDAY_EVENING], 30)).toBe(false)
  })

  it('rejects a timestamp carrying seconds', () => {
    expect(isSlotAligned('2026-09-29T17:00:30.000Z', [TUESDAY_EVENING], 30)).toBe(false)
  })

  it('rejects an unparseable timestamp', () => {
    expect(isSlotAligned('not-a-date', [TUESDAY_EVENING], 30)).toBe(false)
  })

  it('rejects everything when no availability is set', () => {
    expect(isSlotAligned('2026-09-29T17:00:00.000Z', [], 30)).toBe(false)
  })
})

describe('weekdayName', () => {
  it('matches getUTCDay() numbering', () => {
    expect(weekdayName(0)).toBe('Sunday')
    expect(weekdayName(2)).toBe('Tuesday')
    expect(weekdayName(6)).toBe('Saturday')
    expect(new Date(TUESDAY).getUTCDay()).toBe(2)
  })
})

describe('windows on a local wall clock', () => {
  // Tuesday 17:00-19:00 in Nairobi (UTC+3) is 14:00-16:00 UTC.
  const EAT = 180
  const TUESDAY_EVENING_LOCAL: AvailabilityWindow = { day: 2, startMinute: 17 * 60, endMinute: 19 * 60 }

  it('places slots at the local time, expressed in UTC', () => {
    const slots = generateSlots({
      windows: [TUESDAY_EVENING_LOCAL],
      fromIso: '2026-09-29T00:00:00.000Z',
      toIso: '2026-09-30T00:00:00.000Z',
      durationMin: 60,
      offsetMinutes: EAT,
    })
    expect(slots).toEqual(['2026-09-29T14:00:00.000Z', '2026-09-29T15:00:00.000Z'])
  })

  it('uses the local weekday when the local day differs from the UTC day', () => {
    // Wednesday 01:00-02:00 in Nairobi is Tuesday 22:00-23:00 UTC.
    const earlyWednesday: AvailabilityWindow = { day: 3, startMinute: 60, endMinute: 120 }
    const slots = generateSlots({
      windows: [earlyWednesday],
      fromIso: '2026-09-29T00:00:00.000Z',
      toIso: '2026-09-30T12:00:00.000Z',
      durationMin: 60,
      offsetMinutes: EAT,
    })
    expect(slots).toEqual(['2026-09-29T22:00:00.000Z'])
  })

  it('validates alignment on the same local clock', () => {
    expect(isSlotAligned('2026-09-29T14:00:00.000Z', [TUESDAY_EVENING_LOCAL], 30, EAT)).toBe(true)
    // 17:00 UTC is 20:00 in Nairobi — outside the window, though it was the
    // slot the old UTC-only reading would have offered.
    expect(isSlotAligned('2026-09-29T17:00:00.000Z', [TUESDAY_EVENING_LOCAL], 30, EAT)).toBe(false)
  })
})
