import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { can, useCurrentSession } from '../../app/SessionContext'
import { QueryState } from '../../components/ui/QueryState'
import { Avatar } from '../../components/ui/Avatar'
import { OfficeHoursBrowser } from '../office-hours/OfficeHours'
import { BlockButton, ReportButton } from '../safety/SafetyControls'
import {
  mentorsApi,
  mentorshipApi,
  messagingApi,
  opportunitiesApi,
  schedulingApi,
} from '../../lib/api'
import { ApiError } from '../../lib/http'

type MentorProfilePageProps = {
  mentorId: string
  onBack: () => void
}

type ProfileTab = 'overview' | 'experience' | 'opportunities'

export function MentorProfilePage({ mentorId, onBack }: MentorProfilePageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<ProfileTab>('overview')
  const [showRequest, setShowRequest] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mentor', mentorId],
    queryFn: () => mentorsApi.detail(mentorId),
    enabled: Boolean(mentorId),
  })

  const mentor = data?.mentor

  // Buttons follow the session's capabilities, which the API enforces too: only
  // students request mentorship or apply; nobody messages or requests themselves.
  const session = useCurrentSession()
  const isSelf = mentor !== undefined && mentor.userId === session?.id
  const canRequest = can(session, 'mentorship.request') && !isSelf
  const canMessage = can(session, 'messaging.use') && !isSelf
  const canApply = can(session, 'opportunities.apply')

  const requestMutation = useMutation({
    mutationFn: (payload: {
      interest: string
      preferredSlot: string
      preferredSlotAt?: string
      message: string
    }) => mentorshipApi.createRequest({ mentorProfileId: mentorId, ...payload }),
    onSuccess: (result) => {
      setFeedback(result.message)
      setShowRequest(false)
      void refetch()
      // The dashboard's request list and pending-request count now include it.
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
    onError: (caught) => {
      setFeedback(caught instanceof ApiError ? caught.message : 'Could not send the request.')
    },
  })

  // "Message" used to be a dead button; it now opens (or reuses) a real thread.
  const messageMutation = useMutation({
    mutationFn: () => messagingApi.open(mentor?.userId ?? ''),
    onSuccess: async ({ conversationId }) => {
      // A brand-new thread must be in the list the messages page opens with,
      // and the page must open this thread — not whichever is most recent.
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      navigate(`/messages?c=${encodeURIComponent(conversationId)}`)
    },
    // Messaging needs a link first (ROADMAP D2); the server says what is missing.
    onError: (caught) =>
      setFeedback(caught instanceof ApiError ? caught.message : 'Could not open a conversation.'),
  })

  const applyMutation = useMutation({
    mutationFn: (opportunityId: string) => opportunitiesApi.apply(opportunityId),
    onSuccess: (result) => setFeedback(result.message),
    onError: (caught) =>
      setFeedback(caught instanceof ApiError ? caught.message : 'Could not apply.'),
  })

  return (
    <section className="content-panel">
      <button className="ghost-btn" type="button" onClick={onBack}>
        ← Back to mentors
      </button>

      <QueryState isLoading={isLoading} error={error}>
        {mentor && (
          <>
            <div className="match-card" style={{ marginTop: '1rem' }}>
              <div className="match-header">
                <div className="person-heading">
                  <Avatar name={mentor.name} url={mentor.avatarUrl} size="lg" />
                  <div>
                    <h3>{mentor.name}</h3>
                    <p>
                      {mentor.role} · {mentor.company}
                    </p>
                  </div>
                </div>
                <span className={mentor.remainingCapacity > 0 ? 'status available' : 'status busy'}>
                  {mentor.remainingCapacity > 0
                    ? `${mentor.remainingCapacity} of ${mentor.capacity} places left`
                    : 'At capacity'}
                </span>
              </div>

              <p className="muted-line">{mentor.location}</p>

              <div className="chip-row">
                {mentor.skills.map((skill) => (
                  <span key={skill}>{skill}</span>
                ))}
              </div>

              {(canRequest || canMessage) && (
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  {canRequest && (
                    <button
                      className="primary-btn"
                      type="button"
                      disabled={mentor.remainingCapacity <= 0}
                      onClick={() => setShowRequest((open) => !open)}
                    >
                      {mentor.remainingCapacity > 0 ? 'Request mentorship' : 'No places available'}
                    </button>
                  )}
                  {canMessage && (
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={() => messageMutation.mutate()}
                      disabled={messageMutation.isPending}
                    >
                      Message
                    </button>
                  )}
                </div>
              )}

              {feedback && <p className="success-msg">{feedback}</p>}

              {!isSelf && session && (
                <div className="row-actions safety-row">
                  <ReportButton userId={mentor.userId} name={mentor.name} contextType="profile" contextId={mentor.id} />
                  {canMessage && <BlockButton userId={mentor.userId} name={mentor.name} />}
                </div>
              )}
            </div>

            {showRequest && canRequest && (
              <RequestForm
                mentorProfileId={mentorId}
                mentorName={mentor.name}
                isSubmitting={requestMutation.isPending}
                onSubmit={(payload) => requestMutation.mutate(payload)}
              />
            )}

            <div className="filter-tabs" style={{ marginTop: '1.5rem' }}>
              {(['overview', 'experience', 'opportunities'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={tab === item ? 'filter-tab active' : 'filter-tab'}
                  onClick={() => setTab(item)}
                >
                  {item[0]?.toUpperCase()}
                  {item.slice(1)}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <>
                <div className="panel" style={{ marginTop: '1rem' }}>
                  <h3>About</h3>
                  <p className="muted-line">
                    {mentor.bio ?? `Well matched for career guidance in ${mentor.industry}.`}
                  </p>
                  <div className="chip-row" style={{ marginTop: '0.75rem' }}>
                    {mentor.tracks.map((track) => (
                      <span key={track}>{track}</span>
                    ))}
                  </div>
                </div>

                <AvailabilitySummary mentorProfileId={mentorId} mentorName={mentor.name} />
                {canRequest && (
                  <OfficeHoursBrowser mentorProfileId={mentorId} title={`${mentor.name}'s office hours`} />
                )}
              </>
            )}

            {tab === 'experience' && (
              <div className="panel" style={{ marginTop: '1rem' }}>
                <h3>Career journey</h3>
                <ul className="check-list">
                  {mentor.timeline.map((entry) => (
                    <li key={`${entry.year}-${entry.title}`}>
                      <strong>{entry.year}</strong> — {entry.title} · {entry.org}
                      {entry.description && <p className="muted-line">{entry.description}</p>}
                    </li>
                  ))}
                  {mentor.timeline.length === 0 && <li>No career history added yet.</li>}
                </ul>

                <h3 style={{ marginTop: '1.5rem' }}>Certifications</h3>
                <ul className="tags">
                  {mentor.certifications.map((cert) => (
                    <li key={cert}>{cert}</li>
                  ))}
                  {mentor.certifications.length === 0 && <li>None listed</li>}
                </ul>
              </div>
            )}

            {tab === 'opportunities' && (
              <div className="panel" style={{ marginTop: '1rem' }}>
                <h3>Posted opportunities</h3>
                <div className="directory-list">
                  {mentor.postedOpportunities.map((opportunity) => (
                    <div className="directory-item" key={opportunity.id}>
                      <div>
                        <strong>{opportunity.title}</strong>
                        <p>
                          {opportunity.type}
                          {opportunity.location ? ` · ${opportunity.location}` : ''}
                        </p>
                      </div>
                      {canApply && (
                        <button
                          className="primary-btn"
                          type="button"
                          disabled={applyMutation.isPending}
                          onClick={() => applyMutation.mutate(opportunity.id)}
                        >
                          Apply
                        </button>
                      )}
                    </div>
                  ))}
                  {mentor.postedOpportunities.length === 0 && (
                    <p className="muted-line">No opportunities posted yet.</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </QueryState>
    </section>
  )
}

function RequestForm({
  mentorProfileId,
  mentorName,
  isSubmitting,
  onSubmit,
}: {
  mentorProfileId: string
  mentorName: string
  isSubmitting: boolean
  onSubmit: (payload: {
    interest: string
    preferredSlot: string
    preferredSlotAt?: string
    message: string
  }) => void
}) {
  const [interest, setInterest] = useState('')
  const [message, setMessage] = useState('')
  const [slotStart, setSlotStart] = useState('')

  /**
   * The mentor's real open slots. The previous version of this form asked the
   * student to type a time ("Wednesday 5:30 PM"), which nothing could check and
   * nothing acted on. Picking a published slot means accepting the request books
   * that appointment outright.
   */
  const slots = useQuery({
    queryKey: ['slots', mentorProfileId],
    queryFn: () => schedulingApi.slots(mentorProfileId),
  })

  const options = slots.data?.slots ?? []
  const chosen = options.find((slot) => slot.startsAt === slotStart)

  return (
    <form
      className="panel form-grid"
      style={{ marginTop: '1rem' }}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          interest,
          // The label is what the mentor reads in their inbox; when no slot was
          // picked, say so plainly rather than inventing a time.
          preferredSlot: chosen ? chosen.label : 'No preference — happy to fit around you',
          ...(chosen ? { preferredSlotAt: chosen.startsAt } : {}),
          message,
        })
      }}
    >
      <h3>Request mentorship</h3>

      <label>
        <span>What do you need help with?</span>
        <input
          className="input-field"
          value={interest}
          onChange={(event) => setInterest(event.target.value)}
          placeholder="Machine learning career path"
          required
        />
      </label>

      <label>
        <span>Preferred first session</span>
        <select
          className="select-field"
          value={slotStart}
          onChange={(event) => setSlotStart(event.target.value)}
          disabled={slots.isLoading || options.length === 0}
        >
          <option value="">
            {slots.isLoading
              ? 'Loading open slots…'
              : options.length === 0
                ? `${mentorName} has not published availability yet`
                : 'No preference'}
          </option>
          {options.map((slot) => (
            <option key={slot.startsAt} value={slot.startsAt}>
              {slot.dateLabel} · {slot.label.replace(/^\S+\s/, '')}
            </option>
          ))}
        </select>
      </label>

      {chosen && (
        <p className="muted-line">
          If {mentorName} accepts, your first session is booked for {chosen.dateLabel} at{' '}
          {chosen.label.replace(/^\S+\s/, '')}.
        </p>
      )}
      {!slots.isLoading && options.length === 0 && (
        <p className="muted-line">
          You can still send the request — you will agree a time together once they accept.
        </p>
      )}

      <label>
        <span>Message</span>
        <textarea
          className="textarea-field"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="A short note so the mentor can decide whether they're the right fit."
          required
        />
      </label>

      <button className="primary-btn" type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send request'}
      </button>
    </form>
  )
}

/**
 * The mentor's published weekly schedule, read-only.
 *
 * Shown alongside the concrete slot picker because the two answer different
 * questions: this says "Tuesday evenings suit them", the picker says "17:30 next
 * Tuesday is free". A student deciding whether to ask at all wants the former.
 */
function AvailabilitySummary({
  mentorProfileId,
  mentorName,
}: {
  mentorProfileId: string
  mentorName: string
}) {
  const availability = useQuery({
    queryKey: ['mentor-availability', mentorProfileId],
    queryFn: () => schedulingApi.mentorAvailability(mentorProfileId),
  })

  const data = availability.data?.availability
  if (availability.isLoading || !data) return null

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h3>Availability</h3>
      {data.windows.length === 0 ? (
        <p className="muted-line">
          {mentorName} has not published a schedule yet. You can still send a request and agree a
          time together.
        </p>
      ) : (
        <>
          <p className="muted-line">
            {data.sessionDurationMin}-minute sessions, times in {data.timezoneLabel}.
          </p>
          <ul className="availability-summary">
            {data.windows.map((window) => (
              <li key={window.id}>
                <span>{window.dayName}</span>
                <span>
                  {window.startTime} – {window.endTime}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
