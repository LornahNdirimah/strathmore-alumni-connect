import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { Avatar } from '../../components/ui/Avatar'
import { QueryState } from '../../components/ui/QueryState'
import { Icon } from '../../components/ui/Icon'
import { StatCard } from '../../components/ui/StatCard'
import { dashboardLabels, quickActions } from '../../config/navigation'
import { contentApi, feedbackApi, mentorsApi, mentorshipApi, seekersApi, schedulingApi } from '../../lib/api'
import type { AppPage, AuthSession, DashboardTab } from '../../types'
import { formatDate } from '../../lib/format'
import { ApiError } from '../../lib/http'
import { AccountSettings } from '../account/AccountSettings'
import { AnnouncementsPanel } from '../announcements/AnnouncementsPanel'
import { FeedbackForm } from '../feedback/FeedbackForm'
import { StudentForm } from '../onboarding/OnboardingPage'
import { MatchReasons } from '../mentors/MatchReasons'
import { MentorshipCard } from '../mentorship/MentorshipCard'
import { OfficeHoursBrowser } from '../office-hours/OfficeHours'
import { OpportunitiesFeed } from '../opportunities/OpportunitiesFeed'
import { SessionBooking } from '../scheduling/SessionBooking'
import { SessionList } from '../scheduling/SessionList'

type StudentDashboardPageProps = {
  session: AuthSession
  activeTab: DashboardTab
  onNavigate: (page: AppPage) => void
  onTabChange: (tab: DashboardTab) => void
}

const quickActionIcons = [Icon.Search, Icon.Message, Icon.Calendar, Icon.Users] as const

