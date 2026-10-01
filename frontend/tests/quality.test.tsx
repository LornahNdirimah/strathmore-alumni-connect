/**
 * Phase 6 in the UI: goals, session ratings, match reasons, office hours, the
 * opportunities board and the alumni directory.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { SessionContext } from '../src/app/SessionContext'
import { AlumniDirectoryPage } from '../src/features/alumni/AlumniDirectoryPage'
import { MatchReasons } from '../src/features/mentors/MatchReasons'
import { MentorshipCard } from '../src/features/mentorship/MentorshipCard'
import { OfficeHoursBrowser, OfficeHoursHost } from '../src/features/office-hours/OfficeHours'
import { OpportunitiesBoardPage } from '../src/features/opportunities/OpportunitiesBoardPage'
import { SessionList } from '../src/features/scheduling/SessionList'
import type { AuthSession, MentorshipSession, Relationship } from '../src/types'
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
  goals: [{ id: 'g-1', title: 'Finish portfolio', completed: false, completedAt: null }],
}

describe('goals', () => {
  it('adds a goal and ticks one off', async () => {
    const { requests } = installFakeApi({
      'POST /mentorship/relationships/rel-1/goals': { status: 201, body: { goal: {}, message: 'Goal added.' } },
      'PATCH /mentorship/goals/g-1': { body: { message: 'ok' } },
    })
    renderWith(<MentorshipCard relationship={relationship} viewer="student" />)
    const user = userEvent.setup()

    expect(screen.getByText('0 of 1 done')).toBeInTheDocument()
    await user.type(screen.getByLabelText('New goal'), 'Land an internship')
    await user.click(screen.getByRole('button', { name: 'Add goal' }))
    await user.click(screen.getByRole('checkbox', { name: 'Finish portfolio' }))

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true))
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ title: 'Land an internship' })
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ completed: true })
  })

  it('stops offering new goals at five', () => {
    installFakeApi({})
    const five = Array.from({ length: 5 }, (_, index) => ({
      id: `g-${index}`,
      title: `Goal ${index}`,
      completed: false,
      completedAt: null,
    }))
    renderWith(<MentorshipCard relationship={{ ...relationship, goals: five }} viewer="mentor" />)
    expect(screen.queryByLabelText('New goal')).toBeNull()
  })
})

describe('session ratings', () => {
  const held: MentorshipSession = {
    id: 'sess-1',
    relationshipId: 'rel-1',
    mentorProfileId: 'mp-1',
    title: 'CV review',
    scheduledAt: '2026-09-01T14:00:00.000Z',
    endsAt: '2026-09-01T14:30:00.000Z',
    durationMin: 30,
    slotLabel: 'Tuesday 5:00 PM EAT',
    dateLabel: 'September 1, 2026',
    timezoneLabel: 'EAT',
    status: 'completed',
    notes: null,
    cancelledReason: null,
    mentorName: 'Amina Osei',
    studentName: 'Kevin Otieno',
    meetingLink: null,
    calendarUrl: '/api/scheduling/sessions/sess-1/calendar.ics',
    myRating: null,
    bookedByMe: true,
    canModify: false,
  }

  it('asks for a rating on a held session and sends it', async () => {
    const { requests } = installFakeApi({
      'GET /scheduling/sessions': { body: { sessions: [held] } },
      'POST /scheduling/sessions/sess-1/rating': { status: 201, body: { message: 'Thanks for rating the session.' } },
    })
    renderWith(<SessionList scope="past" counterpart="mentor" />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: '4 out of 5' }))
    await user.type(screen.getByLabelText('Comment (optional)'), 'Clear advice')
    await user.click(screen.getByRole('button', { name: 'Send rating' }))

    expect(await screen.findByText('Thanks for rating the session.')).toBeInTheDocument()
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ rating: 4, comment: 'Clear advice' })
  })

  it('shows the rating once given', async () => {
    installFakeApi({ 'GET /scheduling/sessions': { body: { sessions: [{ ...held, myRating: 5 }] } } })
    renderWith(<SessionList scope="past" counterpart="mentor" />)
    expect(await screen.findByText('You rated this session 5/5.')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Rating' })).toBeNull()
  })
})

describe('match reasons', () => {
  it('lists why a mentor was suggested, and nothing when there is no reason', () => {
    const { rerender } = render(<MatchReasons reasons={['Mentors in Data Science', 'Also studied Statistics']} />)
    expect(screen.getByRole('list', { name: 'Why this mentor was suggested' })).toHaveTextContent('Mentors in Data Science')
    rerender(<MatchReasons reasons={[]} />)
    expect(screen.queryByRole('list')).toBeNull()
  })
})

describe('office hours', () => {
  const officeHour = {
    id: 'oh-1',
    mentorProfileId: 'mp-1',
    mentorName: 'Amina Osei',
    mentorAvatarUrl: null,
    title: 'CV clinic',
    description: null,
    startsAt: '2026-12-01T14:00:00.000Z',
    endsAt: '2026-12-01T15:00:00.000Z',
    dateLabel: 'December 1, 2026',
    timeLabel: 'Tuesday 5:00 PM EAT',
    durationMin: 60,
    capacity: 6,
    attendeeCount: 5,
    spotsLeft: 1,
    joined: false,
    isHost: false,
    cancelled: false,
    meetingLink: null,
  }

  it('lets a student join one with places left', async () => {
    const { requests } = installFakeApi({
      'GET /office-hours': { body: { officeHours: [officeHour, { ...officeHour, id: 'oh-2', title: 'Full one', spotsLeft: 0 }] } },
      'POST /office-hours/oh-1/join': { body: { officeHour, message: 'You are in. See you there.' } },
    })
    renderWith(<OfficeHoursBrowser />)
    const user = userEvent.setup()

    expect(await screen.findByRole('button', { name: 'Join Full one' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Join CV clinic' }))
    expect(await screen.findByText('You are in. See you there.')).toBeInTheDocument()
    expect(requests.some((r) => r.method === 'POST' && r.path === '/office-hours/oh-1/join')).toBe(true)
  })

  it('lets a mentor publish one on their own clock', async () => {
    const { requests } = installFakeApi({
      'GET /office-hours/mine': { body: { officeHours: [] } },
      'POST /office-hours': { status: 201, body: { officeHour: { ...officeHour, isHost: true }, message: 'ok' } },
    })
    renderWith(<OfficeHoursHost />, { session: makeSession({ role: 'alumni' }) })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Topic'), 'CV clinic')
    await user.type(screen.getByLabelText('Starts'), '2026-12-01T17:00')
    await user.click(screen.getByRole('button', { name: 'Publish office hours' }))

    expect(await screen.findByText('“CV clinic” is open for students to join.')).toBeInTheDocument()
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({
      title: 'CV clinic',
      startsAt: '2026-12-01T17:00',
      durationMin: 60,
      capacity: 6,
    })
  })
})

describe('opportunities board', () => {
  it('filters through the URL and shows deadlines', async () => {
    const { requests } = installFakeApi({
      'GET /opportunities': {
        body: {
          opportunities: [
            {
              id: 'opp-1', title: 'Data intern', type: 'Internship', location: 'Nairobi', description: null,
              postedAt: '2026-09-20T00:00:00.000Z', closesAt: '2026-10-31T20:59:00.000Z',
              postedBy: { userId: 'u-1', name: 'Grace', mentorProfileId: null }, applied: false, applicantCount: 0,
            },
          ],
        },
      },
    })
    renderWith(<OpportunitiesBoardPage />, { path: '/opportunities' })

    expect(await screen.findByText('Applications close October 31, 2026')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Internship')
    await waitFor(() => expect(currentUrl).toBe('/opportunities?type=Internship'))
    await waitFor(() => expect(requests.some((r) => r.query.get('type') === 'Internship')).toBe(true))
  })
})

describe('alumni directory', () => {
  it('lists alumni and opens a conversation with one', async () => {
    installFakeApi({
      'GET /alumni': {
        body: {
          alumni: [
            {
              userId: 'u-9', name: 'Brian Kimani', avatarUrl: null, classYear: '2015', program: 'BCom',
              headline: 'Analyst', company: 'KCB', industry: 'Finance', location: 'Nairobi', mentorProfileId: null,
            },
          ],
          total: 1, page: 1, limit: 30, classYears: ['2015'], industries: ['Finance'],
        },
      },
      'POST /conversations': { status: 201, body: { conversationId: 'conv-3' } },
    })
    renderWith(<AlumniDirectoryPage />, { session: makeSession({ role: 'alumni' }), path: '/alumni-directory' })

    expect(await screen.findByText('Class of 2015 · BCom')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Message Brian Kimani' }))
    await waitFor(() => expect(currentUrl).toBe('/messages?c=conv-3'))
  })
})
