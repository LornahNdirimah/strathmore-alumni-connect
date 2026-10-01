import { sidebarItemsFor } from '../../config/navigation'
import { Avatar } from '../ui/Avatar'
import type { AppPage, AuthSession, DashboardTab } from '../../types'

type SidebarProps = {
  session: AuthSession
  activeTab: DashboardTab
  onChange: (tab: DashboardTab) => void
  onNavigate: (page: AppPage) => void
}

/** Tabs that are really shortcuts to a standalone route, not an inline panel. */
const portalTargets: Partial<Record<DashboardTab, AppPage>> = {
  'find-mentors': 'mentor-search',
  'collaboration-groups': 'communities',
}

export function Sidebar({ session, activeTab, onChange, onNavigate }: SidebarProps) {
  // Filtered by capability: an alumnus sees the mentor tabs only once they mentor.
  const items = sidebarItemsFor(session)

  return (
    <aside className="sidebar">
      <div className="profile-card">
        <Avatar name={session.name} url={session.avatarUrl} />
        <div>
          <h3>{session.name}</h3>
          <p>{session.email}</p>
        </div>
      </div>

      <div className="nav-panel">
        {items.map((item) => {
          const portalPage = portalTargets[item.id]

          return (
            <button
              key={item.id}
              type="button"
              className={activeTab === item.id ? 'side-item active' : 'side-item'}
              onClick={() => (portalPage ? onNavigate(portalPage) : onChange(item.id))}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
