import { institution } from '../../data/institution'
import type { AppPage } from '../../types'

type FooterProps = {
  onNavigate: (page: AppPage) => void
  hasSession: boolean
}

export function Footer({ onNavigate, hasSession }: FooterProps) {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-col">
          <div className="footer-brand">
            <div className="brand-mark">{institution.brandInitial}</div>
            <div>
              <p className="brand-title" style={{ margin: 0 }}>
                {institution.name}
              </p>
              <p style={{ margin: 0 }}>{institution.shortName}</p>
            </div>
          </div>
          <p>{institution.missionBlurb}</p>
          <p className="footer-motto">
            "{institution.motto}" — {institution.mottoTranslation}
          </p>
        </div>

        <div className="footer-col">
          <h4>For students</h4>
          <p>
            Get matched with alumni mentors who have walked your path — real career clarity, internship pipelines, and
            the confidence that comes from guidance you can trust.
          </p>
          <ul className="footer-links">
            <li>
              <button type="button" onClick={() => onNavigate(hasSession ? 'mentor-search' : 'login')}>
                Find a mentor
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate(hasSession ? 'events' : 'login')}>
                Browse events
              </button>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>For alumni</h4>
          <p>
            Give back through mentorship, and grow alongside peers through collaboration groups that connect you across
            industries, cohorts, and continents.
          </p>
          <ul className="footer-links">
            <li>
              <button type="button" onClick={() => onNavigate(hasSession ? 'communities' : 'login')}>
                Join a community
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate(hasSession ? 'alumni-dashboard' : 'signup')}>
                Become a mentor
              </button>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>Platform</h4>
          <ul className="footer-links">
            <li>
              <button type="button" onClick={() => onNavigate('mentor-search')}>
                Mentors
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('events')}>
                Events
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('communities')}>
                Communities
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate(hasSession ? 'messages' : 'login')}>
                Messages
              </button>
            </li>
            {!hasSession && (
              <>
                <li>
                  <button type="button" onClick={() => onNavigate('login')}>
                    Sign in
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => onNavigate('signup')}>
                    Sign up
                  </button>
                </li>
              </>
            )}
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <span>
            © {year} {institution.name}. All rights reserved.
          </span>
          <span>{institution.platformNote}</span>
        </div>
      </div>
    </footer>
  )
}
