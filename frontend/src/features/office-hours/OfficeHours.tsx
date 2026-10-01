import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Avatar } from '../../components/ui/Avatar'
import { QueryState } from '../../components/ui/QueryState'
import { officeHoursApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import type { OfficeHour } from '../../types'

/**
 * Office hours (DESIGN_BACKLOG #36): a mentor opens one time to several
 * students at once. Any student can join, not only the mentor's mentees.
 */

function useRefresh() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['office-hours'] })
    // An office hour is a commitment: it changes which one-to-one slots exist.
    void queryClient.invalidateQueries({ queryKey: ['slots'] })
  }
}

/** For students: upcoming office hours to join, optionally from one mentor. */
export function OfficeHoursBrowser({
  mentorProfileId,
  title = 'Office hours',
}: {
  mentorProfileId?: string
  title?: string
}) {
  const refresh = useRefresh()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const list = useQuery({
    queryKey: ['office-hours', 'upcoming', mentorProfileId ?? 'all'],
    queryFn: () => officeHoursApi.upcoming(mentorProfileId),
  })

  const onError = (error: unknown) =>
    setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : 'Something went wrong.' })
  const join = useMutation({
    mutationFn: officeHoursApi.join,
    onSuccess: (result) => {
      setNotice({ kind: 'ok', text: result.message })
      refresh()
    },
    onError,
  })
  const leave = useMutation({
    mutationFn: officeHoursApi.leave,
    onSuccess: (result) => {
      setNotice({ kind: 'ok', text: result.message })
      refresh()
    },
    onError,
  })

  const items = list.data?.officeHours ?? []
  // On a mentor's profile, an empty list is just noise.
  if (mentorProfileId && !list.isLoading && items.length === 0) return null

  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="muted-line">
        Small group sessions a mentor opens to any student — no mentorship needed.
      </p>
      {notice && <p className={notice.kind === 'ok' ? 'success-msg' : 'error-msg'}>{notice.text}</p>}
      <QueryState
        isLoading={list.isLoading}
        error={list.error}
        isEmpty={items.length === 0}
        emptyMessage="No office hours are scheduled right now."
      >
        <div className="directory-list">
          {items.map((item) => (
            <div className="directory-item" key={item.id}>
              <div className="person-heading">
                {!mentorProfileId && <Avatar name={item.mentorName} url={item.mentorAvatarUrl} size="sm" />}
                <div>
                  <strong>{item.title}</strong>
                  <p>
                    {!mentorProfileId && `${item.mentorName} · `}
                    {item.dateLabel} · {item.timeLabel} · {item.durationMin} min
                  </p>
                  {item.description && <p className="muted-line">{item.description}</p>}
                  <p className="muted-line">
                    {item.spotsLeft} of {item.capacity} places left
                  </p>
                  {item.joined && item.meetingLink && (
                    <a href={item.meetingLink} target="_blank" rel="noopener noreferrer">
                      Meeting link
                    </a>
                  )}
                </div>
              </div>
              {item.joined ? (
                <button
                  className="ghost-btn"
                  type="button"
                  aria-label={`Leave ${item.title}`}
                  disabled={leave.isPending}
                  onClick={() => leave.mutate(item.id)}
                >
                  Leave
                </button>
              ) : (
                <button
                  className="primary-btn"
                  type="button"
                  aria-label={`Join ${item.title}`}
                  disabled={join.isPending || item.spotsLeft === 0}
                  onClick={() => join.mutate(item.id)}
                >
                  {item.spotsLeft === 0 ? 'Full' : 'Join'}
                </button>
              )}
            </div>
          ))}
        </div>
      </QueryState>
    </div>
  )
}

