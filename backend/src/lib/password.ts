/**
 * Password hashing on Node's built-in crypto — no bcrypt dependency, no native
 * build step.
 *
 * scrypt is a memory-hard KDF (RFC 7914) and an appropriate choice here. The
 * parameters below follow current OWASP guidance for scrypt: N=2^16, r=8, p=1.
 * Every hash gets its own random salt, and verification is constant-time so the
 * comparison itself leaks nothing about how much of the hash matched.
 */
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'

/**
 * `promisify` resolves to scrypt's 3-argument overload and drops the options
 * parameter, so the tuning below would be silently ignored. Wrapping it by
 * hand keeps the options and the return type honest.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

const SALT_BYTES = 16
const KEY_LENGTH = 64
const SCRYPT_PARAMS = {
  N: 2 ** 16,
  r: 8,
  p: 1,
  // scrypt needs roughly 128 * N * r bytes; Node's default 32 MB cap is below
  // what N=2^16 requires, so raise it or the call throws.
  maxmem: 256 * 1024 * 1024,
} as const

export type PasswordHash = {
  hash: string
  salt: string
}

export async function hashPassword(plaintext: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(plaintext, salt, KEY_LENGTH, SCRYPT_PARAMS)

  return {
    hash: derived.toString('base64'),
    salt: salt.toString('base64'),
  }
}

/**
 * Constant-time verification.
 *
 * Returns false rather than throwing on malformed stored values: a corrupt row
 * should read as "wrong password", not as a 500 that tells an attacker the
 * account exists but is broken.
 */
export async function verifyPassword(
  plaintext: string,
  stored: PasswordHash,
): Promise<boolean> {
  let expected: Buffer
  let salt: Buffer

  try {
    expected = Buffer.from(stored.hash, 'base64')
    salt = Buffer.from(stored.salt, 'base64')
  } catch {
    return false
  }

  if (expected.length !== KEY_LENGTH || salt.length === 0) {
    return false
  }

  const derived = await scrypt(plaintext, salt, KEY_LENGTH, SCRYPT_PARAMS)

  return timingSafeEqual(derived, expected)
}
