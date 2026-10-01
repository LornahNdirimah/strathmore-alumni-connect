/**
 * Session identity and the query cache.
 *
 * Cached server data is per-person. These tests pin that switching accounts on
 * one tab never lets the second account read the first one's cached data.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { useSession } from '../src/app/useSession'
import { errorReply, installFakeApi, makeSession } from './helpers/fakeApi'

function setup(me = errorReply(401, 'UNAUTHORIZED', 'Not signed in.')) {
  installFakeApi({ 'GET /auth/me': me, 'POST /auth/logout': { body: { message: 'Signed out.' } } })
  const queryClient = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useSession(), { wrapper })
  return { queryClient, hook }
}

describe('useSession', () => {
  it('drops cached data on logout', async () => {
    const student = makeSession()
    const { queryClient, hook } = setup({ body: { user: student } })
    await waitFor(() => expect(hook.result.current.status).toBe('authenticated'))

    queryClient.setQueryData(['requests'], { requests: ['the student’s request'] })
    await act(() => hook.result.current.logout())

    expect(queryClient.getQueryData(['requests'])).toBeUndefined()
  })

  it('drops cached data when a different account signs in', async () => {
    const { queryClient, hook } = setup()
    await waitFor(() => expect(hook.result.current.status).toBe('anonymous'))

    act(() => hook.result.current.setSession(makeSession({ id: 'student-1' })))
    queryClient.setQueryData(['requests'], { requests: ['the student’s request'] })

    act(() =>
      hook.result.current.setSession(makeSession({ id: 'alumni-1', role: 'alumni' })),
    )

    expect(queryClient.getQueryData(['requests'])).toBeUndefined()
  })

  it('keeps cached data when the same account re-reads its session', async () => {
    const student = makeSession()
    const { queryClient, hook } = setup({ body: { user: student } })
    await waitFor(() => expect(hook.result.current.status).toBe('authenticated'))

    queryClient.setQueryData(['requests'], { requests: ['still mine'] })
    // What onboarding does after the opt-in form is submitted.
    await act(() => hook.result.current.refresh())

    expect(queryClient.getQueryData(['requests'])).toEqual({ requests: ['still mine'] })
  })
})
