/**
 * Typed API surface, grouped by domain.
 *
 * Replaces the previous mock implementation (setTimeout + in-memory array
 * mutation). Every call now reaches the backend and persists; nothing here
 * keeps client-side state.
 */
import { api } from './http.js'
import type {
  AdminStats,
  ImportResult,
  ReportContext,
  ReportItem,
  ReportReason,
  AlumniEntry,
  HostedOfficeHour,
  MentorshipGoal,
  OfficeHour,
  NotificationItem,
  EditableMentorProfile,
  Announcement,
  AuditEntry,
  CheckInProgress,
  EventAttendee,
  EventType,
  Opportunity,
  OpportunityApplicant,
  OpportunityType,
  TimezoneLabel,
  AdminUser,
  AdminUserPage,
  Insights,
  MatchEvaluation,
  AuthSession,
  BookableSlot,
  ChatMessage,
  CollaborationGroup,
  ConversationSummary,
  DashboardStat,
  GroupResource,
  GroupVisibility,
  LandingContent,
  Mentor,
  MentorAvailability,
  MentorDetail,
  MentorSearchResult,
  MentorshipRequest,
  MentorshipSession,
  PlatformEvent,
  Relationship,
  Seeker,
  VerificationItem,
} from '../types'

// --- Auth ------------------------------------------------------------------

export type LoginPayload = { email: string; password: string }
export type SignupPayload = {
  name: string
  email: string
  password: string
  role: 'student' | 'alumni'
  /** Required for alumni: what an administrator verifies them against. */
  classYear?: string
  program?: string
  /** Agreement to the privacy notice and code of conduct; required. */
  acceptTerms: boolean
}

export const authApi = {
  login: (payload: LoginPayload) =>
    api.post<{ user: AuthSession; message: string }>('/auth/login', payload),
  signup: (payload: SignupPayload) =>
    api.post<{ user: AuthSession; message: string }>('/auth/signup', payload),
  logout: () => api.post<{ message: string }>('/auth/logout'),
  /** Session rehydration on app boot; the cookie is not readable from JS. */
  me: () => api.get<{ user: AuthSession }>('/auth/me'),
  verifyEmail: (token: string) => api.post<{ message: string }>('/auth/verify-email', { token }),
  resendVerification: () => api.post<{ message: string }>('/auth/resend-verification'),
  /** Always answers the same, whether or not the address has an account. */
  forgotPassword: (email: string) => api.post<{ message: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, password }),
}

// --- Mentors ---------------------------------------------------------------

export type MentorSearchParams = {
  q?: string
  industry?: string
  track?: string
  available?: boolean
  page?: number
  limit?: number
}

export const mentorsApi = {
  search: (params: MentorSearchParams = {}) =>
    api.get<MentorSearchResult>('/mentors', {
      ...params,
      // The API expects the literal strings 'true'/'false'; omit when unset so
      // the filter isn't applied at all.
      available: params.available ? 'true' : undefined,
    }),
  detail: (mentorId: string) => api.get<{ mentor: MentorDetail }>(`/mentors/${mentorId}`),
  recommendations: (limit = 5, track?: string) =>
    api.get<{ items: Mentor[]; source: 'ml' | 'fallback' }>('/mentors/recommendations', {
      limit,
      track,
    }),
  /** The mentor's public profile plus every stored form field for editing. */
  myProfile: () =>
    api.get<{ mentor: MentorDetail | null; editable: EditableMentorProfile | null }>('/mentors/me'),
  createProfile: (payload: Record<string, unknown>) =>
    api.post<{ mentor: MentorDetail; message: string }>('/mentors/me', payload),
  updateProfile: (payload: Record<string, unknown>) =>
    api.patch<{ mentor: MentorDetail; message: string }>('/mentors/me', payload),
}

// --- Opportunities ---------------------------------------------------------

export type OpportunityPayload = {
  title: string
  type: OpportunityType
  location?: string
  description?: string
  /** 'YYYY-MM-DD': applications close at the end of that day. */
  closesOn?: string
}

