/**
 * Who may do what — the platform's role model in one place.
 *
 * Every access rule that depends on *who the caller is* is expressed here as a
 * capability, and nowhere else. Routes guard on capabilities
 * (`app.requireCapability`), and `/auth/me` sends the caller's list to the
 * client, which builds its navigation and buttons from the same list. The UI
 * and the API therefore cannot disagree about what a role is allowed to do:
 * previously some rules were route guards, some were hidden buttons, and some
 * existed nowhere.
 *
 * Ownership rules ("only this mentorship's participants", "only the group's
 * creator") stay in the services — they depend on the record, not the role.
 *
 * The roles, as decided:
 *   - Students are mentored: they request mentorship and join communities open
 *     to students.
 *   - Alumni may mentor or not; they join and create alumni communities.
 *   - Admins verify alumni, manage users, publish announcements and run
 *     events. They take no part in mentorship, messaging or communities, except
 *     to remove a community that should not exist.
 *   - Anyone whose account is not active (an alumnus awaiting verification)
 *     has no capabilities at all.
 */
import type { AuthRole, UserStatus } from '../types/domain.js'

// The list itself is part of the API contract, which the client shares.
export { CAPABILITIES, type Capability } from '../contract/index.js'
import { CAPABILITIES, type Capability } from '../contract/index.js'

export type PolicySubject = {
  role: AuthRole
  status: UserStatus
  /** Whether this user has a mentor profile. Only meaningful for alumni. */
  isMentor: boolean
}

export function capabilitiesFor(subject: PolicySubject): Capability[] {
  if (subject.status !== 'active') return []

  switch (subject.role) {
    case 'student':
      return [
        'mentors.browse',
        'mentorship.request',
        'mentorship.participate',
        'opportunities.view',
        'opportunities.apply',
        'communities.view',
        'communities.join',
        'messaging.use',
        'events.view',
        'events.register',
      ]

    case 'alumni':
      return [
        'mentors.browse',
        subject.isMentor ? 'mentorship.mentor' : 'mentorship.become-mentor',
        'mentorship.participate',
        'opportunities.view',
        'opportunities.post',
        'communities.view',
        'communities.join',
        'communities.create',
        'alumni.directory',
        'messaging.use',
        'events.view',
        'events.register',
      ]

    case 'admin':
      return ['admin.manage', 'communities.view', 'communities.moderate', 'events.view', 'events.manage']
  }
}

export function can(subject: PolicySubject, capability: Capability): boolean {
  return capabilitiesFor(subject).includes(capability)
}
