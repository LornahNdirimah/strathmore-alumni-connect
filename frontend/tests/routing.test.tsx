/**
 * Route guards in App.tsx.
 *
 * These are UI affordances — the API enforces roles itself — but getting them
 * wrong strands a user on a blank page or the wrong dashboard, so the redirect
 * rules are pinned here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../src/App'
import type { AuthSession } from '../src/types'
import { errorReply, installFakeApi, makeSession } from './helpers/fakeApi'

let currentPath = ''
function LocationProbe() {
  currentPath = useLocation().pathname
  return null
}

function renderAt(path: string, session: AuthSession | null) {
  installFakeApi({
    'GET /auth/me': session
      ? { body: { user: session } }
      : errorReply(401, 'UNAUTHORIZED', 'Not signed in.'),
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('route guards', () => {
  it('sends a signed-out visitor from a dashboard to the login page', async () => {
    renderAt('/student', null)
    await waitFor(() => expect(currentPath).toBe('/login'))
  })

  it('sends a student who has not completed the opt-in form to onboarding', async () => {
    const session = makeSession({
      optIn: { isSeeker: false, isMentor: false, seekerId: null, mentorProfileId: null },
    })
    renderAt('/student', session)
    await waitFor(() => expect(currentPath).toBe('/onboarding'))
  })

  it('treats a session missing optIn as not opted in instead of crashing', async () => {
    const session = { ...makeSession(), optIn: undefined } as unknown as AuthSession
    renderAt('/student', session)
    await waitFor(() => expect(currentPath).toBe('/onboarding'))
  })

  it("redirects a user away from another role's dashboard to their own", async () => {
    renderAt('/admin', makeSession())
    await waitFor(() => expect(currentPath).toBe('/student'))
  })

  it('redirects a signed-in user away from the login page', async () => {
    const alumni = makeSession({
      role: 'alumni',
      optIn: { isSeeker: false, isMentor: true, seekerId: null, mentorProfileId: 'm-1' },
    })
    renderAt('/login', alumni)
    await waitFor(() => expect(currentPath).toBe('/alumni'))
  })
})
