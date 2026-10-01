/**
 * The mentor profile offers each action only to accounts allowed to take it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SessionContext } from '../src/app/SessionContext'
import { MentorProfilePage } from '../src/features/mentors/MentorProfilePage'
import type { AuthSession } from '../src/types'
import { installFakeApi, makeSession } from './helpers/fakeApi'

const mentor = {
  id: 'mp-amina',
  userId: 'user-amina',
  name: 'Amina Osei',
  role: 'Data Scientist',
  company: 'Safaricom',
  industry: 'Telecom',
  location: 'Nairobi',
  availability: 'Available',
  skills: ['Python'],
  tracks: ['Data Science'],
  capacity: 3,
  remainingCapacity: 2,
  bio: null,
  certifications: [],
  timeline: [],
  postedOpportunities: [],
}

function renderAs(session: AuthSession) {
  installFakeApi({
    'GET /mentors/mp-amina': { body: { mentor } },
    'GET /scheduling/availability/mp-amina': {
      body: {
        availability: {
          mentorProfileId: 'mp-amina',
          timezoneLabel: 'EAT',
          sessionDurationMin: 30,
          windows: [],
        },
      },
    },
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={session}>
        <MemoryRouter>
          <MentorProfilePage mentorId="mp-amina" onBack={vi.fn()} />
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('MentorProfilePage actions', () => {
  it('offers a student both request and message', async () => {
    renderAs(makeSession())
    expect(await screen.findByRole('button', { name: 'Request mentorship' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument()
  })

  it('offers another alumnus a message but never a mentorship request', async () => {
    renderAs(
      makeSession({
        id: 'user-brian',
        role: 'alumni',
        capabilities: ['mentors.browse', 'messaging.use', 'mentorship.mentor'],
      }),
    )
    expect(await screen.findByRole('button', { name: 'Message' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request mentorship' })).toBeNull()
  })

  it('offers a mentor nothing on their own profile', async () => {
    renderAs(
      makeSession({
        id: 'user-amina',
        role: 'alumni',
        capabilities: ['mentors.browse', 'messaging.use', 'mentorship.mentor'],
      }),
    )
    await screen.findByText('Amina Osei')
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull()
  })
})
