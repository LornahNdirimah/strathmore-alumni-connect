import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'

import { useUpdateSession } from '../../app/SessionContext'
import { Avatar } from '../../components/ui/Avatar'
import { accountApi, safetyApi } from '../../lib/api'
import { ApiError, apiAssetUrl } from '../../lib/http'
import { ImageError, prepareAvatar } from '../../lib/image'
import type { AuthSession } from '../../types'

/**
 * What every account can change about itself (DESIGN_BACKLOG #24, #25): the
 * photo people recognise them by, their name, and their password.
 */
export function AccountSettings({ session }: { session: AuthSession }) {
  return (
    <div className="panel account-settings">
      <h2>Account</h2>
      <PhotoSection session={session} />
      <NameSection session={session} />
      <PasswordSection />
      {session.role === 'alumni' && <PrivacySection />}
      <YourDataSection />
    </div>
  )
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof ImageError ? error.message : fallback
}

function PhotoSection({ session }: { session: AuthSession }) {
  const updateSession = useUpdateSession()
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const upload = useMutation({
    mutationFn: async (file: File) => accountApi.uploadAvatar(await prepareAvatar(file)),
    onSuccess: (result) => {
      updateSession(result.user)
      setStatus({ kind: 'ok', text: result.message })
    },
    onError: (error) => setStatus({ kind: 'error', text: messageOf(error, 'Could not update your photo.') }),
  })

  const remove = useMutation({
    mutationFn: () => accountApi.removeAvatar(),
    onSuccess: (result) => {
      updateSession(result.user)
      setStatus({ kind: 'ok', text: result.message })
    },
    onError: (error) => setStatus({ kind: 'error', text: messageOf(error, 'Could not remove your photo.') }),
  })

  const busy = upload.isPending || remove.isPending

  return (
    <section className="account-section photo-section">
      <Avatar name={session.name} url={session.avatarUrl} size="lg" />
      <div>
        <h3>Photo</h3>
        <p className="muted-line">
          Optional. A clear photo of your face helps mentors and mentees recognise each other.
        </p>
        <div className="row-actions" style={{ marginTop: '0.5rem' }}>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Choose a photo"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Reset so choosing the same file again still fires a change.
              event.target.value = ''
              if (file) upload.mutate(file)
            }}
          />
          <button className="secondary-btn" type="button" disabled={busy} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Uploading…' : session.avatarUrl ? 'Change photo' : 'Add a photo'}
          </button>
          {session.avatarUrl && (
            <button className="ghost-btn" type="button" disabled={busy} onClick={() => remove.mutate()}>
              Remove photo
            </button>
          )}
        </div>
        {status && <p className={status.kind === 'ok' ? 'success-msg' : 'error-msg'}>{status.text}</p>}
      </div>
    </section>
  )
}

function NameSection({ session }: { session: AuthSession }) {
  const updateSession = useUpdateSession()
  const [name, setName] = useState(session.name)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const rename = useMutation({
    mutationFn: () => accountApi.rename(name),
    onSuccess: (result) => {
      updateSession(result.user)
      setStatus({ kind: 'ok', text: result.message })
    },
    onError: (error) => setStatus({ kind: 'error', text: messageOf(error, 'Could not change your name.') }),
  })

  return (
    <form
      className="account-section form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        rename.mutate()
      }}
    >
      <h3>Name</h3>
      <div className="form-row" style={{ alignItems: 'end' }}>
        <label>
          <span>Full name</span>
          <input
            className="input-field"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <button
          className="primary-btn"
          type="submit"
          disabled={rename.isPending || name.trim() === session.name}
        >
          {rename.isPending ? 'Saving…' : 'Save name'}
        </button>
      </div>
      <p className="muted-line">Your email ({session.email}) is how you sign in and cannot be changed here.</p>
      {status && <p className={status.kind === 'ok' ? 'success-msg' : 'error-msg'}>{status.text}</p>}
    </form>
  )
}

function PasswordSection() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const change = useMutation({
    mutationFn: () => accountApi.changePassword(form.currentPassword, form.newPassword),
    onSuccess: (result) => {
      setForm({ currentPassword: '', newPassword: '', confirm: '' })
      setFieldErrors({})
      setStatus({ kind: 'ok', text: result.message })
    },
    onError: (error) => {
      setFieldErrors(error instanceof ApiError ? error.fieldErrors() : {})
      setStatus({ kind: 'error', text: messageOf(error, 'Could not change your password.') })
    },
  })

  const mismatch = form.confirm !== '' && form.confirm !== form.newPassword

  return (
    <form
      className="account-section form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        if (!mismatch) change.mutate()
      }}
    >
      <h3>Password</h3>
      <p className="muted-line">Changing it signs you out on every other device.</p>
      <label>
        <span>Current password</span>
        <input
          className="input-field"
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={(event) => setForm((c) => ({ ...c, currentPassword: event.target.value }))}
          required
        />
      </label>
      <div className="form-row">
        <label>
          <span>New password</span>
          <input
            className="input-field"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={form.newPassword}
            onChange={(event) => setForm((c) => ({ ...c, newPassword: event.target.value }))}
            placeholder="At least 10 characters"
            required
          />
          {fieldErrors.newPassword && <small className="field-error">{fieldErrors.newPassword}</small>}
        </label>
        <label>
          <span>Confirm new password</span>
          <input
            className="input-field"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={(event) => setForm((c) => ({ ...c, confirm: event.target.value }))}
            aria-describedby={mismatch ? 'password-mismatch' : undefined}
            required
          />
        </label>
      </div>
      {/* Outside the label, so it describes the field rather than renaming it. */}
      {mismatch && (
        <small className="field-error" id="password-mismatch">
          The two passwords do not match.
        </small>
      )}
      <button className="primary-btn" type="submit" disabled={change.isPending || mismatch}>
        {change.isPending ? 'Changing…' : 'Change password'}
      </button>
      {status && <p className={status.kind === 'ok' ? 'success-msg' : 'error-msg'}>{status.text}</p>}
    </form>
  )
}

