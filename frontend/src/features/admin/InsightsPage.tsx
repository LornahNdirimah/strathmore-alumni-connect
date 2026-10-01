import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { StatCard } from '../../components/ui/StatCard'
import { adminApi } from '../../lib/api'
import type { MatchEvaluation, OutcomeBucket } from '../../types'

const PERIODS = [30, 90, 365] as const

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function hours(value: number | null): string {
  if (value === null) return '—'
  return value < 48 ? `${Math.round(value)} h` : `${Math.round(value / 24)} days`
}

/**
 * What the platform's records say about mentoring (DESIGN_BACKLOG #47, #48,
 * #50, #52): where mentors are short, how suggestions turn into mentorships,
 * whether better-scored suggestions really are taken up more, and who leaves
 * requests unanswered.
 */
export function InsightsPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90)
  const insights = useQuery({
    queryKey: ['admin-insights', days],
    queryFn: () => adminApi.insights(days),
    placeholderData: keepPreviousData,
  })
  const evaluation = useQuery({ queryKey: ['admin-evaluation'], queryFn: () => adminApi.evaluation() })
  const data = insights.data

  return (
    <>
      <div className="panel">
        <h2>Supply and demand</h2>
        <p className="muted-line">
          Students waiting for a mentor in each track, against the free seats of mentors offering it. A mentor in two
          tracks counts in both. Recruit where the shortfall is.
        </p>
        <QueryState isLoading={insights.isLoading} error={insights.error}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Track</th>
                <th>Waiting</th>
                <th>Mentors</th>
                <th>Free seats</th>
                <th>Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {(data?.supply ?? []).map((row) => (
                <tr key={row.track}>
                  <td>{row.track}</td>
                  <td>
                    {row.waiting} <span className="muted-line">of {row.seeking}</span>
                  </td>
                  <td>{row.mentors}</td>
                  <td>{row.freeSeats}</td>
                  <td>{row.shortfall > 0 ? <strong className="shortfall">{row.shortfall}</strong> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </QueryState>
      </div>

      <div className="panel">
        <div className="panel-heading-row">
          <h2>From suggestion to mentorship</h2>
          <div className="filter-tabs" role="tablist" aria-label="Period">
            {PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={days === value}
                className={days === value ? 'filter-tab active' : 'filter-tab'}
                onClick={() => setDays(value)}
              >
                {value === 365 ? 'Year' : `${value} days`}
              </button>
            ))}
          </div>
        </div>
        {data && (
          <>
            <p className="muted-line">
              Every student–mentor pair first suggested in the last {data.pipeline.days} days, followed forward. Each
              step counts only if it came after the suggestion.
            </p>
            <ol className="funnel" aria-label="Matching pipeline">
              {data.pipeline.stages.map((stage) => {
                const top = data.pipeline.stages[0]!.count
                return (
                  <li key={stage.key}>
                    <span className="funnel-label">{stage.label}</span>
                    <span className="funnel-bar" aria-hidden="true">
                      <span style={{ width: `${top ? Math.max(2, (stage.count / top) * 100) : 0}%` }} />
                    </span>
                    <span className="funnel-count">
                      {stage.count}
                      {stage.rateFromPrevious !== null && (
                        <span className="muted-line"> ({percent(stage.rateFromPrevious)})</span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>

            <div className="stats-grid">
              <StatCard label="Requests sent" value={String(data.pipeline.requests.total)} />
              <StatCard
                label="Accepted, after a suggestion"
                value={percent(data.pipeline.requests.acceptRateAfterSuggestion)}
              />
              <StatCard label="Accepted, found otherwise" value={percent(data.pipeline.requests.acceptRateOtherwise)} />
              <StatCard label="Typical time to answer" value={hours(data.pipeline.requests.medianResponseHours)} />
            </div>
            <p className="muted-line">
              {data.pipeline.requests.expired} expired unanswered, {data.pipeline.requests.declined} declined,{' '}
              {data.pipeline.requests.withdrawn} withdrawn, {data.pipeline.requests.pending} still waiting.
            </p>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Is the matcher right?</h2>
        <p className="muted-line">
          If the scores mean something, better-scored and higher-placed suggestions should be asked for and accepted
          more often.
        </p>
        {data && (
          <div className="content-grid">
            <OutcomeTable caption="By match score" rows={data.pipeline.byScore} />
            <OutcomeTable caption="By position in the list" rows={data.pipeline.byRank} />
          </div>
        )}
        <EvaluationSummary
          loading={evaluation.isLoading}
          result={evaluation.data?.evaluation ?? null}
          matching={evaluation.data?.matching}
        />
      </div>

      <div className="panel">
        <h2>Requests left unanswered</h2>
        <p className="muted-line">
          Mentors whose requests lapsed in the last {data?.responsiveness.windowDays ?? 180} days. Suggestions already
          rank them lower; a reminder or a lower capacity may help more.
        </p>
        <QueryState
          isLoading={insights.isLoading}
          error={insights.error}
          isEmpty={(data?.responsiveness.mentors.length ?? 0) === 0}
          emptyMessage="Every request was answered."
        >
          <div className="directory-list">
            {(data?.responsiveness.mentors ?? []).map((mentor) => (
              <div className="directory-item" key={mentor.mentorProfileId}>
                <strong>{mentor.name}</strong>
                <span className="muted-line">
                  {mentor.expired} lapsed, {mentor.answered} answered
                  {mentor.medianResponseHours !== null && ` · usually answers in ${hours(mentor.medianResponseHours)}`}
                </span>
              </div>
            ))}
          </div>
        </QueryState>
      </div>
    </>
  )
}

function OutcomeTable({ caption, rows }: { caption: string; rows: OutcomeBucket[] }) {
  return (
    <table className="data-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th />
          <th>Shown</th>
          <th>Asked for</th>
          <th>Accepted</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.suggested}</td>
            <td>{row.suggested ? `${row.requested} (${percent(row.requestRate)})` : '—'}</td>
            <td>{row.requested ? `${row.accepted} (${percent(row.acceptRate)})` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EvaluationSummary({
  loading,
  result,
  matching,
}: {
  loading: boolean
  result: MatchEvaluation | null
  matching: 'ready' | 'unavailable' | 'failed' | undefined
}) {
  if (loading) return <p className="muted-line">Scoring real mentorships…</p>
  if (!result) {
    return (
      <p className="muted-line">
        {matching === 'failed'
          ? 'The matching engine could not score the mentorships just now.'
          : 'The matching engine is not running, so real mentorships cannot be scored against it.'}
      </p>
    )
  }
  if (result.pairs === 0) return <p className="muted-line">No mentorships have formed yet to score.</p>

  return (
    <div className="stats-grid">
      <StatCard label="Of the best possible fit" value={percent(result.ceilingRatio)} />
      <StatCard label="Mean fit, accepted" value={result.meanAccepted?.toFixed(2) ?? '—'} />
      <StatCard label="Mean fit, declined" value={result.meanDeclined?.toFixed(2) ?? '—'} />
      <StatCard label="Mentorships scored" value={String(result.pairs)} />
    </div>
  )
}