export const opportunitiesApi = {
  /** Open opportunities, newest first; optionally filtered. */
  feed: (filters: { q?: string; type?: string } = {}) =>
    api.get<{ opportunities: Opportunity[] }>('/opportunities', filters),
  /** What the signed-in alumnus has posted, with applicant counts. */
  mine: () => api.get<{ opportunities: Opportunity[] }>('/opportunities/mine'),
  post: (payload: OpportunityPayload) =>
    api.post<{ opportunity: Opportunity; message: string }>('/opportunities', payload),
  close: (opportunityId: string) =>
    api.post<{ opportunity: Opportunity; message: string }>(`/opportunities/${opportunityId}/close`),
  applicants: (opportunityId: string) =>
    api.get<{ applicants: OpportunityApplicant[] }>(`/opportunities/${opportunityId}/applications`),
  apply: (opportunityId: string, message?: string) =>
    api.post<{ message: string }>(`/opportunities/${opportunityId}/apply`, message ? { message } : {}),
}

// --- Notifications -----------------------------------------------------------

export const notificationsApi = {
  list: () =>
    api.get<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications'),
  read: (notificationId: string) => api.post<{ message: string }>(`/notifications/${notificationId}/read`),
  readAll: () => api.post<{ message: string }>('/notifications/read-all'),
}

// --- Account (every role) --------------------------------------------------

export const accountApi = {
  rename: (name: string) => api.patch<{ user: AuthSession; message: string }>('/account', { name }),
  /** Signs out every other session; this one is re-issued. */
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>('/account/password', { currentPassword, newPassword }),
  /** `image` is a data URL of the already-resized photo. */
  uploadAvatar: (image: string) =>
    api.put<{ user: AuthSession; message: string }>('/account/avatar', { image }),
  removeAvatar: () => api.delete<{ user: AuthSession; message: string }>('/account/avatar'),
  acceptTerms: () => api.post<{ user: AuthSession; message: string }>('/account/accept-terms'),
  privacy: () => api.get<{ privacy: { showInDirectory: boolean } }>('/account/privacy'),
  setPrivacy: (privacy: { showInDirectory: boolean }) =>
    api.put<{ privacy: { showInDirectory: boolean }; message: string }>('/account/privacy', privacy),
  /** API path of the "download my data" file, for a download link. */
  exportPath: '/api/account/export',
  /** Immediate and permanent; the password confirms it is really them. */
  deleteAccount: (password: string) =>
    api.post<{ message: string }>('/account/delete', { password, confirm: true }),
}

// --- Safety: blocking and reporting ------------------------------------------

export const safetyApi = {
  blocked: () =>
    api.get<{ blocked: Array<{ userId: string; name: string; avatarUrl: string | null; blockedAt: string }> }>(
      '/blocks',
    ),
  block: (userId: string) => api.post<{ message: string }>('/blocks', { userId }),
  unblock: (userId: string) => api.delete<{ message: string }>(`/blocks/${userId}`),
  report: (payload: {
    userId: string
    contextType: ReportContext
    contextId?: string
    reason: ReportReason
    details?: string
  }) => api.post<{ message: string }>('/reports', payload),
}

// --- Seekers (student career-goals form) -----------------------------------

export const seekersApi = {
  me: () => api.get<{ seeker: Seeker | null }>('/seekers/me'),
  create: (payload: Record<string, unknown>) =>
    api.post<{ seeker: Seeker; message: string }>('/seekers/me', payload),
  update: (payload: Record<string, unknown>) =>
    api.patch<{ seeker: Seeker; message: string }>('/seekers/me', payload),
}

// --- Mentorship ------------------------------------------------------------

