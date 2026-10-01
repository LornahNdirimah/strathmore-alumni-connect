/**
 * API wire types come from the backend's contract (DESIGN_BACKLOG #55): one
 * definition both sides compile against. `AuthSession` is the contract's
 * `SessionUser` under the name the app has always used.
 */
export type {
  AdminUser,
  AdminUserPage,
  AuthRole,
  Capability,
  ImportResult,
  ImportRow,
  Insights,
  MatchEvaluation,
  OptInStatus,
  OutcomeBucket,
  ReportContext,
  ReportItem,
  ReportReason,
  SessionUser as AuthSession,
  TrackSupply,
  VerificationStatus,
} from '@contract'
import type { AuthRole, Capability, OptInStatus, SessionUser as AuthSession, VerificationStatus } from '@contract'

/**
 * API contract types.
 *
 * These mirror the backend's serializers. The most significant change from the
 * mock shapes: every id is a `string`. The mock keyed mentors by number and
 * users by string, which is why the old alumni dashboard had to find its own
 * mentor row by matching display names.
 */

export type UserRole = 'student' | 'mentor' | 'alumni' | 'admin'

export type DashboardTab =
  | 'overview'
  | 'profile'
  | 'my-mentors'
  | 'find-mentors'
  | 'my-sessions'
  | 'my-mentees'
  | 'availability'
  | 'collaboration-groups'
  | 'opportunities'
  | 'verification-queue'
  | 'users'
  | 'events'
  | 'announcements'
  | 'activity'
  | 'reports'
  | 'import'
  | 'insights'

export type AppPage =
  | 'landing'
  | 'mentor-search'
  | 'mentor-detail'
  | 'student-dashboard'
  | 'alumni-dashboard'
  | 'admin-dashboard'
  | 'login'
  | 'signup'
  | 'events'
  | 'messages'
  | 'communities'
  | 'community-detail'
  | 'onboarding'
  | 'pending'
  | 'opportunities'
  | 'alumni-directory'
  | 'verify-email'
  | 'forgot-password'
  | 'reset-password'
  | 'consent'
  | 'privacy'
  | 'code-of-conduct'

export type Track =
  | 'Data Science'
  | 'Software Engineering'
  | 'Product Design'
  | 'Finance'
  | 'Entrepreneurship'
  | 'Public Policy'
  | 'Marketing'
  | 'Research'

export type Cadence = 'weekly' | 'biweekly' | 'as-needed'
export type FormatPreference = 'virtual' | 'in-person' | 'either'
export type SupportOption = 'resume_review' | 'interview_prep' | 'networking' | 'general_guidance'

export type CareerTimelineEntry = {
  year: string
  title: string
  org: string
  description?: string
}

export type MentorOpportunity = {
  id: string
  title: string
  type: 'Internship' | 'Full-time' | 'Volunteer'
  location: string | null
  postedAt: string
}

export type Mentor = {
  id: string
  userId: string
  name: string
  role: string
  company: string
  industry: string
  location: string
  availability: 'Available' | 'Busy'
  skills: string[]
  tracks: string[]
  capacity: number
  remainingCapacity: number
  avatarUrl: string | null
  /** Present only on recommendations — a score is relative to one student. */
  matchScore?: number
  /** Present only on recommendations: why this mentor was suggested. */
  matchReasons?: string[]
}

/** Every stored mentor-join field, returned only to the mentor, for editing. */
export type EditableMentorProfile = {
  headline: string
  company: string
  industry: string
  location: string
  bio: string
  capacity: number
  availability: 'Available' | 'Busy'
  cadence: Cadence | null
  formatPreference: FormatPreference | null
  skills: string[]
  tracks: string[]
  major: string
  hobbies: string[]
  uniqueQuality: string
  country: string
  stateProvince: string
}

export type MentorDetail = Mentor & {
  bio: string | null
  certifications: string[]
  timeline: CareerTimelineEntry[]
  postedOpportunities: MentorOpportunity[]
}

export type MentorSearchResult = {
  items: Mentor[]
  total: number
  page: number
  limit: number
  industries: string[]
}

export type Seeker = {
  id: string
  userId: string
  major: string
  year: string
  targetTrack: Track
  careerGoalText: string
  preferredCadence: Cadence
  formatPreference: FormatPreference
  requestedSupport: SupportOption[]
  interests: string[]
  skillTags: string[]
  hobbies: string[]
  uniqueQuality: string
  country: string
  stateProvince: string
}

export type MentorshipRequest = {
  id: string
  studentUserId: string
  studentName: string
  studentAvatarUrl: string | null
  mentorProfileId: string
  mentorName: string
  mentorHeadline: string
  interest: string
  preferredSlot: string
  message: string
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
  responseNotes: string | null
  createdAt: string
  respondedAt: string | null
  /** When an unanswered request lapses; null once resolved. */
  expiresAt: string | null
}

export type CheckInProgress = 'on-track' | 'needs-attention'

export type Relationship = {
  id: string
  mentorProfileId: string
  mentorUserId: string
  mentorName: string
  mentorHeadline: string
  mentorCompany: string
  studentUserId: string
  studentName: string
  mentorAvatarUrl: string | null
  studentAvatarUrl: string | null
  status: 'active' | 'completed' | 'paused'
  startedAt: string
  /** End of the fixed term. */
  endsOn: string | null
  endedAt: string | null
  /** 'term-complete', or what the person ending it wrote. */
  endReason: string | null
  checkInOpensAt: string | null
  /** Whether the viewer owes the mid-point check-in now. */
  checkInDue: boolean
  myCheckIn: { progress: CheckInProgress; note: string | null } | null
  /** What the pair agreed to work on. */
  goals: MentorshipGoal[]
}

export type MentorshipGoal = { id: string; title: string; completed: boolean; completedAt: string | null }

