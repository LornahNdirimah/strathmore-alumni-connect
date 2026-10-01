/**
 * Authentication plugin: JWT issuing/verification plus the route guards.
 *
 * The token lives in an httpOnly, SameSite=Lax cookie rather than
 * localStorage. The mock frontend kept an unsigned session JSON blob in
 * localStorage, which meant (a) any XSS could read it and (b) a user could
 * simply edit `{"role":"admin"}` and become an admin. httpOnly closes (a)
 * because script can't read the cookie, and signing closes (b) because the
 * server verifies the signature on every request and never trusts a
 * client-supplied role.
 */
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

import { env, isProduction } from '../config/env.js'
import { getDatabase } from '../db/connection.js'
import { queryOne } from '../db/repository.js'
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js'
import { type Capability, can } from '../lib/policy.js'
import { CURRENT_TERMS_VERSION } from '../lib/terms.js'
import type { AuthRole, UserStatus } from '../types/domain.js'

export const AUTH_COOKIE_NAME = 'mentorship_token'
const TOKEN_TTL_SECONDS = 60 * 60 * 12 // 12h — long enough for a demo session

export type AuthTokenPayload = {
  sub: string
  role: AuthRole
  name: string
  email: string
  /**
   * The account's session_version when this token was issued. A password
   * change bumps the stored version, which invalidates every earlier token.
   * Absent on tokens issued before versions existed, and read as 0.
   */
  ver?: number
}

/**
 * The caller as the database describes them *now*, not as the token did when
 * it was issued. Role and status come from the users row on every request, so
 * suspending an account or approving an alumnus takes effect immediately rather
 * than when a 12-hour token happens to expire.
 */
export type Principal = AuthTokenPayload & {
  status: UserStatus
  isMentor: boolean
  /** Whether the current privacy notice and code of conduct are accepted. */
  termsAccepted: boolean
}

declare module 'fastify' {
  interface FastifyInstance {
    /** A valid session for an existing, non-suspended account — pending included. */
    requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /** A valid session for an *active* account. The default guard. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /** Active account holding one of `roles`. */
    requireRole: (
      ...roles: AuthRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /** Active account granted `capability` by lib/policy.ts. */
    requireCapability: (
      capability: Capability,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    issueSession: (reply: FastifyReply, payload: AuthTokenPayload) => Promise<void>
    clearSession: (reply: FastifyReply) => void
  }

  interface FastifyRequest {
    currentUser?: Principal
  }
}

type PrincipalRow = {
  id: string
  name: string
  email: string
  role: AuthRole
  status: UserStatus
  session_version: number
  terms_version: string | null
  deleted_at: string | null
  is_mentor: number
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  await app.register(cookie)

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: AUTH_COOKIE_NAME, signed: false },
    sign: { expiresIn: TOKEN_TTL_SECONDS },
  })

  app.decorate('requireSession', async (request: FastifyRequest) => {
    let token: AuthTokenPayload
    try {
      // Reads the token from the cookie (configured above). A tampered or
      // expired token fails signature verification here.
      token = await request.jwtVerify<AuthTokenPayload>()
    } catch {
      throw new UnauthorizedError('You must be signed in to do that.')
    }

    const row = queryOne<PrincipalRow>(
      getDatabase(),
      `SELECT u.id, u.name, u.email, u.role, u.status, u.session_version, u.terms_version, u.deleted_at,
              EXISTS (SELECT 1 FROM mentor_profiles mp WHERE mp.user_id = u.id) AS is_mentor
       FROM users u WHERE u.id = ?`,
      [token.sub],
    )

    // A token for a deleted or suspended account is not a session.
    if (!row || row.deleted_at) throw new UnauthorizedError('Your session is no longer valid.')
    if (row.status === 'suspended') throw new UnauthorizedError('This account has been suspended.')
    if ((token.ver ?? 0) !== row.session_version) {
      throw new UnauthorizedError('Your password was changed. Please sign in again.')
    }

    request.currentUser = {
      sub: row.id,
      role: row.role,
      name: row.name,
      email: row.email,
      status: row.status,
      isMentor: row.is_mentor === 1,
      termsAccepted: row.terms_version === CURRENT_TERMS_VERSION,
    }
  })

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireSession(request, reply)

    if (request.currentUser?.status !== 'active') {
      throw new ForbiddenError(
        'Your account is waiting for verification. You will get access once an administrator approves it.',
      )
    }
    // Enforced here, not only by the UI's consent screen: nothing but the
    // account routes (which use requireSession) works until it is accepted.
    if (!request.currentUser.termsAccepted) {
      throw new ForbiddenError('Please accept the updated privacy notice and code of conduct to continue.')
    }
  })

  app.decorate(
    'requireRole',
    (...roles: AuthRole[]) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        await app.requireAuth(request, reply)

        const role = request.currentUser?.role
        if (!role || !roles.includes(role)) {
          throw new ForbiddenError('Your account role does not permit this action.')
        }
      },
  )

  app.decorate(
    'requireCapability',
    (capability: Capability) => async (request: FastifyRequest, reply: FastifyReply) => {
      await app.requireAuth(request, reply)

      if (!request.currentUser || !can(request.currentUser, capability)) {
        throw new ForbiddenError('Your account does not permit this action.')
      }
    },
  )

  app.decorate('issueSession', async (reply: FastifyReply, payload: AuthTokenPayload) => {
    // Stamped here rather than by each caller, so no path can issue a token
    // that ignores the current version.
    const version = queryOne<{ session_version: number }>(
      getDatabase(),
      'SELECT session_version FROM users WHERE id = ?',
      [payload.sub],
    )
    const token = await reply.jwtSign({ ...payload, ver: version?.session_version ?? 0 })

    reply.setCookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      // Lax is correct for a same-site SPA: it still sends the cookie on
      // top-level navigations while blocking it on cross-site subrequests.
      sameSite: 'lax',
      // Secure would break plain-http://localhost, so it tracks the environment.
      secure: isProduction,
      path: '/',
      maxAge: TOKEN_TTL_SECONDS,
    })
  })

  app.decorate('clearSession', (reply: FastifyReply) => {
    reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' })
  })
}

export default fp(authPlugin, { name: 'auth' })
