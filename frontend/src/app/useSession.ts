/**
 * Session state, sourced from the server rather than localStorage.
 *
 * The old model read a plain JSON blob out of localStorage synchronously on
 * mount, which meant the client decided who it was — editing that value to
 * `{"role":"admin"}` was enough to reach the admin dashboard. The token now
 * lives in an httpOnly cookie the page cannot read, so identity has to be
 * fetched, and the answer comes from a signature the server verified.
 *
 * The cost is that boot is asynchronous, hence the explicit `status` — the app
 * must not decide a user is logged out while that first request is in flight,
 * or every reload would flash the login page.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { authApi } from '../lib/api'
import { ApiError } from '../lib/http'
import type { AuthSession } from '../types'

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

export type UseSessionResult = {
  session: AuthSession | null
  status: SessionStatus
  setSession: (session: AuthSession | null) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

export function useSession(): UseSessionResult {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')
  const queryClient = useQueryClient()
  const currentUserId = useRef<string | null>(null)

  /**
   * Cached server data belongs to whoever fetched it. Query keys such as
   * ['requests'] are not scoped by user, and with a 30s staleTime the next
   * account to sign in on this tab was served the previous account's cached
   * requests, mentorships and stats. Clearing whenever the identity changes is
   * simpler and safer than threading a user id through every key.
   */
  const adopt = useCallback(
    (next: AuthSession | null) => {
      const nextId = next?.id ?? null
      if (nextId !== currentUserId.current) queryClient.clear()
      currentUserId.current = nextId
      setSession(next)
      setStatus(next ? 'authenticated' : 'anonymous')
    },
    [queryClient],
  )

  const refresh = useCallback(async () => {
    try {
      const { user } = await authApi.me()
      adopt(user)
    } catch (error) {
      // A 401 is the normal "not signed in" answer, not a failure worth
      // surfacing. Anything else (the API being down) also leaves the user
      // anonymous, but is worth a console note while developing.
      if (!(error instanceof ApiError) || error.status !== 401) {
        console.warn('Session check failed:', error)
      }
      adopt(null)
    }
  }, [adopt])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      // Clear locally even if the request failed; the cookie is gone or the
      // server is unreachable, and either way this session is over.
      adopt(null)
    }
  }, [adopt])

  return { session, status, setSession: adopt, refresh, logout }
}
