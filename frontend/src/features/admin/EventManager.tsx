import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { eventsApi, type EventPayload } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { ApiError } from '../../lib/http'
import { TIMEZONE_LABELS, type PlatformEvent, type TimezoneLabel } from '../../types'

/**
 * Admins schedule, edit and cancel events and see who registered
 * (DESIGN_BACKLOG #23). Events previously came only from the seed.
 *
 * Times are entered on a wall clock with a timezone label ("6 PM EAT"); the
 * server turns that into the real instant (ROADMAP D7).
 */
export function EventManager() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<PlatformEvent | null>(null)

  // All events, past ones included, so an admin can review what happened.
  const events = useQuery({ queryKey: ['events', 'admin'], queryFn: () => eventsApi.listAll() })

  const refresh = (message: string) => {
    setNotice(message)
    setEditing(null)
    void queryClient.invalidateQueries({ queryKey: ['events'] })
  }

  const cancel = useMutation({
    mutationFn: (eventId: string) => eventsApi.cancelEvent(eventId),
    onSuccess: (result) => refresh(result.message),
    onError: (error) => setNotice(error instanceof ApiError ? error.message : 'Could not cancel the event.'),
  })

  return (
    <>
      <EventForm
        key={editing?.id ?? 'new'}
        editing={editing}
        onSaved={refresh}
        onCancelEdit={() => setEditing(null)}
      />

      <div className="panel">
        <h2>Events</h2>
        {notice && <p className="success-msg">{notice}</p>}
        <QueryState
          isLoading={events.isLoading}
          error={events.error}
          isEmpty={(events.data?.events ?? []).length === 0}
          emptyMessage="No events scheduled."
        >
          <div className="directory-list">
            {(events.data?.events ?? []).map((event) => (
              <div className="directory-item stacked" key={event.id}>
                <div className="directory-item-row">
                  <div>
                    <strong>{event.title}</strong>
                    <p>
                      {event.date} · {event.time} · {event.location}
                    </p>
                    <p className="muted-line">
                      {event.type} · {event.tag}
                    </p>
                  </div>
                  <div className="row-actions">
                    {event.cancelled ? (
                      <span className="status busy">Cancelled</span>
                    ) : (
                      <>
                        <button
                          className="secondary-btn"
                          type="button"
                          aria-label={`Edit ${event.title}`}
                          onClick={() => {
                            setEditing(event)
                            window.scrollTo?.({ top: 0, behavior: 'smooth' })
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="ghost-btn"
                          type="button"
                          aria-label={`Cancel ${event.title}`}
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(event.id)}
                        >
                          Cancel event
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <Attendees event={event} />
              </div>
            ))}
          </div>
        </QueryState>
      </div>
    </>
  )
}

function Attendees({ event }: { event: PlatformEvent }) {
  const [open, setOpen] = useState(false)
  const attendees = useQuery({
    queryKey: ['events', event.id, 'attendees'],
    queryFn: () => eventsApi.attendees(event.id),
    enabled: open,
  })

  if (event.attendeeCount === 0) return <p className="muted-line">No registrations yet.</p>

  return (
    <details onToggle={(toggle) => setOpen((toggle.target as HTMLDetailsElement).open)}>
      <summary>{event.attendeeCount} registered</summary>
      <QueryState isLoading={attendees.isLoading} error={attendees.error}>
        <ul className="applicant-list">
          {(attendees.data?.attendees ?? []).map((person) => (
            <li key={person.userId}>
              <strong>{person.name}</strong> · {person.role} ·{' '}
              <a href={`mailto:${person.email}`}>{person.email}</a>
              <span className="muted-line"> · registered {formatDate(person.registeredAt)}</span>
            </li>
          ))}
        </ul>
      </QueryState>
    </details>
  )
}

const EMPTY: EventPayload = {
  title: '',
  description: '',
  startsAt: '',
  endsAt: '',
  timezoneLabel: 'EAT',
  location: '',
  type: 'In-Person',
  tag: '',
}

function EventForm({
  editing,
  onSaved,
  onCancelEdit,
}: {
  editing: PlatformEvent | null
  onSaved: (message: string) => void
  onCancelEdit: () => void
}) {
  const [form, setForm] = useState<EventPayload>(
    editing
      ? {
          title: editing.title,
          description: editing.description,
          startsAt: editing.startsAtLocal,
          endsAt: editing.endsAtLocal ?? '',
          timezoneLabel: editing.timezoneLabel,
          location: editing.location,
          type: editing.type,
          tag: editing.tag,
        }
      : EMPTY,
  )
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, ...(form.endsAt ? {} : { endsAt: undefined }) }
      return editing ? eventsApi.update(editing.id, payload) : eventsApi.create(payload)
    },
    onSuccess: (result) => {
      setForm(EMPTY)
      setError(null)
      setFieldErrors({})
      onSaved(result.message)
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the event.')
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors() : {})
    },
  })

  const set = <K extends keyof EventPayload>(key: K, value: EventPayload[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <form
      className="panel form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <h2>{editing ? `Edit “${editing.title}”` : 'Schedule an event'}</h2>

      <div className="form-row">
        <label>
          <span>Title</span>
          <input className="input-field" value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </label>
        <label>
          <span>Tag</span>
          <input
            className="input-field"
            value={form.tag}
            onChange={(e) => set('tag', e.target.value)}
            placeholder="Careers"
            required
          />
        </label>
      </div>

      <label>
        <span>Description</span>
        <textarea
          className="textarea-field"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          required
        />
      </label>

      <div className="form-row">
        <label>
          <span>Starts</span>
          <input
            className="input-field"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => set('startsAt', e.target.value)}
            required
          />
          {fieldErrors.startsAt && <small className="field-error">{fieldErrors.startsAt}</small>}
        </label>
        <label>
          <span>Ends (optional)</span>
          <input
            className="input-field"
            type="datetime-local"
            value={form.endsAt ?? ''}
            onChange={(e) => set('endsAt', e.target.value)}
          />
        </label>
        <label>
          <span>Timezone</span>
          <select
            className="select-field"
            value={form.timezoneLabel}
            onChange={(e) => set('timezoneLabel', e.target.value as TimezoneLabel)}
          >
            {TIMEZONE_LABELS.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Location</span>
          <input
            className="input-field"
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Strathmore Business School, or a meeting link"
            required
          />
        </label>
        <label>
          <span>Format</span>
          <select
            className="select-field"
            value={form.type}
            onChange={(e) => set('type', e.target.value as EventPayload['type'])}
          >
            <option value="In-Person">In person</option>
            <option value="Online">Online</option>
            <option value="Hybrid">Hybrid</option>
          </select>
        </label>
      </div>

      <div className="row-actions">
        <button className="primary-btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Schedule event'}
        </button>
        {editing && (
          <button className="ghost-btn" type="button" onClick={onCancelEdit}>
            Stop editing
          </button>
        )}
      </div>
      {error && <p className="error-msg">{error}</p>}
    </form>
  )
}