/** For mentors: publish office hours and see who is coming. */
export function OfficeHoursHost() {
  const refresh = useRefresh()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const mine = useQuery({ queryKey: ['office-hours', 'mine'], queryFn: () => officeHoursApi.mine() })

  const cancel = useMutation({
    mutationFn: officeHoursApi.cancel,
    onSuccess: (result) => {
      setNotice({ kind: 'ok', text: result.message })
      refresh()
    },
    onError: (error) =>
      setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : 'Could not cancel it.' }),
  })

  const now = new Date().toISOString()
  const upcoming = (mine.data?.officeHours ?? []).filter((item) => !item.cancelled && item.startsAt > now)

  return (
    <>
      <div className="panel">
        <h2>Your office hours</h2>
        {notice && <p className={notice.kind === 'ok' ? 'success-msg' : 'error-msg'}>{notice.text}</p>}
        <QueryState
          isLoading={mine.isLoading}
          error={mine.error}
          isEmpty={upcoming.length === 0}
          emptyMessage="None scheduled. Open one below to meet several students at once."
        >
          <div className="directory-list">
            {upcoming.map((item) => (
              <div className="directory-item stacked" key={item.id}>
                <div className="directory-item-row">
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {item.dateLabel} · {item.timeLabel} · {item.attendeeCount} of {item.capacity} joined
                    </p>
                  </div>
                  <button
                    className="ghost-btn"
                    type="button"
                    aria-label={`Cancel ${item.title}`}
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(item.id)}
                  >
                    Cancel
                  </button>
                </div>
                {item.attendees.length > 0 && (
                  <div className="row-actions">
                    {item.attendees.map((person) => (
                      <span className="person-heading" key={person.userId}>
                        <Avatar name={person.name} url={person.avatarUrl} size="sm" />
                        {person.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </QueryState>
      </div>

      <HostForm
        onCreated={(officeHour) => {
          setNotice({ kind: 'ok', text: `“${officeHour.title}” is open for students to join.` })
          refresh()
        }}
      />
    </>
  )
}

const EMPTY = { title: '', description: '', startsAt: '', durationMin: 60, capacity: 6, meetingLink: '' }

function HostForm({ onCreated }: { onCreated: (officeHour: OfficeHour) => void }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () =>
      officeHoursApi.create({
        title: form.title.trim(),
        startsAt: form.startsAt,
        durationMin: form.durationMin,
        capacity: form.capacity,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.meetingLink.trim() ? { meetingLink: form.meetingLink.trim() } : {}),
      }),
    onSuccess: (result) => {
      setForm(EMPTY)
      setError(null)
      onCreated(result.officeHour)
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'Could not publish it.'),
  })

  return (
    <form
      className="panel form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate()
      }}
    >
      <h2>Open office hours</h2>
      <p className="muted-line">
        Times are in your own timezone, as on your availability. Your one-to-one slots at that time
        are closed automatically.
      </p>
      <div className="form-row">
        <label>
          <span>Topic</span>
          <input
            className="input-field"
            value={form.title}
            onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))}
            placeholder="CV clinic"
            required
          />
        </label>
        <label>
          <span>Starts</span>
          <input
            className="input-field"
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) => setForm((c) => ({ ...c, startsAt: event.target.value }))}
            required
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          <span>Length</span>
          <select
            className="select-field"
            value={form.durationMin}
            onChange={(event) => setForm((c) => ({ ...c, durationMin: Number(event.target.value) }))}
          >
            {[30, 45, 60, 90, 120].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Places</span>
          <input
            className="input-field"
            type="number"
            min={2}
            max={50}
            value={form.capacity}
            onChange={(event) => setForm((c) => ({ ...c, capacity: Number(event.target.value) }))}
            required
          />
        </label>
      </div>
      <label>
        <span>What will you cover? (optional)</span>
        <textarea
          className="textarea-field"
          value={form.description}
          onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
        />
      </label>
      <label>
        <span>Meeting link (optional — shown only to students who join)</span>
        <input
          className="input-field"
          type="url"
          value={form.meetingLink}
          onChange={(event) => setForm((c) => ({ ...c, meetingLink: event.target.value }))}
          placeholder="https://meet.google.com/abc-defg-hij"
        />
      </label>
      <button className="primary-btn" type="submit" disabled={create.isPending}>
        {create.isPending ? 'Publishing…' : 'Publish office hours'}
      </button>
      {error && <p className="error-msg">{error}</p>}
    </form>
  )
}
