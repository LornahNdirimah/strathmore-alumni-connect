import { z } from 'zod'

import { SUPPORT_OPTIONS, TRACKS } from '../../types/domain.js'

/**
 * The student career-goals form (DESIGN_BACKLOG #3, #5).
 *
 * Submitting this is what opts a student into the mentorship programme —
 * every field here is either a matching feature or a hard filter, which is why
 * the form is the access gate rather than a profile nicety.
 */
export const seekerSchema = z.object({
  major: z.string().trim().min(1).max(120),
  year: z.string().trim().min(1).max(40),
  targetTrack: z.enum(TRACKS),
  careerGoalText: z
    .string()
    .trim()
    .min(20, 'Describe your goal in a sentence or two so mentors can self-select.')
    .max(1500),
  preferredCadence: z.enum(['weekly', 'biweekly', 'as-needed']),
  formatPreference: z.enum(['virtual', 'in-person', 'either']),
  requestedSupport: z.array(z.enum(SUPPORT_OPTIONS)).min(1, 'Pick at least one kind of support.').max(4),
  interests: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  skillTags: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  hobbies: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  uniqueQuality: z.string().trim().max(200).default(''),
  country: z.string().trim().max(80).default(''),
  stateProvince: z.string().trim().max(80).default(''),
})

export const seekerUpdateSchema = seekerSchema.partial()

export type SeekerInput = z.infer<typeof seekerSchema>
