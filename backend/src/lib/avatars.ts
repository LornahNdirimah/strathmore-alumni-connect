/**
 * Profile photo storage (DESIGN_BACKLOG #25).
 *
 * The browser resizes a photo to a small square before uploading it, so what
 * arrives is a few tens of kilobytes; the server stores it as a file next to the
 * database rather than as a BLOB, keeping the database small and letting the
 * photo be streamed.
 *
 * The server does not decode images (that would mean a native dependency such
 * as sharp, which this project avoids). Instead it trusts nothing the client
 * *says* about the file: the type is read from the file's own leading bytes,
 * must be JPEG, PNG or WebP, and must agree with the declared type; the size is
 * capped; and the file name is generated here, never taken from the request.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { env } from '../config/env.js'
import { BadRequestError } from './errors.js'

export const MAX_AVATAR_BYTES = 300 * 1024

export type AvatarType = 'image/jpeg' | 'image/png' | 'image/webp'

const EXTENSIONS: Record<AvatarType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Uploads live beside the database, so a test's temporary database gets its own. */
export function avatarDirectory(): string {
  const base =
    env.DATABASE_PATH === ':memory:' ? tmpdir() : dirname(resolve(env.DATABASE_PATH))
  return join(base, 'uploads', 'avatars')
}

/** The image type the bytes themselves declare, or null if not an allowed one. */
export function sniffImageType(bytes: Buffer): AvatarType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

/** Decodes a `data:image/...;base64,...` URL into checked image bytes. */
export function decodeAvatarDataUrl(dataUrl: string): { bytes: Buffer; type: AvatarType } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new BadRequestError('Upload a JPEG, PNG or WebP image.')

  const declared = match[1] as AvatarType
  const bytes = Buffer.from(match[2]!, 'base64')

  if (bytes.length === 0) throw new BadRequestError('That image is empty.')
  if (bytes.length > MAX_AVATAR_BYTES) {
    throw new BadRequestError('That image is too large. Choose a smaller photo.')
  }

  const actual = sniffImageType(bytes)
  if (!actual || actual !== declared) {
    throw new BadRequestError('That file is not the image type it claims to be.')
  }

  return { bytes, type: actual }
}

/** Writes the photo and returns its generated file name. */
export function storeAvatar(userId: string, bytes: Buffer, type: AvatarType): string {
  const directory = avatarDirectory()
  mkdirSync(directory, { recursive: true })

  // The user id is ours, not the request's, but keep the name to a safe
  // alphabet regardless: it becomes a path.
  const safeId = userId.replace(/[^A-Za-z0-9_-]/g, '')
  const fileName = `${safeId}-${randomUUID()}.${EXTENSIONS[type]}`
  writeFileSync(join(directory, fileName), bytes)
  return fileName
}

/** Full path for a stored file name; basename() keeps it inside the directory. */
export function avatarFilePath(fileName: string): string {
  return join(avatarDirectory(), basename(fileName))
}

export function deleteAvatarFile(fileName: string | null): void {
  if (!fileName) return
  rmSync(avatarFilePath(fileName), { force: true })
}

export function contentTypeFor(fileName: string): AvatarType {
  if (fileName.endsWith('.png')) return 'image/png'
  if (fileName.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

/**
 * The URL a client loads the photo from, or null for no photo. Versioned by the
 * update time so a replaced photo is never served from a stale cache.
 */
export function avatarUrl(userId: string, updatedAt: string | null | undefined): string | null {
  if (!updatedAt) return null
  return `/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(updatedAt)}`
}
