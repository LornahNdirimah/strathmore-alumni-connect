/**
 * A stand-in for the backend, installed as `fetch`.
 *
 * Stubbing at the network boundary rather than mocking `lib/api` means every
 * test also exercises the real HTTP client — URL building, the credentials
 * flag, and turning error bodies into ApiError — which is where the frontend
 * and the API actually meet.
 */
import { vi } from 'vitest'

import type { AuthSession } from '../../src/types'

type Reply = { status?: number; body?: unknown }
type Handler = Reply | ((request: RecordedRequest) => Reply)

export type RecordedRequest = {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  credentials: RequestCredentials | undefined
}

/** Routes are keyed `METHOD /path`, with the path relative to `/api`. */
export function installFakeApi(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = []

  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const request: RecordedRequest = {
      method,
      path: url.pathname.replace(/^\/api/, ''),
      query: url.searchParams,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      credentials: init.credentials,
    }
    requests.push(request)

    const handler = routes[`${method} ${request.path}`]
    const reply: Reply = !handler
      ? {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message: `No fake for ${method} ${request.path}` } },
        }
      : typeof handler === 'function'
        ? handler(request)
        : handler

    const status = reply.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

export function errorReply(status: number, code: string, message: string, details = []): Reply {
  return { status, body: { error: { code, message, details } } }
}

export function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    id: 'u-1',
    name: 'Test User',
    email: 'test@example.com',
    role: 'student',
    status: 'active',
    optIn: { isSeeker: true, isMentor: false, seekerId: 's-1', mentorProfileId: null },
    capabilities: [
      'mentors.browse',
      'mentorship.request',
      'mentorship.participate',
      'opportunities.view',
      'opportunities.apply',
      'communities.view',
      'communities.join',
      'messaging.use',
      'events.view',
      'events.register',
    ],
    verification: null,
    avatarUrl: null,
    emailVerified: true,
    termsAccepted: true,
    ...overrides,
  }
}
