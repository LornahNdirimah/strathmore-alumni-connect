/**
 * The pages behind emailed links, and the verify-your-email banner
 * (DESIGN_BACKLOG #43).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SessionContext } from '../src/app/SessionContext'
import { AuthPage } from '../src/features/auth/AuthPage'
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailBanner,
  VerifyEmailPage,
} from '../src/features/auth/EmailFlows'
import { errorReply, installFakeApi, makeSession } from './helpers/fakeApi'

function renderAt(ui: ReactNode, path = '/') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={null}>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('VerifyEmailPage', () => {
  it('sends the token from the link once, and refreshes the session', async () => {
    const { requests } = installFakeApi({
      'POST /auth/verify-email': { body: { message: 'Thanks — your email address is confirmed.' } },
    })
    const onVerified = vi.fn()
    renderAt(<VerifyEmailPage onVerified={onVerified} />, '/verify-email?token=abcdefghijklmnopqrstuvwxyz')

    expect(await screen.findByText('Thanks — your email address is confirmed.')).toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.body).toEqual({ token: 'abcdefghijklmnopqrstuvwxyz' })
    expect(onVerified).toHaveBeenCalled()
  })

  it('explains an expired link', async () => {
    installFakeApi({
      'POST /auth/verify-email': errorReply(400, 'BAD_REQUEST', 'This link is invalid or has expired. Please request a new one.'),
    })
    renderAt(<VerifyEmailPage onVerified={vi.fn()} />, '/verify-email?token=abcdefghijklmnopqrstuvwxyz')
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument()
  })
})

describe('password reset pages', () => {
  it('asks for a link by email and shows the neutral answer', async () => {
    const { requests } = installFakeApi({
      'POST /auth/forgot-password': { body: { message: 'If an account uses that address, a link is on its way.' } },
    })
    renderAt(<ForgotPasswordPage />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Email'), 'ada@strathmore.edu')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText(/a link is on its way/)).toBeInTheDocument()
    expect(requests[0]?.body).toEqual({ email: 'ada@strathmore.edu' })
  })

  it('sets the new password with the token from the link', async () => {
    const { requests } = installFakeApi({
      'POST /auth/reset-password': { body: { message: 'Your password was changed.' } },
    })
    renderAt(<ResetPasswordPage />, '/reset-password?token=abcdefghijklmnopqrstuvwxyz')
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password')
    await user.type(screen.getByLabelText('Confirm new password'), 'something-else')
    expect(screen.getByRole('button', { name: 'Set new password' })).toBeDisabled()

    await user.clear(screen.getByLabelText('Confirm new password'))
    await user.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-password')
    await user.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByText('Your password was changed.')).toBeInTheDocument()
    expect(requests[0]?.body).toEqual({ token: 'abcdefghijklmnopqrstuvwxyz', password: 'a-brand-new-password' })
  })

  it('offers the way in from the sign-in page', () => {
    installFakeApi({})
    renderAt(<AuthPage mode="login" onAuthenticate={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot-password')
  })
})

describe('VerifyEmailBanner', () => {
  it('resends the link on request', async () => {
    const { requests } = installFakeApi({
      'POST /auth/resend-verification': { body: { message: 'We sent a new link to ada@strathmore.edu.' } },
    })
    renderAt(<VerifyEmailBanner email={makeSession().email} />)

    await userEvent.click(screen.getByRole('button', { name: 'Send it again' }))
    await waitFor(() => expect(screen.getByText('We sent a new link to ada@strathmore.edu.')).toBeInTheDocument())
    expect(requests).toHaveLength(1)
  })
})
