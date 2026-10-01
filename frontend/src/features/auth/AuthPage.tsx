import { useState } from 'react'
import { Link } from 'react-router-dom'

import { authApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import type { AuthRole, AuthSession } from '../../types'

type AuthPageProps = {
  mode: 'login' | 'signup'
  onAuthenticate: (session: AuthSession) => void
}

/**
 * Seeded demo accounts. These are deliberately public — they exist only in the
 * local demo database and are documented in the README. Note the difference
 * from the previous version: the app no longer *reads* real credentials out of
 * a shipped user table, it just offers to type these three in for you.
 */
const DEMO_ACCOUNTS: Array<{ role: AuthRole; email: string; password: string }> = [
  { role: 'student', email: 'student@demo.com', password: 'Student123!' },
  { role: 'alumni', email: 'alumni@demo.com', password: 'Alumni123!' },
  { role: 'admin', email: 'admin@demo.com', password: 'Admin123!' },
]

export function AuthPage({ mode, onAuthenticate }: AuthPageProps) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'student' as 'student' | 'alumni',
    classYear: '',
    program: '',
    acceptTerms: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)
    setFieldErrors({})

    try {
      const { classYear, program, acceptTerms, ...details } = form
      const account = { ...details, acceptTerms }
      const result =
        mode === 'signup'
          ? await authApi.signup(
              // What an administrator verifies an alumnus against; not asked of students.
              form.role === 'alumni' ? { ...account, classYear, program } : account,
            )
          : await authApi.login({ email: form.email, password: form.password })

      onAuthenticate(result.user)
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFieldErrors(caught.fieldErrors())
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const fillDemo = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setForm((current) => ({
      ...current,
      email: account.email,
      password: account.password,
      role: account.role === 'admin' ? 'student' : account.role,
    }))
  }

  return (
    <section className="panel auth-panel">
      <h2>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
      <p className="muted-line">
        {mode === 'signup'
          ? 'Join the Strathmore alumni mentorship network.'
          : 'Access the mentorship platform for students, alumni, or administrators.'}
      </p>

      <form className="form-grid" onSubmit={handleSubmit}>
        {mode === 'signup' && (
          <label>
            <span>Full name</span>
            <input
              className="input-field"
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
              placeholder="Jane Doe"
              required
            />
            {fieldErrors.name && <small className="field-error">{fieldErrors.name}</small>}
          </label>
        )}

        <div className="form-row">
          <label>
            <span>Email</span>
            <input
              className="input-field"
              type="email"
              value={form.email}
              onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
              placeholder="you@strathmore.edu"
              required
            />
            {fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}
          </label>

          {mode === 'signup' && (
            <label>
              <span>I am a</span>
              <select
                className="select-field"
                value={form.role}
                onChange={(event) =>
                  setForm((c) => ({ ...c, role: event.target.value as 'student' | 'alumni' }))
                }
              >
                <option value="student">Student</option>
                <option value="alumni">Alumni</option>
              </select>
            </label>
          )}
        </div>

        {mode === 'signup' && form.role === 'alumni' && (
          <div className="form-row">
            <label>
              <span>Year you graduated</span>
              <input
                className="input-field"
                inputMode="numeric"
                value={form.classYear}
                onChange={(event) => setForm((c) => ({ ...c, classYear: event.target.value }))}
                placeholder="2018"
                required
              />
              {fieldErrors.classYear && (
                <small className="field-error">{fieldErrors.classYear}</small>
              )}
            </label>
            <label>
              <span>Programme</span>
              <input
                className="input-field"
                value={form.program}
                onChange={(event) => setForm((c) => ({ ...c, program: event.target.value }))}
                placeholder="BSc Informatics and Computer Science"
                required
              />
              {fieldErrors.program && <small className="field-error">{fieldErrors.program}</small>}
            </label>
            <p className="muted-line" style={{ gridColumn: '1 / -1' }}>
              An administrator checks these against the alumni records before your account is
              activated.
            </p>
          </div>
        )}

        <label>
          <span>Password</span>
          <input
            className="input-field"
            type="password"
            value={form.password}
            onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))}
            placeholder={mode === 'signup' ? 'At least 10 characters' : 'Enter your password'}
            required
          />
          {fieldErrors.password && <small className="field-error">{fieldErrors.password}</small>}
          {mode === 'login' && (
            <Link to="/forgot-password" className="muted-line" style={{ justifySelf: 'end' }}>
              Forgot your password?
            </Link>
          )}
        </label>

        {mode === 'signup' && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.acceptTerms}
              onChange={(event) => setForm((c) => ({ ...c, acceptTerms: event.target.checked }))}
              required
            />
            <span>
              I have read and accept the <Link to="/privacy" target="_blank">privacy notice</Link> and the{' '}
              <Link to="/code-of-conduct" target="_blank">code of conduct</Link>.
            </span>
          </label>
        )}
        {fieldErrors.acceptTerms && <small className="field-error">{fieldErrors.acceptTerms}</small>}

        <button className="primary-btn" type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? mode === 'signup'
              ? 'Creating account…'
              : 'Signing in…'
            : mode === 'signup'
              ? 'Create account'
              : 'Continue'}
        </button>

        {error && <p className="error-msg">{error}</p>}
      </form>

      <p className="muted-line" style={{ marginTop: '1rem' }}>
        {mode === 'signup' ? (
          <>
            Already have an account? <Link to="/login">Sign in</Link>
          </>
        ) : (
          <>
            Don't have an account? <Link to="/signup">Sign up</Link>
          </>
        )}
      </p>

      {mode === 'login' && (
        <div className="panel" style={{ marginTop: '1.5rem' }}>
          <h3>Demo accounts</h3>
          <p className="muted-line">Seeded local accounts for trying the platform.</p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.role}
                className="secondary-btn"
                type="button"
                onClick={() => fillDemo(account)}
              >
                Fill {account.role} demo
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
