/**
 * Admin verification queue: every undecided entry can still be decided.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AdminDashboardPage } from '../src/features/admin/AdminDashboardPage'
import { installFakeApi } from './helpers/fakeApi'

const entry = (id: string, name: string, status: string) => ({
  id,
  user_id: `user-${id}`,
  name,
  email: `${id}@example.com`,
  class_year: '2019',
  program: 'BSc Informatics',
  status,
  created_at: '2026-09-01T00:00:00.000Z',
  reviewed_at: null,
})

function renderQueue() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminDashboardPage activeTab="verification-queue" onTabChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('verification queue', () => {
  it('lets a flagged entry still be verified', async () => {
    const { requests } = installFakeApi({
      'GET /admin/verifications': { body: { verifications: [entry('v1', 'Brian Mwangi', 'review')] } },
      'PATCH /admin/verifications/v1': { body: { message: 'Verification approved.' } },
    })
    renderQueue()

    await userEvent.click(await screen.findByRole('button', { name: 'Verify Brian Mwangi' }))

    expect(await screen.findByText('Verification approved.')).toBeInTheDocument()
    expect(requests.find((request) => request.method === 'PATCH')?.body).toEqual({
      status: 'approved',
    })
  })

  it('offers reject on pending and flagged entries, but no actions once decided', async () => {
    installFakeApi({
      'GET /admin/verifications': {
        body: {
          verifications: [
            entry('v1', 'Pending Person', 'pending'),
            entry('v2', 'Flagged Person', 'review'),
            entry('v3', 'Approved Person', 'approved'),
          ],
        },
      },
    })
    renderQueue()

    expect(await screen.findByRole('button', { name: 'Reject Pending Person' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject Flagged Person' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Flag Flagged Person for review' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Approved Person/ })).toBeNull()
  })
})
