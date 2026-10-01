import { useQuery } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { adminApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'

/**
 * The admin audit log (DESIGN_BACKLOG #45): every approval, rejection,
 * suspension, announcement, event change and community removal, with who did
 * it and when. Entries are written in the same transaction as the action.
 */
export function ActivityLog() {
  const log = useQuery({ queryKey: ['admin-audit'], queryFn: () => adminApi.audit() })

  return (
    <div className="panel">
      <h2>Activity log</h2>
      <p className="muted-line">The most recent 100 administrator actions.</p>
      <QueryState
        isLoading={log.isLoading}
        error={log.error}
        isEmpty={(log.data?.entries ?? []).length === 0}
        emptyMessage="No administrator actions recorded yet."
      >
        <ol className="activity-list">
          {(log.data?.entries ?? []).map((entry) => (
            <li key={entry.id}>
              <span className="muted-line">{formatDateTime(entry.createdAt)}</span>
              <p>
                <strong>{entry.adminName ?? 'A former admin'}</strong> — {entry.summary}
              </p>
            </li>
          ))}
        </ol>
      </QueryState>
    </div>
  )
}
