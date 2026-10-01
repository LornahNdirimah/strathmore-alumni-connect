/**
 * Directory visibility (DESIGN_BACKLOG #44, remainder).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SessionContext, SessionUpdateContext } from '../src/app/SessionContext'
import { AccountSettings } from '../src/features/account/AccountSettings'
import type { AuthSession } from '../src/types'
import { installFakeApi, makeSession } from './helpers/fakeApi'

function renderSettings(session: AuthSession) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={session}>
        <SessionUpdateContext.Provider value={vi.fn()}>
          <MemoryRouter>
            <AccountSettings session={session} />
          </MemoryRouter>
        </SessionUpdateContext.Provider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('directory visibility', () => {
  it('lets an alumnus leave the alumni directory', async () => {
    const { requests } = installFakeApi({
      'GET /blocks': { body: { blocked: [] } },
      'GET /account/privacy': { body: { privacy: { showInDirectory: true } } },
      'PUT /account/privacy': {
        body: { privacy: { showInDirectory: false }, message: 'You are no longer listed in the alumni directory.' },
      },
    })
    renderSettings(makeSession({ role: 'alumni' }))

    const toggle = screen.getByRole('checkbox', { name: 'Show me in the alumni directory' })
    await waitFor(() => expect(toggle).toBeChecked())
    await userEvent.click(toggle)

    expect(await screen.findByText('You are no longer listed in the alumni directory.')).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
    expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({ showInDirectory: false })
  })

  it('is not offered to students, who are never in the directory', () => {
    installFakeApi({ 'GET /blocks': { body: { blocked: [] } } })
    renderSettings(makeSession())
    expect(screen.queryByText('Show me in the alumni directory')).toBeNull()
  })
})
