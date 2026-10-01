/**
 * Phase 7 in the UI: consent, deleting an account, report and block, the
 * admin reports queue and the alumni import.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import App from '../src/App'
import { SessionContext, SessionUpdateContext } from '../src/app/SessionContext'
import { AccountSettings } from '../src/features/account/AccountSettings'
import { AlumniImport } from '../src/features/admin/AlumniImport'
import { ReportsQueue } from '../src/features/admin/ReportsQueue'
import { BlockButton, ReportButton } from '../src/features/safety/SafetyControls'
import { installFakeApi, makeSession } from './helpers/fakeApi'

let currentPath = ''
function LocationProbe() {
  currentPath = useLocation().pathname
  return null
}

function renderWith(ui: ReactNode, onUpdate = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={makeSession()}>
        <SessionUpdateContext.Provider value={onUpdate}>
          <MemoryRouter initialEntries={['/student/profile']}>
            {ui}
            <LocationProbe />
          </MemoryRouter>
        </SessionUpdateContext.Provider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return onUpdate
}

describe('consent', () => {
  it('holds an account that has not accepted the current terms on the consent screen', async () => {
    const session = makeSession({ termsAccepted: false })
    const { requests } = installFakeApi({
      'GET /auth/me': { body: { user: session } },
      'POST /account/accept-terms': { body: { user: makeSession(), message: 'Thank you.' } },
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/student']}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()

    await waitFor(() => expect(currentPath).toBe('/consent'))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(requests.some((r) => r.path === '/account/accept-terms')).toBe(true))
    await waitFor(() => expect(currentPath).toBe('/student'))
  })
})

describe('deleting an account', () => {
  it('needs the password and a tick, then signs out and leaves', async () => {
    const { requests } = installFakeApi({
      'GET /blocks': { body: { blocked: [] } },
      'POST /account/delete': { body: { message: 'Your account has been deleted.' } },
    })
    const onUpdate = renderWith(<AccountSettings session={makeSession()} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Delete my account…' }))
    const submit = screen.getByRole('button', { name: 'Delete my account' })
    await user.type(screen.getByLabelText('Your password'), 'student-password-123')
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /deleted permanently/ }))
    await user.click(submit)

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(null))
    expect(requests.find((r) => r.path === '/account/delete')?.body).toEqual({
      password: 'student-password-123',
      confirm: true,
    })
    expect(currentPath).toBe('/')
  })

  it('offers the data download', () => {
    installFakeApi({ 'GET /blocks': { body: { blocked: [] } } })
    renderWith(<AccountSettings session={makeSession()} />)
    expect(screen.getByRole('link', { name: 'Download my data' })).toHaveAttribute(
      'href',
      'http://localhost:3001/api/account/export',
    )
  })
})

describe('report and block', () => {
  it('sends a report with its reason and context', async () => {
    const { requests } = installFakeApi({
      'POST /reports': { status: 201, body: { message: 'Thank you. An administrator will review your report.' } },
    })
    renderWith(<ReportButton userId="u-9" name="Brian" contextType="message" contextId="msg-1" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Report Brian' }))
    await user.selectOptions(screen.getByLabelText('What is wrong?'), 'spam')
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    expect(await screen.findByText(/An administrator will review/)).toBeInTheDocument()
    expect(requests[0]?.body).toEqual({ userId: 'u-9', contextType: 'message', contextId: 'msg-1', reason: 'spam' })
  })

  it('blocks, and offers to unblock someone already blocked', async () => {
    const { requests } = installFakeApi({
      'GET /blocks': { body: { blocked: [{ userId: 'u-9', name: 'Brian', avatarUrl: null, blockedAt: '2026-09-30T00:00:00Z' }] } },
      'DELETE /blocks/u-9': { body: { message: 'Unblocked.' } },
    })
    renderWith(<BlockButton userId="u-9" name="Brian" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Unblock Brian' }))
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE')).toBe(true))
  })
})

describe('admin tools', () => {
  it('shows a reported message and records the decision', async () => {
    const { requests } = installFakeApi({
      'GET /admin/reports': {
        body: {
          reports: [
            {
              id: 'rep-1',
              reporter: { userId: 's-1', name: 'Kevin' },
              reported: { userId: 'm-1', name: 'Brian', role: 'alumni', status: 'active', totalReports: 2 },
              contextType: 'message',
              contextId: 'msg-1',
              excerpt: 'Something rude',
              reason: 'harassment',
              details: null,
              status: 'open',
              resolutionNote: null,
              reviewerName: null,
              reviewedAt: null,
              createdAt: '2026-09-30T08:00:00.000Z',
            },
          ],
        },
      },
      'PATCH /admin/reports/rep-1': { body: { message: 'ok' } },
    })
    renderWith(<ReportsQueue />)
    const user = userEvent.setup()

    expect(await screen.findByText('“Something rude”')).toBeInTheDocument()
    expect(screen.getByText(/2 reports about this person in total/)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Note for the record/), 'Warned them.')
    await user.click(screen.getByRole('button', { name: 'Mark actioned' }))

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true))
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ status: 'actioned', note: 'Warned them.' })
  })

  it('previews an import before creating anything', async () => {
    const preview = {
      dryRun: true,
      summary: { ready: 1, created: 0, duplicate: 0, invalid: 1 },
      rows: [
        { line: 2, name: 'Grace', email: 'grace@example.com', status: 'ready', problems: [] },
        { line: 3, name: 'Bad', email: 'bad', status: 'invalid', problems: ['Not a valid email address.'] },
      ],
    }
    const { requests } = installFakeApi({})
    // Answer according to dryRun, as the server does.
    const fetchMock = globalThis.fetch as unknown as { mockImplementation: (fn: unknown) => void }
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      requests.push({ method: 'POST', path: '/admin/alumni/import', query: new URLSearchParams(), body, credentials: init.credentials })
      const result = body.dryRun ? preview : { ...preview, dryRun: false, summary: { ...preview.summary, ready: 0, created: 1 } }
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    renderWith(<AlumniImport />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('…or paste it'), 'name,email,class year,programme')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByText(/Nothing has been created yet/)).toBeInTheDocument()
    expect(screen.getByText(/Not a valid email address/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import 1 alumni' }))
    expect(await screen.findByText(/Created 1 accounts/)).toBeInTheDocument()
    expect(requests.map((r) => (r.body as { dryRun: boolean }).dryRun)).toEqual([true, false])
  })
})