export const mentorshipApi = {
  listRequests: () => api.get<{ requests: MentorshipRequest[] }>('/mentorship/requests'),
  createRequest: (payload: {
    mentorProfileId: string
    interest: string
    /** Human label for the requested time, shown in the mentor's inbox. */
    preferredSlot: string
    /** The same moment as ISO 8601; accepting the request books it. */
    preferredSlotAt?: string
    message: string
  }) => api.post<{ request: MentorshipRequest; message: string }>('/mentorship/requests', payload),
  respond: (requestId: string, payload: { status: 'accepted' | 'declined'; notes?: string }) =>
    api.patch<{
      request: MentorshipRequest
      /** Set when accepting booked the time the student asked for. */
      firstSession: MentorshipSession | null
      message: string
    }>(`/mentorship/requests/${requestId}`, payload),
  relationships: () => api.get<{ relationships: Relationship[] }>('/mentorship/relationships'),
  withdraw: (requestId: string) =>
    api.post<{ request: MentorshipRequest; message: string }>(
      `/mentorship/requests/${requestId}/withdraw`,
    ),
  /** Either participant may end a mentorship; it frees the mentor's seat. */
  end: (relationshipId: string, reason?: string) =>
    api.post<{ message: string }>(
      `/mentorship/relationships/${relationshipId}/end`,
      reason ? { reason } : {},
    ),
  checkIn: (relationshipId: string, payload: { progress: CheckInProgress; note?: string }) =>
    api.post<{ message: string }>(`/mentorship/relationships/${relationshipId}/checkin`, payload),
  addGoal: (relationshipId: string, title: string) =>
    api.post<{ goal: MentorshipGoal; message: string }>(`/mentorship/relationships/${relationshipId}/goals`, {
      title,
    }),
  setGoalCompleted: (goalId: string, completed: boolean) =>
    api.patch<{ message: string }>(`/mentorship/goals/${goalId}`, { completed }),
  removeGoal: (goalId: string) => api.delete<{ message: string }>(`/mentorship/goals/${goalId}`),
}

// --- Office hours ------------------------------------------------------------

export const officeHoursApi = {
  upcoming: (mentorProfileId?: string) =>
    api.get<{ officeHours: OfficeHour[] }>('/office-hours', { mentorProfileId }),
  mine: () => api.get<{ officeHours: HostedOfficeHour[] }>('/office-hours/mine'),
  /** `startsAt` is a wall-clock 'YYYY-MM-DDTHH:mm' in the mentor's own timezone. */
  create: (payload: {
    title: string
    description?: string
    startsAt: string
    durationMin: number
    capacity: number
    meetingLink?: string
  }) => api.post<{ officeHour: OfficeHour; message: string }>('/office-hours', payload),
  join: (id: string) => api.post<{ officeHour: OfficeHour; message: string }>(`/office-hours/${id}/join`),
  leave: (id: string) => api.delete<{ officeHour: OfficeHour; message: string }>(`/office-hours/${id}/join`),
  cancel: (id: string) => api.post<{ officeHour: OfficeHour; message: string }>(`/office-hours/${id}/cancel`),
}

// --- Alumni directory --------------------------------------------------------

export const alumniApi = {
  directory: (filters: { q?: string; classYear?: string; industry?: string; page?: number }) =>
    api.get<{
      alumni: AlumniEntry[]
      total: number
      page: number
      limit: number
      classYears: string[]
      industries: string[]
    }>('/alumni', filters),
}

// --- Scheduling ------------------------------------------------------------

