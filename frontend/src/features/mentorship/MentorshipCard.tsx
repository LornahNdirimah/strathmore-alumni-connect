import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { mentorshipApi, messagingApi } from '../../lib/api'
import { Avatar } from '../../components/ui/Avatar'
import { formatDate } from '../../lib/format'
import { ApiError } from '../../lib/http'
import type { CheckInProgress, Relationship } from '../../types'
import { SessionBooking } from '../scheduling/SessionBooking'

type MentorshipCardProps = {
  relationship: Relationship
  /** Which side the viewer is on; decides whose name and which actions show. */
  viewer: 'student' | 'mentor'
}

/**
 * One mentorship, with everything either participant can do to it
 * (DESIGN_BACKLOG #7, #29, #34): message the other person, book a session
 * (mentor side — students book under My sessions), end it early, and give the
 * mid-point check-in once it opens.
 */
export function MentorshipCard({ relationship, viewer }: MentorshipCardProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [reason, setReason] = useState('')

  const counterpart =
    viewer === 'student'
      ? {
          name: relationship.mentorName,
          userId: relationship.mentorUserId,
          avatarUrl: relationship.mentorAvatarUrl,
        }
      : {
          name: relationship.studentName,
          userId: relationship.studentUserId,
          avatarUrl: relationship.studentAvatarUrl,
        }
  const isActive = relationship.status === 'active'

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['relationships'] })
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    void queryClient.invalidateQueries({ queryKey: ['slots'] })
    void queryClient.invalidateQueries({ queryKey: ['feedback-pending'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    void queryClient.invalidateQueries({ queryKey: ['my-mentor'] })
  }

  const message = useMutation({
    mutationFn: () => messagingApi.open(counterpart.userId),
    onSuccess: async ({ conversationId }) => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      navigate(`/messages?c=${encodeURIComponent(conversationId)}`)
    },
    onError: (error) =>
      setNotice(error instanceof ApiError ? error.message : 'Could not open a conversation.'),
  })

  const end = useMutation({
    mutationFn: () => mentorshipApi.end(relationship.id, reason.trim() || undefined),
    onSuccess: (result) => {
      setNotice(result.message)
      setConfirmingEnd(false)
      refresh()
    },
    onError: (error) =>
      setNotice(error instanceof ApiError ? error.message : 'Could not end the mentorship.'),
  })

  return (
    <article className="mentorship-card">
      <header className="directory-item-row">
        <div className="person-heading">
          <Avatar name={counterpart.name} url={counterpart.avatarUrl} />
          <div>
            <strong>{counterpart.name}</strong>
            {viewer === 'student' && (
              <p>
                {relationship.mentorHeadline} · {relationship.mentorCompany}
              </p>
            )}
            <p className="muted-line">
              Since {formatDate(relationship.startedAt)}
              {isActive && relationship.endsOn && ` · runs until ${formatDate(relationship.endsOn)}`}
              {!isActive && relationship.endedAt && ` · ended ${formatDate(relationship.endedAt)}`}
            </p>
            {!isActive && relationship.endReason && (
              <p className="muted-line">
                {relationship.endReason === 'term-complete'
                  ? 'The mentorship term came to an end.'
                  : `“${relationship.endReason}”`}
              </p>
            )}
          </div>
        </div>
        <span className={isActive ? 'status available' : 'status busy'}>
          {isActive ? 'active' : 'ended'}
        </span>
      </header>

      {notice && <p className="success-msg">{notice}</p>}

      {isActive && relationship.checkInDue && (
        <CheckInForm relationshipId={relationship.id} counterpartName={counterpart.name} onDone={refresh} />
      )}
      {relationship.myCheckIn && (
        <p className="muted-line">
          Your mid-point check-in:{' '}
          {relationship.myCheckIn.progress === 'on-track' ? 'on track' : 'needs attention'}
          {relationship.myCheckIn.note ? ` — “${relationship.myCheckIn.note}”` : ''}
        </p>
      )}

      <Goals relationship={relationship} onChange={refresh} />

      <div className="row-actions">
        <button
          className="secondary-btn"
          type="button"
          aria-label={`Message ${counterpart.name}`}
          disabled={message.isPending}
          onClick={() => message.mutate()}
        >
          Message
        </button>
        {isActive && !confirmingEnd && (
          <button
            className="ghost-btn"
            type="button"
            aria-label={`End mentorship with ${counterpart.name}`}
            onClick={() => setConfirmingEnd(true)}
          >
            End mentorship
          </button>
        )}
      </div>

      {confirmingEnd && (
        <div className="confirm-box">
          <p>
            End your mentorship with {counterpart.name}? This frees the seat, cancels upcoming
            sessions, and asks you both for feedback.
          </p>
          <label>
            <span>Reason (optional, shared with {counterpart.name})</span>
            <input
              className="input-field"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="We covered what I needed — thank you!"
            />
          </label>
          <div className="row-actions">
            <button className="primary-btn" type="button" disabled={end.isPending} onClick={() => end.mutate()}>
              {end.isPending ? 'Ending…' : 'Yes, end it'}
            </button>
            <button className="ghost-btn" type="button" onClick={() => setConfirmingEnd(false)}>
              Keep it going
            </button>
          </div>
        </div>
      )}

      {isActive && viewer === 'mentor' && (
        <details className="booking-block">
          <summary>Book a session with {counterpart.name}</summary>
          <SessionBooking
            relationshipId={relationship.id}
            mentorProfileId={relationship.mentorProfileId}
            mentorName={relationship.mentorName}
            compact
          />
        </details>
      )}
    </article>
  )
}

