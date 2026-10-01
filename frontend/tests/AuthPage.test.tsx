/**
 * Sign-in and sign-up: the server's validation messages must reach the user
 * next to the field they are about, not as a generic failure.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthPage } from '../src/features/auth/AuthPage'
import { errorReply, installFakeApi, makeSession } from './helpers/fakeApi'

function renderAuth(mode: 'login' | 'signup') {
  const onAuthenticate = vi.fn()
  render(
    <MemoryRouter>
      <AuthPage mode={mode} onAuthenticate={onAuthenticate} />
    </MemoryRouter>,
  )
  return { onAuthenticate, user: userEvent.setup() }
}

describe('AuthPage', () => {
  it('signs in with a demo account and hands the session up', async () => {
    const session = makeSession({ email: 'student@demo.com' })
    const { requests } = installFakeApi({ 'POST /auth/login': { body: { user: session } } })
    const { onAuthenticate, user } = renderAuth('login')

    await user.click(screen.getByRole('button', { name: 'Fill student demo' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(onAuthenticate).toHaveBeenCalledWith(session))
    expect(requests[0]?.body).toEqual({ email: 'student@demo.com', password: 'Student123!' })
  })

  it("shows the server's message when sign-in is refused", async () => {
    installFakeApi({
      'POST /auth/login': errorReply(401, 'UNAUTHORIZED', 'Invalid email or password.'),
    })
    const { onAuthenticate, user } = renderAuth('login')

    await user.type(screen.getByPlaceholderText('you@strathmore.edu'), 'a@b.co')
    await user.type(screen.getByPlaceholderText('Enter your password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument()
    expect(onAuthenticate).not.toHaveBeenCalled()
  })

  it('renders per-field validation errors beside the field they belong to', async () => {
    installFakeApi({
      'POST /auth/signup': errorReply(400, 'BAD_REQUEST', 'Invalid request.', [
        { field: 'password', message: 'Password must be at least 10 characters.' },
      ] as never),
    })
    const { user } = renderAuth('signup')

    await user.type(screen.getByPlaceholderText('Jane Doe'), 'Jane Doe')
    await user.type(screen.getByPlaceholderText('you@strathmore.edu'), 'jane@example.com')
    await user.type(screen.getByPlaceholderText('At least 10 characters'), 'short')
    await user.click(screen.getByRole('checkbox', { name: /accept the privacy notice/ }))
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    const fieldError = await screen.findByText('Password must be at least 10 characters.')
    expect(fieldError).toHaveClass('field-error')
  })

  it('asks alumni for the details verification needs, and sends them', async () => {
    const { requests } = installFakeApi({
      'POST /auth/signup': {
        status: 201,
        body: { user: makeSession({ role: 'alumni', status: 'pending', capabilities: [] }) },
      },
    })
    const { user } = renderAuth('signup')

    expect(screen.queryByPlaceholderText('2018')).toBeNull()
    await user.selectOptions(screen.getByRole('combobox'), 'alumni')

    await user.type(screen.getByPlaceholderText('Jane Doe'), 'Grace Wanjiru')
    await user.type(screen.getByPlaceholderText('you@strathmore.edu'), 'grace@example.com')
    await user.type(screen.getByPlaceholderText('2018'), '2015')
    await user.type(screen.getByPlaceholderText('BSc Informatics and Computer Science'), 'BCom')
    await user.type(screen.getByPlaceholderText('At least 10 characters'), 'long-enough-pass')
    await user.click(screen.getByRole('checkbox', { name: /accept the privacy notice/ }))
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.body).toMatchObject({ role: 'alumni', classYear: '2015', program: 'BCom', acceptTerms: true })
  })

  it('does not send verification fields for a student', async () => {
    const { requests } = installFakeApi({
      'POST /auth/signup': { status: 201, body: { user: makeSession() } },
    })
    const { user } = renderAuth('signup')

    await user.type(screen.getByPlaceholderText('Jane Doe'), 'Kevin Otieno')
    await user.type(screen.getByPlaceholderText('you@strathmore.edu'), 'kevin@example.com')
    await user.type(screen.getByPlaceholderText('At least 10 characters'), 'long-enough-pass')
    await user.click(screen.getByRole('checkbox', { name: /accept the privacy notice/ }))
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.body).not.toHaveProperty('classYear')
  })
})
