import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { adminApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { ApiError } from '../../lib/http'
import type { ReportItem } from '../../types'

const REASON_LABELS: Record<ReportItem['reason'], string> = {
  harassment: 'Harassment',
  inappropriate: 'Inappropriate content',
  spam: 'Spam',
  impersonation: 'Impersonation',
  safety: 'Safety concern',
  other: 'Other',
}

/**
 * Reports from members (DESIGN_BACKLOG #42), open ones first. Each shows where
 * it happened — for a message, the message itself — and how often the person
 * has been reported in total. Suspending, when warranted, is done from Users.
 */
export function ReportsQueue() {
  const [filter, setFilter] = useState<'open' | 'closed'>('open')
  const reports = useQuery({ queryKey: ['admin-reports', filter], queryFn: () => adminApi.reports(filter) })
  const items = reports.data?.reports ?? []

  return (
    <div className="panel">
      <h2>Reports</h2>
      <div className="filter-tabs" role="tablist" aria-label="Which reports">
        {(['open', 'closed'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={filter === value ? 'filter-tab active' : 'filter-tab'}
            onClick={() => setFilter(value)}
          >
            {value === 'open' ? 'Needs review' : 'Reviewed'}
          </button>
        ))}
      </div>
      <QueryState
        isLoading={reports.isLoading}
        error={reports.error}
        isEmpty={items.length === 0}
        emptyMessage={filter === 'open' ? 'Nothing to review.' : 'No reviewed reports yet.'}
      >
        <div className="directory-list">
          {items.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      </QueryState>
    </div>
  )
}

function ReportCard({ report }: { report: ReportItem }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const review = useMutation({
    mutationFn: (status: 'actioned' | 'dismissed') => adminApi.reviewReport(report.id, status, note.trim() || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-reports'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-audit'] })
    },
  })

  return (
    <article className="directory-item stacked">
      <div className="directory-item-row">
        <div>
          <strong>{REASON_LABELS[report.reason]}</strong> — about <strong>{report.reported.name}</strong> ({report.reported.role}
          {report.reported.status !== 'active' ? `, ${report.reported.status}` : ''})
          <p className="muted-line">
            Reported by {report.reporter?.name ?? 'a former member'} · {formatDateTime(report.createdAt)} · in a{' '}
            {report.contextType}
            {report.reported.totalReports > 1 && ` · ${report.reported.totalReports} reports about this person in total`}
          </p>
        </div>
        <span className={report.status === 'open' ? 'status busy' : 'status'}>{report.status}</span>
      </div>
      {report.excerpt && <blockquote className="report-excerpt">“{report.excerpt}”</blockquote>}
      {report.details && <p>{report.details}</p>}

      {report.status === 'open' ? (
        <div className="form-grid">
          <input
            className="input-field"
            aria-label="Note for the record (not shown to the reporter)"
            placeholder="Note for the record (not shown to the reporter)"
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="row-actions">
            <button className="primary-btn" type="button" disabled={review.isPending} onClick={() => review.mutate('actioned')}>
              Mark actioned
            </button>
            <button className="ghost-btn" type="button" disabled={review.isPending} onClick={() => review.mutate('dismissed')}>
              Dismiss
            </button>
          </div>
          {review.isError && (
            <p className="error-msg">{review.error instanceof ApiError ? review.error.message : 'Could not save.'}</p>
          )}
        </div>
      ) : (
        <p className="muted-line">
          {report.status} by {report.reviewerName ?? 'an admin'} {formatDateTime(report.reviewedAt)}
          {report.resolutionNote ? ` — ${report.resolutionNote}` : ''}
        </p>
      )}
    </article>
  )
}
