import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import * as service from './opportunities.service.js'

export async function opportunityRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  /** The feed of open opportunities. */
  app.get('/', { preHandler: app.requireCapability('opportunities.view') }, async (request) => {
    const filters = parseOrThrow(service.feedQuerySchema, request.query, 'filters')
    return { opportunities: service.listOpen(db, requireUserId(request), filters) }
  })

  /** Everything the caller has posted, with applicant counts. */
  app.get('/mine', { preHandler: app.requireCapability('opportunities.post') }, async (request) => ({
    opportunities: service.listMine(db, requireUserId(request)),
  }))

  app.post('/', { preHandler: app.requireCapability('opportunities.post') }, async (request, reply) => {
    const input = parseOrThrow(service.opportunitySchema, request.body, 'opportunity')
    const opportunity = service.post(db, requireUserId(request), input)
    return reply.code(201).send({ opportunity, message: 'Opportunity posted.' })
  })

  app.post(
    '/:opportunityId/close',
    { preHandler: app.requireCapability('opportunities.post') },
    async (request) => {
      const { opportunityId } = request.params as { opportunityId: string }
      const opportunity = service.close(db, requireUserId(request), opportunityId)
      return { opportunity, message: 'Applications are closed.' }
    },
  )

  /** Who applied — visible to the poster only. */
  app.get(
    '/:opportunityId/applications',
    { preHandler: app.requireCapability('opportunities.post') },
    async (request) => {
      const { opportunityId } = request.params as { opportunityId: string }
      return { applicants: service.listApplicants(db, requireUserId(request), opportunityId) }
    },
  )

  app.post(
    '/:opportunityId/apply',
    { preHandler: app.requireCapability('opportunities.apply') },
    async (request, reply) => {
      const { opportunityId } = request.params as { opportunityId: string }
      const input = parseOrThrow(service.applicationSchema, request.body ?? {}, 'application')
      service.apply(db, requireUserId(request), opportunityId, input.message)
      return reply.code(201).send({ message: 'Application submitted.' })
    },
  )
}