export const schedulingApi = {
  /** The signed-in mentor's own weekly schedule, for the editor. */
  myAvailability: () =>
    api.get<{ availability: MentorAvailability }>('/scheduling/availability/me'),

  /** Replaces the whole schedule — a week is edited as a whole, not per window. */
  saveAvailability: (payload: {
    timezoneLabel: string
    sessionDurationMin: number
    windows: Array<{ dayOfWeek: number; startTime: string; endTime: string }>
  }) =>
    api.put<{ availability: MentorAvailability; message: string }>(
      '/scheduling/availability/me',
      payload,
    ),

  mentorAvailability: (mentorProfileId: string) =>
    api.get<{ availability: MentorAvailability }>(`/scheduling/availability/${mentorProfileId}`),

  /** Concrete slots this viewer can actually book with that mentor. */
  slots: (mentorProfileId: string, days = 21) =>
    api.get<{ slots: BookableSlot[]; availability: MentorAvailability }>(
      `/scheduling/slots/${mentorProfileId}?days=${days}`,
    ),

  sessions: (scope: 'all' | 'upcoming' | 'past' = 'all') =>
    api.get<{ sessions: MentorshipSession[] }>(`/scheduling/sessions?scope=${scope}`),

  book: (payload: {
    relationshipId: string
    title: string
    scheduledAt: string
    notes?: string
    meetingLink?: string
  }) =>
    api.post<{ session: MentorshipSession; message: string }>('/scheduling/sessions', payload),

  rate: (sessionId: string, rating: number, comment?: string) =>
    api.post<{ message: string }>(`/scheduling/sessions/${sessionId}/rating`, comment ? { rating, comment } : { rating }),

  update: (
    sessionId: string,
    payload: {
      status?: 'upcoming' | 'completed' | 'cancelled'
      scheduledAt?: string
      title?: string
      notes?: string
      cancelledReason?: string
      /** An empty string clears it. */
      meetingLink?: string
    },
  ) =>
    api.patch<{ session: MentorshipSession; message: string }>(
      `/scheduling/sessions/${sessionId}`,
      payload,
    ),
}

// --- Feedback --------------------------------------------------------------

export type FeedbackPayload = {
  relationshipId: string
  satisfactionRating: number
  wouldMatchAgain: boolean
  sessionsHeld: number
  relationshipStatus: 'ongoing' | 'ended' | 'never_started'
  primaryGoalProgress: 'none' | 'some' | 'significant'
  freeTextComments?: string
}

export const feedbackApi = {
  pending: () =>
    api.get<{
      pending: Array<{
        relationshipId: string
        mentorName: string
        studentName: string
        startedAt: string
      }>
    }>('/feedback/pending'),
  submit: (payload: FeedbackPayload) => api.post<{ message: string }>('/feedback', payload),
}

// --- Communities -----------------------------------------------------------

export const groupsApi = {
  list: () => api.get<{ groups: CollaborationGroup[] }>('/groups'),
  detail: (groupId: string) =>
    api.get<{ group: CollaborationGroup; resources: GroupResource[] }>(`/groups/${groupId}`),
  join: (groupId: string) =>
    api.post<{ group: CollaborationGroup; message: string }>(`/groups/${groupId}/join`),
  leave: (groupId: string) =>
    api.delete<{ group: CollaborationGroup; message: string }>(`/groups/${groupId}/leave`),
  /** Creator-only on the server too, not just hidden in the UI. */
  setVisibility: (groupId: string, visibility: GroupVisibility) =>
    api.patch<{ group: CollaborationGroup; message: string }>(`/groups/${groupId}/visibility`, {
      visibility,
    }),
  create: (payload: { name: string; topic: string; description: string; visibility?: GroupVisibility }) =>
    api.post<{ group: CollaborationGroup; message: string }>('/groups', payload),
  /** Moderation — admins only, enforced by the server. */
  remove: (groupId: string) => api.delete<{ message: string }>(`/groups/${groupId}`),
}

// --- Messaging -------------------------------------------------------------

export const messagingApi = {
  conversations: () => api.get<{ conversations: ConversationSummary[] }>('/conversations'),
  messages: (conversationId: string) =>
    api.get<{ messages: ChatMessage[] }>(`/conversations/${conversationId}/messages`),
  send: (conversationId: string, text: string) =>
    api.post<{ message: ChatMessage }>(`/conversations/${conversationId}/messages`, { text }),
  markRead: (conversationId: string) =>
    api.post<{ message: string }>(`/conversations/${conversationId}/read`),
  open: (participantUserId: string) =>
    api.post<{ conversationId: string }>('/conversations', { participantUserId }),
}

// --- Events ----------------------------------------------------------------

