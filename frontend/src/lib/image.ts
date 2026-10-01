/**
 * Prepares a profile photo in the browser before it is uploaded.
 *
 * Phone photos are several megabytes; an avatar needs a few kilobytes. Resizing
 * here keeps the upload small and means the server never has to decode images
 * (which would need a native dependency). The server still checks what arrives.
 */

export const AVATAR_SIZE = 256
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_INPUT_BYTES = 15 * 1024 * 1024

export class ImageError extends Error {}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageError('That file could not be read as an image.'))
    }
    image.src = url
  })
}

/**
 * Centre-crops `file` to a square and scales it to AVATAR_SIZE, returning a
 * data URL. WebP where the browser can encode it, JPEG otherwise — a browser
 * that cannot encode WebP silently returns PNG from toDataURL, which would be
 * far larger, so the result is checked rather than assumed.
 */
export async function prepareAvatar(file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) {
    throw new ImageError('Choose a JPEG, PNG or WebP photo.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageError('That photo is over 15 MB. Choose a smaller one.')
  }

  const image = await loadImage(file)
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  if (side === 0) throw new ImageError('That image is empty.')

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new ImageError('Your browser could not process the photo.')

  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  )

  const webp = canvas.toDataURL('image/webp', 0.85)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85)
}
