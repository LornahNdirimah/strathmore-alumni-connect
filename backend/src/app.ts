/**
 * Fastify application assembly: security middleware, error handling, routes.
 *
 * Exported as a builder (rather than a module-level singleton) so tests can
 * spin up an isolated instance per suite with its own database.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import { env, isProduction, isTest } from './config/env.js'
import { AUTH_RATE_LIMIT, GLOBAL_RATE_LIMIT } from './config/rate-limits.js'
import { isAppError } from './lib/errors.js'
import { setMailLogger } from './lib/mailer.js'
import { accountRoutes } from './modules/account/account.routes.js'
import { adminRoutes } from './modules/admin/admin.routes.js'
import { alumniRoutes } from './modules/alumni/alumni.routes.js'
import { announcementRoutes } from './modules/announcements/announcements.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { communityRoutes } from './modules/communities/communities.routes.js'
import { contentRoutes } from './modules/content/content.routes.js'
import { eventRoutes } from './modules/events/events.routes.js'
import { feedbackRoutes } from './modules/feedback/feedback.routes.js'
import { healthRoutes } from './modules/health/health.routes.js'
import { mentorRoutes } from './modules/mentors/mentors.routes.js'
import { schedulingRoutes } from './modules/scheduling/scheduling.routes.js'
import { mentorshipRoutes } from './modules/mentorship/mentorship.routes.js'
import { notificationRoutes } from './modules/notifications/notifications.routes.js'
import { officeHourRoutes } from './modules/office-hours/office-hours.routes.js'
import { safetyRoutes } from './modules/safety/safety.routes.js'
import { messagingRoutes } from './modules/messaging/messaging.routes.js'
import { opportunityRoutes } from './modules/opportunities/opportunities.routes.js'
import { seekerRoutes } from './modules/seekers/seekers.routes.js'
import authPlugin from './plugins/auth.js'
import lifecyclePlugin from './plugins/lifecycle.js'
import matchingPlugin from './plugins/matching.js'

export type BuildAppOptions = {
  /** Disables request logging; tests are noisy enough. */
  quiet?: boolean
  /** Overrides the auth-route limit so a test can assert throttling happens. */
  authRateLimit?: { max: number; timeWindow: string }
  /** Serve this built frontend (tests); otherwise decided by SERVE_FRONTEND. */
  webRoot?: string
}

declare module 'fastify' {
  interface FastifyInstance {
    authRateLimit: { max: number; timeWindow: string }
  }
}

