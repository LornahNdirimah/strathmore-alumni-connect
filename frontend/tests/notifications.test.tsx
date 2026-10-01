/**
 * Notifications, live updates, meeting links and calendar export in the UI.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useLiveUpdates } from '../src/app/useLiveUpdates'
import { NotificationBell } from '../src/features/notifications/NotificationBell'
import { SessionList } from '../src/features/scheduling/SessionList'
import type { MentorshipSession } from '../src/types'
import { installFakeApi } from './helpers/fakeApi'

let currentUrl = ''
function LocationProbe() {
  const location = useLocation()
  currentUrl = `${location.pathname}${location.search}`
  return null
}

function wrap(ui: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/student']}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const notification = (id: string, title: string, read: boolean, link: string | null = null) => ({
  id,
  type: 'request.accepted',
  title,
  body: null,
  link,
  createdAt: '2026-09-29T10:00:00.000Z',
  read,
})

describe('NotificationBell', () => {
  it('shows the unread count, and opening an item marks it read and follows its link', async () => {
    const { requests } = installFakeApi({
      'GET /notifications': {
        body: {
          unreadCount: 2,
          notifications: [
            notification('n1', 'Amina accepted your request', false, '/student/my-mentors'),
            notification('n2', 'New announcement', false),
            notification('n3', 'Old news', true),
          ],
        },
      },
      'POST /notifications/n1/read': { body: { message: 'ok' } },
    })
    wrap(<NotificationBell />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    await user.click(screen.getByRole('button', { name: /Amina accepted your request/ }))

    await waitFor(() => expect(currentUrl).toBe('/student/my-mentors'))
    expect(requests.some((r) => r.method === 'POST' && r.path === '/notifications/n1/read')).toBe(true)
  })

  it('marks everything read', async () => {
    const { requests } = installFakeApi({
      'GET /notifications': { body: { unreadCount: 1, notifications: [notification('n1', 'Hello', false)] } },
      'POST /notifications/read-all': { body: { message: 'ok' } },
    })
    wrap(<NotificationBell />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await user.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(requests.some((r) => r.path === '/notifications/read-all')).toBe(true))
  })
})

describe('useLiveUpdates', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = []
    listeners = new Map<string, Array<(event: MessageEvent) => void>>()
    closed = false
    constructor(
      public url: string,
      public init?: EventSourceInit,
    ) {
      FakeEventSource.instances.push(this)
    }
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }
    emit(type: string, data: unknown) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(new MessageEvent(type, { data: JSON.stringify(data) }))
      }
    }
    close() {
      this.closed = true
    }
  }

  afterEach(() => {
    FakeEventSource.instances = []
  })

  it('opens a credentialed stream and turns hints into refetches', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { unmount } = renderHook(() => useLiveUpdates(true), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    const source = FakeEventSource.instances[0]!
    expect(source.url).toBe('http://localhost:3001/api/notifications/stream')
    expect(source.init).toEqual({ withCredentials: true })

    act(() => source.emit('message', { type: 'message', conversationId: 'conv-7' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'conv-7'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversations'] })

    act(() => source.emit('sessions', { type: 'sessions' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] })

    unmount()
    expect(source.closed).toBe(true)
  })

  it('opens nothing for someone who is not signed in', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    renderHook(() => useLiveUpdates(false), {
      wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>,
    })
    expect(FakeEventSource.instances).toHaveLength(0)
  })
})

describe('sessions', () => {
  const session: MentorshipSession = {
    id: 'sess-1',
    relationshipId: 'rel-1',
    mentorProfileId: 'mp-1',
    title: 'Mock interview',
    scheduledAt: '2026-12-01T14:00:00.000Z',
    endsAt: '2026-12-01T14:30:00.000Z',
    durationMin: 30,
    slotLabel: 'Tuesday 5:00 PM EAT',
    dateLabel: 'December 1, 2026',
    timezoneLabel: 'EAT',
    status: 'upcoming',
    notes: null,
    cancelledReason: null,
    mentorName: 'Amina Osei',
    studentName: 'Kevin Otieno',
    meetingLink: 'https://meet.example.com/abc',
    calendarUrl: '/api/scheduling/sessions/sess-1/calendar.ics',
    myRating: null,
    bookedByMe: true,
    canModify: true,
  }

  it('offers the meeting link and a calendar download', async () => {
    installFakeApi({ 'GET /scheduling/sessions': { body: { sessions: [session] } } })
    wrap(<SessionList scope="upcoming" counterpart="mentor" />)

    const join = await screen.findByRole('link', { name: 'Join meeting' })
    expect(join).toHaveAttribute('href', 'https://meet.example.com/abc')
    expect(join).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: 'Add to calendar' })).toHaveAttribute(
      'href',
      'http://localhost:3001/api/scheduling/sessions/sess-1/calendar.ics',
    )
  })

  it('lets a participant change the meeting link', async () => {
    const { requests } = installFakeApi({
      'GET /scheduling/sessions': { body: { sessions: [session] } },
      'PATCH /scheduling/sessions/sess-1': { body: { session, message: 'Saved.' } },
    })
    wrap(<SessionList scope="upcoming" counterpart="mentor" />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Change meeting link' }))
    const field = screen.getByLabelText('Meeting link')
    await user.clear(field)
    await user.type(field, 'https://zoom.example.com/j/123')
    await user.click(screen.getByRole('button', { name: 'Save link' }))

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true))
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ meetingLink: 'https://zoom.example.com/j/123' })
  })
})
