import { z } from 'zod'

/**
 * Password policy: length is the property that actually resists brute force,
 * so a 10-character minimum with no composition rules beats "8 chars with a
 * symbol" (NIST SP 800-63B guidance). Capped to keep scrypt's work bounded —
 * an unbounded password is a cheap way to make the server do expensive work.
 */
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(200, 'Password must be at most 200 characters.')

const email = z.string().trim().email('Enter a valid email address.').max(254)

export const name = z.string().trim().min(2, 'Name is too short.').max(120)

export const signupSchema = z
  .object({
    name,
    email,
    password,
    // Admin accounts are never self-registerable over the public API; they are
    // created by seed or by another admin.
    role: z.enum(['student', 'alumni']),
    // What an administrator checks an alumnus against. Required for alumni,
    // ignored for students.
    classYear: z
      .string()
      .trim()
      .regex(/^(19|20)\d{2}$/, 'Enter the year you graduated, e.g. 2018.')
      .optional(),
    program: z.string().trim().min(2, 'Enter the programme you studied.').max(160).optional(),
    // DESIGN_BACKLOG #42, #44: an account starts only with explicit agreement
    // to the privacy notice and code of conduct.
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'Please read and accept the privacy notice and code of conduct.' }),
    }),
  })
  .superRefine((input, context) => {
    if (input.role !== 'alumni') return
    if (!input.classYear) {
      context.addIssue({ code: 'custom', path: ['classYear'], message: 'Enter the year you graduated.' })
    }
    if (!input.program) {
      context.addIssue({ code: 'custom', path: ['program'], message: 'Enter the programme you studied.' })
    }
  })

export const loginSchema = z.object({
  email,
  // Deliberately not `password` — login must not leak the policy by rejecting
  // a short password with a validation error before checking credentials.
  password: z.string().min(1, 'Password is required.').max(200),
})

export const tokenSchema = z.object({ token: z.string().trim().min(20).max(200) })

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password,
})

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
