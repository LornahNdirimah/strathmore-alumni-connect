/**
 * The availability editor: the whole week is loaded, edited, and saved as one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AvailabilityEditor } from '../src/features/scheduling/AvailabilityEditor'
import { errorReply, installFakeApi } from './helpers/fakeApi'

const existing = {
  availability: {
    mentorProfileId: 'm-1',
    timezoneLabel: 'EAT',
    sessionDurationMin: 45,
    windows: [
      { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' },
      { dayOfWeek: 3, startTime: '14:00', endTime: '16:00' },
    ],
  },
}

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AvailabilityEditor />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

describe('AvailabilityEditor', () => {
  it('loads the saved schedule into the form', async () => {
    installFakeApi({ 'GET /scheduling/availability/me': { body: existing } })
    renderEditor()

    expect(await screen.findByRole('button', { name: 'Remove Monday window' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Wednesday window' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('45 minutes')).toBeInTheDocument()
  })

  it('saves the whole week, including removals, in one request', async () => {
    const { requests } = installFakeApi({
      'GET /scheduling/availability/me': { body: existing },
      'PUT /scheduling/availability/me': { body: { ...existing, message: 'Availability saved.' } },
    })
    const user = renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Remove Monday window' }))
    await user.click(screen.getByRole('button', { name: 'Save availability' }))

    expect(await screen.findByText('Availability saved.')).toBeInTheDocument()
    const put = requests.find((request) => request.method === 'PUT')
    expect(put?.body).toEqual({
      timezoneLabel: 'EAT',
      sessionDurationMin: 45,
      windows: [{ dayOfWeek: 3, startTime: '14:00', endTime: '16:00' }],
    })
  })

  it("shows the server's reason when a schedule is refused", async () => {
    installFakeApi({
      'GET /scheduling/availability/me': { body: existing },
      'PUT /scheduling/availability/me': errorReply(
        400,
        'BAD_REQUEST',
        'Two windows on Wednesday overlap.',
      ),
    })
    const user = renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Add a window' }))
    await user.click(screen.getByRole('button', { name: 'Save availability' }))

    expect(await screen.findByText('Two windows on Wednesday overlap.')).toBeInTheDocument()
  })

  it('warns that nothing is bookable when there are no windows', async () => {
    installFakeApi({
      'GET /scheduling/availability/me': {
        body: { availability: { ...existing.availability, windows: [] } },
      },
    })
    renderEditor()

    expect(await screen.findByText(/students cannot book a session/)).toBeInTheDocument()
  })
})