export type SessionStatus = 'upcoming' | 'completed' | 'cancelled'

export type MentorshipSession = {
  id: string
  relationshipId: string
  /** Lets the UI fetch this mentor's open slots when rescheduling. */
  mentorProfileId: string | null
  title: string
  /** ISO 8601. The display strings below are derived from it server-side. */
  scheduledAt: string
  endsAt: string
  durationMin: number
  slotLabel: string
  dateLabel: string
  timezoneLabel: string
  status: SessionStatus
  notes: string | null
  cancelledReason: string | null
  mentorName: string
  studentName: string
  bookedByMe: boolean
  /** False once a session has passed or been closed, so the UI hides its actions. */
  canModify: boolean
  /** https meeting URL for a virtual session, if one was set. */
  meetingLink: string | null
  /** API path of the session's .ics file. */
  calendarUrl: string
  /** The viewer's own 1–5 rating, once a held session has been rated. */
  myRating: number | null
}

/** A concrete bookable time, derived from a mentor's recurring availability. */
export type BookableSlot = {
  startsAt: string
  endsAt: string
  label: string
  dateLabel: string
}

export type AvailabilityWindow = {
  id: string
  /** 0 = Sunday, matching Date#getUTCDay(). */
  dayOfWeek: number
  dayName: string
  startTime: string
  endTime: string
}

export type MentorAvailability = {
  mentorProfileId: string
  timezoneLabel: string
  sessionDurationMin: number
  windows: AvailabilityWindow[]
}

export type GroupVisibility = 'alumni-only' | 'open-to-students'

export type CollaborationGroup = {
  id: string
  name: string
  topic: string
  description: string
  visibility: GroupVisibility
  createdBy: string
  creatorName: string
  createdAt: string
  memberCount: number
  isMember: boolean
  /** True only for the creator — DESIGN_BACKLOG #1. */
  canEditVisibility: boolean
}

export type GroupResource = { title: string; url: string | null }

export type EventType = 'In-Person' | 'Online' | 'Hybrid'

export type PlatformEvent = {
  id: string
  title: string
  description: string
  startsAt: string
  date: string
  time: string
  location: string
  type: EventType
  tag: string
  imageUrl: string | null
  endsAt: string | null
  timezoneLabel: TimezoneLabel
  /** Wall-clock 'YYYY-MM-DDTHH:mm' in the event's timezone, for editing. */
  startsAtLocal: string
  endsAtLocal: string | null
  cancelled: boolean
  registered: boolean
  attendeeCount: number
}

export type EventAttendee = {
  userId: string
  name: string
  email: string
  role: AuthRole
  registeredAt: string
}

/** Must match TIMEZONE_OFFSETS in backend/src/lib/time.ts. */
export const TIMEZONE_LABELS = ['EAT', 'CAT', 'SAST', 'WAT', 'GMT', 'UTC'] as const
export type TimezoneLabel = (typeof TIMEZONE_LABELS)[number]

export type OpportunityType = 'Internship' | 'Full-time' | 'Volunteer'

export type Opportunity = {
  id: string
  title: string
  type: OpportunityType
  location: string | null
  description: string | null
  postedAt: string
  closesAt: string | null
  postedBy: { userId: string; name: string; mentorProfileId: string | null }
  applied: boolean
  applicantCount: number
}

export type OpportunityApplicant = {
  userId: string
  name: string
  email: string
  message: string | null
  appliedAt: string
}

export type Announcement = {
  id: string
  title: string
  body: string
  audience: 'all' | 'students' | 'alumni'
  createdAt: string
}

export type AuditEntry = {
  id: string
  adminName: string | null
  action: string
  targetType: string
  targetId: string
  summary: string
  createdAt: string
}

export type ConversationSummary = {
  id: string
  participantId: string
  participantName: string
  participantRole: string
  participantAvatarUrl: string | null
  preview: string
  lastMessageTime: string
  unreadCount: number
}

export type ChatMessage = {
  id: string
  conversationId: string
  from: 'me' | 'them'
  text: string
  time: string
  createdAt: string
}

export type DashboardStat = { label: string; value: string }

export type LandingContent = {
  eyebrow: string
  headline: string
  description: string
  primaryCta: string
  secondaryCta: string
  whyMentorship: { title: string; body: string; points: readonly string[] }
  collaboration: { title: string; body: string; points: readonly string[] }
  careerTracks: readonly string[]
  testimonials: ReadonlyArray<{ name: string; role: string; quote: string }>
  stats: DashboardStat[]
}

export type VerificationItem = {
  id: string
  user_id: string
  name: string
  email: string
  class_year: string
  program: string
  status: 'pending' | 'approved' | 'review' | 'rejected'
  created_at: string
  reviewed_at: string | null
}

export type AdminStats = Record<string, number>

export type NotificationItem = {
  id: string
  type: string
  title: string
  body: string | null
  /** In-app path the notification opens. */
  link: string | null
  createdAt: string
  read: boolean
}

export type OfficeHour = {
  id: string
  mentorProfileId: string
  mentorName: string
  mentorAvatarUrl: string | null
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  dateLabel: string
  timeLabel: string
  durationMin: number
  capacity: number
  attendeeCount: number
  spotsLeft: number
  joined: boolean
  isHost: boolean
  cancelled: boolean
  /** Only for the host and students who have joined. */
  meetingLink: string | null
}

export type HostedOfficeHour = OfficeHour & {
  attendees: Array<{ userId: string; name: string; avatarUrl: string | null }>
}

export type AlumniEntry = {
  userId: string
  name: string
  avatarUrl: string | null
  classYear: string | null
  program: string | null
  headline: string | null
  company: string | null
  industry: string | null
  location: string | null
  mentorProfileId: string | null
}
