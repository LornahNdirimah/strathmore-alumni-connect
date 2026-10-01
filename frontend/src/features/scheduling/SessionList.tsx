import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { schedulingApi } from '../../lib/api'
import { ApiError, apiAssetUrl } from '../../lib/http'
import type { MentorshipSession } from '../../types'

type SessionListProps = {
  scope?: 'all' | 'upcoming' | 'past'
  /** Which name to show on each row — the viewer wants the *other* person. */
  counterpart: 'mentor' | 'student'
  title?: string
  emptyMessage?: string
  /** Cap for dashboard summaries; omit to show everything. */
  limit?: number
}

/**
 * Sessions with their real date and time, plus the actions a participant can
 * take on them. Reschedule and cancel go through the same validation a new
 * booking does, so the server is what decides whether a change is allowed.
 */
export function SessionList({
  scope = 'upcoming',
  counterpart,
  title = 'Sessions',
  emptyMessage = 'Nothing scheduled yet.',
  limit,
}: SessionListProps) {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reschedulingId, setReschedulingId] = useState<string | null>(null)
  const [linkEditingId, setLinkEditingId] = useState<string | null>(null)

  const sessions = useQuery({
    queryKey: ['sessions', scope],
    queryFn: () => schedulingApi.sessions(scope),
  })

  const change = useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string
      payload: Parameters<typeof schedulingApi.update>[1]
    }) => schedulingApi.update(sessionId, payload),
    onSuccess: (result) => {
      setNotice(result.message)
      setError(null)
      setReschedulingId(null)
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['slots'] })
    },
    onError: (caught) => {
      setNotice(null)
      setError(caught instanceof ApiError ? caught.message : 'Could not update that session.')
    },
  })

  const all = sessions.data?.sessions ?? []
  const rows = limit ? all.slice(0, limit) : all

  const nameOf = (session: MentorshipSession) =>
    counterpart === 'mentor' ? session.mentorName : session.studentName

  return (
    <div className="panel">
      <h2>{title}</h2>
      {notice && <p className="success-msg">{notice}</p>}
      {error && <p className="error-msg">{error}</p>}

      <QueryState
        isLoading={sessions.isLoading}
        error={sessions.error}
        isEmpty={all.length === 0}
        emptyMessage={emptyMessage}
      >
        <div className="session-list">
          {rows.map((session) => (
            <div className="session-card" key={session.id}>
              <div className="session-when">
                <strong>{session.dateLabel}</strong>
                <span>{session.slotLabel}</span>
                <span className="muted-line">{session.durationMin} min</span>
              </div>

              <div className="session-body">
                <div className="session-heading">
                  <strong>{session.title}</strong>
                  <span
                    className={
                      session.status === 'upcoming'
                        ? 'status available'
                        : session.status === 'completed'
                          ? 'status'
                          : 'status busy'
                    }
                  >
                    {session.status}
                  </span>
                </div>
                <p className="muted-line">with {nameOf(session)}</p>
                {session.notes && <p className="muted-line">“{session.notes}”</p>}
                {session.cancelledReason && (
                  <p className="muted-line">Cancelled: {session.cancelledReason}</p>
                )}

                {session.status === 'completed' &&
                  (session.myRating ? (
                    <p className="muted-line">You rated this session {session.myRating}/5.</p>
                  ) : (
                    <RateSession
                      sessionId={session.id}
                      counterpartName={nameOf(session)}
                      onRated={(message) => {
                        setNotice(message)
                        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
                      }}
                    />
                  ))}

                {session.status === 'upcoming' && (
                  <div className="session-links">
                    {session.meetingLink && (
                      <a
                        className="primary-btn"
                        href={session.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Join meeting
                      </a>
                    )}
                    {/* DESIGN_BACKLOG #39 — into whatever calendar they use. */}
                    <a className="link-btn" href={apiAssetUrl(session.calendarUrl)} download>
                      Add to calendar
                    </a>
                    {session.canModify && (
                      <button
                        className="link-btn"
                        type="button"
                        onClick={() => setLinkEditingId(linkEditingId === session.id ? null : session.id)}
                      >
                        {session.meetingLink ? 'Change meeting link' : 'Add meeting link'}
                      </button>
                    )}
                  </div>
                )}

                {linkEditingId === session.id && (
                  <MeetingLinkForm
                    initial={session.meetingLink ?? ''}
                    isPending={change.isPending}
                    onSave={(meetingLink) => {
                      change.mutate({ sessionId: session.id, payload: { meetingLink } })
                      setLinkEditingId(null)
                    }}
                  />
                )}

                {session.canModify && (
                  <div className="session-actions">
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={() =>
                        setReschedulingId(reschedulingId === session.id ? null : session.id)
                      }
                    >
                      {reschedulingId === session.id ? 'Keep this time' : 'Reschedule'}
                    </button>
                    <button
                      className="ghost-btn"
                      type="button"
                      disabled={change.isPending}
                      onClick={() =>
                        change.mutate({ sessionId: session.id, payload: { status: 'cancelled' } })
                      }
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* A past session can be marked held, which is what the feedback
                    form's "sessions held" count is built from. */}
                {session.status === 'upcoming' && !session.canModify && (
                  <div className="session-actions">
                    <button
                      className="secondary-btn"
                      type="button"
                      disabled={change.isPending}
                      onClick={() =>
                        change.mutate({ sessionId: session.id, payload: { status: 'completed' } })
                      }
                    >
                      Mark as held
                    </button>
                  </div>
                )}

                {reschedulingId === session.id && (
                  <ReschedulePicker
                    session={session}
                    isPending={change.isPending}
                    onPick={(scheduledAt) =>
                      change.mutate({ sessionId: session.id, payload: { scheduledAt } })
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {limit && all.length > limit && (
          <p className="muted-line">Showing {limit} of {all.length}.</p>
        )}
      </QueryState>
    </div>
  )
}

/**
 * Open slots to move a session onto, fetched only once the viewer has actually
 * asked to reschedule rather than for every row in the list.
 */
function ReschedulePicker({
  session,
  isPending,
  onPick,
}: {
  session: MentorshipSession
  isPending: boolean
  onPick: (scheduledAt: string) => void
}) {
  const slots = useQuery({
    queryKey: ['slots', session.mentorProfileId],
    queryFn: () => schedulingApi.slots(session.mentorProfileId!),
    enabled: Boolean(session.mentorProfileId),
  })

  if (!session.mentorProfileId) {
    return <p className="muted-line">This session predates online booking and cannot be moved.</p>
  }

  if (slots.isLoading) return <p className="muted-line">Loading open slots…</p>

  // The session's own slot is excluded server-side because it is busy, so an
  // empty list genuinely means there is nowhere else to move it.
  const open = slots.data?.slots ?? []
  if (open.length === 0) {
    return <p className="muted-line">No other open slots in the next three weeks.</p>
  }

  return (
    <div className="slot-row" style={{ marginTop: '0.6rem' }}>
      {open.slice(0, 12).map((slot) => (
        <button
          key={slot.startsAt}
          type="button"
          className="slot-chip"
          disabled={isPending}
          onClick={() => onPick(slot.startsAt)}
        >
          {slot.dateLabel.replace(/,.*/, '')} · {slot.label.replace(/^\S+\s/, '')}
        </button>
      ))}
    </div>
  )
}

/** Sets, changes or clears (empty) a session's meeting link. */
function MeetingLinkForm({
  initial,
  isPending,
  onSave,
}: {
  initial: string
  isPending: boolean
  onSave: (meetingLink: string) => void
}) {
  const [value, setValue] = useState(initial)

  return (
    <form
      className="row-actions"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(value.trim())
      }}
    >
      <input
        className="input-field"
        type="url"
        aria-label="Meeting link"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://meet.google.com/abc-defg-hij"
        maxLength={500}
      />
      <button className="secondary-btn" type="submit" disabled={isPending}>
        Save link
      </button>
    </form>
  )
}

/**
 * A quick rating after a held session (DESIGN_BACKLOG #33) — faster, finer
 * signal than the end-of-mentorship form, and never filled in for anyone.
 */
function RateSession({
  sessionId,
  counterpartName,
  onRated,
}: {
  sessionId: string
  counterpartName: string
  onRated: (message: string) => void
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rate = useMutation({
    mutationFn: () => schedulingApi.rate(sessionId, rating, comment.trim() || undefined),
    onSuccess: (result) => onRated(result.message),
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'Could not save your rating.'),
  })

  return (
    <form
      className="confirm-box"
      onSubmit={(event) => {
        event.preventDefault()
        if (rating > 0) rate.mutate()
      }}
    >
      <span>How was this session with {counterpartName}?</span>
      <div className="star-rating" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} out of 5`}
            className={value <= rating ? 'on' : undefined}
            onClick={() => setRating(value)}
          >
            ★
          </button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <input
            className="input-field"
            aria-label="Comment (optional)"
            value={comment}
            maxLength={500}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What was most useful? (optional)"
          />
          <button className="secondary-btn" type="submit" disabled={rate.isPending}>
            {rate.isPending ? 'Saving…' : 'Send rating'}
          </button>
        </>
      )}
      {error && <p className="error-msg">{error}</p>}
    </form>
  )
}
