/**
 * The API's wire types, shared with the frontend (DESIGN_BACKLOG #55).
 *
 * The backend annotates its responses with these, so the compiler refuses a
 * route that sends something else; the frontend imports the same file (as
 * `@contract`, type-only) instead of keeping its own copy. A field renamed
 * here breaks whichever side still uses the old name — at compile time, not
 * as a blank screen, which is how the login-shape drift in the build notes
 * was found.
 *
 * Rules for this file: types and `as const` lists only, and no imports. The
 * frontend compiles it with browser settings, so anything that pulls in
 * Node, Fastify or Zod would break its build.
 *
 * Other response types still live on each side; they move here the same way
 * when next touched (see DESIGN_BACKLOG #55).
 */

// ── Accounts and access ───────────────────────────────────────────────────────

export type AuthRole = 'student' | 'alumni' | 'admin'
export type UserStatus = 'active' | 'pending' | 'suspended'
export type VerificationStatus = 'pending' | 'approved' | 'review' | 'rejected'

/** What an account may do. The server decides; the client builds navigation from it. */
export const CAPABILITIES = [
  /** Browse the mentor directory and mentor profiles. */
  'mentors.browse',
  /** Ask a mentor for mentorship; receive recommendations. */
  'mentorship.request',
  /** Act as a mentor: answer requests, publish availability. */
  'mentorship.mentor',
  /** Create a mentor profile — an alumnus who does not mentor yet. */
  'mentorship.become-mentor',
  /** Take part in a mentorship: relationships, sessions, feedback. */
  'mentorship.participate',
  /** See the opportunities board. */
  'opportunities.view',
  /** Apply to an opportunity an alumnus posted. */
  'opportunities.apply',
  /** Post an opportunity and see who applied. Any verified alumnus (ROADMAP D5). */
  'opportunities.post',
  /** See communities (which ones is decided by visibility rules). */
  'communities.view',
  /** Join and leave communities. */
  'communities.join',
  /** Create a community. */
  'communities.create',
  /** Remove a community. Moderation, not membership. */
  'communities.moderate',
  /** Send and read direct messages. */
  'messaging.use',
  /** See the events calendar. */
  'events.view',
  /** Register for events. */
  'events.register',
  /** Create, edit and cancel events; see who registered. */
  'events.manage',
  /** Search the alumni directory — the alumni network's own peer space. */
  'alumni.directory',
  /** Verify alumni, manage users, publish announcements. */
  'admin.manage',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export type OptInStatus = {
  isSeeker: boolean
  isMentor: boolean
  mentorProfileId: string | null
  seekerId: string | null
}

export type VerificationSummary = {
  status: VerificationStatus
  classYear: string
  program: string
}

/** The session as every auth endpoint returns it (`{ user: SessionUser }`). */
export type SessionUser = {
  id: string
  name: string
  email: string
  role: AuthRole
  status: UserStatus
  /** Relative API path to the profile photo; null means show initials. */
  avatarUrl: string | null
  /** Whether the address was confirmed through the emailed link. */
  emailVerified: boolean
  /** Whether the current privacy notice and code of conduct are accepted. */
  termsAccepted: boolean
  optIn: OptInStatus
  capabilities: Capability[]
  /** An alumnus's latest verification entry; null for other roles. */
  verification: VerificationSummary | null
}

// ── Administration ────────────────────────────────────────────────────────────

export type AdminUser = {
  id: string
  name: string
  email: string
  role: AuthRole
  status: UserStatus
  created_at: string
  avatarUrl: string | null
}

/** `GET /api/admin/users` */
export type AdminUserPage = { users: AdminUser[]; total: number; page: number; limit: number }

export const REPORT_REASONS = ['harassment', 'spam', 'inappropriate', 'safety', 'impersonation', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export const REPORT_CONTEXTS = ['message', 'profile', 'community', 'opportunity', 'other'] as const
export type ReportContext = (typeof REPORT_CONTEXTS)[number]

/** One entry of `GET /api/admin/reports`. */
export type ReportItem = {
  id: string
  /** Null once the reporter has deleted their account. */
  reporter: { userId: string; name: string | null } | null
  reported: { userId: string; name: string; role: AuthRole; status: UserStatus; totalReports: number }
  contextType: ReportContext
  contextId: string | null
  /** The reported message, when the report is about one the reported person sent. */
  excerpt: string | null
  reason: ReportReason
  details: string | null
  status: 'open' | 'actioned' | 'dismissed'
  resolutionNote: string | null
  reviewerName: string | null
  reviewedAt: string | null
  createdAt: string
}

export type ImportRow = {
  line: number
  name: string
  email: string
  status: 'ready' | 'created' | 'duplicate' | 'invalid'
  problems: string[]
}

/** `POST /api/admin/alumni/import` */
export type ImportResult = {
  rows: ImportRow[]
  summary: Record<ImportRow['status'], number>
  dryRun: boolean
}

// ── Insights (DESIGN_BACKLOG #47, #48, #50, #52) ─────────────────────────────

export type TrackSupply = {
  track: string
  /** Students whose target is this track. */
  seeking: number
  /** Of those, how many have no active mentorship. */
  waiting: number
  /** Mentors offering the track. */
  mentors: number
  /** Their free seats. A mentor in two tracks counts in both. */
  freeSeats: number
  /** Waiting students beyond the free seats — where to recruit. */
  shortfall: number
}

export type PipelineStage = { key: string; label: string; count: number; rateFromPrevious: number | null }

export type OutcomeBucket = {
  label: string
  suggested: number
  requested: number
  accepted: number
  requestRate: number | null
  acceptRate: number | null
}

export type Pipeline = {
  days: number
  stages: PipelineStage[]
  requests: {
    total: number
    afterSuggestion: number
    accepted: number
    declined: number
    expired: number
    withdrawn: number
    pending: number
    acceptRateAfterSuggestion: number | null
    acceptRateOtherwise: number | null
    medianResponseHours: number | null
  }
  byScore: OutcomeBucket[]
  byRank: OutcomeBucket[]
}

export type Responsiveness = {
  mentorProfileId: string
  name: string
  answered: number
  expired: number
  medianResponseHours: number | null
  factor: number
}

/** `GET /api/admin/insights` */
export type Insights = {
  supply: TrackSupply[]
  pipeline: Pipeline
  responsiveness: { windowDays: number; mentors: Responsiveness[] }
}

/** The matching worker's score of real outcomes. */
export type MatchEvaluation = {
  pairs: number
  observedTotal: number
  ceilingTotal: number | null
  ceilingRatio: number | null
  ceilingNote: string | null
  meanAccepted: number | null
  meanDeclined: number | null
  declined: number
}

/** `GET /api/admin/insights/evaluation` */
export type EvaluationResponse = { evaluation: MatchEvaluation | null; matching: 'ready' | 'unavailable' | 'failed' }
