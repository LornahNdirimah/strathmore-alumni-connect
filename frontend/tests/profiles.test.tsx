/**
 * Profiles and account settings (DESIGN_BACKLOG #24, #25).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SessionContext, SessionUpdateContext } from '../src/app/SessionContext'
import { Avatar } from '../src/components/ui/Avatar'
import { AccountSettings } from '../src/features/account/AccountSettings'
import { AlumniDashboardPage } from '../src/features/alumni/AlumniDashboardPage'
import { StudentDashboardPage } from '../src/features/students/StudentDashboardPage'
import type { AuthSession } from '../src/types'
import { installFakeApi, makeSession } from './helpers/fakeApi'

// jsdom has no canvas, so the resize step is replaced; what is under test is
// what the page does with the result.
vi.mock('../src/lib/image', () => ({
  ImageError: class ImageError extends Error {},
  prepareAvatar: vi.fn(async () => 'data:image/webp;base64,UklGRgAAAABXRUJQ'),
}))

function renderWith(ui: ReactNode, session: AuthSession, onUpdate = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={session}>
        <SessionUpdateContext.Provider value={onUpdate}>
          <MemoryRouter>{ui}</MemoryRouter>
        </SessionUpdateContext.Provider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return onUpdate
}

describe('Avatar', () => {
  it('shows the photo when there is one, and initials otherwise', () => {
    const { rerender } = render(<Avatar name="Amina Osei" url="/api/users/u-1/avatar?v=1" />)
    expect(screen.getByRole('img', { name: "Amina Osei's photo" })).toHaveAttribute(
      'src',
      'http://localhost:3001/api/users/u-1/avatar?v=1',
    )

    rerender(<Avatar name="Amina Osei" url={null} />)
    expect(screen.getByText('AO')).toBeInTheDocument()
  })

  it('falls back to initials when the photo fails to load', () => {
    render(<Avatar name="Dr. Amina Osei" url="/api/users/u-1/avatar?v=1" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText('DA')).toBeInTheDocument()
  })
})

describe('AccountSettings', () => {
  it('uploads a photo and updates the session with the result', async () => {
    const updated = makeSession({ avatarUrl: '/api/users/u-1/avatar?v=2' })
    const { requests } = installFakeApi({
      'PUT /account/avatar': { body: { user: updated, message: 'Your photo was updated.' } },
    })
    const onUpdate = renderWith(<AccountSettings session={makeSession()} />, makeSession())

    const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('Choose a photo'), file)

    expect(await screen.findByText('Your photo was updated.')).toBeInTheDocument()
    expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({ image: 'data:image/webp;base64,UklGRgAAAABXRUJQ' })
    expect(onUpdate).toHaveBeenCalledWith(updated)
  })

  it('offers removal only when there is a photo', async () => {
    installFakeApi({
      'DELETE /account/avatar': { body: { user: makeSession(), message: 'Your photo was removed.' } },
    })
    renderWith(
      <AccountSettings session={makeSession({ avatarUrl: '/api/users/u-1/avatar?v=1' })} />,
      makeSession(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    expect(await screen.findByText('Your photo was removed.')).toBeInTheDocument()
  })

  it('renames, and refuses a password confirmation that does not match', async () => {
    const renamed = makeSession({ name: 'Kevin O. Otieno' })
    installFakeApi({ 'PATCH /account': { body: { user: renamed, message: 'Your name was updated.' } } })
    const onUpdate = renderWith(<AccountSettings session={makeSession()} />, makeSession())
    const user = userEvent.setup()

    const nameField = screen.getByLabelText('Full name')
    await user.clear(nameField)
    await user.type(nameField, 'Kevin O. Otieno')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(renamed))

    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password')
    await user.type(screen.getByLabelText('Confirm new password'), 'something-else-entirely')
    expect(screen.getByText('The two passwords do not match.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
  })
})

describe('editable profiles', () => {
  it('lets a student edit their career goals, starting from what they saved', async () => {
    const { requests } = installFakeApi({
      'GET /seekers/me': {
        body: {
          seeker: {
            id: 's-1', userId: 'u-1', major: 'Computer Science', year: 'Year 3', targetTrack: 'Data Science',
            careerGoalText: 'I want to move into machine learning engineering.', preferredCadence: 'biweekly',
            formatPreference: 'virtual', requestedSupport: ['interview_prep'], interests: ['ml'],
            skillTags: ['Python'], hobbies: ['chess'], uniqueQuality: '', country: 'Kenya', stateProvince: 'Nairobi',
          },
        },
      },
      'PATCH /seekers/me': { body: { seeker: {}, message: 'Saved.' } },
    })
    renderWith(
      <StudentDashboardPage session={makeSession()} activeTab="profile" onNavigate={vi.fn()} onTabChange={vi.fn()} />,
      makeSession(),
    )
    const user = userEvent.setup()

    const major = await screen.findByDisplayValue('Computer Science')
    await user.clear(major)
    await user.type(major, 'Data Science and Analytics')
    await user.click(screen.getByRole('button', { name: 'Save career goals' }))

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true))
    expect(requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({
      major: 'Data Science and Analytics',
      skillTags: ['Python'],
      hobbies: ['chess'],
    })
  })

  it('lets a mentor edit their whole mentor profile, including matching details', async () => {
    const mentorSession = makeSession({
      role: 'alumni',
      capabilities: ['mentorship.mentor', 'opportunities.post', 'communities.view'],
    })
    const { requests } = installFakeApi({
      'GET /mentors/me': {
        body: {
          mentor: { id: 'mp-1', name: 'Amina Osei', role: 'Data Scientist', tracks: [] },
          editable: {
            headline: 'Data Scientist', company: 'Safaricom', industry: 'Telecom', location: 'Nairobi',
            bio: '', capacity: 3, availability: 'Available', cadence: 'biweekly', formatPreference: 'either',
            skills: ['Python'], tracks: ['Data Science'], major: 'Statistics', hobbies: ['running'],
            uniqueQuality: '', country: 'Kenya', stateProvince: 'Nairobi',
          },
        },
      },
      'PATCH /mentors/me': { body: { mentor: {}, message: 'Profile updated.' } },
    })
    renderWith(
      <AlumniDashboardPage session={mentorSession} activeTab="profile" onNavigate={vi.fn()} onTabChange={vi.fn()} />,
      mentorSession,
    )
    const user = userEvent.setup()

    const hobbies = await screen.findByDisplayValue('running')
    await user.type(hobbies, ', photography')
    await user.click(screen.getByRole('button', { name: 'Save mentor profile' }))

    expect(await screen.findByText('Profile updated.')).toBeInTheDocument()
    expect(requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({
      headline: 'Data Scientist',
      hobbies: ['running', 'photography'],
      capacity: 3,
    })
  })
})
