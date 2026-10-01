import { z } from 'zod'

export const groupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  topic: z.string().trim().min(2).max(200),
  description: z.string().trim().min(10).max(2000),
  // DESIGN_BACKLOG #1: alumni-only is the default; opening a group to students
  // is an explicit, deliberate act by its creator.
  visibility: z.enum(['alumni-only', 'open-to-students']).default('alumni-only'),
})

export const visibilitySchema = z.object({
  visibility: z.enum(['alumni-only', 'open-to-students']),
})

export type GroupInput = z.infer<typeof groupSchema>
export type VisibilityInput = z.infer<typeof visibilitySchema>
