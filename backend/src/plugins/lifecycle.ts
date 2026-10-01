/**
 * Runs the mentorship lifecycle sweep: expiring unanswered requests, closing
 * mentorships whose term has run out, and sending session reminders
 * (modules/mentorship/mentorship.service.ts).
 *
 * Once at startup, so a server that was down catches up, then every fifteen
 * minutes — often enough that a session booked for this afternoon is still
 * reminded ahead of time. Nothing here is time-critical to the minute, so an
 * in-process timer is enough, and it needs no scheduler to install or
 * supervise.
 */
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

import { isTest } from '../config/env.js'
import { getDatabase } from '../db/connection.js'
import { runLifecycleSweep } from '../modules/mentorship/mentorship.service.js'

const SWEEP_INTERVAL_MS = 15 * 60 * 1000

async function lifecyclePlugin(app: FastifyInstance): Promise<void> {
  // Tests call runLifecycleSweep directly with a chosen "now"; a background
  // timer would only make them nondeterministic.
  if (isTest) return

  const sweep = () => {
    try {
      const result = runLifecycleSweep(getDatabase())
      if (result.expiredRequests > 0 || result.endedMentorships > 0 || result.remindersSent > 0) {
        app.log.info(result, '[lifecycle] sweep')
      }
    } catch (error) {
      app.log.error({ err: error }, '[lifecycle] sweep failed')
    }
  }

  app.addHook('onReady', async () => sweep())

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
  timer.unref()
  app.addHook('onClose', async () => clearInterval(timer))
}

export default fp(lifecyclePlugin, { name: 'lifecycle' })
