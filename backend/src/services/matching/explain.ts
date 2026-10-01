/**
 * Why a mentor was suggested (DESIGN_BACKLOG #37), in words a student reads.
 *
 * The engine ranks on encoded features — track, major, hobbies, location — and
 * returns only a score. Showing the overlaps behind it makes a suggestion easy
 * to trust or dismiss, and makes a bad match obvious to whoever is looking.
 * The comparison is deliberately plain (case-insensitive equality) so each
 * reason is literally true.
 */

export type MatchSubject = {
  targetTrack: string | null
  major: string | null
  interests: string[]
  hobbies: string[]
  country: string | null
  stateProvince: string | null
}

export type MatchCandidate = {
  tracks: string[]
  skills: string[]
  major: string | null
  hobbies: string[]
  country: string | null
  stateProvince: string | null
}

const MAX_REASONS = 3

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** Items of `mine` that also appear in `theirs`, keeping `theirs`' spelling. */
function overlap(mine: string[], theirs: string[]): string[] {
  const wanted = new Set(mine.map(norm).filter(Boolean))
  return theirs.filter((item) => wanted.has(norm(item)))
}

export function explainMatch(student: MatchSubject, mentor: MatchCandidate): string[] {
  const reasons: string[] = []

  const track = student.targetTrack && mentor.tracks.find((item) => norm(item) === norm(student.targetTrack))
  if (track) reasons.push(`Mentors in ${track}`)

  if (norm(student.major) && norm(student.major) === norm(mentor.major)) {
    reasons.push(`Also studied ${mentor.major}`)
  }

  // A skill named the same as the track ("Software Engineering") would only
  // repeat the first reason.
  const sharedSkills = overlap(student.interests, mentor.skills).filter(
    (skill) => !track || norm(skill) !== norm(track),
  )
  if (sharedSkills.length > 0) reasons.push(`Works with ${sharedSkills.slice(0, 2).join(' and ')}`)

  const sharedHobbies = overlap(student.hobbies, mentor.hobbies)
  if (sharedHobbies.length > 0) reasons.push(`You both enjoy ${sharedHobbies.slice(0, 2).join(' and ')}`)

  if (norm(student.stateProvince) && norm(student.stateProvince) === norm(mentor.stateProvince)) {
    reasons.push(`Also based in ${mentor.stateProvince}`)
  } else if (norm(student.country) && norm(student.country) === norm(mentor.country)) {
    reasons.push(`Also in ${mentor.country}`)
  }

  return reasons.slice(0, MAX_REASONS)
}
