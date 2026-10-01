import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { schedulingApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import type { BookableSlot } from '../../types'

type SessionBookingProps = {
  relationshipId: string
  mentorProfileId: string
  mentorName: string
  /** Rendered inline in a panel that already has a heading. */
  compact?: boolean
  onBooked?: () => void
}

/**
 * Books a session against a mentor's published availability.
 *
 * The student picks a real slot rather than typing a time, because a typed time
 * cannot be checked against when the mentor is free — which is why the earlier
 * free-text "preferred slot" never became an actual appointment. Slots come from
 * the server with both participants' existing commitments already removed, so
 * everything offered here is bookable.
 */
export function SessionBooking({
  relationshipId,
  mentorProfileId,
  mentorName,
  compact = false,
  onBooked,
}: SessionBookingProps) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string>('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [meetingLink, setMeetingLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const slots = useQuery({
    queryKey: ['slots', mentorProfileId],
    queryFn: () => schedulingApi.slots(mentorProfileId),
  })

  /**
   * Grouped by day so the picker reads like a calendar rather than a flat list of
   * forty timestamps.
   */
  const days = useMemo(() => {
    const grouped = new Map<string, BookableSlot[]>()
    for (const slot of slots.data?.slots ?? []) {
      const existing = grouped.get(slot.dateLabel)
      if (existing) existing.push(slot)
      else grouped.set(slot.dateLabel, [slot])
    }
    return [...grouped.entries()]
  }, [slots.data])

  const book = useMutation({
    mutationFn: () =>
      schedulingApi.book({
        relationshipId,
        title: title.trim(),
        scheduledAt: selected,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(meetingLink.trim() ? { meetingLink: meetingLink.trim() } : {}),
      }),
    onSuccess: (result) => {
      setSuccess(result.message)
      setError(null)
      setSelected('')
      setTitle('')
      setNotes('')
      setMeetingLink('')
      // The chosen slot is now taken, and the session lists gain a row.
      void queryClient.invalidateQueries({ queryKey: ['slots', mentorProfileId] })
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      onBooked?.()
    },
    onError: (caught) => {
      setSuccess(null)
      setError(
        caught instanceof ApiError ? caught.message : 'Could not book that session. Try again.',
      )
      // A conflict means someone took the slot; refresh so the list is honest.
      void queryClient.invalidateQueries({ queryKey: ['slots', mentorProfileId] })
    },
  })

  const availability = slots.data?.availability

  return (
    <form
      className={compact ? 'form-grid' : 'panel form-grid'}
      onSubmit={(event) => {
        event.preventDefault()
        if (!selected || !title.trim()) return
        book.mutate()
      }}
    >
      {!compact && <h3>Book a session with {mentorName}</h3>}

      <QueryState
        isLoading={slots.isLoading}
        error={slots.error}
        isEmpty={days.length === 0}
        emptyMessage={`${mentorName} has no open slots in the next three weeks. Message them to agree a time.`}
      >
        {availability && (
          <p className="muted-line">
            {availability.sessionDurationMin}-minute sessions, shown in {availability.timezoneLabel}.
          </p>
        )}

        <div className="slot-day-list">
          {days.map(([dateLabel, daySlots]) => (
            <div className="slot-day" key={dateLabel}>
              <strong>{dateLabel}</strong>
              <div className="slot-row">
                {daySlots.map((slot) => (
                  <button
                    key={slot.startsAt}
                    type="button"
                    className={slot.startsAt === selected ? 'slot-chip selected' : 'slot-chip'}
                    aria-pressed={slot.startsAt === selected}
                    // The chip shows only the time; the day heading gives the
                    // date by sight, so a screen reader needs both spoken.
                    aria-label={`${dateLabel}, ${slot.label.replace(/^\S+\s/, '')}`}
                    onClick={() => {
                      setSelected(slot.startsAt)
                      setError(null)
                    }}
                  >
                    {/* The label carries the weekday and zone; the day heading
                        already says the date, so show just the clock time. */}
                    {slot.label.replace(/^\S+\s/, '')}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <label>
          <span>What is this session about?</span>
          <input
            className="input-field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Portfolio review"
            maxLength={160}
            required
          />
        </label>

        <label>
          <span>Anything to prepare? (optional)</span>
          <textarea
            className="textarea-field"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="I'll share my GitHub repo beforehand."
            maxLength={2000}
          />
        </label>

        <label>
          <span>Meeting link (optional, for a video call)</span>
          <input
            className="input-field"
            type="url"
            value={meetingLink}
            onChange={(event) => setMeetingLink(event.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
            maxLength={500}
          />
        </label>

        <button
          className="primary-btn"
          type="submit"
          disabled={book.isPending || !selected || !title.trim()}
        >
          {book.isPending ? 'Booking…' : selected ? 'Confirm booking' : 'Pick a slot first'}
        </button>

        {error && <p className="error-msg">{error}</p>}
        {success && <p className="success-msg">{success}</p>}
      </QueryState>
    </form>
  )
}
