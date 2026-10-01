import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { useCan } from '../../app/SessionContext'
import { QueryState } from '../../components/ui/QueryState'
import { opportunitiesApi } from '../../lib/api'
import { formatShortDate } from '../../lib/format'
import { ApiError } from '../../lib/http'

/**
 * Open opportunities from across the alumni network, newest first. Any verified
 * alumnus can post one (ROADMAP D5), so this — not a mentor's profile — is
 * where students find them.
 */
export function OpportunitiesFeed({ limit = 5 }: { limit?: number }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const canApply = useCan('opportunities.apply')
  const [notice, setNotice] = useState<string | null>(null)

  const feed = useQuery({ queryKey: ['opportunities', 'feed'], queryFn: () => opportunitiesApi.feed() })
  const items = (feed.data?.opportunities ?? []).slice(0, limit)

  const apply = useMutation({
    mutationFn: (opportunityId: string) => opportunitiesApi.apply(opportunityId),
    onSuccess: (result) => {
      setNotice(result.message)
      void queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    },
    onError: (error) => setNotice(error instanceof ApiError ? error.message : 'Could not apply.'),
  })

  return (
    <div className="panel">
      <h2>Latest opportunities</h2>
      {notice && <p className="success-msg">{notice}</p>}
      <QueryState
        isLoading={feed.isLoading}
        error={feed.error}
        isEmpty={items.length === 0}
        emptyMessage="No open opportunities right now."
      >
        <div className="directory-list">
          {items.map((item) => (
            <div className="directory-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>
                  {item.type}
                  {item.location ? ` · ${item.location}` : ''} · posted by{' '}
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
                {item.description && <p className="muted-line">{item.description}</p>}
                <p className="muted-line">Posted {formatShortDate(item.postedAt)}</p>
              </div>
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
            </div>
          ))}
        </div>
      </QueryState>
      <button className="link-btn" type="button" style={{ marginTop: '0.75rem' }} onClick={() => navigate('/opportunities')}>
        See all opportunities →
      </button>
    </div>
  )
}