export const eventsApi = {
  list: (type?: string) =>
    api.get<{ events: PlatformEvent[] }>('/events', {
      type,
      // Show past events too when a type filter is applied, so filtering never
      // silently empties the page.
      upcomingOnly: type ? 'false' : 'true',
    }),
  /** Past events too — for the admin's event manager. */
  listAll: () => api.get<{ events: PlatformEvent[] }>('/events', { upcomingOnly: 'false' }),
  register: (eventId: string) => api.post<{ message: string }>(`/events/${eventId}/register`),
  cancel: (eventId: string) => api.delete<{ message: string }>(`/events/${eventId}/register`),

  // Management — admins only, enforced by the server.
  create: (payload: EventPayload) =>
    api.post<{ event: PlatformEvent; message: string }>('/events', payload),
  update: (eventId: string, payload: Partial<EventPayload>) =>
    api.patch<{ event: PlatformEvent; message: string }>(`/events/${eventId}`, payload),
  cancelEvent: (eventId: string) =>
    api.post<{ event: PlatformEvent; message: string }>(`/events/${eventId}/cancel`),
  attendees: (eventId: string) =>
    api.get<{ attendees: EventAttendee[] }>(`/events/${eventId}/attendees`),
}

/** Times are wall-clock 'YYYY-MM-DDTHH:mm' in `timezoneLabel`. */
export type EventPayload = {
  title: string
  description: string
  startsAt: string
  endsAt?: string
  timezoneLabel: TimezoneLabel
  location: string
  type: EventType
  tag: string
}

// --- Announcements ---------------------------------------------------------

export const announcementsApi = {
  /** What the signed-in user's audience has been sent. */
  feed: () => api.get<{ announcements: Announcement[] }>('/announcements'),
}

// --- Admin -----------------------------------------------------------------

export const adminApi = {
  verifications: () => api.get<{ verifications: VerificationItem[] }>('/admin/verifications'),
  reviewVerification: (id: string, status: 'approved' | 'review' | 'rejected') =>
    api.patch<{ message: string }>(`/admin/verifications/${id}`, { status }),
  /** One page of accounts; search and filters run on the server. */
  users: (filters: { role?: string; q?: string; page?: number; limit?: number } = {}) =>
    api.get<AdminUserPage>('/admin/users', filters),
  insights: (days: 30 | 90 | 365) => api.get<Insights>('/admin/insights', { days }),
  /** Asks the matching worker, so it is fetched separately and may be unavailable. */
  evaluation: () =>
    api.get<{ evaluation: MatchEvaluation | null; matching: 'ready' | 'unavailable' | 'failed' }>('/admin/insights/evaluation'),
  /** Suspend or reactivate an account; takes effect on the user's next request. */
  setUserStatus: (userId: string, status: 'active' | 'suspended') =>
    api.patch<{ message: string }>(`/admin/users/${userId}/status`, { status }),
  announce: (payload: { title: string; audience: 'all' | 'students' | 'alumni'; body: string }) =>
    api.post<{ message: string }>('/admin/announcements', payload),
  stats: () => api.get<{ stats: AdminStats }>('/admin/stats'),
  /** Every announcement sent, whatever its audience. */
  announcements: () => api.get<{ announcements: Announcement[] }>('/admin/announcements'),
  audit: () => api.get<{ entries: AuditEntry[] }>('/admin/audit'),
  reports: (status: 'open' | 'closed' | 'all' = 'open') =>
    api.get<{ reports: ReportItem[] }>('/admin/reports', { status }),
  reviewReport: (reportId: string, status: 'actioned' | 'dismissed', note?: string) =>
    api.patch<{ message: string }>(`/admin/reports/${reportId}`, note ? { status, note } : { status }),
  /** `dryRun` previews what each row would do without creating anything. */
  importAlumni: (csv: string, dryRun: boolean) => api.post<ImportResult>('/admin/alumni/import', { csv, dryRun }),
  /** Moderation (ROADMAP D6); recorded in the audit log. */
  removeAvatar: (userId: string) => api.delete<{ message: string }>(`/admin/users/${userId}/avatar`),
}

// --- Content ---------------------------------------------------------------

export const contentApi = {
  landing: () => api.get<LandingContent>('/content/landing'),
  dashboardStats: () => api.get<{ stats: DashboardStat[] }>('/content/dashboard/stats'),
}
