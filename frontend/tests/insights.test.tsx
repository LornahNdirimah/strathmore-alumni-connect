/**
 * Phase 8 in the UI: the admin Insights page and the server-paged user list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SessionContext } from '../src/app/SessionContext'
import { AdminDashboardPage } from '../src/features/admin/AdminDashboardPage'
import { InsightsPage } from '../src/features/admin/InsightsPage'
import type { Insights } from '../src/types'
import { installFakeApi, makeSession } from './helpers/fakeApi'

function renderWith(ui: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={makeSession({ role: 'admin', capabilities: ['admin.manage'] })}>
        <MemoryRouter>{ui}</MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

const bucket = (label: string, suggested: number, requested: number, accepted: number) => ({
  label,
  suggested,
  requested,
  accepted,
  requestRate: suggested ? requested / suggested : null,
  acceptRate: requested ? accepted / requested : null,
})

const INSIGHTS: Insights = {
  supply: [
    { track: 'Data Science', seeking: 12, waiting: 9, mentors: 2, freeSeats: 3, shortfall: 6 },
    { track: 'Finance', seeking: 2, waiting: 1, mentors: 4, freeSeats: 8, shortfall: 0 },
  ],
  pipeline: {
    days: 90,
    stages: [
      { key: 'suggested', label: 'Suggested', count: 40, rateFromPrevious: null },
      { key: 'requested', label: 'Requested', count: 10, rateFromPrevious: 0.25 },
      { key: 'accepted', label: 'Accepted', count: 6, rateFromPrevious: 0.6 },
      { key: 'session', label: 'First session held', count: 4, rateFromPrevious: 0.667 },
      { key: 'feedback', label: 'Feedback given', count: 2, rateFromPrevious: 0.5 },
    ],
    requests: {
      total: 14, afterSuggestion: 10, accepted: 7, declined: 2, expired: 3, withdrawn: 1, pending: 1,
      acceptRateAfterSuggestion: 0.6, acceptRateOtherwise: 0.25, medianResponseHours: 30,
    },
    byScore: [bucket('0.75 – 1', 10, 5, 4), bucket('0.50 – 0.75', 20, 4, 2), bucket('0.25 – 0.50', 10, 1, 0), bucket('under 0.25', 0, 0, 0)],
    byRank: [bucket('#1', 8, 4, 3), bucket('#2', 8, 2, 1), bucket('#3', 8, 1, 0), bucket('#4', 8, 0, 0), bucket('#5', 8, 0, 0), bucket('6th or lower', 0, 0, 0)],
  },
  responsiveness: {
    windowDays: 180,
    mentors: [{ mentorProfileId: 'mp-1', name: 'Brian Slow', answered: 1, expired: 3, medianResponseHours: 120, factor: 0.7 }],
  },
}

describe('Insights', () => {
  it('shows where to recruit, the pipeline, the outcome tables and who to nudge', async () => {
    installFakeApi({
      'GET /admin/insights': { body: INSIGHTS },
      'GET /admin/insights/evaluation': { body: { evaluation: null, matching: 'unavailable' } },
    })
    renderWith(<InsightsPage />)

    const dataScience = (await screen.findByText('Data Science')).closest('tr')!
    expect(within(dataScience).getByText('6')).toHaveClass('shortfall')

    const funnel = screen.getByRole('list', { name: 'Matching pipeline' })
    expect(within(funnel).getByText('First session held')).toBeInTheDocument()
    expect(within(funnel).getByText('(25%)')).toBeInTheDocument()

    expect(screen.getByText('60%')).toBeInTheDocument() // accepted after a suggestion
    expect(screen.getByText('30 h')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'By match score' })).toHaveTextContent('5 (50%)')
    expect(screen.getByText('Brian Slow')).toBeInTheDocument()
    expect(await screen.findByText(/matching engine is not running/)).toBeInTheDocument()
  })

  it('asks for another period, and shows the evaluation when the matcher can score', async () => {
    const { requests } = installFakeApi({
      'GET /admin/insights': (request) => ({ body: { ...INSIGHTS, pipeline: { ...INSIGHTS.pipeline, days: Number(request.query.get('days')) } } }),
      'GET /admin/insights/evaluation': {
        body: {
          matching: 'ready',
          evaluation: { pairs: 12, observedTotal: 6, ceilingTotal: 8, ceilingRatio: 0.75, ceilingNote: null, meanAccepted: 0.5, meanDeclined: 0.31, declined: 4 },
        },
      },
    })
    renderWith(<InsightsPage />)

    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.getByText('0.31')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: '30 days' }))
    expect(await screen.findByText(/in the last 30 days/)).toBeInTheDocument()
    expect(requests.filter((r) => r.path === '/admin/insights').map((r) => r.query.get('days'))).toEqual(['90', '30'])
  })
})

describe('admin user list', () => {
  it('searches and pages on the server', async () => {
    const user = (i: number) => ({
      id: `u-${i}`, name: `Person ${i}`, email: `p${i}@example.com`, role: 'student', status: 'active',
      created_at: '2026-09-01T00:00:00Z', avatarUrl: null,
    })
    const { requests } = installFakeApi({
      'GET /admin/users': (request) => ({
        body: {
          users: [user(Number(request.query.get('page')) * 100)],
          total: request.query.get('q') ? 1 : 120,
          page: Number(request.query.get('page')),
          limit: 50,
        },
      }),
      'GET /admin/stats': { body: { stats: {} } },
      'GET /admin/verifications': { body: { verifications: [] } },
      'GET /content/dashboard/stats': { body: { stats: [] } },
    })
    renderWith(<AdminDashboardPage activeTab="users" onTabChange={vi.fn()} />)
    const actor = userEvent.setup()

    expect(await screen.findByText('120 accounts')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Person 200')).toBeInTheDocument()

    await actor.type(screen.getByLabelText('Search users'), 'kev')
    expect(await screen.findByText('1 accounts')).toBeInTheDocument()
    const last = requests.filter((r) => r.path === '/admin/users').at(-1)!
    expect(last.query.get('q')).toBe('kev')
    expect(last.query.get('page')).toBe('1')
    await waitFor(() => expect(screen.queryByText(/Page \d of/)).toBeNull())
  })
})
