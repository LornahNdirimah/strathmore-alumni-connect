import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { useCan } from '../../app/SessionContext'
import { Avatar } from '../../components/ui/Avatar'
import { Icon } from '../../components/ui/Icon'
import { QueryState } from '../../components/ui/QueryState'
import { AvailabilityEditor } from '../scheduling/AvailabilityEditor'
import { SessionList } from '../scheduling/SessionList'
import { AccountSettings } from '../account/AccountSettings'
import { AnnouncementsPanel } from '../announcements/AnnouncementsPanel'
import { FeedbackForm } from '../feedback/FeedbackForm'
import { MentorshipCard } from '../mentorship/MentorshipCard'
import { MyOpportunities } from '../opportunities/MyOpportunities'
import { OfficeHoursHost } from '../office-hours/OfficeHours'
import { MentorForm } from '../onboarding/OnboardingPage'
import { StatCard } from '../../components/ui/StatCard'
import { dashboardLabels, quickActions } from '../../config/navigation'
import { contentApi, feedbackApi, mentorsApi, mentorshipApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import type { AppPage, AuthSession, DashboardTab } from '../../types'

type AlumniDashboardPageProps = {
  session: AuthSession
  activeTab: DashboardTab
  onNavigate: (page: AppPage) => void
  onTabChange: (tab: DashboardTab) => void
}

const quickActionIcons = [Icon.Briefcase, Icon.Users, Icon.Message, Icon.Award] as const

export function AlumniDashboardPage({
  session,
  activeTab,
  onNavigate,
  onTabChange,
}: AlumniDashboardPageProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)
  // Mentoring is optional for alumni (DESIGN_BACKLOG #20). Mentor-only panels
  // and queries are skipped entirely for an alumnus who does not mentor.
  const isMentor = useCan('mentorship.mentor')

  const stats = useQuery({ queryKey: ['dashboard-stats'], queryFn: () => contentApi.dashboardStats() })
  const profile = useQuery({
    queryKey: ['my-mentor'],
    queryFn: () => mentorsApi.myProfile(),
    enabled: isMentor,
  })
  const requests = useQuery({
    queryKey: ['requests'],
    queryFn: () => mentorshipApi.listRequests(),
    enabled: isMentor,
  })
  const relationships = useQuery({
    queryKey: ['relationships'],
    queryFn: () => mentorshipApi.relationships(),
    enabled: isMentor,
  })
  const [profileNotice, setProfileNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({})
  const saveProfile = useMutation({
    mutationFn: (payload: Record<string, unknown>) => mentorsApi.updateProfile(payload),
    onSuccess: (result) => {
      setProfileNotice({ kind: 'ok', text: result.message })
      setProfileErrors({})
      void queryClient.invalidateQueries({ queryKey: ['my-mentor'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
    onError: (error) => {
      setProfileNotice({
        kind: 'error',
        text: error instanceof ApiError ? error.message : 'Could not save your profile.',
      })
      setProfileErrors(error instanceof ApiError ? error.fieldErrors() : {})
    },
  })

  const pendingFeedback = useQuery({
    queryKey: ['feedback-pending'],
    queryFn: () => feedbackApi.pending(),
    enabled: isMentor,
  })
  const submitFeedback = useMutation({
    mutationFn: feedbackApi.submit,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback-pending'] }),
  })

  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'accepted' | 'declined' }) =>
      mentorshipApi.respond(id, { status }),
    onSuccess: (result) => {
      setNotice(result.message)
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      void queryClient.invalidateQueries({ queryKey: ['relationships'] })
      void queryClient.invalidateQueries({ queryKey: ['my-mentor'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      // Accepting can book the student's requested slot, which changes both the
      // session lists and the slots still open on this mentor.
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['slots'] })
    },
    onError: (error) =>
      setNotice(error instanceof ApiError ? error.message : 'Could not respond to the request.'),
  })

  const pendingRequests = (requests.data?.requests ?? []).filter(
    (request) => request.status === 'pending',
  )

  const handleQuickAction = (index: number) => {
    const actions = [
      () => onTabChange('opportunities'),
      () => onNavigate('communities'),
      () => onNavigate('messages'),
      () => onTabChange('availability'),
    ]
    actions[index]?.()
  }

  // Posting opportunities and setting availability are mentor actions; a
  // non-mentor gets the two that apply to every alumnus.
  // Any alumnus may post opportunities (ROADMAP D5); setting availability is
  // a mentor's.
  const MENTOR_ONLY_ACTIONS = new Set([3])
  const visibleActions = quickActions.alumni
    .map((action, index) => ({ action, index }))
    .filter(({ index }) => isMentor || !MENTOR_ONLY_ACTIONS.has(index))

  const becomeMentorCard = (
    <div className="panel">
      <h2>Become a mentor</h2>
      <p className="muted-line">
        Mentoring is optional. If you would like to guide students, tell us what you can help with
        and how many students you can take on — you can change or pause it at any time.
      </p>
      <button
        className="primary-btn"
        type="button"
        style={{ marginTop: '0.75rem' }}
        onClick={() => navigate('/onboarding')}
      >
        Join the mentor network
      </button>
    </div>
  )

  if (activeTab === 'availability') {
    return (
      <section className="content-panel">
        <AvailabilityEditor />
        <OfficeHoursHost />
        <SessionList
          scope="upcoming"
          counterpart="student"
          title="Your upcoming sessions"
          emptyMessage="No sessions booked with you yet."
        />
        {/* Past sessions are where a mentor marks one as held — the count the
            feedback form and Tier-2 data rely on. */}
        <SessionList
          scope="past"
          counterpart="student"
          title="Past sessions"
          emptyMessage="Nothing has happened yet."
          limit={10}
        />
      </section>
    )
  }

  if (activeTab === 'my-mentees') {
    return (
      <section className="content-panel">
        {notice && <p className="success-msg">{notice}</p>}

        <div className="panel">
          <h2>Mentorship requests</h2>
          <QueryState
            isLoading={requests.isLoading}
            error={requests.error}
            isEmpty={pendingRequests.length === 0}
            emptyMessage="No pending requests right now."
          >
            <div className="mentor-list">
              {pendingRequests.map((request) => (
                <div className="mentor-row" key={request.id}>
                  <div className="mentor-summary">
                    <Avatar name={request.studentName} url={request.studentAvatarUrl} size="sm" />
                    <div>
                      <strong>{request.studentName}</strong>
                      <p>{request.interest}</p>
                      {/* The time they asked for. Accepting books it outright,
                          so the mentor can see what they are agreeing to. */}
                      <p className="muted-line">Requested: {request.preferredSlot}</p>
                      <p className="muted-line">“{request.message}”</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="primary-btn"
                      type="button"
                      disabled={respond.isPending}
                      aria-label={`Accept ${request.studentName}'s request`}
                      onClick={() => respond.mutate({ id: request.id, status: 'accepted' })}
                    >
                      Accept
                    </button>
                    <button
                      className="secondary-btn"
                      type="button"
                      disabled={respond.isPending}
                      aria-label={`Decline ${request.studentName}'s request`}
                      onClick={() => respond.mutate({ id: request.id, status: 'declined' })}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </QueryState>
        </div>

        <div className="panel">
          <h2>Mentees</h2>
          <div className="mentorship-list">
            {(relationships.data?.relationships ?? []).map((relationship) => (
              <MentorshipCard key={relationship.id} relationship={relationship} viewer="mentor" />
            ))}
            {relationships.data?.relationships.length === 0 && (
              <p className="muted-line">No mentees yet.</p>
            )}
          </div>
        </div>

        {/* DESIGN_BACKLOG #29 — mentors give feedback too; it is half the
            Tier-2 signal and was only ever asked of students. */}
        {(pendingFeedback.data?.pending ?? []).length > 0 && (
          <div className="panel">
            <h2>Share feedback</h2>
            <p className="muted-line">
              How did each mentorship go from your side? Your answers are never generated for you.
            </p>
            {pendingFeedback.data?.pending.map((item) => (
              <FeedbackForm
                key={item.relationshipId}
                relationshipId={item.relationshipId}
                counterpartName={item.studentName}
                isSubmitting={submitFeedback.isPending}
                onSubmit={(payload) => submitFeedback.mutate(payload)}
              />
            ))}
          </div>
        )}
      </section>
    )
  }

  if (activeTab === 'opportunities') {
    return (
      <section className="content-panel">
        <MyOpportunities />
      </section>
    )
  }

  if (activeTab === 'profile' && !isMentor) {
    return (
      <section className="content-panel">
        <AccountSettings session={session} />
        {session.verification && (
          <p className="muted-line">
            Verified alumnus · Class of {session.verification.classYear} · {session.verification.program}
          </p>
        )}
        {becomeMentorCard}
      </section>
    )
  }

  if (activeTab === 'profile') {
    return (
      <section className="content-panel">
        <AccountSettings session={session} />
        {/* DESIGN_BACKLOG #24: the whole mentor-join form, editable. Capacity
            is one of its fields; the server refuses to set it below the
            number of students already being mentored. */}
        <QueryState isLoading={profile.isLoading} error={profile.error}>
          {profile.data?.editable && (
            <MentorForm
              key={profile.dataUpdatedAt}
              initial={profile.data.editable}
              title="Mentor profile"
              submitLabel="Save mentor profile"
              fieldErrors={profileErrors}
              isSubmitting={saveProfile.isPending}
              onSubmit={(payload) => saveProfile.mutate(payload)}
            />
          )}
        </QueryState>
        {profileNotice && (
          <p className={profileNotice.kind === 'ok' ? 'success-msg' : 'error-msg'}>{profileNotice.text}</p>
        )}
      </section>
    )
  }

  return (
    <section className="content-panel">
      <div className="hero-card">
        <div>
          <span className="eyebrow">{dashboardLabels.alumni}</span>
          <h1>{session.name}</h1>
          <p>{profile.data?.mentor?.role ?? session.email}</p>
        </div>
        <button className="primary-btn large" type="button" onClick={() => onNavigate('communities')}>
          View communities
        </button>
      </div>

      <div className="quick-actions">
        {visibleActions.map(({ action, index }) => {
          const ActionIcon = quickActionIcons[index] ?? Icon.Briefcase
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

      {notice && <p className="success-msg">{notice}</p>}

      {!isMentor && becomeMentorCard}

      <AnnouncementsPanel />

      {isMentor && (
      <div className="panel">
        <h2>Pending requests</h2>
        <QueryState
          isLoading={requests.isLoading}
          error={requests.error}
          isEmpty={pendingRequests.length === 0}
          emptyMessage="Nothing waiting on you right now."
        >
          <div className="mentor-list">
            {pendingRequests.slice(0, 3).map((request) => (
              <div className="mentor-row" key={request.id}>
                <div className="mentor-summary">
                  <div>
                    <strong>{request.studentName}</strong>
                    <p>{request.interest}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="primary-btn"
                    type="button"
                    disabled={respond.isPending}
                    aria-label={`Accept ${request.studentName}'s request`}
                    onClick={() => respond.mutate({ id: request.id, status: 'accepted' })}
                  >
                    Accept
                  </button>
                  <button
                    className="secondary-btn"
                    type="button"
                    disabled={respond.isPending}
                    aria-label={`Decline ${request.studentName}'s request`}
                    onClick={() => respond.mutate({ id: request.id, status: 'declined' })}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </QueryState>
      </div>
      )}
    </section>
  )
}
