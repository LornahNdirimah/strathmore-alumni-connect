/**
 * Student dashboard: recommendations lead to the recommended mentor.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { StudentDashboardPage } from '../src/features/students/StudentDashboardPage'
import { installFakeApi, makeSession } from './helpers/fakeApi'

let currentPath = ''
function LocationProbe() {
  currentPath = useLocation().pathname
  return null
}

describe('StudentDashboardPage', () => {
  it("opens the recommended mentor's own profile from View", async () => {
    installFakeApi({
      'GET /mentors/recommendations': {
        body: {
          source: 'ml',
          items: [
            {
              id: 'mentor-amina',
              userId: 'user-amina',
              name: 'Amina Osei',
              role: 'Data Scientist',
              company: 'Safaricom',
              industry: 'Telecom',
              location: 'Nairobi',
              availability: 'Available',
              skills: [],
              tracks: ['Data Science'],
              capacity: 3,
              remainingCapacity: 2,
              matchScore: 0.82,
            },
          ],
        },
      },
    })

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/student']}>
          <StudentDashboardPage
            session={makeSession()}
            activeTab="overview"
            onNavigate={vi.fn()}
            onTabChange={vi.fn()}
          />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await userEvent.click(await screen.findByRole('button', { name: "View Amina Osei's profile" }))

    expect(currentPath).toBe('/mentors/mentor-amina')
  })
})
