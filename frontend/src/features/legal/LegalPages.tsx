/**
 * The privacy notice and code of conduct (DESIGN_BACKLOG #42, #44), and the
 * screen that asks for them to be accepted.
 *
 * DRAFTS. These texts describe what the software actually does, but they have
 * not been reviewed by Strathmore University's data protection officer or
 * legal office, and they are not legal advice. Before real users rely on
 * them, have them reviewed, fill in the contact details, and bump
 * CURRENT_TERMS_VERSION in backend/src/lib/terms.ts so everyone accepts the
 * reviewed version.
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { useUpdateSession } from '../../app/SessionContext'
import { accountApi } from '../../lib/api'
import { ApiError, apiAssetUrl } from '../../lib/http'

const DRAFT_NOTICE =
  'Draft pending review by Strathmore University’s data protection officer. It describes how this platform handles data, but it is not yet an approved policy.'

export function PrivacyNoticePage() {
  return (
    <section className="content-panel">
      <article className="panel legal-text">
        <p className="notice-banner">{DRAFT_NOTICE}</p>
        <h1>Privacy notice</h1>

        <h2>What we collect</h2>
        <ul>
          <li>Your account: name, email address, password (stored only as a salted hash) and your role.</li>
          <li>Alumni verification: your class year and programme.</li>
          <li>
            What you tell us to be matched: for students, your course, goals, interests, skills and
            hobbies; for mentors, your role, company, industry, skills, tracks and availability.
          </li>
          <li>What you do here: requests, mentorships, sessions, goals, messages, feedback and ratings, community memberships, event registrations and applications.</li>
          <li>An optional profile photo.</li>
        </ul>

        <h2>Why</h2>
        <ul>
          <li>To match students with mentors, and to run mentorships, sessions and messaging.</li>
          <li>To keep the platform safe: verifying alumni, handling reports, and an administrator activity log.</li>
          <li>
            To improve matching. Suggestions shown, requests and answers, and the feedback and
            ratings you give are used, without your name, to evaluate and improve how mentors are
            suggested. Feedback is only ever entered by people; none is generated.
          </li>
        </ul>

        <h2>Who can see it</h2>
        <ul>
          <li>Other members see what the platform shows them: a mentor’s profile, your name and photo in a conversation or mentorship. Email addresses are not shown to other members.</li>
          <li>Administrators can see account details to verify, moderate and support the platform; their actions are logged.</li>
          <li>Nothing is sold or shared with advertisers.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          Under Kenya’s Data Protection Act, 2019 you can ask to see, correct or delete your data,
          and object to its use. On this platform you can do much of that yourself from your
          Profile page:
        </p>
        <ul>
          <li><strong>Correct it:</strong> edit your name, photo and profile at any time.</li>
          <li><strong>See it:</strong> <em>Download my data</em> gives you everything we hold about you as a file.</li>
          <li>
            <strong>Delete it:</strong> <em>Delete my account</em> erases your personal details at once.
            Records others depend on — that a mentorship or session took place, and anonymous scores —
            are kept without anything that identifies you, and the text of your messages is removed.
          </li>
        </ul>

        <h2>Contact</h2>
        <p>Questions about your data: <em>[data protection contact to be added by Strathmore University]</em>.</p>
      </article>
    </section>
  )
}

export function CodeOfConductPage() {
  return (
    <section className="content-panel">
      <article className="panel legal-text">
        <p className="notice-banner">{DRAFT_NOTICE}</p>
        <h1>Code of conduct</h1>
        <p>This is a place for students and alumni to help each other. By using it you agree to:</p>
        <ol>
          <li><strong>Be respectful.</strong> No harassment, discrimination, threats or demeaning language.</li>
          <li><strong>Keep it professional.</strong> Mentorship is about learning and careers; keep contact appropriate to that.</li>
          <li><strong>Be honest.</strong> Use your real identity. Do not impersonate anyone or misrepresent your experience.</li>
          <li><strong>Respect privacy.</strong> Do not share what others tell you in confidence, or their contact details, without their consent.</li>
          <li><strong>No spam or selling.</strong> Opportunities you post must be genuine; do not use messaging to advertise.</li>
          <li><strong>Keep commitments.</strong> Turn up to sessions you book, or cancel in good time.</li>
          <li><strong>Speak up.</strong> If something is wrong, use <em>Report</em>. Reports are reviewed by administrators, and you can also block anyone.</li>
        </ol>
        <p>
          Breaking these rules can lead to a warning, removal of content, or suspension of your
          account.
        </p>
      </article>
    </section>
  )
}

/**
 * Shown until the current privacy notice and code of conduct are accepted —
 * after sign-up for invited alumni, and to everyone when the texts change.
 * The API enforces the same thing; this is what the person sees.
 */
export function ConsentPage({ onLogout }: { onLogout: () => void }) {
  const updateSession = useUpdateSession()
  const [agreed, setAgreed] = useState(false)
  const accept = useMutation({
    mutationFn: () => accountApi.acceptTerms(),
    onSuccess: (result) => updateSession(result.user),
  })

  return (
    <section className="content-panel">
      <div className="panel auth-panel form-grid">
        <h2>Before you continue</h2>
        <p>
          Please read and accept the <Link to="/privacy" target="_blank">privacy notice</Link> and the{' '}
          <Link to="/code-of-conduct" target="_blank">code of conduct</Link>. They explain what we do with
          your data and how members treat each other here.
        </p>
        <label className="checkbox-row">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          <span>I have read and accept the privacy notice and code of conduct.</span>
        </label>
        <button className="primary-btn" type="button" disabled={!agreed || accept.isPending} onClick={() => accept.mutate()}>
          {accept.isPending ? 'Saving…' : 'Continue'}
        </button>
        {accept.isError && (
          <p className="error-msg">{accept.error instanceof ApiError ? accept.error.message : 'Please try again.'}</p>
        )}
        <p className="muted-line">
          Rather not? You can <a href={apiAssetUrl(accountApi.exportPath)} download>download your data</a> or{' '}
          <button className="link-btn" type="button" onClick={onLogout}>
            sign out
          </button>
          .
        </p>
      </div>
    </section>
  )
}
