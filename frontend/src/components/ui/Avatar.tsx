import { useState } from 'react'

import { apiAssetUrl } from '../../lib/http'

type AvatarProps = {
  name: string
  /** API-relative photo path, or null/undefined for none. */
  url?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

/**
 * A person's photo, or their initials when they have none (DESIGN_BACKLOG #25).
 * Photos are optional (ROADMAP D6), and one that fails to load — removed by a
 * moderator since the page loaded, say — falls back to initials rather than a
 * broken image.
 */
export function Avatar({ name, url, size = 'md', className = '' }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null)
  const showPhoto = Boolean(url) && failed !== url

  return (
    <span className={`avatar avatar-${size} ${className}`.trim()} aria-hidden={showPhoto ? undefined : true}>
      {showPhoto ? (
        <img src={apiAssetUrl(url!)} alt={`${name}'s photo`} onError={() => setFailed(url ?? null)} />
      ) : (
        initialsOf(name)
      )}
    </span>
  )
}
