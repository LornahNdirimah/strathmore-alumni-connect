import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import type { AuthRole } from '../../types/domain.js'
import { groupSchema, visibilitySchema } from './communities.schemas.js'
import * as service from './communities.service.js'

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireIdentity(request: {
    currentUser?: { sub: string; role: AuthRole }
  }): { userId: string; role: AuthRole } {
    const user = request.currentUser
    if (!user) throw new UnauthorizedError()
    return { userId: user.sub, role: user.role }
  }

  app.get('/', { preHandler: app.requireCapability('communities.view') }, async (request) => {
    const { userId, role } = requireIdentity(request)
    return { groups: service.listGroups(db, userId, role) }
  })

  /** Alumni create groups; students join the ones opened to them. */
  app.post('/', { preHandler: app.requireCapability('communities.create') }, async (request, reply) => {
    const { userId } = requireIdentity(request)
    const input = parseOrThrow(groupSchema, request.body, 'group')
    const group = service.createGroup(db, userId, input)

    return reply.code(201).send({ group, message: 'Group created.' })
  })

  app.get('/:groupId', { preHandler: app.requireCapability('communities.view') }, async (request) => {
    const { userId, role } = requireIdentity(request)
    const { groupId } = request.params as { groupId: string }

    const group = service.getGroup(db, groupId, userId, role)
    return { group, resources: service.listResources(db, groupId) }
  })

  app.post('/:groupId/join', { preHandler: app.requireCapability('communities.join') }, async (request) => {
    const { userId, role } = requireIdentity(request)
    const { groupId } = request.params as { groupId: string }

    return { group: service.joinGroup(db, groupId, userId, role), message: 'You joined the group.' }
  })

  app.delete('/:groupId/leave', { preHandler: app.requireCapability('communities.join') }, async (request) => {
    const { userId, role } = requireIdentity(request)
    const { groupId } = request.params as { groupId: string }

    return { group: service.leaveGroup(db, groupId, userId, role), message: 'You left the group.' }
  })

  /**
   * Moderation: an administrator removes a group that should not exist.
   * Admins never join or create groups (see lib/policy.ts); this is the one
   * thing they may do to a community.
   */
  app.delete('/:groupId', { preHandler: app.requireCapability('communities.moderate') }, async (request) => {
    const { groupId } = request.params as { groupId: string }
    const removed = service.removeGroup(db, groupId, request.currentUser!.sub)
    return { message: `“${removed.name}” was removed.` }
  })

  /** DESIGN_BACKLOG #1 — creator-only, checked in the service, not just hidden in the UI. */
  app.patch('/:groupId/visibility', { preHandler: app.requireAuth }, async (request) => {
    const { userId } = requireIdentity(request)
    const { groupId } = request.params as { groupId: string }
    const input = parseOrThrow(visibilitySchema, request.body, 'visibility')

    const group = service.setVisibility(db, groupId, userId, input)
    // replaceAll, not replace: 'open-to-students' has two hyphens and the
    // single-replace form produced "open to-students".
    return { group, message: `Group is now ${group.visibility.replaceAll('-', ' ')}.` }
  })
}
