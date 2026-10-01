import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Avatar } from '../../components/ui/Avatar'
import { QueryState } from '../../components/ui/QueryState'
import { alumniApi, messagingApi } from '../../lib/api'
import { ApiError } from '../../lib/http'

/**
 * The alumni directory (DESIGN_BACKLOG #41): verified alumni finding each
 * other by name, class year, programme, company or industry. Alumni may
 * message one another freely, so each card is one click from a conversation.
 */
export function AlumniDirectoryPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  const q = params.get('q') ?? ''
  const classYear = params.get('classYear') ?? ''
  const industry = params.get('industry') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)

  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        if (key !== 'page') next.delete('page')
        return next
      },
      { replace: key === 'q' },
    )

  const directory = useQuery({
    queryKey: ['alumni-directory', { q, classYear, industry, page }],
    queryFn: () =>
      alumniApi.directory({
        q: q || undefined,
        classYear: classYear || undefined,
        industry: industry || undefined,
        page,
      }),
  })

  const message = useMutation({
    mutationFn: (userId: string) => messagingApi.open(userId),
    onSuccess: async ({ conversationId }) => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      navigate(`/messages?c=${encodeURIComponent(conversationId)}`)
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'Could not open a conversation.'),
  })

  const data = directory.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <section className="content-panel">
      <div className="panel">
        <h2>Alumni directory</h2>
        <p className="muted-line">Verified Strathmore alumni. Reach out to anyone — for advice, a referral, or a coffee.</p>
        <div className="search-bar">
          <input
            className="input-field"
            aria-label="Search alumni"
            placeholder="Search by name, programme, company or role…"
            value={q}
            onChange={(event) => setParam('q', event.target.value)}
          />
          <select
            className="select-field"
            aria-label="Class year"
            value={classYear}
            onChange={(event) => setParam('classYear', event.target.value)}
          >
            <option value="">Any year</option>
            {(data?.classYears ?? []).map((year) => (
              <option key={year} value={year}>
                Class of {year}
              </option>
            ))}
          </select>
          <select
            className="select-field"
            aria-label="Industry"
            value={industry}
            onChange={(event) => setParam('industry', event.target.value)}
          >
            <option value="">Any industry</option>
            {(data?.industries ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        {data && <p className="muted-line">{data.total} alumni</p>}
        {error && <p className="error-msg">{error}</p>}
      </div>

      <QueryState
        isLoading={directory.isLoading}
        error={directory.error}
        isEmpty={data?.alumni.length === 0}
        emptyMessage="No alumni match those filters."
      >
        <div className="directory-grid">
          {(data?.alumni ?? []).map((person) => (
            <article className="panel" key={person.userId}>
              <div className="person-heading">
                <Avatar name={person.name} url={person.avatarUrl} />
                <div>
                  <strong>{person.name}</strong>
                  <p className="muted-line">
                    {[person.classYear && `Class of ${person.classYear}`, person.program].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              {person.headline && (
                <p>
                  {person.headline}
                  {person.company ? ` · ${person.company}` : ''}
                </p>
              )}
              {person.location && <p className="muted-line">{person.location}</p>}
              <div className="row-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  aria-label={`Message ${person.name}`}
                  disabled={message.isPending}
                  onClick={() => message.mutate(person.userId)}
                >
                  Message
                </button>
                {person.mentorProfileId && (
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => navigate(`/mentors/${person.mentorProfileId}`)}
                  >
                    Mentor profile
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="secondary-btn"
              type="button"
              disabled={page === 1}
              onClick={() => setParam('page', String(page - 1))}
            >
              Previous
            </button>
            <span className="muted-line">
              Page {page} of {totalPages}
            </span>
            <button
              className="secondary-btn"
              type="button"
              disabled={page >= totalPages}
              onClick={() => setParam('page', String(page + 1))}
            >
              Next
            </button>
          </div>
        )}
      </QueryState>
    </section>
  )
}
