import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useCan } from '../../app/SessionContext'
import { QueryState } from '../../components/ui/QueryState'
import { opportunitiesApi } from '../../lib/api'
import { formatDate, formatShortDate } from '../../lib/format'
import { ApiError } from '../../lib/http'

const TYPES = ['Internship', 'Full-time', 'Volunteer'] as const

/**
 * The opportunities board (DESIGN_BACKLOG #38): every open opportunity posted
 * by alumni, with search, a type filter, deadlines and the viewer's
 * application status. Filters live in the URL so Back and links keep them.
 */
export function OpportunitiesBoardPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const canApply = useCan('opportunities.apply')
  const canPost = useCan('opportunities.post')
  const [params, setParams] = useSearchParams()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const q = params.get('q') ?? ''
  const type = params.get('type') ?? ''

  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: key === 'q' },
    )

  const board = useQuery({
    queryKey: ['opportunities', 'board', { q, type }],
    queryFn: () => opportunitiesApi.feed({ q: q || undefined, type: type || undefined }),
  })

  const apply = useMutation({
    mutationFn: (id: string) => opportunitiesApi.apply(id),
    onSuccess: (result) => {
      setNotice({ kind: 'ok', text: result.message })
      void queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    },
    onError: (error) =>
      setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : 'Could not apply.' }),
  })

  const items = board.data?.opportunities ?? []

  return (
    <section className="content-panel">
      <div className="panel">
        <div className="directory-item-row">
          <h2>Opportunities</h2>
          {canPost && (
            <button className="secondary-btn" type="button" onClick={() => navigate('/alumni/opportunities')}>
              Post an opportunity
            </button>
          )}
        </div>
        <p className="muted-line">Internships, jobs and volunteering shared by Strathmore alumni.</p>
        <div className="search-bar">
          <input
            className="input-field"
            aria-label="Search opportunities"
            placeholder="Search by title, place or who posted it…"
            value={q}
            onChange={(event) => setParam('q', event.target.value)}
          />
          <select
            className="select-field"
            aria-label="Type"
            value={type}
            onChange={(event) => setParam('type', event.target.value)}
          >
            <option value="">All types</option>
            {TYPES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        {notice && <p className={notice.kind === 'ok' ? 'success-msg' : 'error-msg'}>{notice.text}</p>}
      </div>

      <QueryState
        isLoading={board.isLoading}
        error={board.error}
        isEmpty={items.length === 0}
        emptyMessage={q || type ? 'Nothing matches those filters.' : 'No open opportunities right now.'}
      >
        <div className="directory-grid">
          {items.map((item) => (
            <article className="panel opportunity-card" key={item.id}>
              <span className="event-tag">{item.type}</span>
              <h3>{item.title}</h3>
              <p className="muted-line">
                {item.location ? `${item.location} · ` : ''}posted {formatShortDate(item.postedAt)} by{' '}
                {item.postedBy.mentorProfileId ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => navigate(`/mentors/${item.postedBy.mentorProfileId}`)}
                  >
                    {item.postedBy.name}
                  </button>
                ) : (
                  item.postedBy.name
                )}
              </p>
              {item.description && <p>{item.description}</p>}
              {item.closesAt && <p className="muted-line">Applications close {formatDate(item.closesAt)}</p>}
              {canApply &&
                (item.applied ? (
                  <span className="status available">Applied</span>
                ) : (
                  <button
                    className="primary-btn"
                    type="button"
                    aria-label={`Apply for ${item.title}`}
                    disabled={apply.isPending}
                    onClick={() => apply.mutate(item.id)}
                  >
                    Apply
                  </button>
                ))}
            </article>
          ))}
        </div>
      </QueryState>
    </section>
  )
}
