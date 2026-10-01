/**
 * Messaging: opening a specific thread from elsewhere in the app.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { MessagingPage } from '../src/features/messaging/MessagingPage'
import { installFakeApi } from './helpers/fakeApi'

const conversation = (id: string, participantName: string) => ({
  id,
  participantId: `user-${id}`,
  participantName,
  participantRole: 'alumni',
  preview: 'Hello',
  lastMessageTime: '10:00 AM',
  unreadCount: 0,
})

const message = (conversationId: string, text: string) => ({
  id: `m-${conversationId}`,
  conversationId,
  from: 'them',
  text,
  time: '10:00 AM',
  createdAt: '2026-09-29T10:00:00.000Z',
})

describe('MessagingPage', () => {
  it('opens the thread named in ?c= rather than the most recent one', async () => {
    const { requests } = installFakeApi({
      'GET /conversations': {
        body: { conversations: [conversation('recent', 'Grace'), conversation('older', 'Amina')] },
      },
      'GET /conversations/recent/messages': { body: { messages: [message('recent', 'From Grace')] } },
      'GET /conversations/older/messages': { body: { messages: [message('older', 'From Amina')] } },
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/messages?c=older']}>
          <MessagingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('From Amina')).toBeInTheDocument()
    expect(requests.some((request) => request.path === '/conversations/recent/messages')).toBe(false)
  })
})