export function StudentDashboardPage({
  session,
  activeTab,
  onNavigate,
  onTabChange,
}: StudentDashboardPageProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const stats = useQuery({ queryKey: ['dashboard-stats'], queryFn: () => contentApi.dashboardStats() })
  const recommendations = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => mentorsApi.recommendations(4),
  })
  const relationships = useQuery({
    queryKey: ['relationships'],
    queryFn: () => mentorshipApi.relationships(),
  })
  const requests = useQuery({ queryKey: ['requests'], queryFn: () => mentorshipApi.listRequests() })
  const sessions = useQuery({
    queryKey: ['sessions', 'upcoming'],
    queryFn: () => schedulingApi.sessions('upcoming'),
  })
  const seeker = useQuery({ queryKey: ['seeker'], queryFn: () => seekersApi.me() })
  const pendingFeedback = useQuery({
    queryKey: ['feedback-pending'],
    queryFn: () => feedbackApi.pending(),
  })

  const [requestNotice, setRequestNotice] = useState<string | null>(null)
  const withdraw = useMutation({
    mutationFn: (requestId: string) => mentorshipApi.withdraw(requestId),
    onSuccess: (result) => {
      setRequestNotice(result.message)
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      void queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    },
    onError: (error) =>
      setRequestNotice(error instanceof ApiError ? error.message : 'Could not withdraw the request.'),
  })

  const [goalsNotice, setGoalsNotice] = useState<string | null>(null)
  const [goalsErrors, setGoalsErrors] = useState<Record<string, string>>({})
  const saveGoals = useMutation({
    mutationFn: (payload: Record<string, unknown>) => seekersApi.update(payload),
    onSuccess: () => {
      setGoalsNotice('Your career goals were saved. Your suggestions will reflect them.')
      setGoalsErrors({})
      void queryClient.invalidateQueries({ queryKey: ['seeker'] })
      void queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    },
    onError: (error) => {
      setGoalsNotice(null)
      setGoalsErrors(error instanceof ApiError ? error.fieldErrors() : {})
    },
  })

  const submitFeedback = useMutation({
    mutationFn: feedbackApi.submit,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback-pending'] }),
  })

  const handleQuickAction = (index: number) => {
    const actions = [
      () => onNavigate('mentor-search'),
      () => onNavigate('messages'),
      () => onNavigate('events'),
      () => onTabChange('profile'),
    ]
    actions[index]?.()
  }

  if (activeTab === 'my-mentors') {
    return (
      <section className="content-panel">
        <div className="panel">
          <h2>My mentors</h2>
          <QueryState
            isLoading={relationships.isLoading}
            error={relationships.error}
            isEmpty={relationships.data?.relationships.length === 0}
            emptyMessage="No active mentorships yet. Send a request from a mentor's profile."
          >
            <div className="mentorship-list">
              {(relationships.data?.relationships ?? []).map((relationship) => (
                <MentorshipCard key={relationship.id} relationship={relationship} viewer="student" />
              ))}
            </div>
          </QueryState>
        </div>

        <div className="panel">
          <h2>My requests</h2>
          <p className="muted-line">
            You can have up to three requests waiting at once. Unanswered requests expire after a
            week, so you are never left waiting on someone indefinitely.
          </p>
          {requestNotice && <p className="success-msg">{requestNotice}</p>}
          <div className="directory-list">
            {(requests.data?.requests ?? []).map((request) => (
              <div className="directory-item" key={request.id}>
                <div>
                  <strong>{request.mentorName}</strong>
                  <p>{request.interest}</p>
                  {request.status === 'pending' && request.expiresAt && (
                    <p className="muted-line">Waiting for a reply · expires {formatDate(request.expiresAt)}</p>
                  )}
                  {request.responseNotes && (
                    <p className="muted-line">“{request.responseNotes}”</p>
                  )}
                </div>
                <div className="row-actions">
                  <span className={request.status === 'accepted' ? 'status available' : 'status busy'}>
                    {request.status}
                  </span>
                  {request.status === 'pending' && (
                    <button
                      className="ghost-btn"
                      type="button"
                      aria-label={`Withdraw request to ${request.mentorName}`}
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate(request.id)}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            ))}
            {requests.data?.requests.length === 0 && (
              <p className="muted-line">You haven't sent any requests yet.</p>
            )}
          </div>
        </div>
      </section>
    )
  }

  if (activeTab === 'my-sessions') {
    const activeMentorships = (relationships.data?.relationships ?? []).filter(
      (relationship) => relationship.status === 'active',
    )

    return (
      <section className="content-panel">
        <SessionList
          scope="upcoming"
          counterpart="mentor"
          title="Upcoming sessions"
          emptyMessage="No sessions booked yet. Pick a slot from one of your mentors below."
        />

        {/* Booking is available for the whole life of a mentorship, not only at
            the moment the request is sent. */}
        {activeMentorships.length > 0 && (
          <div className="panel">
            <h2>Book a new session</h2>
            <p className="muted-line">
              Slots come from each mentor's published availability, so anything you can pick here is
              a time they are genuinely free.
            </p>
            {activeMentorships.map((relationship) => (
              <details className="booking-block" key={relationship.id}>
                <summary>
                  {relationship.mentorName} — {relationship.mentorHeadline}
                </summary>
                <SessionBooking
                  relationshipId={relationship.id}
                  mentorProfileId={relationship.mentorProfileId}
                  mentorName={relationship.mentorName}
                  compact
                />
              </details>
            ))}
          </div>
        )}

        <OfficeHoursBrowser />

        <SessionList
          scope="past"
          counterpart="mentor"
          title="Past sessions"
          emptyMessage="Nothing has happened yet."
          limit={10}
        />

        {/* DESIGN_BACKLOG #5 — the real post-match feedback form. */}
        {(pendingFeedback.data?.pending ?? []).length > 0 && (
          <div className="panel">
            <h2>Share feedback</h2>
            <p className="muted-line">
              Your responses are what a future matching model would learn from — they are never
              generated on your behalf.
            </p>
            {pendingFeedback.data?.pending.map((item) => (
              <FeedbackForm
                key={item.relationshipId}
                relationshipId={item.relationshipId}
                counterpartName={item.mentorName}
                isSubmitting={submitFeedback.isPending}
                onSubmit={(payload) => submitFeedback.mutate(payload)}
              />
            ))}
          </div>
        )}
      </section>
    )
  }

  if (activeTab === 'profile') {
    return (
      <section className="content-panel">
        <AccountSettings session={session} />
        {/* DESIGN_BACKLOG #24: the career-goals form, editable after
            onboarding. Matching runs on these answers, so recommendations
            refresh when they change. */}
        <QueryState isLoading={seeker.isLoading} error={seeker.error}>
          {seeker.data?.seeker && (
            <StudentForm
              key={seeker.dataUpdatedAt}
              initial={seeker.data.seeker}
              title="Career goals"
              submitLabel="Save career goals"
              fieldErrors={goalsErrors}
              isSubmitting={saveGoals.isPending}
              onSubmit={(payload) => saveGoals.mutate(payload)}
            />
          )}
        </QueryState>
        {goalsNotice && <p className="success-msg">{goalsNotice}</p>}
      </section>
    )
  }

  return (
    <section className="content-panel">
      <div className="hero-card">
        <div>
          <span className="eyebrow">{dashboardLabels.student}</span>
          <h1>{session.name}</h1>
          <p>{session.email}</p>
        </div>
        <button className="primary-btn large" type="button" onClick={() => onNavigate('mentor-search')}>
          Find mentors
        </button>
      </div>

      <div className="quick-actions">
        {quickActions.student.map((action, index) => {
          const ActionIcon = quickActionIcons[index] ?? Icon.Search
          return (
            <button
              className="quick-action-btn"
              type="button"
              key={action.label}
              onClick={() => handleQuickAction(index)}
            >
              <span className="quick-action-icon">
                <ActionIcon />
              </span>
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </button>
          )
        })}
      </div>

      <div className="stats-grid">
        {(stats.data?.stats ?? []).map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div className="content-grid">
        <div className="panel">
          <h2>Recommended for you</h2>
          {recommendations.data?.source === 'fallback' && (
            <p className="muted-line">
              Matching service is warming up — showing a simpler ranking for now.
            </p>
          )}
          <QueryState
            isLoading={recommendations.isLoading}
            error={recommendations.error}
            isEmpty={recommendations.data?.items.length === 0}
            emptyMessage="No mentors with open capacity match your goals right now."
          >
            <div className="mentor-list">
              {(recommendations.data?.items ?? []).map((mentor) => (
                <div className="mentor-row" key={mentor.id}>
                  <div className="mentor-summary">
                    <Avatar name={mentor.name} url={mentor.avatarUrl} size="sm" />
                    <div>
                      <strong>{mentor.name}</strong>
                      <p>
                        {mentor.role} · {mentor.company}
                      </p>
                      <MatchReasons reasons={mentor.matchReasons} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {mentor.matchScore !== undefined && (
                      <span className="score-pill">{Math.round(mentor.matchScore * 100)}%</span>
                    )}
                    <button
                      className="secondary-btn"
                      type="button"
                      aria-label={`View ${mentor.name}'s profile`}
                      onClick={() => navigate(`/mentors/${mentor.id}`)}
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </QueryState>
          {(recommendations.data?.items.length ?? 0) > 0 && (
            <button
              className="link-btn"
              type="button"
              style={{ marginTop: '0.75rem' }}
              onClick={() => navigate('/mentors?view=suggested')}
            >
              See all your suggestions →
            </button>
          )}
        </div>

        <div className="panel">
          <h2>Upcoming sessions</h2>
          <div className="mentor-list">
            {(sessions.data?.sessions ?? []).slice(0, 4).map((item) => (
              <div className="mentor-row" key={item.id}>
                <div className="mentor-summary">
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {item.mentorName} · {item.dateLabel} · {item.slotLabel}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {sessions.data?.sessions.length === 0 && (
              <p className="muted-line">
                Nothing scheduled yet — book a slot under My sessions.
              </p>
            )}
          </div>
          <button
            className="secondary-btn"
            type="button"
            style={{ marginTop: '0.75rem' }}
            onClick={() => onTabChange('my-sessions')}
          >
            Manage sessions
          </button>
        </div>
      </div>

      <div className="content-grid">
        <AnnouncementsPanel />
        <OpportunitiesFeed />
      </div>
    </section>
  )
}
