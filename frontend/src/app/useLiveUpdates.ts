/**
 * Live updates over server-sent events (DESIGN_BACKLOG #56).
 *
 * The server sends hints, not data — "your notifications changed", "a message
 * arrived in conversation X", "a session changed" — and this hook turns each
 * into cache invalidations, so the affected lists refetch through the normal
 * authorised routes. EventSource reconnects by itself, and the pages' slower
 * polling stays as a fallback, so a dropped stream means staler data rather
 * than wrong data.
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { apiAssetUrl } from '../lib/http'

/** What a notification can change on screen besides the bell itself. */
const REFRESHED_BY_NOTIFICATIONS = [
  ['notifications'],
  ['announcements'],
  ['requests'],
  ['relationships'],
  ['dashboard-stats'],
  ['feedback-pending'],
  ['opportunities'],
] as const

export function useLiveUpdates(enabled: boolean): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    // jsdom and very old browsers have no EventSource; polling covers them.
    if (!enabled || typeof EventSource === 'undefined') return

    const source = new EventSource(apiAssetUrl('/api/notifications/stream'), { withCredentials: true })

    const invalidate = (queryKey: readonly unknown[]) =>
      void queryClient.invalidateQueries({ queryKey: [...queryKey] })

    source.addEventListener('notifications', () => {
      for (const key of REFRESHED_BY_NOTIFICATIONS) invalidate(key)
    })

    source.addEventListener('message', (event) => {
      const { conversationId } = JSON.parse((event as MessageEvent<string>).data) as {
        conversationId: string
      }
      invalidate(['conversations'])
      invalidate(['messages', conversationId])
    })

    source.addEventListener('sessions', () => {
      invalidate(['sessions'])
      invalidate(['slots'])
    })

    return () => source.close()
  }, [enabled, queryClient])
}