const MAX_GOALS = 5

/**
 * What the pair agreed to work on (DESIGN_BACKLOG #32). Either side can add,
 * tick off or remove a goal while the mentorship runs; afterwards the list
 * stays as a record of what was achieved.
 */
function Goals({ relationship, onChange }: { relationship: Relationship; onChange: () => void }) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isActive = relationship.status === 'active'
  const done = relationship.goals.filter((goal) => goal.completed).length

  const onError = (caught: unknown) =>
    setError(caught instanceof ApiError ? caught.message : 'Could not update the goals.')

  const add = useMutation({
    mutationFn: () => mentorshipApi.addGoal(relationship.id, title.trim()),
    onSuccess: () => {
      setTitle('')
      setError(null)
      onChange()
    },
    onError,
  })
  const toggle = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      mentorshipApi.setGoalCompleted(id, completed),
    onSuccess: onChange,
    onError,
  })
  const remove = useMutation({ mutationFn: mentorshipApi.removeGoal, onSuccess: onChange, onError })

  if (!isActive && relationship.goals.length === 0) return null

  return (
    <section className="goals" aria-label="Goals">
      <h4>
        Goals{' '}
        {relationship.goals.length > 0 && (
          <span className="muted-line">
            {done} of {relationship.goals.length} done
          </span>
        )}
      </h4>

      {relationship.goals.length === 0 && (
        <p className="muted-line">Agree two or three goals so you both know what you are working towards.</p>
      )}

      <ul className="goal-list">
        {relationship.goals.map((goal) => (
          <li key={goal.id}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={goal.completed}
                disabled={!isActive || toggle.isPending}
                onChange={() => toggle.mutate({ id: goal.id, completed: !goal.completed })}
              />
              <span className={goal.completed ? 'goal-done' : undefined}>{goal.title}</span>
            </label>
            {isActive && (
              <button
                className="link-btn"
                type="button"
                aria-label={`Remove goal: ${goal.title}`}
                onClick={() => remove.mutate(goal.id)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {isActive && relationship.goals.length < MAX_GOALS && (
        <form
          className="row-actions"
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim()) add.mutate()
          }}
        >
          <input
            className="input-field"
            aria-label="New goal"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Land a summer data internship"
          />
          <button className="secondary-btn" type="submit" disabled={add.isPending || !title.trim()}>
            Add goal
          </button>
        </form>
      )}
      {error && <p className="error-msg">{error}</p>}
    </section>
  )
}

function CheckInForm({
  relationshipId,
  counterpartName,
  onDone,
}: {
  relationshipId: string
  counterpartName: string
  onDone: () => void
}) {
  const [progress, setProgress] = useState<CheckInProgress>('on-track')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = useMutation({
    mutationFn: () => mentorshipApi.checkIn(relationshipId, { progress, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: onDone,
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'Could not save your check-in.'),
  })

  return (
    <form
      className="confirm-box"
      onSubmit={(event) => {
        event.preventDefault()
        submit.mutate()
      }}
    >
      <p>
        <strong>Halfway check-in.</strong> How is the mentorship with {counterpartName} going?
      </p>
      <div className="row-actions" role="radiogroup" aria-label="Progress">
        <label className="radio-chip">
          <input
            type="radio"
            name={`progress-${relationshipId}`}
            checked={progress === 'on-track'}
            onChange={() => setProgress('on-track')}
          />
          On track
        </label>
        <label className="radio-chip">
          <input
            type="radio"
            name={`progress-${relationshipId}`}
            checked={progress === 'needs-attention'}
            onChange={() => setProgress('needs-attention')}
          />
          Needs attention
        </label>
      </div>
      <label>
        <span>Anything to add? (optional)</span>
        <input className="input-field" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button className="primary-btn" type="submit" disabled={submit.isPending}>
        {submit.isPending ? 'Saving…' : 'Send check-in'}
      </button>
      {error && <p className="error-msg">{error}</p>}
    </form>
  )
}
