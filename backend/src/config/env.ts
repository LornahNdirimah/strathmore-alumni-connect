/**
 * Environment configuration, validated once at boot.
 *
 * Fails fast and loudly: a missing or weak JWT_SECRET is a security defect, not
 * something to paper over with a generated default that silently changes on
 * every restart (which would invalidate every issued session). The one
 * exception is the test environment, which gets a fixed throwaway secret so
 * suites don't need a .env file.
 */
import { z } from 'zod'

import { loadDotEnv } from './dotenv.js'

// Before the schema reads process.env. Real environment variables still win, so
// this only fills in what the shell didn't provide.
loadDotEnv()

const MIN_SECRET_LENGTH = 32

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().min(1).default('127.0.0.1'),
  JWT_SECRET: z
    .string()
    .min(MIN_SECRET_LENGTH, `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().min(1).default('./data/app.db'),
  PYTHON_BIN: z.string().min(1).default('python3'),
  ML_ENGINE_DIR: z.string().min(1).default('../ml-matching/MachineLearning'),
  ML_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // --- Email (lib/mailer.ts) ---
  // 'smtp' sends through SMTP_HOST — in development that is Mailpit, a local
  // test inbox on port 1025 whose web page shows every message. 'console'
  // prints messages to the API log instead; 'memory' keeps them for tests.
  MAIL_TRANSPORT: z.enum(['smtp', 'console', 'memory']).default('smtp'),
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().min(3).default('Strathmore Alumni Connect <no-reply@alumni-connect.local>'),
  /** Where links in emails point: the frontend's public address. */
  APP_URL: z.string().url().optional(),

  // --- Single origin (DESIGN_BACKLOG #53) ---
  // When on, the API also serves the built frontend, so the site is one
  // process on one origin. Defaults to on in production.
  SERVE_FRONTEND: z.enum(['true', 'false']).optional(),
  FRONTEND_DIST: z.string().min(1).default('../frontend/dist'),

  /** Requests per minute per address, outside sign-in (which stays at 10). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),

  // --- Backups (npm run db:backup) ---
  BACKUP_DIR: z.string().min(1).optional(),
  BACKUP_KEEP: z.coerce.number().int().min(1).default(14),
})

export type Env = z.infer<typeof envSchema>

/** A deterministic, obviously-not-production secret used only under NODE_ENV=test. */
const TEST_ONLY_SECRET = 'test-only-secret-not-for-production-use-0123456789'

function loadEnv(): Env {
  const source: Record<string, string | undefined> = { ...process.env }

  if (source.NODE_ENV === 'test' && !source.JWT_SECRET) {
    source.JWT_SECRET = TEST_ONLY_SECRET
  }
  // Tests never send real email, whatever a developer's .env says.
  if (source.NODE_ENV === 'test') source.MAIL_TRANSPORT = 'memory'

  const parsed = envSchema.safeParse(source)

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        'Copy backend/.env.example to backend/.env and fill in the missing values.\n' +
        'Generate a JWT_SECRET with:\n' +
        '  node -e "console.log(require(\'node:crypto\').randomBytes(48).toString(\'base64url\'))"',
    )
  }

  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET === TEST_ONLY_SECRET) {
    throw new Error('Refusing to start in production with the test JWT_SECRET.')
  }

  return parsed.data
}

export const env = loadEnv()

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
