/**
 * The pages behind emailed links (DESIGN_BACKLOG #43): confirming an address,
 * asking for a password reset, and choosing the new password.
 *
 * Each works signed in or signed out — people open links on another device or
 * in another browser — and each reads its token from the URL.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { useCurrentSession } from '../../app/SessionContext'
import { authApi } from '../../lib/api'
import { ApiError } from '../../lib/http'

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/** Opened from the confirm-your-email link. */
export function VerifyEmailPage({ onVerified }: { onVerified: () => Promise<void> | void }) {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const session = useCurrentSession()
  const started = useRef(false)

  const verify = useMutation({
    mutationFn: () => authApi.verifyEmail(token),
    onSuccess: () => void onVerified(),
  })

  // Once, on arrival. StrictMode mounts twice in development, and a token only
  // works once, so the guard matters.
  useEffect(() => {
    if (token && !started.current) {
      started.current = true
      verify.mutate()
    }
  }, [token, verify])

  return (
    <section className="content-panel">
      <div className="panel auth-panel">
        <h2>Confirm your email</h2>
        {!token && <p className="error-msg">This link is incomplete. Open it again from the email.</p>}
        {verify.isPending && <p className="muted-line">Confirming…</p>}
        {verify.isSuccess && <p className="success-msg">{verify.data.message}</p>}
        {verify.isError && (
          <p className="error-msg">{messageOf(verify.error, 'We could not confirm this link.')}</p>
        )}
        <p style={{ marginTop: '1rem' }}>
          {session ? <Link to="/">Back to the platform</Link> : <Link to="/login">Sign in</Link>}
          {verify.isError && session && ' — you can ask for a new link from the banner at the top.'}
        </p>
      </div>
    </section>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const request = useMutation({ mutationFn: () => authApi.forgotPassword(email.trim()) })

  return (
    <section className="content-panel">
      <form
        className="panel auth-panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          request.mutate()
        }}
      >
        <h2>Reset your password</h2>
        <p className="muted-line">Enter the email you signed up with and we will send you a link.</p>
        <label>
          <span>Email</span>
          <input
            className="input-field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@strathmore.edu"
            required
          />
        </label>
        <button className="primary-btn" type="submit" disabled={request.isPending}>
          {request.isPending ? 'Sending…' : 'Send reset link'}
        </button>
        {/* The same words whether or not the address has an account. */}
        {request.isSuccess && <p className="success-msg">{request.data.message}</p>}
        {request.isError && <p className="error-msg">{messageOf(request.error, 'Please try again.')}</p>}
        <p className="muted-line">
          Remembered it? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </section>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const reset = useMutation({ mutationFn: () => authApi.resetPassword(token, password) })
  const mismatch = confirm !== '' && confirm !== password

  if (reset.isSuccess) {
    return (
      <section className="content-panel">
        <div className="panel auth-panel">
          <h2>Password changed</h2>
          <p className="success-msg">{reset.data.message}</p>
          <p>
            <Link to="/login">Sign in</Link>
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="content-panel">
      <form
        className="panel auth-panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          if (!mismatch) reset.mutate()
        }}
      >
        <h2>Choose a new password</h2>
        {!token && <p className="error-msg">This link is incomplete. Open it again from the email.</p>}
        <label>
          <span>New password</span>
          <input
            className="input-field"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 10 characters"
            required
          />
        </label>
        <label>
          <span>Confirm new password</span>
          <input
            className="input-field"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            aria-describedby={mismatch ? 'reset-mismatch' : undefined}
            required
          />
        </label>
        {/* Outside the label, so it describes the field rather than renaming it. */}
        {mismatch && (
          <small className="field-error" id="reset-mismatch">
            The two passwords do not match.
          </small>
        )}
        <button className="primary-btn" type="submit" disabled={reset.isPending || mismatch || !token}>
          {reset.isPending ? 'Saving…' : 'Set new password'}
        </button>
        {reset.isError && (
          <p className="error-msg">
            {messageOf(reset.error, 'Could not reset the password.')}{' '}
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        )}
      </form>
    </section>
  )
}

/**
 * A reminder until the address is confirmed. Confirming never blocks using the
 * platform; it is what lets email about requests and sessions reach them.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const resend = useMutation({ mutationFn: () => authApi.resendVerification() })

  return (
    <div className="notice-banner" role="status">
      <span>
        Please confirm your email address — we sent a link to <strong>{email}</strong>.
      </span>
      {resend.isSuccess ? (
        <span>{resend.data.message}</span>
      ) : (
        <button className="link-btn" type="button" disabled={resend.isPending} onClick={() => resend.mutate()}>
          {resend.isPending ? 'Sending…' : 'Send it again'}
        </button>
      )}
      {resend.isError && <span className="error-msg">{messageOf(resend.error, 'Could not send it.')}</span>}
    </div>
  )
}
