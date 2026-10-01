/**
 * Rate-limit policy in one place.
 *
 * Auth endpoints are the credential-stuffing target and carry a tighter limit
 * than the rest of the API. Under NODE_ENV=test the limits are effectively
 * disabled, because suites legitimately fire dozens of signups in a second and
 * would otherwise fail on throttling rather than on behaviour — the limiter
 * itself is covered by its own test, which forces the real values back on.
 */
import { env, isTest } from './env.js'

// RATE_LIMIT_PER_MINUTE raises the general limit where one address stands for
// many users (behind a proxy without trustProxy) or for a browser test run.
export const GLOBAL_RATE_LIMIT = { max: isTest ? 100_000 : env.RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' }
export const AUTH_RATE_LIMIT = { max: isTest ? 100_000 : 10, timeWindow: '1 minute' }

/** Strict values, used when a test needs to assert the limiter actually trips. */
export const STRICT_AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }
