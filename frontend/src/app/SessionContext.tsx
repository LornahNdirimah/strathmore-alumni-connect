/**
 * The signed-in session, available to any page without prop-drilling.
 *
 * Pages deep in the tree — a mentor's profile, a community card — decide which
 * buttons to show from the session's capabilities. Passing the session down
 * through every route element to reach them would couple each intermediate
 * component to a value it never uses.
 */
import { createContext, useContext } from 'react'

import type { AuthSession, Capability } from '../types'

export const SessionContext = createContext<AuthSession | null>(null)

/**
 * Replaces the session after an account change (a new name or photo) with the
 * user the API returned, so the sidebar and every avatar update at once.
 */
export const SessionUpdateContext = createContext<(session: AuthSession | null) => void>(() => {})

export function useUpdateSession(): (session: AuthSession | null) => void {
  return useContext(SessionUpdateContext)
}

export function useCurrentSession(): AuthSession | null {
  return useContext(SessionContext)
}

/** Whether `session` grants `capability`. Reads defensively: no session, no access. */
export function can(session: AuthSession | null, capability: Capability): boolean {
  return session?.capabilities?.includes(capability) ?? false
}

/** Shorthand for `can(useCurrentSession(), capability)` inside a component. */
export function useCan(capability: Capability): boolean {
  return can(useCurrentSession(), capability)
}
