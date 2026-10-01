import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'

import { AppLayout } from './app/AppLayout'
import { can, SessionContext, SessionUpdateContext } from './app/SessionContext'
import { useLiveUpdates } from './app/useLiveUpdates'
import { useSession } from './app/useSession'
import { dashboardBasePath, dashboardPath, sidebarItemsFor } from './config/navigation'
import { AuthPage } from './features/auth/AuthPage'
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './features/auth/EmailFlows'
import { CodeOfConductPage, ConsentPage, PrivacyNoticePage } from './features/legal/LegalPages'
import { LandingPage } from './features/landing/LandingPage'
import type { AppPage, AuthRole, AuthSession, Capability, DashboardTab } from './types'

// Landing and auth are the entry points and stay in the main bundle; every
// signed-in page is split into its own chunk and fetched on first visit.
const AdminDashboardPage = lazy(() =>
  import('./features/admin/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })),
)
const AlumniDashboardPage = lazy(() =>
  import('./features/alumni/AlumniDashboardPage').then((m) => ({ default: m.AlumniDashboardPage })),
)
const CommunitiesPage = lazy(() =>
  import('./features/communities/CommunitiesPage').then((m) => ({ default: m.CommunitiesPage })),
)
const CommunityDetailPage = lazy(() =>
  import('./features/communities/CommunityDetailPage').then((m) => ({
    default: m.CommunityDetailPage,
  })),
)
const EventsPage = lazy(() =>
  import('./features/events/EventsPage').then((m) => ({ default: m.EventsPage })),
)
const MentorProfilePage = lazy(() =>
  import('./features/mentors/MentorProfilePage').then((m) => ({ default: m.MentorProfilePage })),
)
const MentorSearchPage = lazy(() =>
  import('./features/mentors/MentorSearchPage').then((m) => ({ default: m.MentorSearchPage })),
)
const AlumniDirectoryPage = lazy(() =>
  import('./features/alumni/AlumniDirectoryPage').then((m) => ({ default: m.AlumniDirectoryPage })),
)
const OpportunitiesBoardPage = lazy(() =>
  import('./features/opportunities/OpportunitiesBoardPage').then((m) => ({
    default: m.OpportunitiesBoardPage,
  })),
)
const MessagingPage = lazy(() =>
  import('./features/messaging/MessagingPage').then((m) => ({ default: m.MessagingPage })),
)
const OnboardingPage = lazy(() =>
  import('./features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
)
const PendingVerificationPage = lazy(() =>
  import('./features/auth/PendingVerificationPage').then((m) => ({
    default: m.PendingVerificationPage,
  })),
)
const StudentDashboardPage = lazy(() =>
  import('./features/students/StudentDashboardPage').then((m) => ({
    default: m.StudentDashboardPage,
  })),
)

function PageFallback() {
  return (
    <div className="query-state">
      <div className="boot-spinner" aria-hidden="true" />
      <p className="muted-line">Loading…</p>
    </div>
  )
}

const DASHBOARD_PAGES: Record<AuthRole, AppPage> = {
  student: 'student-dashboard',
  alumni: 'alumni-dashboard',
  admin: 'admin-dashboard',
}

function getPageFromPath(pathname: string): AppPage {
  if (pathname === '/') return 'landing'
  if (pathname === '/mentors') return 'mentor-search'
  if (pathname.startsWith('/mentors/')) return 'mentor-detail'
  for (const [role, base] of Object.entries(dashboardBasePath) as Array<[AuthRole, string]>) {
    if (pathname === base || pathname.startsWith(`${base}/`)) return DASHBOARD_PAGES[role]
  }
  if (pathname === '/login') return 'login'
  if (pathname === '/signup') return 'signup'
  if (pathname === '/onboarding') return 'onboarding'
  if (pathname === '/pending') return 'pending'
  if (pathname === '/verify-email') return 'verify-email'
  if (pathname === '/forgot-password') return 'forgot-password'
  if (pathname === '/reset-password') return 'reset-password'
  if (pathname === '/consent') return 'consent'
  if (pathname === '/privacy') return 'privacy'
  if (pathname === '/code-of-conduct') return 'code-of-conduct'
  if (pathname === '/events') return 'events'
  if (pathname === '/opportunities') return 'opportunities'
  if (pathname === '/alumni-directory') return 'alumni-directory'
  if (pathname === '/messages') return 'messages'
  if (pathname === '/communities') return 'communities'
  if (pathname.startsWith('/communities/')) return 'community-detail'
  return 'landing'
}

/**
 * Sidebar entries that are shortcuts to a standalone page rather than a panel
 * of the dashboard. A URL naming one is sent to that page.
 */
const PORTAL_TABS: Partial<Record<DashboardTab, string>> = {
  'find-mentors': '/mentors',
  'collaboration-groups': '/communities',
}

/** The dashboard tab named in the URL (`/alumni/availability` → 'availability'). */
function getTabFromPath(pathname: string): DashboardTab {
  const segment = pathname.split('/')[2]
  return (segment as DashboardTab | undefined) ?? 'overview'
}

/**
 * Whether this account has completed the opt-in form its role requires.
 *
 * Only students must: their goals are what matching runs on. Mentoring is
 * optional for alumni (DESIGN_BACKLOG #20) — an alumnus who never fills in the
 * mentor form is still a full member of the network.
 *
 * Reads defensively. This guard runs on every protected route, so a response
 * missing `optIn` used to throw here and blank the whole app. Treating an absent
 * field as "not opted in" sends the user to the onboarding form, which is
 * recoverable, rather than a crash.
 */
function hasOptedIn(session: AuthSession): boolean {
  if (session.role === 'student') return session.optIn?.isSeeker === true
  return true
}

/** Where a signed-in user belongs when a page is not for them. */
function homeFor(session: AuthSession): string {
  if (session.status === 'pending') return '/pending'
  // Before anything else, the current privacy notice and code of conduct.
  if (session.termsAccepted === false) return '/consent'
  if (!hasOptedIn(session)) return '/onboarding'
  return dashboardPath(session.role)
}

function MentorDetailRoute({ onBack }: { onBack: () => void }) {
  const { mentorId } = useParams()
  return <MentorProfilePage mentorId={mentorId ?? ''} onBack={onBack} />
}

function CommunityDetailRoute({ onBack }: { onBack: () => void }) {
  const { groupId } = useParams()
  return <CommunityDetailPage groupId={groupId ?? ''} onBack={onBack} />
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const { session, status, setSession, refresh, logout } = useSession()
  // Before any early return: hooks run on every render.
  useLiveUpdates(session?.status === 'active')

  const currentPage = getPageFromPath(location.pathname)
  const dashboardTab = getTabFromPath(location.pathname)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleTabChange = (tab: DashboardTab) => {
    if (session) navigate(dashboardPath(session.role, tab))
  }

  const navigateToPage = (page: AppPage) => {
    if (!session && page !== 'landing' && page !== 'login' && page !== 'signup') {
      navigate('/login')
      return
    }

    if (session && (page === 'student-dashboard' || page === 'alumni-dashboard' || page === 'admin-dashboard')) {
      navigate(homeFor(session))
      return
    }

    const paths: Record<AppPage, string> = {
      landing: '/',
      'mentor-search': '/mentors',
      'mentor-detail': '/mentors',
      'student-dashboard': '/student',
      'alumni-dashboard': '/alumni',
      'admin-dashboard': '/admin',
      login: '/login',
      signup: '/signup',
      onboarding: '/onboarding',
      pending: '/pending',
      'verify-email': '/verify-email',
      'forgot-password': '/forgot-password',
      'reset-password': '/reset-password',
      consent: '/consent',
      privacy: '/privacy',
      'code-of-conduct': '/code-of-conduct',
      events: '/events',
      opportunities: '/opportunities',
      'alumni-directory': '/alumni-directory',
      messages: '/messages',
      communities: '/communities',
      'community-detail': '/communities',
    }

    navigate(paths[page])
  }

  // Until the session request settles we cannot know whether to render the app
  // or the login page; guessing would flash the wrong one on every reload.
  if (status === 'loading') {
    return (
      <div className="page-shell">
        <div className="boot-screen">
          <div className="boot-spinner" aria-hidden="true" />
          <p>Loading your session…</p>
        </div>
      </div>
    )
  }

  /**
   * Requires an active, opted-in session holding `capability`. The server
   * enforces the same capability; this only decides where to send someone
   * rather than showing them a page that would fail.
   */
  const requires = (capability: Capability | null, element: ReactNode) => {
    if (!session) return <Navigate to="/login" replace />
    if (session.status !== 'active' || session.termsAccepted === false || !hasOptedIn(session)) {
      return <Navigate to={homeFor(session)} replace />
    }
    if (capability && !can(session, capability)) {
      return <Navigate to={dashboardPath(session.role)} replace />
    }
    return element
  }

  /** A role's dashboard, with the tab taken from the URL and validated. */
  const dashboard = (role: AuthRole, render: (session: AuthSession) => ReactNode) => {
    if (!session) return <Navigate to="/login" replace />
    if (session.role !== role) return <Navigate to={homeFor(session)} replace />
    if (session.status !== 'active' || session.termsAccepted === false || !hasOptedIn(session)) {
      return <Navigate to={homeFor(session)} replace />
    }

    const portal = PORTAL_TABS[dashboardTab]
    if (portal) return <Navigate to={portal} replace />

    // A tab this account cannot see (a mentor tab for a non-mentor, a tab
    // from another role's dashboard, a typo) falls back to the overview.
    const allowed = sidebarItemsFor(session).some((item) => item.id === dashboardTab)
    if (!allowed) return <Navigate to={dashboardPath(role)} replace />

    return render(session)
  }

  return (
    <SessionContext.Provider value={session}>
      <SessionUpdateContext.Provider value={setSession}>
      <AppLayout
        activePage={currentPage}
        activeTab={dashboardTab}
        onNavigate={navigateToPage}
        onTabChange={handleTabChange}
        onLogout={handleLogout}
        session={session}
      >
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage onNavigate={navigateToPage} />} />

            <Route
              path="/login"
              element={
                session ? (
                  <Navigate to={homeFor(session)} replace />
                ) : (
                  <AuthPage mode="login" onAuthenticate={setSession} />
                )
              }
            />
            <Route
              path="/signup"
              element={
                session ? (
                  <Navigate to={homeFor(session)} replace />
                ) : (
                  <AuthPage mode="signup" onAuthenticate={setSession} />
                )
              }
            />

            {/* Pages behind emailed links (DESIGN_BACKLOG #43). Reachable signed
                in or out: people open links on another device. */}
            <Route path="/verify-email" element={<VerifyEmailPage onVerified={refresh} />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* DESIGN_BACKLOG #42, #44 — public, so they can be read before signing up. */}
            <Route path="/privacy" element={<PrivacyNoticePage />} />
            <Route path="/code-of-conduct" element={<CodeOfConductPage />} />
            <Route
              path="/consent"
              element={
                !session ? (
                  <Navigate to="/login" replace />
                ) : session.termsAccepted === false ? (
                  <ConsentPage onLogout={handleLogout} />
                ) : (
                  <Navigate to={homeFor(session)} replace />
                )
              }
            />

            {/* An alumnus awaiting verification sees only this (ROADMAP D4). */}
            <Route
              path="/pending"
              element={
                !session ? (
                  <Navigate to="/login" replace />
                ) : session.status !== 'pending' ? (
                  <Navigate to={homeFor(session)} replace />
                ) : (
                  <PendingVerificationPage
                    session={session}
                    onRefresh={refresh}
                    onLogout={handleLogout}
                  />
                )
              }
            />

            {/* Opt-in forms — DESIGN_BACKLOG #3, #5. Required for students;
                for alumni it is the voluntary "become a mentor" form. */}
            <Route
              path="/onboarding"
              element={
                !session ? (
                  <Navigate to="/login" replace />
                ) : session.status !== 'active' || session.termsAccepted === false ? (
                  <Navigate to={homeFor(session)} replace />
                ) : (session.role === 'student' && !hasOptedIn(session)) ||
                  can(session, 'mentorship.become-mentor') ? (
                  <OnboardingPage
                    session={session}
                    onComplete={async () => {
                      await refresh()
                      navigate(dashboardPath(session.role))
                    }}
                  />
                ) : (
                  <Navigate to={homeFor(session)} replace />
                )
              }
            />

            <Route
              path="/mentors"
              element={requires(
                'mentors.browse',
                <MentorSearchPage onOpenProfile={(mentorId) => navigate(`/mentors/${mentorId}`)} />,
              )}
            />
            <Route
              path="/mentors/:mentorId"
              element={requires(
                'mentors.browse',
                <MentorDetailRoute onBack={() => navigate('/mentors')} />,
              )}
            />

            <Route
              path="/student/:tab?"
              element={dashboard('student', (current) => (
                <StudentDashboardPage
                  session={current}
                  activeTab={dashboardTab}
                  onNavigate={navigateToPage}
                  onTabChange={handleTabChange}
                />
              ))}
            />
            <Route
              path="/alumni/:tab?"
              element={dashboard('alumni', (current) => (
                <AlumniDashboardPage
                  session={current}
                  activeTab={dashboardTab}
                  onNavigate={navigateToPage}
                  onTabChange={handleTabChange}
                />
              ))}
            />
            <Route
              path="/admin/:tab?"
              element={dashboard('admin', () => (
                <AdminDashboardPage activeTab={dashboardTab} onTabChange={handleTabChange} />
              ))}
            />

            <Route path="/events" element={requires('events.view', <EventsPage />)} />
            <Route
              path="/opportunities"
              element={requires('opportunities.view', <OpportunitiesBoardPage />)}
            />
            <Route
              path="/alumni-directory"
              element={requires('alumni.directory', <AlumniDirectoryPage />)}
            />
            <Route path="/messages" element={requires('messaging.use', <MessagingPage />)} />
            <Route
              path="/communities"
              element={requires(
                'communities.view',
                <CommunitiesPage onOpenGroup={(groupId) => navigate(`/communities/${groupId}`)} />,
              )}
            />
            <Route
              path="/communities/:groupId"
              element={requires(
                'communities.view',
                <CommunityDetailRoute onBack={() => navigate('/communities')} />,
              )}
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppLayout>
      </SessionUpdateContext.Provider>
    </SessionContext.Provider>
  )
}
