/**
 * HTTP client for the backend API.
 *
 * `credentials: 'include'` on every call is what carries the httpOnly auth
 * cookie. The token is deliberately unreadable from JavaScript — the previous
 * localStorage session could be read by any injected script and edited by the
 * user to grant themselves admin — so there is no Authorization header to set
 * here and nothing for the app to store.
 */

// A production build is served by the API itself (DESIGN_BACKLOG #53), so it
// calls its own origin. In development Vite and the API run on separate ports.
const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api')

/**
 * Turns an API-relative path such as '/api/users/u-1/avatar?v=…' into a URL
 * the browser can load. The API may live on another origin (another port in
 * development), so the path is resolved against the API's origin, not the
 * page's.
 */
export function apiAssetUrl(path: string): string {
  return new URL(path, new URL(API_BASE, window.location.origin)).toString()
}

export type FieldIssue = { field: string; message: string }

/** An error the server chose to describe, safe to show the user. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: FieldIssue[]

  constructor(status: number, code: string, message: string, details: FieldIssue[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Per-field messages, for rendering inline on a form. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((issue) => [issue.field, issue.message]))
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  return url.toString()
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response

  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch {
    // fetch only rejects on network-level failures, which for a local demo
    // almost always means the API isn't running.
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Is the API running?')
  }

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: FieldIssue[] } })
      ?.error
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Something went wrong.',
      error?.details ?? [],
    )
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => apiRequest<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
}
