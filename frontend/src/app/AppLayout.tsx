import type { ReactNode } from 'react'

import { Footer } from '../components/layout/Footer'
import { Sidebar } from '../components/layout/Sidebar'
import { TopBar } from '../components/layout/TopBar'
import { VerifyEmailBanner } from '../features/auth/EmailFlows'
import type { AppPage, AuthSession, DashboardTab } from '../types'

type AppLayoutProps = {
  activePage: AppPage
  activeTab: DashboardTab
  onNavigate: (page: AppPage) => void
  onTabChange: (tab: DashboardTab) => void
  onLogout: () => void
  session: AuthSession | null
  children: ReactNode
}

function isDashboardPage(page: AppPage): boolean {
  return page === 'student-dashboard' || page === 'alumni-dashboard' || page === 'admin-dashboard'
}

export function AppLayout({
  activePage,
  activeTab,
  onNavigate,
  onTabChange,
  onLogout,
  session,
  children,
}: AppLayoutProps) {
  const showSidebar = isDashboardPage(activePage) && session !== null

  return (
    <div className="page-shell">
      {/* The first thing a keyboard user reaches (DESIGN_BACKLOG #58). */}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <TopBar
        activePage={activePage}
        onSelect={onNavigate}
        onLogout={onLogout}
        session={session}
      />

      {session && session.status === 'active' && session.emailVerified === false && activePage !== 'verify-email' && (
        <VerifyEmailBanner email={session.email} />
      )}

      <main className={showSidebar ? 'main-layout with-sidebar' : 'main-layout'}>
        {showSidebar && session && (
          <Sidebar
            session={session}
            activeTab={activeTab}
            onChange={onTabChange}
            onNavigate={onNavigate}
          />
        )}
        <div id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </div>
      </main>

      {activePage === 'landing' && (
        <Footer onNavigate={onNavigate} hasSession={session !== null} />
      )}
    </div>
  )
}
