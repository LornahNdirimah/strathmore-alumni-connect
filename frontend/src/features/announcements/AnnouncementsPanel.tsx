import { useQuery } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { announcementsApi } from '../../lib/api'
import { formatDate } from '../../lib/format'

/**
 * What the platform's administrators have sent this user's audience
 * (DESIGN_BACKLOG #22). Announcements used to be publishable but unreadable.
 */
export function AnnouncementsPanel({ limit = 3 }: { limit?: number }) {
  const feed = useQuery({ queryKey: ['announcements'], queryFn: () => announcementsApi.feed() })
  const items = (feed.data?.announcements ?? []).slice(0, limit)

  return (
    <div className="panel">
      <h2>Announcements</h2>
      <QueryState
        isLoading={feed.isLoading}
        error={feed.error}
        isEmpty={items.length === 0}
        emptyMessage="No announcements yet."
      >
        <div className="directory-list">
          {items.map((item) => (
            <article className="directory-item announcement" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
                <p className="muted-line">{formatDate(item.createdAt)}</p>
              </div>
            </article>
          ))}
        </div>
      </QueryState>
    </div>
  )
}
