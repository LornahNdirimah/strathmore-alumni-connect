import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import { useCan } from '../../app/SessionContext'
import { QueryState } from '../../components/ui/QueryState'
import { Avatar } from '../../components/ui/Avatar'
import { TRACKS } from '../../config/navigation'
import { mentorsApi } from '../../lib/api'
import type { Mentor } from '../../types'
import { MatchReasons } from './MatchReasons'

type MentorSearchPageProps = {
  onOpenProfile: (mentorId: string) => void
}

type View = 'all' | 'suggested'

/**
 * The mentor directory, and — for students — a "Suggested for me" view of just
 * the mentors the matcher recommends (DESIGN_BACKLOG #28).
 *
 * Every filter lives in the URL rather than component state, so Back returns to
 * the same results, a search can be linked to, and the dashboard can send a
 * student straight to their suggestions with `?view=suggested`.
 */
export function MentorSearchPage({ onOpenProfile }: MentorSearchPageProps) {
  const canBeMatched = useCan('mentorship.request')
  const [params, setParams] = useSearchParams()

  const view: View = canBeMatched && params.get('view') === 'suggested' ? 'suggested' : 'all'
  const query = params.get('q') ?? ''
  const industry = params.get('industry') ?? 'All'
  const track = params.get('track') ?? ''
  const onlyAvailable = params.get('available') === 'true'
  const page = Math.max(1, Number(params.get('page')) || 1)

  /** Writes one filter to the URL; any filter change except paging resets the page. */
  const setParam = (key: string, value: string | null, options: { keepPage?: boolean } = {}) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
        if (!options.keepPage) next.delete('page')
        return next
      },
      // Typing in the search box should not leave one history entry per key.
      { replace: key === 'q' },
    )
  }

  /**
   * Filtering happens server-side. The mock shipped the entire mentor table to
   * the browser and filtered it there, which stops working the moment the
   * directory is bigger than a demo fixture — it is now 300+ rows.
   */
  const directory = useQuery({
    queryKey: ['mentors', { query, industry, track, onlyAvailable, page }],
    queryFn: () =>
      mentorsApi.search({
        q: query || undefined,
        industry: industry === 'All' ? undefined : industry,
        track: track || undefined,
        available: onlyAvailable,
        page,
        limit: 24,
      }),
    enabled: view === 'all',
  })

  const suggestions = useQuery({
    queryKey: ['recommendations', 'page', track],
    queryFn: () => mentorsApi.recommendations(12, track || undefined),
    enabled: view === 'suggested',
  })

  const data = directory.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <section className="content-panel">
      <div className="panel">
        <h2>{view === 'suggested' ? 'Suggested for you' : 'Find your mentor'}</h2>

        {canBeMatched && (
          <div className="filter-tabs" role="tablist" aria-label="Which mentors to show">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'suggested'}
              className={view === 'suggested' ? 'filter-tab active' : 'filter-tab'}
              onClick={() => setParam('view', 'suggested')}
            >
              Suggested for me
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'all'}
              className={view === 'all' ? 'filter-tab active' : 'filter-tab'}
              onClick={() => setParam('view', null)}
            >
              All mentors
            </button>
          </div>
        )}

        <div className="search-bar">
          {view === 'all' && (
            <input
              className="input-field"
              placeholder="Search by name, company, or skill..."
              aria-label="Search mentors"
              value={query}
              onChange={(event) => setParam('q', event.target.value)}
            />
          )}
          <select
            className="select-field"
            aria-label="Track"
            value={track}
            onChange={(event) => setParam('track', event.target.value)}
          >
            <option value="">{view === 'suggested' ? 'My target track' : 'All tracks'}</option>
            {TRACKS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          {view === 'all' && (
            <>
              <select
                className="select-field"
                aria-label="Industry"
                value={industry}
                onChange={(event) => setParam('industry', event.target.value === 'All' ? null : event.target.value)}
              >
                <option value="All">All industries</option>
                {(data?.industries ?? []).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={onlyAvailable ? 'filter-tab active' : 'filter-tab'}
                aria-pressed={onlyAvailable}
                onClick={() => setParam('available', onlyAvailable ? null : 'true')}
              >
                Available now
              </button>
            </>
          )}
        </div>

        {view === 'all' && data && (
          <p className="muted-line" style={{ marginTop: '0.75rem' }}>
            {data.total} mentor{data.total === 1 ? '' : 's'} match
            {directory.isFetching ? ' · updating…' : ''}
          </p>
        )}
        {view === 'suggested' && (
          <p className="muted-line" style={{ marginTop: '0.75rem' }}>
            Ranked by how well each mentor matches your goals. Mentors you are already working with or
            waiting on are left out.
            {suggestions.data?.source === 'fallback' && ' The matching service is warming up, so this is a simpler ranking for now.'}
          </p>
        )}
      </div>

      {view === 'suggested' ? (
        <QueryState
          isLoading={suggestions.isLoading}
          error={suggestions.error}
          isEmpty={suggestions.data?.items.length === 0}
          emptyMessage="No suggestions with open places right now. Try another track, or browse all mentors."
        >
          <MentorGrid mentors={suggestions.data?.items ?? []} onOpenProfile={onOpenProfile} />
        </QueryState>
      ) : (
        <QueryState
          isLoading={directory.isLoading}
          error={directory.error}
          isEmpty={data?.items.length === 0}
          emptyMessage="No mentors match your search. Try different filters."
        >
          <MentorGrid mentors={data?.items ?? []} onOpenProfile={onOpenProfile} />

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="secondary-btn"
                type="button"
                disabled={page === 1}
                onClick={() => setParam('page', String(page - 1), { keepPage: true })}
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
                onClick={() => setParam('page', String(page + 1), { keepPage: true })}
              >
                Next
              </button>
            </div>
          )}
        </QueryState>
      )}
    </section>
  )
}

function MentorGrid({
  mentors,
  onOpenProfile,
}: {
  mentors: Mentor[]
  onOpenProfile: (mentorId: string) => void
}) {
  return (
    <div className="match-grid">
      {mentors.map((mentor) => (
        <article className="match-card" key={mentor.id}>
          <div className="match-header">
            <div className="person-heading">
              <Avatar name={mentor.name} url={mentor.avatarUrl} />
              <div>
                <h3>{mentor.name}</h3>
                <p>{mentor.role}</p>
              </div>
            </div>
            {mentor.matchScore !== undefined && (
              <span className="score-badge">{Math.round(mentor.matchScore * 100)}%</span>
            )}
          </div>

          <p className="muted-line">{mentor.company}</p>
          <p className="muted-line">{mentor.location}</p>
          <MatchReasons reasons={mentor.matchReasons} />

          <div className="chip-row">
            {mentor.skills.slice(0, 4).map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '0.75rem',
            }}
          >
            <span className={mentor.remainingCapacity > 0 ? 'status available' : 'status busy'}>
              {mentor.remainingCapacity > 0
                ? `${mentor.remainingCapacity} place${mentor.remainingCapacity === 1 ? '' : 's'} left`
                : 'Full'}
            </span>
            <button
              className="secondary-btn"
              type="button"
              aria-label={`View ${mentor.name}'s profile`}
              onClick={() => onOpenProfile(mentor.id)}
            >
              View profile
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}
