/**
 * The role model as the UI applies it: where each kind of account is allowed to
 * go, and what each one is shown. The server enforces the same capabilities
 * (backend/tests/access.test.ts); these tests pin that the UI never offers what
 * the API would refuse.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../src/App'
import type { AuthSession, Capability } from '../src/types'
import { installFakeApi, makeSession } from './helpers/fakeApi'

const ALUMNI_BASE: Capability[] = [
  'mentors.browse',
  'alumni.directory',
  'mentorship.participate',
  'communities.view',
  'communities.join',
  'communities.create',
  'messaging.use',
  'events.view',
  'events.register',
]

const sessions = {
  student: makeSession(),
  mentor: makeSession({
    id: 'alumni-mentor',
    role: 'alumni',
    optIn: { isSeeker: false, isMentor: true, seekerId: null, mentorProfileId: 'mp-1' },
    capabilities: [...ALUMNI_BASE, 'mentorship.mentor'],
  }),
  nonMentor: makeSession({
    id: 'alumni-member',
    role: 'alumni',
    optIn: { isSeeker: false, isMentor: false, seekerId: null, mentorProfileId: null },
    capabilities: [...ALUMNI_BASE, 'mentorship.become-mentor'],
  }),
  pending: makeSession({
    id: 'alumni-pending',
    role: 'alumni',
    status: 'pending',
    optIn: { isSeeker: false, isMentor: false, seekerId: null, mentorProfileId: null },
    capabilities: [],
    verification: { status: 'pending', classYear: '2018', program: 'BSc Informatics' },
  }),
  admin: makeSession({
    id: 'admin-1',
    role: 'admin',
    optIn: { isSeeker: false, isMentor: false, seekerId: null, mentorProfileId: null },
    capabilities: ['admin.manage', 'communities.view', 'communities.moderate', 'events.view'],
  }),
} satisfies Record<string, AuthSession>

let currentPath = ''
function LocationProbe() {
  currentPath = useLocation().pathname
  return null
}

function renderAt(path: string, session: AuthSession) {
  installFakeApi({ 'GET /auth/me': { body: { user: session } } })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('where each account may go', () => {
  it('keeps an alumnus awaiting verification on the waiting screen', async () => {
    for (const path of ['/alumni', '/mentors', '/communities', '/login']) {
      const view = renderAt(path, sessions.pending)
      await waitFor(() => expect(currentPath).toBe('/pending'))
      view.unmount()
    }
  })

  it('tells a pending alumnus what they submitted', async () => {
    renderAt('/pending', sessions.pending)
    expect(await screen.findByText('Your account is waiting for verification')).toBeInTheDocument()
    expect(screen.getByText('BSc Informatics')).toBeInTheDocument()
  })

  it('lets an alumnus who does not mentor into their dashboard, not the mentor form', async () => {
    renderAt('/alumni', sessions.nonMentor)
    expect(await screen.findByRole('button', { name: 'Join the mentor network' })).toBeInTheDocument()
    expect(currentPath).toBe('/alumni')
  })

  it('sends an admin away from mentorship pages', async () => {
    for (const path of ['/mentors', '/messages']) {
      const view = renderAt(path, sessions.admin)
      await waitFor(() => expect(currentPath).toBe('/admin'))
      view.unmount()
    }
  })
})

describe('dashboard tabs live in the URL', () => {
  it('opens the tab the URL names', async () => {
    renderAt('/admin/users', sessions.admin)
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(currentPath).toBe('/admin/users')
  })

  it('falls back to the overview for a tab this account cannot see', async () => {
    renderAt('/alumni/availability', sessions.nonMentor)
    await waitFor(() => expect(currentPath).toBe('/alumni'))
  })

  it('sends a shortcut tab to its page', async () => {
    renderAt('/student/find-mentors', sessions.student)
    await waitFor(() => expect(currentPath).toBe('/mentors'))
  })
})

describe('navigation follows capabilities', () => {
  async function topNavLabels(session: AuthSession, path: string): Promise<string[]> {
    renderAt(path, session)
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    await waitFor(() => expect(within(nav).queryAllByRole('button').length).toBeGreaterThan(0))
    return within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
  }

  it('gives an admin no mentorship or messaging links', async () => {
    expect(await topNavLabels(sessions.admin, '/admin')).toEqual(['Communities', 'Events'])
  })

  it('gives a student every member area', async () => {
    expect(await topNavLabels(sessions.student, '/student')).toEqual([
      'Mentors',
      'Opportunities',
      'Messages',
      'Communities',
      'Events',
    ])
  })

  it('shows mentor tabs only to an alumnus who mentors', async () => {
    const view = renderAt('/alumni', sessions.mentor)
    expect(await screen.findByRole('button', { name: 'Availability' })).toBeInTheDocument()
    view.unmount()

    renderAt('/alumni', sessions.nonMentor)
    await screen.findByRole('button', { name: 'Groups' })
    expect(screen.queryByRole('button', { name: 'Availability' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'My Mentees' })).toBeNull()
  })
})
