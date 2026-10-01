import { z } from 'zod'

import { TRACKS } from '../../types/domain.js'

const trackEnum = z.enum(TRACKS)

export const mentorSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(120).optional(),
  track: trackEnum.optional(),
  // Query strings arrive as text, so coerce rather than expecting a real boolean.
  available: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  // Bounded so a client cannot ask for the entire table in one request.
  limit: z.coerce.number().int().min(1).max(100).default(24),
})

export const mentorProfileSchema = z.object({
  headline: z.string().trim().min(2).max(160),
  company: z.string().trim().min(1).max(160),
  industry: z.string().trim().min(1).max(120),
  location: z.string().trim().min(1).max(160),
  bio: z.string().trim().max(2000).optional(),
  /**
   * DESIGN_BACKLOG #2: capacity is self-reported per mentor. Capped at 20 —
   * well above any realistic mentoring load, low enough that a typo'd extra
   * zero can't flood one mentor with assignments.
   */
  capacity: z.coerce.number().int().min(0).max(20),
  availability: z.enum(['Available', 'Busy']).default('Available'),
  cadence: z.enum(['weekly', 'biweekly', 'as-needed']).optional(),
  formatPreference: z.enum(['virtual', 'in-person', 'either']).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  tracks: z.array(trackEnum).min(1, 'Choose at least one track you can mentor in.').max(8),

  // Feature fields the matching engine reads. Collected on the join form
  // because without them a mentor can be stored but never vectorised, and so
  // would silently never appear in anyone's recommendations.
  major: z.string().trim().min(1).max(120),
  hobbies: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  uniqueQuality: z.string().trim().max(200).default(''),
  country: z.string().trim().max(80).default(''),
  stateProvince: z.string().trim().max(80).default(''),
})

export const mentorProfileUpdateSchema = mentorProfileSchema.partial()

export const recommendationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  track: trackEnum.optional(),
  formatPreference: z.enum(['virtual', 'in-person', 'either']).optional(),
})

export type MentorSearchQuery = z.infer<typeof mentorSearchQuerySchema>
export type MentorProfileInput = z.infer<typeof mentorProfileSchema>
export type RecommendationQuery = z.infer<typeof recommendationQuerySchema>
