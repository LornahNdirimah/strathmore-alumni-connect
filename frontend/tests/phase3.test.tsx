/**
 * Phase 3 in the UI: the mentorship lifecycle, opportunities, communities,
 * admin events, and the "suggested for me" view of mentor search.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SessionContext } from '../src/app/SessionContext'
import { EventManager } from '../src/features/admin/EventManager'
import { CommunitiesPage } from '../src/features/communities/CommunitiesPage'
import { MentorSearchPage } from '../src/features/mentors/MentorSearchPage'
import { MentorshipCard } from '../src/features/mentorship/MentorshipCard'
import { MyOpportunities } from '../src/features/opportunities/MyOpportunities'
import { OpportunitiesFeed } from '../src/features/opportunities/OpportunitiesFeed'
import type { AuthSession, Relationship } from '../src/types'
import { installFakeApi, makeSession } from './helpers/fakeApi'

let currentUrl = ''
function LocationProbe() {
  const location = useLocation()
  currentUrl = `${location.pathname}${location.search}`
  return null
}

function renderWith(ui: ReactNode, options: { session?: AuthSession; path?: string } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={options.session ?? makeSession()}>
        <MemoryRouter initialEntries={[options.path ?? '/']}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

const alumnus = makeSession({
  id: 'user-alum',
  role: 'alumni',
  capabilities: ['communities.view', 'communities.join', 'communities.create', 'opportunities.post', 'opportunities.view'],
})

const relationship: Relationship = {
  id: 'rel-1',
  mentorProfileId: 'mp-1',
  mentorUserId: 'user-mentor',
  mentorName: 'Amina Osei',
  mentorHeadline: 'Data Scientist',
  mentorCompany: 'Safaricom',
  studentUserId: 'user-student',
  studentName: 'Kevin Otieno',
  mentorAvatarUrl: null,
  studentAvatarUrl: null,
  status: 'active',
  startedAt: '2026-08-01T10:00:00.000Z',
  endsOn: '2026-10-24T10:00:00.000Z',
  endedAt: null,
  endReason: null,
  checkInOpensAt: '2026-09-12T10:00:00.000Z',
  checkInDue: false,
  myCheckIn: null,
  goals: [],
}

describe('MentorshipCard', () => {
  it('ends a mentorship after confirmation, sending the reason', async () => {
    const { requests } = installFakeApi({
      'POST /mentorship/relationships/rel-1/end': { body: { message: 'The mentorship has ended.' } },
    })
    renderWith(<MentorshipCard relationship={relationship} viewer="student" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'End mentorship with Amina Osei' }))
    await user.type(screen.getByPlaceholderText(/covered what I needed/), 'Got the internship')
    await user.click(screen.getByRole('button', { name: 'Yes, end it' }))

    expect(await screen.findByText('The mentorship has ended.')).toBeInTheDocument()
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ reason: 'Got the internship' })
  })

  it('asks for the mid-point check-in only once it is due', async () => {
    const { requests } = installFakeApi({
      'POST /mentorship/relationships/rel-1/checkin': { status: 201, body: { message: 'Thanks' } },
    })
    const view = renderWith(<MentorshipCard relationship={relationship} viewer="student" />)
    expect(screen.queryByText(/Halfway check-in/)).toBeNull()
    view.unmount()

    renderWith(<MentorshipCard relationship={{ ...relationship, checkInDue: true }} viewer="student" />)
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Needs attention'))
    await user.click(screen.getByRole('button', { name: 'Send check-in' }))

    await waitFor(() => expect(requests.some((r) => r.path.endsWith('/checkin'))).toBe(true))
    expect(requests.find((r) => r.path.endsWith('/checkin'))?.body).toEqual({ progress: 'needs-attention' })
  })

  it('shows the mentor the student’s name and a way to book, and opens that thread', async () => {
    installFakeApi({
      'POST /conversations': { status: 201, body: { conversationId: 'conv-9' } },
    })
    renderWith(<MentorshipCard relationship={relationship} viewer="mentor" />)

    expect(screen.getByText('Kevin Otieno')).toBeInTheDocument()
    expect(screen.getByText('Book a session with Kevin Otieno')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Message Kevin Otieno' }))
    await waitFor(() => expect(currentUrl).toBe('/messages?c=conv-9'))
  })

  it('shows an ended mentorship without actions to end it again', () => {
    installFakeApi({})
    renderWith(
      <MentorshipCard
        relationship={{ ...relationship, status: 'completed', endedAt: '2026-10-24T10:00:00.000Z', endReason: 'term-complete' }}
        viewer="student"
      />,
    )
    expect(screen.getByText('The mentorship term came to an end.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /End mentorship/ })).toBeNull()
  })
})

describe('mentor search', () => {
  it('opens on the student’s suggestions from ?view=suggested', async () => {
    installFakeApi({
      'GET /mentors/recommendations': {
        body: {
          source: 'ml',
          items: [
            {
              id: 'mp-1', userId: 'u-1', name: 'Amina Osei', role: 'Data Scientist', company: 'Safaricom',
              industry: 'Telecom', location: 'Nairobi', availability: 'Available', skills: [], tracks: [],
              capacity: 3, remainingCapacity: 2, matchScore: 0.8,
            },
          ],
        },
      },
    })
    renderWith(<MentorSearchPage onOpenProfile={vi.fn()} />, { path: '/mentors?view=suggested' })

    expect(await screen.findByText('Amina Osei')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Suggested for me' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('keeps filters in the URL', async () => {
    installFakeApi({
      'GET /mentors': { body: { items: [], total: 0, page: 1, limit: 24, industries: [] } },
    })
    renderWith(<MentorSearchPage onOpenProfile={vi.fn()} />, { path: '/mentors' })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Available now' }))
    await user.selectOptions(screen.getByLabelText('Track'), 'Finance')

    await waitFor(() => expect(currentUrl).toBe('/mentors?available=true&track=Finance'))
  })

  it('offers no suggestions view to someone who cannot be matched', () => {
    installFakeApi({
      'GET /mentors': { body: { items: [], total: 0, page: 1, limit: 24, industries: [] } },
    })
    renderWith(<MentorSearchPage onOpenProfile={vi.fn()} />, { session: alumnus, path: '/mentors?view=suggested' })
    expect(screen.queryByRole('tab', { name: 'Suggested for me' })).toBeNull()
  })
})

describe('opportunities', () => {
  it('lets a student apply from the feed', async () => {
    const { requests } = installFakeApi({
      'GET /opportunities': {
        body: {
          opportunities: [
            {
              id: 'opp-1', title: 'Data intern', type: 'Internship', location: 'Nairobi', description: null,
              postedAt: '2026-09-20T00:00:00.000Z', closesAt: null,
              postedBy: { userId: 'u-1', name: 'Grace Wanjiru', mentorProfileId: null },
              applied: false, applicantCount: 0,
            },
          ],
        },
      },
      'POST /opportunities/opp-1/apply': { status: 201, body: { message: 'Application submitted.' } },
    })
    renderWith(<OpportunitiesFeed />)

    await userEvent.click(await screen.findByRole('button', { name: 'Apply for Data intern' }))
    expect(await screen.findByText('Application submitted.')).toBeInTheDocument()
    expect(requests.some((r) => r.method === 'POST' && r.path === '/opportunities/opp-1/apply')).toBe(true)
  })

  it('shows the poster who applied', async () => {
    installFakeApi({
      'GET /opportunities/mine': {
        body: {
          opportunities: [
            {
              id: 'opp-1', title: 'Data intern', type: 'Internship', location: null, description: null,
              postedAt: '2026-09-20T00:00:00.000Z', closesAt: null,
              postedBy: { userId: 'user-alum', name: 'Grace', mentorProfileId: null },
              applied: false, applicantCount: 1,
            },
          ],
        },
      },
      'GET /opportunities/opp-1/applications': {
        body: {
          applicants: [
            { userId: 's-1', name: 'Kevin Otieno', email: 'kevin@example.com', message: 'Keen to learn', appliedAt: '2026-09-21T00:00:00.000Z' },
          ],
        },
      },
    })
    renderWith(<MyOpportunities />, { session: alumnus })

    await userEvent.click(await screen.findByText('1 applicant'))
    expect(await screen.findByText('Kevin Otieno')).toBeInTheDocument()
    expect(screen.getByText('“Keen to learn”')).toBeInTheDocument()
  })
})

describe('communities', () => {
  it('lets an alumnus start a community', async () => {
    const { requests } = installFakeApi({
      'GET /groups': { body: { groups: [] } },
      'POST /groups': { status: 201, body: { group: {}, message: 'Group created.' } },
    })
    renderWith(<CommunitiesPage onOpenGroup={vi.fn()} />, { session: alumnus })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start a community' }))
    await user.type(screen.getByPlaceholderText('Fintech circle'), 'Fintech circle')
    await user.type(screen.getByPlaceholderText('Finance'), 'Finance')
    await user.type(screen.getByRole('textbox', { name: 'What is it for?' }), 'Alumni working in fintech.')
    await user.click(screen.getByRole('button', { name: 'Create community' }))

    expect(await screen.findByText('Group created.')).toBeInTheDocument()
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({
      name: 'Fintech circle',
      topic: 'Finance',
      description: 'Alumni working in fintech.',
      visibility: 'alumni-only',
    })
  })

  it('does not offer students a way to start one', async () => {
    installFakeApi({ 'GET /groups': { body: { groups: [] } } })
    renderWith(<CommunitiesPage onOpenGroup={vi.fn()} />)
    await screen.findByText('No groups are open to you yet.')
    expect(screen.queryByRole('button', { name: 'Start a community' })).toBeNull()
  })
})

describe('admin event manager', () => {
  it('schedules an event with wall-clock times and a timezone', async () => {
    const { requests } = installFakeApi({
      'GET /events': { body: { events: [] } },
      'POST /events': { status: 201, body: { event: {}, message: 'Event scheduled.' } },
    })
    renderWith(<EventManager />, { session: makeSession({ role: 'admin' }) })
    const user = userEvent.setup()

    const form = screen.getByRole('heading', { name: 'Schedule an event' }).closest('form')!
    const field = (name: string) => within(form).getByLabelText(name)
    await user.type(field('Title'), 'Careers evening')
    await user.type(field('Tag'), 'Careers')
    await user.type(field('Description'), 'Alumni on their first jobs.')
    await user.type(field('Starts'), '2026-11-05T18:00')
    await user.type(field('Location'), 'SBS auditorium')
    await user.click(within(form).getByRole('button', { name: 'Schedule event' }))

    expect(await screen.findByText('Event scheduled.')).toBeInTheDocument()
    expect(requests.find((r) => r.method === 'POST')?.body).toMatchObject({
      title: 'Careers evening',
      startsAt: '2026-11-05T18:00',
      timezoneLabel: 'EAT',
      type: 'In-Person',
    })
  })
})
