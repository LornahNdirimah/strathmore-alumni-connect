import type { ReactNode } from 'react'

import { ApiError } from '../../lib/http'

type QueryStateProps = {
  isLoading: boolean
  error: unknown
  isEmpty?: boolean
  emptyMessage?: string
  children: ReactNode
}

/**
 * One place for the loading / error / empty branches every data-backed panel
 * needs, so pages don't each invent their own and forget one of the three.
 */
export function QueryState({
  isLoading,
  error,
  isEmpty = false,
  emptyMessage = 'Nothing here yet.',
  children,
}: QueryStateProps) {
  if (isLoading) {
    return (
      <div className="query-state">
        <div className="boot-spinner" aria-hidden="true" />
        <p className="muted-line">Loading…</p>
      </div>
    )
  }

  if (error) {
    const message =
      error instanceof ApiError ? error.message : 'Something went wrong loading this.'
    return (
      <div className="query-state">
        <p className="error-msg">{message}</p>
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div className="query-state">
        <p className="muted-line">{emptyMessage}</p>
      </div>
    )
  }

  return <>{children}</>
}
