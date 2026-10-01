import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  tokenSchema,
} from './auth.schemas.js'
import {
  getSessionUser,
  login,
  requestPasswordReset,
  resetPassword,
  sendVerification,
  signup,
  verifyEmail,
} from './auth.service.js'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  // Auth endpoints are the prime brute-force target; see config/rate-limits.ts.
  const authRateLimit = { config: { rateLimit: app.authRateLimit } }

  app.post('/signup', authRateLimit, async (request, reply) => {
    const input = parseOrThrow(signupSchema, request.body, 'signup details')
    const user = await signup(db, input)
    // Confirming the address never blocks using the account; the app shows a
    // reminder with a resend button until it is done.
    sendVerification(db, user.id)

    await app.issueSession(reply, {
      sub: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    })

    return reply.code(201).send({
      user,
      message: `Account created for ${user.name}. Welcome to the network.`,
    })
  })

  app.post('/login', authRateLimit, async (request, reply) => {
    const input = parseOrThrow(loginSchema, request.body, 'credentials')
    const user = await login(db, input)

    await app.issueSession(reply, {
      sub: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    })

    const label = `${user.role[0]?.toUpperCase()}${user.role.slice(1)}`
    return reply.send({ user, message: `${label} dashboard ready for access.` })
  })

  // ── Email verification and password reset (DESIGN_BACKLOG #43) ───────────

  /** Public: the link in the email may be opened signed out, or in another browser. */
  app.post('/verify-email', authRateLimit, async (request) => {
    const input = parseOrThrow(tokenSchema, request.body, 'link')
    verifyEmail(db, input.token)
    return { message: 'Thanks — your email address is confirmed.' }
  })

  app.post(
    '/resend-verification',
    { ...authRateLimit, preHandler: app.requireSession },
    async (request) => {
      sendVerification(db, request.currentUser!.sub)
      return { message: `We sent a new link to ${request.currentUser!.email}.` }
    },
  )

  /** Always the same answer, so it cannot reveal whether an account exists. */
  app.post('/forgot-password', authRateLimit, async (request) => {
    const input = parseOrThrow(forgotPasswordSchema, request.body, 'email')
    requestPasswordReset(db, input.email)
    return {
      message: 'If an account uses that address, a link to reset the password is on its way. It works for one hour.',
    }
  })

  app.post('/reset-password', authRateLimit, async (request) => {
    const input = parseOrThrow(resetPasswordSchema, request.body, 'new password')
    await resetPassword(db, input.token, input.password)
    return { message: 'Your password was changed and every device was signed out. Sign in with the new one.' }
  })

  app.post('/logout', async (_request, reply) => {
    app.clearSession(reply)
    return reply.send({ message: 'Signed out.' })
  })

  /**
   * Session rehydration. The frontend calls this on boot instead of reading
   * localStorage — the cookie is httpOnly, so this is the only way for the SPA
   * to learn who it is, and the answer is authoritative rather than
   * client-editable.
   */
  // requireSession rather than requireAuth: a pending alumnus must still be
  // able to learn that they are pending, which is what the client shows them.
  app.get('/me', { preHandler: app.requireSession }, async (request) => {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()

    const user = getSessionUser(db, userId)
    // A token signed for a since-deleted user must not act as a valid session.
    if (!user) throw new UnauthorizedError('Your session is no longer valid.')

    return { user }
  })
}