/** A caller's own request id is kept only if it looks like one. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/

/** The built frontend to serve, or null when this process is API-only. */
function frontendRoot(): string | null {
  const enabled = env.SERVE_FRONTEND ? env.SERVE_FRONTEND === 'true' : isProduction
  if (!enabled) return null
  const root = resolve(env.FRONTEND_DIST)
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`SERVE_FRONTEND is on but ${root}/index.html does not exist. Run \`npm run build\` first.`)
  }
  return root
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.quiet || isTest ? false : { level: isProduction ? 'info' : 'debug' },
    trustProxy: false,
    bodyLimit: 1024 * 256, // 256 KB — nothing here legitimately posts more
    // Every log line a request writes carries its id (DESIGN_BACKLOG #57). A
    // proxy's X-Request-Id is reused so one id follows the request through.
    requestIdHeader: false,
    genReqId: (request) => {
      const incoming = request.headers['x-request-id']
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID()
    },
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id)
  })

  const webRoot = options.webRoot ?? frontendRoot()

  // --- Security middleware -------------------------------------------------

  await app.register(helmet, {
    // API-only, nothing may load at all. Serving the frontend too, the page
    // may load its own scripts and styles and nothing from elsewhere but the
    // landing photo. Inline style attributes are React's `style={}`.
    contentSecurityPolicy: {
      directives: webRoot
        ? {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
          }
        : { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  })

  await app.register(cors, {
    // Pinned to the known frontend origin. `credentials` is required for the
    // auth cookie to be sent, and the spec forbids pairing that with `*`.
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await app.register(rateLimit, {
    global: true,
    max: GLOBAL_RATE_LIMIT.max,
    timeWindow: GLOBAL_RATE_LIMIT.timeWindow,
    enableDraftSpec: true,
  })

  app.decorate('authRateLimit', options.authRateLimit ?? AUTH_RATE_LIMIT)
  setMailLogger({ info: (msg) => app.log.info(msg), warn: (msg) => app.log.warn(msg) })

  await app.register(authPlugin)
  await app.register(matchingPlugin)
  await app.register(lifecyclePlugin)

  // --- Error handling ------------------------------------------------------

  app.setErrorHandler((rawError, request, reply) => {
    // Narrowing against AppError/ZodError below would otherwise erode the
    // FastifyError type down to `unknown`; keep a typed alias for the
    // framework-shaped fields we still need afterwards.
    const error: unknown = rawError
    const httpError = rawError as { statusCode?: number; code?: string; message?: string }

    if (isAppError(error)) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details ?? undefined },
      })
    }

    // Zod escaping a route without parseOrThrow is a programming error, but
    // report it as a 400 rather than a 500 — the request genuinely was invalid.
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid request.',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
        },
      })
    }

    if (httpError.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      })
    }

    if (httpError.statusCode && httpError.statusCode < 500) {
      return reply.code(httpError.statusCode).send({
        error: {
          code: httpError.code ?? 'BAD_REQUEST',
          message: httpError.message ?? 'Invalid request.',
        },
      })
    }

    // Anything reaching here is a bug. Log it in full, but return nothing that
    // describes our internals — messages can carry SQL, paths, or ids.
    request.log.error({ err: error }, 'Unhandled error')
    return reply.code(500).send({
      // The id lets someone reporting the failure point at its log lines.
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our end.', requestId: request.id },
    })
  })

  app.setNotFoundHandler((request, reply) => {
    // Serving the frontend, any other GET is a page of the app: the browser
    // gets index.html and the client-side router takes it from there.
    const isPage = request.method === 'GET' && !request.url.startsWith('/api/') && request.url !== '/api'
    if (webRoot && isPage) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
    }
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found.` },
    })
  })

  if (webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      // Hashed file names under assets/ never change; everything else is
      // revalidated so a deploy is picked up straight away.
      setHeaders: (reply, path) => {
        reply.header(
          'Cache-Control',
          path.startsWith(join(webRoot, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
      },
    })
  }

  // --- Routes --------------------------------------------------------------

  await app.register(healthRoutes, { prefix: '/api/health' })
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(seekerRoutes, { prefix: '/api/seekers' })
  await app.register(mentorRoutes, { prefix: '/api/mentors' })
  await app.register(mentorshipRoutes, { prefix: '/api/mentorship' })
  await app.register(schedulingRoutes, { prefix: '/api/scheduling' })
  await app.register(communityRoutes, { prefix: '/api/groups' })
  await app.register(messagingRoutes, { prefix: '/api/conversations' })
  await app.register(eventRoutes, { prefix: '/api/events' })
  await app.register(opportunityRoutes, { prefix: '/api/opportunities' })
  await app.register(feedbackRoutes, { prefix: '/api/feedback' })
  await app.register(adminRoutes, { prefix: '/api/admin' })
  await app.register(accountRoutes, { prefix: '/api' })
  await app.register(notificationRoutes, { prefix: '/api/notifications' })
  await app.register(officeHourRoutes, { prefix: '/api/office-hours' })
  await app.register(alumniRoutes, { prefix: '/api/alumni' })
  await app.register(safetyRoutes, { prefix: '/api' })
  await app.register(announcementRoutes, { prefix: '/api/announcements' })
  await app.register(contentRoutes, { prefix: '/api/content' })

  return app
}