/**
 * The person's own data (DESIGN_BACKLOG #44): download it, manage who they
 * have blocked, or delete the account — immediately, with the password
 * re-entered, and anonymising rather than tearing out what others depend on.
 */
/**
 * Who can find an alumnus (DESIGN_BACKLOG #44). Leaving the directory does not
 * stop mentoring: students still find a mentor profile through mentor search.
 */
function PrivacySection() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const privacy = useQuery({ queryKey: ['account-privacy'], queryFn: () => accountApi.privacy() })
  // The box changes the moment it is clicked and goes back if saving fails,
  // rather than sitting unchanged while the request is in flight.
  const [choice, setChoice] = useState<boolean | null>(null)
  const saved = privacy.data?.privacy.showInDirectory ?? true

  const save = useMutation({
    mutationFn: (showInDirectory: boolean) => accountApi.setPrivacy({ showInDirectory }),
    onSuccess: (result) => {
      queryClient.setQueryData(['account-privacy'], { privacy: result.privacy })
      void queryClient.invalidateQueries({ queryKey: ['alumni-directory'] })
      setStatus({ kind: 'ok', text: result.message })
    },
    onError: (error) => {
      setChoice(null)
      setStatus({ kind: 'error', text: messageOf(error, 'Could not save that.') })
    },
  })

  return (
    <section className="account-section form-grid">
      <h3>Privacy</h3>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={choice ?? saved}
          disabled={!privacy.data}
          onChange={(event) => {
            setChoice(event.target.checked)
            save.mutate(event.target.checked)
          }}
        />
        <span>Show me in the alumni directory</span>
      </label>
      <p className="muted-line">
        Other alumni browse the directory to reach out. Leaving it does not stop mentoring: if you mentor, students
        still find you through mentor search.
      </p>
      {status && <p className={status.kind === 'ok' ? 'success-msg' : 'error-msg'}>{status.text}</p>}
    </section>
  )
}

function YourDataSection() {
  const updateSession = useUpdateSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  const [understood, setUnderstood] = useState(false)

  const blocked = useQuery({ queryKey: ['blocks'], queryFn: () => safetyApi.blocked() })
  const unblock = useMutation({
    mutationFn: safetyApi.unblock,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['blocks'] }),
  })

  const remove = useMutation({
    mutationFn: () => accountApi.deleteAccount(password),
    onSuccess: () => {
      updateSession(null)
      navigate('/', { replace: true })
    },
  })

  return (
    <section className="account-section form-grid">
      <h3>Privacy and your data</h3>
      <p className="muted-line">
        Read the <Link to="/privacy">privacy notice</Link> and <Link to="/code-of-conduct">code of conduct</Link>.
      </p>
      <div className="row-actions">
        <a className="secondary-btn" href={apiAssetUrl(accountApi.exportPath)} download>
          Download my data
        </a>
      </div>

      {(blocked.data?.blocked ?? []).length > 0 && (
        <div>
          <h4>People you have blocked</h4>
          <ul className="goal-list">
            {blocked.data!.blocked.map((person) => (
              <li key={person.userId}>
                <span className="person-heading">
                  <Avatar name={person.name} url={person.avatarUrl} size="sm" />
                  {person.name}
                </span>
                <button className="link-btn" type="button" onClick={() => unblock.mutate(person.userId)}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!confirming ? (
        <div>
          <button className="ghost-btn danger" type="button" onClick={() => setConfirming(true)}>
            Delete my account…
          </button>
        </div>
      ) : (
        <form
          className="confirm-box danger-box"
          onSubmit={(event) => {
            event.preventDefault()
            if (understood) remove.mutate()
          }}
        >
          <strong>Delete your account</strong>
          <ul>
            <li>Your name, email, photo, profile and password are erased straight away.</li>
            <li>Active mentorships end and upcoming sessions are cancelled; the other person is told.</li>
            <li>The text of messages you sent is removed.</li>
            <li>
              What others depend on — that a mentorship or session happened, and scores you gave — stays,
              shown as “Former member”.
            </li>
            <li>This cannot be undone. You may want to download your data first.</li>
          </ul>
          <label>
            <span>Your password</span>
            <input
              className="input-field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
            <span>I understand my account will be deleted permanently.</span>
          </label>
          <div className="row-actions">
            <button className="primary-btn danger" type="submit" disabled={!understood || !password || remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Delete my account'}
            </button>
            <button className="ghost-btn" type="button" onClick={() => setConfirming(false)}>
              Keep my account
            </button>
          </div>
          {remove.isError && <p className="error-msg">{messageOf(remove.error, 'Could not delete the account.')}</p>}
        </form>
      )}
    </section>
  )
}
