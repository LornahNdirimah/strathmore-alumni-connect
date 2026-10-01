import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import * as service from './messaging.service.js'

const sendSchema = z.object({ text: z.string().trim().min(1).max(4000) })
const openSchema = z.object({ participantUserId: z.string().trim().min(1) })

export async function messagingRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  app.get('/', { preHandler: app.requireCapability('messaging.use') }, async (request) => ({
    conversations: service.listConversations(db, requireUserId(request)),
  }))

  app.post('/', { preHandler: app.requireCapability('messaging.use') }, async (request, reply) => {
    const userId = requireUserId(request)
    const input = parseOrThrow(openSchema, request.body, 'conversation')
    const conversationId = service.openConversation(
      db,
      { id: userId, role: request.currentUser!.role },
      input.participantUserId,
    )

    return reply.code(201).send({ conversationId })
  })

  app.get('/:conversationId/messages', { preHandler: app.requireCapability('messaging.use') }, async (request) => {
    const userId = requireUserId(request)
    const { conversationId } = request.params as { conversationId: string }

    return { messages: service.listMessages(db, conversationId, userId) }
  })

  app.post('/:conversationId/messages', { preHandler: app.requireCapability('messaging.use') }, async (request, reply) => {
    const userId = requireUserId(request)
    const { conversationId } = request.params as { conversationId: string }
    const input = parseOrThrow(sendSchema, request.body, 'message')

    const message = service.sendMessage(db, conversationId, userId, input.text)
    return reply.code(201).send({ message })
  })

  app.post('/:conversationId/read', { preHandler: app.requireCapability('messaging.use') }, async (request) => {
    const userId = requireUserId(request)
    const { conversationId } = request.params as { conversationId: string }

    service.markRead(db, conversationId, userId)
    return { message: 'Marked as read.' }
  })
}
