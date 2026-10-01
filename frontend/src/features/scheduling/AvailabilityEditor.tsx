import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { schedulingApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import { TIMEZONE_LABELS, type TimezoneLabel } from '../../types'

const TIMEZONE_NAMES: Record<TimezoneLabel, string> = {
  EAT: 'East Africa Time (EAT, UTC+3)',
  CAT: 'Central Africa Time (CAT, UTC+2)',
  SAST: 'South Africa Standard Time (SAST, UTC+2)',
  WAT: 'West Africa Time (WAT, UTC+1)',
  GMT: 'Greenwich Mean Time (GMT)',
  UTC: 'Coordinated Universal Time (UTC)',
}

/** Index is the value stored; 0 = Sunday, matching Date#getUTCDay(). */
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const DURATIONS = [15, 30, 45, 60, 90, 120] as const

type DraftWindow = {
  /** Local-only key so React can track rows that have no server id yet. */
  key: string
  dayOfWeek: number
  startTime: string
  endTime: string
}

let nextKey = 0
function makeWindow(dayOfWeek = 2, startTime = '17:00', endTime = '19:00'): DraftWindow {
  nextKey += 1
  return { key: `w${nextKey}`, dayOfWeek, startTime, endTime }
}

/**
 * Lets a mentor publish the times they are available.
 *
 * This is what makes booking possible at all: a student cannot pick a slot until
 * someone has said when the slots are. The whole week is edited and saved
 * together, which is how a timetable is actually thought about, and means
 * removing a window is as simple as adding one.
 */
export function AvailabilityEditor() {
  const queryClient = useQueryClient()

  const availability = useQuery({
    queryKey: ['my-availability'],
    queryFn: () => schedulingApi.myAvailability(),
  })

  const [windows, setWindows] = useState<DraftWindow[]>([])
  const [durationMin, setDurationMin] = useState(30)
  const [timezoneLabel, setTimezoneLabel] = useState<TimezoneLabel>('EAT')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Seed the form from the server once the schedule arrives. Keyed on the
  // fetched object so a refetch after saving does not clobber a fresh edit.
  const loaded = availability.data?.availability
  useEffect(() => {
    if (!loaded) return
    setWindows(
      loaded.windows.map((window) => makeWindow(window.dayOfWeek, window.startTime, window.endTime)),
    )
    setDurationMin(loaded.sessionDurationMin)
    setTimezoneLabel(
      (TIMEZONE_LABELS as readonly string[]).includes(loaded.timezoneLabel)
        ? (loaded.timezoneLabel as TimezoneLabel)
        : 'EAT',
    )
  }, [loaded])

  const save = useMutation({
    mutationFn: () =>
      schedulingApi.saveAvailability({
        timezoneLabel,
        sessionDurationMin: durationMin,
        windows: windows.map(({ dayOfWeek, startTime, endTime }) => ({
          dayOfWeek,
          startTime,
          endTime,
        })),
      }),
    onSuccess: (result) => {
      setSuccess(result.message)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['my-availability'] })
      // Students' slot lists are derived from this, so they are now stale.
      void queryClient.invalidateQueries({ queryKey: ['slots'] })
    },
    onError: (caught) => {
      setSuccess(null)
      setError(caught instanceof ApiError ? caught.message : 'Could not save your availability.')
    },
  })

  const update = (key: string, patch: Partial<DraftWindow>) => {
    setWindows((current) =>
      current.map((window) => (window.key === key ? { ...window, ...patch } : window)),
    )
    setSuccess(null)
  }

  return (
    <form
      className="panel form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <h2>When are you available?</h2>
      <p className="muted-line">
        Students can only book the times you publish here. Add a window per day you are free — the
        slots offered to them are generated from these.
      </p>

      <QueryState isLoading={availability.isLoading} error={availability.error}>
        <div className="form-row">
          <label>
            <span>Session length</span>
            <select
              className="select-field"
              value={durationMin}
              onChange={(event) => setDurationMin(Number(event.target.value))}
            >
              {DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Your timezone</span>
            {/* The times below are read on this clock, so it decides when each
                slot really is — a fixed list, not free text the server would
                have to guess at. */}
            <select
              className="select-field"
              value={timezoneLabel}
              onChange={(event) => setTimezoneLabel(event.target.value as TimezoneLabel)}
            >
              {TIMEZONE_LABELS.map((label) => (
                <option key={label} value={label}>
                  {TIMEZONE_NAMES[label]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="availability-list">
          {windows.length === 0 && (
            <p className="muted-line">
              No windows yet — students cannot book a session until you add one.
            </p>
          )}

          {windows.map((window) => (
            <div className="availability-row" key={window.key}>
              <select
                className="select-field"
                value={window.dayOfWeek}
                aria-label="Day of week"
                onChange={(event) => update(window.key, { dayOfWeek: Number(event.target.value) })}
              >
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>

              <input
                className="input-field"
                type="time"
                value={window.startTime}
                aria-label="Start time"
                onChange={(event) => update(window.key, { startTime: event.target.value })}
                required
              />
              <span className="availability-dash">to</span>
              <input
                className="input-field"
                type="time"
                value={window.endTime}
                aria-label="End time"
                onChange={(event) => update(window.key, { endTime: event.target.value })}
                required
              />

              <button
                className="ghost-btn"
                type="button"
                aria-label={`Remove ${WEEKDAYS[window.dayOfWeek]} window`}
                onClick={() => {
                  setWindows((current) => current.filter((item) => item.key !== window.key))
                  setSuccess(null)
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            className="secondary-btn"
            type="button"
            onClick={() => {
              setWindows((current) => [...current, makeWindow()])
              setSuccess(null)
            }}
          >
            Add a window
          </button>

          <button className="primary-btn" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save availability'}
          </button>
        </div>

        {error && <p className="error-msg">{error}</p>}
        {success && <p className="success-msg">{success}</p>}
      </QueryState>
    </form>
  )
}
