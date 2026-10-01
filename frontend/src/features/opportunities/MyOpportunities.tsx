import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { opportunitiesApi, type OpportunityPayload } from '../../lib/api'
import { formatDate, formatShortDate } from '../../lib/format'
import { ApiError } from '../../lib/http'
import type { Opportunity } from '../../types'

/**
 * An alumnus's own opportunities: post one, see who applied, close it
 * (DESIGN_BACKLOG #29). Applications were stored before this existed but no
 * screen ever showed them to the person who posted the job.
 */
export function MyOpportunities() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const mine = useQuery({ queryKey: ['opportunities', 'mine'], queryFn: () => opportunitiesApi.mine() })

  const close = useMutation({
    mutationFn: (opportunityId: string) => opportunitiesApi.close(opportunityId),
    onSuccess: (result) => {
      setNotice(result.message)
      void queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    },
    onError: (error) => setNotice(error instanceof ApiError ? error.message : 'Could not close it.'),
  })

  const now = new Date().toISOString()
  const isOpen = (item: Opportunity) => item.closesAt === null || item.closesAt > now

  return (
    <>
      <div className="panel">
        <h2>Your opportunities</h2>
        {notice && <p className="success-msg">{notice}</p>}
        <QueryState
          isLoading={mine.isLoading}
          error={mine.error}
          isEmpty={(mine.data?.opportunities ?? []).length === 0}
          emptyMessage="You haven't posted any opportunities yet."
        >
          <div className="directory-list">
            {(mine.data?.opportunities ?? []).map((item) => (
              <div className="directory-item stacked" key={item.id}>
                <div className="directory-item-row">
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {item.type}
                      {item.location ? ` · ${item.location}` : ''} · posted{' '}
                      {formatShortDate(item.postedAt)}
                    </p>
                  </div>
                  <div className="row-actions">
                    {isOpen(item) ? (
                      <button
                        className="ghost-btn"
                        type="button"
                        aria-label={`Close ${item.title}`}
                        disabled={close.isPending}
                        onClick={() => close.mutate(item.id)}
                      >
                        Close applications
                      </button>
                    ) : (
                      <span className="status busy">Closed {formatShortDate(item.closesAt)}</span>
                    )}
                  </div>
                </div>
                <Applicants opportunity={item} />
              </div>
            ))}
          </div>
        </QueryState>
      </div>

      <PostOpportunityForm
        onPosted={(message) => {
          setNotice(message)
          void queryClient.invalidateQueries({ queryKey: ['opportunities'] })
        }}
      />
    </>
  )
}

function Applicants({ opportunity }: { opportunity: Opportunity }) {
  const [open, setOpen] = useState(false)
  const applicants = useQuery({
    queryKey: ['opportunities', opportunity.id, 'applicants'],
    queryFn: () => opportunitiesApi.applicants(opportunity.id),
    enabled: open,
  })

  if (opportunity.applicantCount === 0) {
    return <p className="muted-line">No applications yet.</p>
  }

  return (
    <details onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>
        {opportunity.applicantCount} {opportunity.applicantCount === 1 ? 'applicant' : 'applicants'}
      </summary>
      <QueryState isLoading={applicants.isLoading} error={applicants.error}>
        <ul className="applicant-list">
          {(applicants.data?.applicants ?? []).map((applicant) => (
            <li key={applicant.userId}>
              <strong>{applicant.name}</strong> ·{' '}
              <a href={`mailto:${applicant.email}`}>{applicant.email}</a>
              <span className="muted-line"> · applied {formatDate(applicant.appliedAt)}</span>
              {applicant.message && <p className="muted-line">“{applicant.message}”</p>}
            </li>
          ))}
        </ul>
      </QueryState>
    </details>
  )
}

const EMPTY_FORM: OpportunityPayload = { title: '', type: 'Internship', location: '', description: '', closesOn: '' }

function PostOpportunityForm({ onPosted }: { onPosted: (message: string) => void }) {
  const [form, setForm] = useState<OpportunityPayload>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const post = useMutation({
    mutationFn: () =>
      opportunitiesApi.post({
        title: form.title,
        type: form.type,
        ...(form.location ? { location: form.location } : {}),
        ...(form.description ? { description: form.description } : {}),
        ...(form.closesOn ? { closesOn: form.closesOn } : {}),
      }),
    onSuccess: (result) => {
      setForm(EMPTY_FORM)
      setError(null)
      onPosted(result.message)
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Could not post the opportunity.'),
  })

  return (
    <form
      className="panel form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        post.mutate()
      }}
    >
      <h2>Post an opportunity</h2>
      <p className="muted-line">Shared with every student on the platform.</p>

      <div className="form-row">
        <label>
          <span>Title</span>
          <input
            className="input-field"
            value={form.title}
            onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))}
            placeholder="ML Engineer Intern"
            required
          />
        </label>
        <label>
          <span>Type</span>
          <select
            className="select-field"
            value={form.type}
            onChange={(event) => setForm((c) => ({ ...c, type: event.target.value as OpportunityPayload['type'] }))}
          >
            <option value="Internship">Internship</option>
            <option value="Full-time">Full-time</option>
            <option value="Volunteer">Volunteer</option>
          </select>
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Location</span>
          <input
            className="input-field"
            value={form.location}
            onChange={(event) => setForm((c) => ({ ...c, location: event.target.value }))}
            placeholder="Nairobi (Hybrid)"
          />
        </label>
        <label>
          {/* DESIGN_BACKLOG #38: a deadline students can see. */}
          <span>Applications close (optional)</span>
          <input
            className="input-field"
            type="date"
            value={form.closesOn}
            onChange={(event) => setForm((c) => ({ ...c, closesOn: event.target.value }))}
          />
        </label>
      </div>

      <label>
        <span>Description</span>
        <textarea
          className="textarea-field"
          value={form.description}
          onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
        />
      </label>

      <button className="primary-btn" type="submit" disabled={post.isPending}>
        {post.isPending ? 'Posting…' : 'Post opportunity'}
      </button>
      {error && <p className="error-msg">{error}</p>}
    </form>
  )
}
