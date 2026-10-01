/**
 * Domain vocabulary shared across modules.
 *
 * These mirror the unions the frontend already declares in
 * `frontend/src/types/index.ts`, so the API can't drift from what the UI
 * renders. The shared contract is generated from here into `shared/types/`.
 */

export type { AuthRole, UserStatus } from '../contract/index.js'
import type { AuthRole, UserStatus } from '../contract/index.js'

export type Availability = 'Available' | 'Busy'
export type Cadence = 'weekly' | 'biweekly' | 'as-needed'
export type FormatPreference = 'virtual' | 'in-person' | 'either'

export type EventType = 'In-Person' | 'Online' | 'Hybrid'
export type OpportunityType = 'Internship' | 'Full-time' | 'Volunteer'

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
export type RelationshipStatus = 'active' | 'completed' | 'paused'
export type SessionStatus = 'upcoming' | 'completed' | 'cancelled'

export type MatchEventType = 'suggested' | 'requested' | 'accepted' | 'declined'

export type GroupVisibility = 'alumni-only' | 'open-to-students'

export type VerificationStatus = 'pending' | 'approved' | 'review' | 'rejected'

export type FeedbackRelationshipStatus = 'ongoing' | 'ended' | 'never_started'
export type GoalProgress = 'none' | 'some' | 'significant'

/**
 * The eight career tracks. Must stay in lockstep with
 * `matching_engine/constants.py::TRACKS` — the ML worker filters on these
 * exact strings, so a typo here silently produces zero recommendations.
 */
export const TRACKS = [
  'Data Science',
  'Software Engineering',
  'Product Design',
  'Finance',
  'Entrepreneurship',
  'Public Policy',
  'Marketing',
  'Research',
] as const

export type Track = (typeof TRACKS)[number]

export const SUPPORT_OPTIONS = [
  'resume_review',
  'interview_prep',
  'networking',
  'general_guidance',
] as const

export type SupportOption = (typeof SUPPORT_OPTIONS)[number]

/** The authenticated identity the API returns to the client. Never includes credentials. */
export type PublicUser = {
  id: string
  name: string
  email: string
  role: AuthRole
  status: UserStatus
}
