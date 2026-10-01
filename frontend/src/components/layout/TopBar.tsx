import { useState } from 'react'

import { navLinksFor, publicNavLinks } from '../../config/navigation'
import { institution } from '../../data/institution'
import { NotificationBell } from '../../features/notifications/NotificationBell'
import { Icon } from '../ui/Icon'
import type { AppPage, AuthRole, AuthSession } from '../../types'

type TopBarProps = {
  activePage?: AppPage
  onSelect: (page: AppPage) => void
  onLogout?: () => void
  session?: AuthSession | null
}

function dashboardPageFor(role: AuthRole): AppPage {
  if (role === 'student') return 'student-dashboard'
  if (role === 'alumni') return 'alumni-dashboard'
  return 'admin-dashboard'
}

export function TopBar({ activePage = 'landing', onSelect, onLogout, session }: TopBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const isLanding = activePage === 'landing'
  const isAuthPage = activePage === 'login' || activePage === 'signup'
  const userRole = session?.role
  const hasSession = Boolean(session)

  // Built from the session's capabilities, the same list the API enforces: each
  // role sees exactly the areas it may use. A pending account has none.
  const navLinks = isLanding ? publicNavLinks : session ? navLinksFor(session) : []

  const select = (page: AppPage) => {
    setMobileOpen(false)
    onSelect(page)
  }

  return (
    <header className="topbar">
      <button
        className="brand-wrap"
        type="button"
        style={{ border: 'none', background: 'none', padding: 0 }}
        onClick={() => select('landing')}
      >
        <div className="brand-mark">{institution.brandInitial}</div>
        <div>
          <p className="brand-title">{institution.brandTitle}</p>
          <p className="brand-subtitle">{institution.brandSubtitle}</p>
        </div>
      </button>

      {!isAuthPage && (
        <nav className="topnav" aria-label="Main navigation">
          {navLinks.map((link) => (
            <button key={link.label} type="button" onClick={() => select(link.action)}>
              {link.label}
            </button>
          ))}
        </nav>
      )}

      {/* Outside .top-actions, which collapses into the mobile menu: the bell
          has to stay visible on a phone. */}
      {session?.status === 'active' && <NotificationBell />}

      {hasSession && userRole && (
        <div className="top-actions">
          <button className="ghost-btn" type="button" onClick={() => select(dashboardPageFor(userRole))}>
            Dashboard
          </button>
          <button className="primary-btn" type="button" onClick={onLogout}>
            Logout
          </button>
        </div>
      )}

      {!isAuthPage && (
        <button
          className="mobile-menu-toggle"
          type="button"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <Icon.X /> : <Icon.Menu />}
        </button>
      )}

      {!isAuthPage && (
        <div className={mobileOpen ? 'mobile-nav-panel open' : 'mobile-nav-panel'}>
          {navLinks.map((link) => (
            <button key={link.label} type="button" onClick={() => select(link.action)}>
              {link.label}
            </button>
          ))}
          {hasSession && userRole && (
            <>
              <button type="button" onClick={() => select(dashboardPageFor(userRole))}>
                Dashboard
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => {
                  setMobileOpen(false)
                  onLogout?.()
                }}
              >
                Logout
              </button>
            </>
          )}
        </div>
      )}
    </header>
  )
}
