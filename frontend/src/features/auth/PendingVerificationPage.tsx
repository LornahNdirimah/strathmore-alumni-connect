import { useState } from 'react'

import type { AuthSession } from '../../types'

type PendingVerificationPageProps = {
  session: AuthSession
  onRefresh: () => Promise<void>
  onLogout: () => void
}

/**
 * What an alumnus sees until an administrator verifies them (ROADMAP D4).
 *
 * The API grants a pending account no capabilities, so there is nothing else to
 * show — but saying exactly where they stand, and what was submitted, beats a
 * page of controls that all answer 403.
 */
export function PendingVerificationPage({ session, onRefresh, onLogout }: PendingVerificationPageProps) {
  const [checking, setChecking] = useState(false)
  const verification = session.verification

  const headline =
    verification?.status === 'rejected'
      ? 'We could not verify your alumni account'
      : 'Your account is waiting for verification'

  const detail =
    verification?.status === 'rejected'
      ? 'An administrator could not match your details to our alumni records. Contact the alumni office if you think this is a mistake.'
      : verification?.status === 'review'
        ? 'An administrator is taking a closer look at your details. This can take a little longer than usual.'
        : 'An administrator checks every new alumni account against the university’s records. You will have full access as soon as yours is approved.'

  return (
    <section className="content-panel">
      <div className="panel auth-panel">
        <span className="eyebrow">Alumni verification</span>
        <h2>{headline}</h2>
        <p className="muted-line">{detail}</p>

        {verification && (
          <dl className="detail-list" style={{ marginTop: '1rem' }}>
            <div>
              <dt>Name</dt>
              <dd>{session.name}</dd>
            </div>
            <div>
              <dt>Class of</dt>
              <dd>{verification.classYear}</dd>
            </div>
            <div>
              <dt>Programme</dt>
              <dd>{verification.program}</dd>
            </div>
          </dl>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
          <button
            className="primary-btn"
            type="button"
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              try {
                await onRefresh()
              } finally {
                setChecking(false)
              }
            }}
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
          <button className="ghost-btn" type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>
    </section>
  )
}
