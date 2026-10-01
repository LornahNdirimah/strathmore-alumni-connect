import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { Icon } from '../../components/ui/Icon'
import { notificationsApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { NotificationItem } from '../../types'

/**
 * The bell in the top bar (DESIGN_BACKLOG #26): an unread count, and a panel
 * listing recent notifications. Opening one marks it read and takes the reader
 * to where they can act on it.
 *
 * Live updates (useLiveUpdates) refresh the list the moment something happens;
 * the slow poll here is only a fallback for when the stream is unavailable.
 */
export function NotificationBell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
    refetchInterval: 60_000,
  })

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  const markRead = useMutation({ mutationFn: notificationsApi.read, onSuccess: refresh })
  const markAll = useMutation({ mutationFn: notificationsApi.readAll, onSuccess: refresh })

  // Close on a click outside the panel or on Escape.
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = inbox.data?.unreadCount ?? 0
  const items = inbox.data?.notifications ?? []

  const openItem = (item: NotificationItem) => {
    if (!item.read) markRead.mutate(item.id)
    setOpen(false)
    if (item.link) navigate(item.link)
  }

  return (
    <div className="notification-bell" ref={panel}>
      <button
        className="ghost-btn bell-button"
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon.Bell />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notification-panel" role="dialog" aria-label="Notifications">
          <div className="notification-panel-header">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="link-btn" type="button" onClick={() => markAll.mutate()}>
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="muted-line notification-empty">You're all caught up.</p>
          ) : (
            <ul className="notification-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.read ? 'notification-item' : 'notification-item unread'}
                    onClick={() => openItem(item)}
                  >
                    <strong>{item.title}</strong>
                    {item.body && <span className="notification-body">{item.body}</span>}
                    <span className="muted-line">{formatDateTime(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
