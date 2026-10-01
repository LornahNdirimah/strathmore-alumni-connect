import { useDeferredValue, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useCurrentSession } from '../../app/SessionContext'
import { Avatar } from '../../components/ui/Avatar'
import { Icon } from '../../components/ui/Icon'
import { QueryState } from '../../components/ui/QueryState'
import { StatCard } from '../../components/ui/StatCard'
import { dashboardLabels, quickActions } from '../../config/navigation'
import { adminApi, contentApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { ApiError } from '../../lib/http'
import { AccountSettings } from '../account/AccountSettings'
import { ActivityLog } from './ActivityLog'
import { AlumniImport } from './AlumniImport'
import { InsightsPage } from './InsightsPage'
import { ReportsQueue } from './ReportsQueue'
import { EventManager } from './EventManager'
import type { DashboardTab } from '../../types'

type AdminDashboardPageProps = {
  activeTab: DashboardTab
  onTabChange: (tab: DashboardTab) => void
}

const quickActionIcons = [Icon.Check, Icon.Users, Icon.Bell, Icon.Calendar] as const

export function AdminDashboardPage({ activeTab, onTabChange }: AdminDashboardPageProps) {
  const queryClient = useQueryClient()
  const session = useCurrentSession()
  const [notice, setNotice] = useState<string | null>(null)

  const stats = useQuery({ queryKey: ['dashboard-stats'], queryFn: () => contentApi.dashboardStats() })
  const platformStats = useQuery({ queryKey: ['admin-stats'], queryFn: () => adminApi.stats() })
  const verifications = useQuery({
    queryKey: ['verifications'],
    queryFn: () => adminApi.verifications(),
  })

  const review = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'review' | 'rejected' }) =>
      adminApi.reviewVerification(id, status),
    onSuccess: (result) => {
      setNotice(result.message)
      void queryClient.invalidateQueries({ queryKey: ['verifications'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
  })

  const handleQuickAction = (index: number) => {
    const actions = [
      () => onTabChange('verification-queue'),
      () => onTabChange('users'),
      () => onTabChange('announcements'),
      () => onTabChange('events'),
    ]
    actions[index]?.()
  }

  const verificationPanel = (
    <div className="panel">
      <h2>Verification queue</h2>
      {notice && <p className="success-msg">{notice}</p>}
      <QueryState
        isLoading={verifications.isLoading}
        error={verifications.error}
        isEmpty={verifications.data?.verifications.length === 0}
        emptyMessage="Nothing waiting for review."
      >
        <div className="directory-list">
          {(verifications.data?.verifications ?? []).map((item) => (
            <div className="directory-item" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.class_year} • {item.program}
                </p>
                <p className="muted-line">{item.email}</p>
              </div>
              {/* A flagged entry is still undecided: it keeps Verify and Reject,
                  otherwise flagging would be a dead end nothing could leave. */}
              {item.status === 'pending' || item.status === 'review' ? (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {item.status === 'review' && <span className="status busy">flagged</span>}
                  <button
                    className="primary-btn"
                    type="button"
                    aria-label={`Verify ${item.name}`}
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: item.id, status: 'approved' })}
                  >
                    Verify
                  </button>
                  {item.status === 'pending' && (
                    <button
                      className="secondary-btn"
                      type="button"
                      aria-label={`Flag ${item.name} for review`}
                      disabled={review.isPending}
                      onClick={() => review.mutate({ id: item.id, status: 'review' })}
                    >
                      Flag for review
                    </button>
                  )}
                  <button
                    className="ghost-btn"
                    type="button"
                    aria-label={`Reject ${item.name}`}
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: item.id, status: 'rejected' })}
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <span className={item.status === 'approved' ? 'status available' : 'status busy'}>
                  {item.status}
                </span>
              )}
            </div>
          ))}
        </div>
      </QueryState>
    </div>
  )

  if (activeTab === 'verification-queue') {
    return <section className="content-panel">{verificationPanel}</section>
  }

  if (activeTab === 'events') {
    return (
      <section className="content-panel">
        <EventManager />
      </section>
    )
  }

  if (activeTab === 'announcements') {
    return (
      <section className="content-panel">
        <AnnouncementForm />
        <AnnouncementHistory />
      </section>
    )
  }

  if (activeTab === 'reports') {
    return (
      <section className="content-panel">
        <ReportsQueue />
      </section>
    )
  }

  if (activeTab === 'import') {
    return (
      <section className="content-panel">
        <AlumniImport />
      </section>
    )
  }

  if (activeTab === 'insights') {
    return (
      <section className="content-panel">
        <InsightsPage />
      </section>
    )
  }

  if (activeTab === 'activity') {
    return (
      <section className="content-panel">
        <ActivityLog />
      </section>
    )
  }

  if (activeTab === 'users') {
    return (
      <section className="content-panel">
        <UserDirectory />
      </section>
    )
  }

  if (activeTab === 'profile') {
    return (
      <section className="content-panel">
        {session && <AccountSettings session={session} />}
        <div className="panel">
          <h2>Platform overview</h2>
          <div className="stats-grid">
            {Object.entries(platformStats.data?.stats ?? {}).map(([key, value]) => (
              <StatCard
                key={key}
                label={key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                value={String(value)}
              />
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="content-panel">
      <div className="hero-card">
        <div>
          <span className="eyebrow">{dashboardLabels.admin}</span>
          <h1>Platform administration</h1>
          <p>Verification queue, alumni directory, and announcements.</p>
        </div>
      </div>

      <div className="quick-actions">
        {quickActions.admin.map((action, index) => {
          const ActionIcon = quickActionIcons[index] ?? Icon.Check
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
        {verificationPanel}
        <ActivityLog />
      </div>
    </section>
  )
}

function AnnouncementForm() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    title: '',
    audience: 'all' as 'all' | 'students' | 'alumni',
    body: '',
  })
  const [message, setMessage] = useState<string | null>(null)

  const publish = useMutation({
    mutationFn: () => adminApi.announce(form),
    onSuccess: (result) => {
      setMessage(result.message)
      setForm({ title: '', audience: 'all', body: '' })
      void queryClient.invalidateQueries({ queryKey: ['admin-announcements'] })
      void queryClient.invalidateQueries({ queryKey: ['announcements'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-audit'] })
    },
    onError: (error) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not publish the announcement.'),
  })

  return (
    <form
      className="panel form-grid"
      id="announcement-form"
      onSubmit={(event) => {
        event.preventDefault()
        publish.mutate()
      }}
    >
      <h2>Send announcement</h2>

      <label>
        <span>Title</span>
        <input
          className="input-field"
          value={form.title}
          onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))}
          required
        />
      </label>

      <label>
        <span>Audience</span>
        <select
          className="select-field"
          value={form.audience}
          onChange={(event) =>
            setForm((c) => ({ ...c, audience: event.target.value as typeof c.audience }))
          }
        >
          <option value="all">All users</option>
          <option value="students">Students</option>
          <option value="alumni">Alumni</option>
        </select>
      </label>

      <label>
        <span>Message</span>
        <textarea
          className="textarea-field"
          value={form.body}
          onChange={(event) => setForm((c) => ({ ...c, body: event.target.value }))}
          required
        />
      </label>

      <button className="primary-btn" type="submit" disabled={publish.isPending}>
        {publish.isPending ? 'Publishing…' : 'Publish'}
      </button>

      {message && <p className="success-msg">{message}</p>}
    </form>
  )
}

const ROLE_FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'student', label: 'Students' },
  { value: 'alumni', label: 'Alumni' },
  { value: 'admin', label: 'Admins' },
] as const

/**
 * Every account, with the one lever an admin has over an existing user:
 * suspending it (DESIGN_BACKLOG #12). A suspended user is signed out on their
 * next request, because the API re-reads status every time rather than trusting
 * the session token.
 */
const PAGE_SIZE = 50

function UserDirectory() {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<(typeof ROLE_FILTERS)[number]['value']>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)
  // Searching runs on the server (DESIGN_BACKLOG #49); deferring the value
  // keeps typing responsive while the previous page stays on screen.
  const q = useDeferredValue(search.trim())

  const users = useQuery({
    queryKey: ['admin-users', { role, q, page }],
    queryFn: () => adminApi.users({ role: role === 'all' ? undefined : role, q: q || undefined, page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })

  const setStatus = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: 'active' | 'suspended' }) =>
      adminApi.setUserStatus(userId, status),
    onSuccess: (result) => {
      setNotice(result.message)
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
    onError: (error) =>
      setNotice(error instanceof ApiError ? error.message : 'Could not change that account.'),
  })

  const removePhoto = useMutation({
    mutationFn: (userId: string) => adminApi.removeAvatar(userId),
    onSuccess: (result) => {
      setNotice(result.message)
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-audit'] })
    },
    onError: (error) =>
      setNotice(error instanceof ApiError ? error.message : 'Could not remove the photo.'),
  })

  const matches = users.data?.users ?? []
  const total = users.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="panel">
      <h2>Users</h2>
      <div className="search-bar">
        <input
          className="input-field"
          placeholder="Search by name or email…"
          aria-label="Search users"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <select
          className="select-field"
          aria-label="Filter by role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as typeof role)
            setPage(1)
          }}
        >
          {ROLE_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {notice && <p className="success-msg">{notice}</p>}

      <QueryState isLoading={users.isLoading} error={users.error} isEmpty={matches.length === 0}>
        <p className="muted-line">{total} accounts</p>
        <div className="directory-list">
          {matches.map((user) => (
            <div className="directory-item" key={user.id}>
              <div className="person-heading">
                <Avatar name={user.name} url={user.avatarUrl} size="sm" />
                <div>
                  <strong>{user.name}</strong>
                  <p>
                    {user.email} · {user.role}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className={user.status === 'active' ? 'status available' : 'status busy'}>
                  {user.status === 'pending' ? 'awaiting verification' : user.status}
                </span>
                {/* Admins are seed-created and cannot be suspended here; a
                    pending alumnus is decided in the verification queue. */}
                {user.role !== 'admin' && user.status === 'active' && (
                  <button
                    className="ghost-btn"
                    type="button"
                    aria-label={`Suspend ${user.name}`}
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ userId: user.id, status: 'suspended' })}
                  >
                    Suspend
                  </button>
                )}
                {/* Moderation for an inappropriate photo (ROADMAP D6). */}
                {user.avatarUrl && (
                  <button
                    className="ghost-btn"
                    type="button"
                    aria-label={`Remove ${user.name}'s photo`}
                    disabled={removePhoto.isPending}
                    onClick={() => removePhoto.mutate(user.id)}
                  >
                    Remove photo
                  </button>
                )}
                {user.status === 'suspended' && (
                  <button
                    className="secondary-btn"
                    type="button"
                    aria-label={`Reactivate ${user.name}`}
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ userId: user.id, status: 'active' })}
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {totalPages > 1 && (
          <div className="pagination">
            <button className="secondary-btn" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="muted-line">
              Page {page} of {totalPages}
            </span>
            <button
              className="secondary-btn"
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </QueryState>
    </div>
  )
}

const AUDIENCE_LABELS = { all: 'Everyone', students: 'Students', alumni: 'Alumni' } as const

/** What has already been sent, so an admin does not announce the same thing twice. */
function AnnouncementHistory() {
  const history = useQuery({ queryKey: ['admin-announcements'], queryFn: () => adminApi.announcements() })

  return (
    <div className="panel">
      <h2>Sent announcements</h2>
      <QueryState
        isLoading={history.isLoading}
        error={history.error}
        isEmpty={(history.data?.announcements ?? []).length === 0}
        emptyMessage="Nothing has been announced yet."
      >
        <div className="directory-list">
          {(history.data?.announcements ?? []).map((item) => (
            <article className="directory-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
                <p className="muted-line">
                  To {AUDIENCE_LABELS[item.audience]} · {formatDateTime(item.createdAt)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </QueryState>
    </div>
  )
}
