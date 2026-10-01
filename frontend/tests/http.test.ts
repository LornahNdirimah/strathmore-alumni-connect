/**
 * The HTTP client: the one place every request and every error passes through.
 */
import { describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '../src/lib/http'
import { errorReply, installFakeApi } from './helpers/fakeApi'

describe('api client', () => {
  it('sends the auth cookie with every request', async () => {
    const { requests } = installFakeApi({ 'GET /ping': { body: { ok: true } } })

    await api.get('/ping')

    expect(requests[0]?.credentials).toBe('include')
  })

  it('drops empty and undefined query values so unset filters are not applied', async () => {
    const { requests } = installFakeApi({ 'GET /mentors': { body: {} } })

    await api.get('/mentors', { q: 'data', industry: '', available: undefined, page: 2 })

    expect(Object.fromEntries(requests[0]!.query)).toEqual({ q: 'data', page: '2' })
  })

  it('turns an error body into an ApiError with per-field messages', async () => {
    installFakeApi({
      'POST /auth/signup': errorReply(400, 'BAD_REQUEST', 'Invalid request.', [
        { field: 'password', message: 'Too short.' },
      ] as never),
    })

    const error = await api.post('/auth/signup', {}).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, code: 'BAD_REQUEST', message: 'Invalid request.' })
    expect((error as ApiError).fieldErrors()).toEqual({ password: 'Too short.' })
  })

  it('reports an unreachable server as a network error rather than throwing raw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(api.get('/ping')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })

  it('resolves a 204 to undefined without trying to parse a body', async () => {
    installFakeApi({ 'DELETE /groups/g-1/leave': { status: 204 } })

    await expect(api.delete('/groups/g-1/leave')).resolves.toBeUndefined()
  })
})
