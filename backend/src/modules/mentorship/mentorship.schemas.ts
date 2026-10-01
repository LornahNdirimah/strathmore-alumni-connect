import { z } from 'zod'

import { isoInstant } from '../scheduling/scheduling.schemas.js'

export const requestSchema = z.object({
  mentorProfileId: z.string().trim().min(1),
  interest: z.string().trim().min(2, 'Tell the mentor what you want help with.').max(200),
  /**
   * The human label for the requested time, shown in the mentor's inbox.
   * Derived from preferredSlotAt when a slot was picked; still accepted on its
   * own so a student can ask for mentorship without committing to a time.
   */
  preferredSlot: z.string().trim().min(1).max(120),
  /**
   * The machine-readable version of the same moment. When present and still
   * free, accepting the request books the first session automatically — which is
   * what makes "requested Wednesday 5:30pm" mean something rather than being a
   * note nobody acts on.
   */
  preferredSlotAt: isoInstant().optional(),
  message: z.string().trim().min(10, 'Add a short note so the mentor can decide.').max(2000),
})

export const respondSchema = z.object({
  status: z.enum(['accepted', 'declined']),
  notes: z.string().trim().max(2000).optional(),
})


export const endSchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

export const checkInSchema = z.object({
  progress: z.enum(['on-track', 'needs-attention']),
  note: z.string().trim().max(1000).optional(),
})

export const goalSchema = z.object({
  title: z.string().trim().min(3, 'Describe the goal in a few words.').max(200),
})

export const goalUpdateSchema = z.object({ completed: z.boolean() })

export type CheckInInput = z.infer<typeof checkInSchema>
export type RequestInput = z.infer<typeof requestSchema>
export type RespondInput = z.infer<typeof respondSchema>
