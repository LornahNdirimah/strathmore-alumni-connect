/**
 * Static UI configuration: navigation links, sidebar menus, quick actions.
 *
 * This is presentation structure rather than data, so it stays in the frontend
 * — previously it lived in mockDb alongside genuine records, which blurred the
 * line between "what the server knows" and "how this app is laid out".
 */
import type { AppPage, AuthRole, AuthSession, Capability, DashboardTab } from '../types'

export const publicNavLinks: Array<{ label: string; action: AppPage }> = [
  { label: 'Home', action: 'landing' },
  { label: 'Sign up', action: 'signup' },
  { label: 'Sign in', action: 'login' },
]

/**
 * Top-bar links for a signed-in user. Each names the capability it needs, so a
 * role sees exactly the areas the API will let it use — an admin, who takes no
 * part in mentorship or messaging, never sees Mentors or Messages.
 */
export const appNavLinks: Array<{ label: string; action: AppPage; requires: Capability }> = [
  { label: 'Mentors', action: 'mentor-search', requires: 'mentors.browse' },
  { label: 'Alumni', action: 'alumni-directory', requires: 'alumni.directory' },
  { label: 'Opportunities', action: 'opportunities', requires: 'opportunities.view' },
  { label: 'Messages', action: 'messages', requires: 'messaging.use' },
  { label: 'Communities', action: 'communities', requires: 'communities.view' },
  { label: 'Events', action: 'events', requires: 'events.view' },
]

export type SidebarMenuItem = { id: DashboardTab; label: string; requires?: Capability }

export const sidebarMenus: Record<AuthRole, SidebarMenuItem[]> = {
  student: [
    { id: 'overview', label: 'Overview' },
    { id: 'my-mentors', label: 'My Mentors' },
    { id: 'find-mentors', label: 'Find Mentors' },
    { id: 'my-sessions', label: 'My Sessions' },
    { id: 'profile', label: 'Profile' },
  ],
  alumni: [
    { id: 'overview', label: 'Overview' },
    // Mentoring is optional for alumni; these two appear once they mentor.
    { id: 'my-mentees', label: 'My Mentees', requires: 'mentorship.mentor' },
    { id: 'availability', label: 'Availability', requires: 'mentorship.mentor' },
    // Any verified alumnus may post opportunities (ROADMAP D5).
    { id: 'opportunities', label: 'Opportunities', requires: 'opportunities.post' },
    { id: 'collaboration-groups', label: 'Groups' },
    { id: 'profile', label: 'Profile' },
  ],
  admin: [
    { id: 'overview', label: 'Overview' },
    { id: 'verification-queue', label: 'Verification' },
    { id: 'users', label: 'Users' },
    { id: 'insights', label: 'Insights' },
    { id: 'reports', label: 'Reports' },
    { id: 'import', label: 'Import alumni' },
    { id: 'events', label: 'Events', requires: 'events.manage' },
    { id: 'announcements', label: 'Announcements' },
    { id: 'activity', label: 'Activity log' },
    { id: 'profile', label: 'Profile' },
  ],
}

function allows(session: AuthSession, requires?: Capability): boolean {
  return requires === undefined || (session.capabilities ?? []).includes(requires)
}

export function navLinksFor(session: AuthSession) {
  return appNavLinks.filter((link) => allows(session, link.requires))
}

export function sidebarItemsFor(session: AuthSession): SidebarMenuItem[] {
  return sidebarMenus[session.role].filter((item) => allows(session, item.requires))
}

/** Base path of each role's dashboard; tabs live beneath it (`/alumni/availability`). */
export const dashboardBasePath: Record<AuthRole, string> = {
  student: '/student',
  alumni: '/alumni',
  admin: '/admin',
}

export function dashboardPath(role: AuthRole, tab: DashboardTab = 'overview'): string {
  const base = dashboardBasePath[role]
  return tab === 'overview' ? base : `${base}/${tab}`
}

export const dashboardLabels: Record<AuthRole, string> = {
  student: 'Student dashboard',
  alumni: 'Alumni dashboard',
  admin: 'Admin dashboard',
}

export type QuickAction = { label: string; description: string }

export const quickActions: Record<AuthRole, QuickAction[]> = {
  student: [
    { label: 'Find mentors', description: 'Search alumni by industry, skill, or availability.' },
    { label: 'Message a mentor', description: 'Continue a conversation with your matches.' },
    { label: 'View events', description: 'Career fairs, webinars, and reunions near you.' },
    { label: 'Update profile', description: 'Keep your interests and goals current.' },
  ],
  alumni: [
    { label: 'Post opportunity', description: 'Share an internship or job with students.' },
    { label: 'Browse communities', description: 'Join collaboration groups across the network.' },
    { label: 'Message a mentee', description: 'Follow up on an active mentorship.' },
    { label: 'Set availability', description: 'Publish the times students can book.' },
  ],
  admin: [
    { label: 'Review verification queue', description: 'Approve or flag pending alumni accounts.' },
    { label: 'Manage users', description: 'Search accounts; suspend or reactivate them.' },
    { label: 'Send announcement', description: 'Publish an update to students or alumni.' },
    { label: 'Manage events', description: 'Schedule, edit or cancel events; see who registered.' },
  ],
}

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

export const CADENCES = ['weekly', 'biweekly', 'as-needed'] as const
export const FORMATS = ['virtual', 'in-person', 'either'] as const

export const SUPPORT_OPTIONS = [
  { value: 'resume_review', label: 'Resume review' },
  { value: 'interview_prep', label: 'Interview preparation' },
  { value: 'networking', label: 'Networking introductions' },
  { value: 'general_guidance', label: 'General career guidance' },
] as const
