/**
 * Report and Block (DESIGN_BACKLOG #42), for anywhere another member appears.
 *
 * Blocking works both ways and is silent: neither person can message or send
 * requests to the other, and the blocked person is not told. Reports go to the
 * administrators, who review them; the reporter hears the outcome.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { safetyApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import type { ReportContext, ReportReason } from '../../types'

const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'impersonation', label: 'Pretending to be someone else' },
  { value: 'safety', label: 'I feel unsafe' },
  { value: 'other', label: 'Something else' },
]

export function ReportButton({
  userId,
  name,
  contextType,
  contextId,
  label = 'Report',
}: {
  userId: string
  name: string
  contextType: ReportContext
  contextId?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>('harassment')
  const [details, setDetails] = useState('')

  const report = useMutation({
    mutationFn: () =>
      safetyApi.report({
        userId,
        contextType,
        ...(contextId ? { contextId } : {}),
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
      }),
    onSuccess: () => setOpen(false),
  })

  if (report.isSuccess) return <span className="muted-line">{report.data.message}</span>

  return (
    <span className="safety-control">
      <button
        className="link-btn"
        type="button"
        aria-label={`${label} ${name}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {open && (
        <form
          className="confirm-box safety-form"
          onSubmit={(event) => {
            event.preventDefault()
            report.mutate()
          }}
        >
          <strong>Report {name}</strong>
          <label>
            <span>What is wrong?</span>
            <select className="select-field" value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
              {REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Anything the reviewer should know? (optional)</span>
            <textarea
              className="textarea-field"
              value={details}
              maxLength={2000}
              onChange={(event) => setDetails(event.target.value)}
            />
          </label>
          <p className="muted-line">Only administrators see reports. {name} is not told who reported them.</p>
          <div className="row-actions">
            <button className="primary-btn" type="submit" disabled={report.isPending}>
              {report.isPending ? 'Sending…' : 'Send report'}
            </button>
            <button className="ghost-btn" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {report.isError && (
            <p className="error-msg">{report.error instanceof ApiError ? report.error.message : 'Could not send it.'}</p>
          )}
        </form>
      )}
    </span>
  )
}

export function BlockButton({ userId, name }: { userId: string; name: string }) {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const blocked = useQuery({ queryKey: ['blocks'], queryFn: () => safetyApi.blocked() })
  const isBlocked = (blocked.data?.blocked ?? []).some((person) => person.userId === userId)

  const toggle = useMutation({
    mutationFn: () => (isBlocked ? safetyApi.unblock(userId) : safetyApi.block(userId)),
    onSuccess: (result) => {
      setNotice(result.message)
      void queryClient.invalidateQueries({ queryKey: ['blocks'] })
    },
  })

  return (
    <span className="safety-control">
      <button
        className="link-btn"
        type="button"
        aria-label={`${isBlocked ? 'Unblock' : 'Block'} ${name}`}
        disabled={toggle.isPending || blocked.isLoading}
        onClick={() => toggle.mutate()}
      >
        {isBlocked ? 'Unblock' : 'Block'}
      </button>
      {notice && <span className="muted-line"> {notice}</span>}
    </span>
  )
}
