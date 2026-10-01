/**
 * Database seed: curated demo content first, then a sampled ML population.
 *
 * Two audiences are being served at once. The curated half (three known logins,
 * the four hand-written mentors, the groups and events) keeps every screen
 * looking exactly as designed and gives a demo a predictable script. The bulk
 * half loads a few hundred mentors and students drawn from the engine's own
 * 23k-record population, so retrieval, capacity limits and MMR diversification
 * have something real to work on — matching over four mentors proves nothing.
 *
 * Idempotent: it clears the tables it owns before inserting, so re-running is
 * safe and produces the same result.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { env } from '../../config/env.js'
import { newId } from '../../lib/id.js'
import { hashPassword } from '../../lib/password.js'
import { isMainModule } from '../../lib/main-module.js'
import { CURRENT_TERMS_VERSION } from '../../lib/terms.js'
import { nowIso, offsetMinutesFor } from '../../lib/time.js'
import { type Database, getDatabase, transaction } from '../connection.js'
import { execute } from '../repository.js'
import { runMigrations } from '../migrate.js'

const seedDir = dirname(fileURLToPath(import.meta.url))

type CuratedMentor = {
  id: number
  name: string
  role: string
  company: string
  industry: string
  availability: 'Available' | 'Busy'
  skills: string[]
  location: string
  bio?: string
  certifications?: string[]
  timeline?: Array<{ year: string; title: string; org: string; description?: string }>
  postedOpportunities?: Array<{ id: string; title: string; type: string; postedAt: string }>
}

type Curated = {
  users: Array<{ id: string; name: string; email: string; password: string; role: string; status: string }>
  students: Array<Record<string, unknown>>
  mentors: CuratedMentor[]
  collaborationGroups: Array<{
    id: string
    name: string
    topic: string
    description: string
    members: string[]
    createdBy: string
    createdAt: string
    resources: Array<{ title: string; url?: string }>
  }>
  events: Array<{
    id: string
    title: string
    date: string
    time: string
    location: string
    type: string
    tag: string
    description: string
  }>
  verificationQueue: Array<{ id: string; name: string; classYear: string; program: string; status: string }>
  announcements: Array<{ id: string; title: string; audience: string; body: string }>
}

type MlPerson = {
  person_id: string
  Name: string
  Major: string
  Hobbies: string[]
  Country: string
  'State/Province': string
  'Unique Quality': string
  Year: string
}

type MlAlumnus = MlPerson & {
  capacity: number
  mentor_tracks: string[]
  availability_cadence: string
  format_preference: string
}

type MlStudent = MlPerson & {
  target_track: string
  career_goal_text: string
  preferred_cadence: string
  format_preference: string
  requested_support: string[]
}

type MlPayload = {
  meta: { seed: number; alumni: number; students: number }
  alumni: MlAlumnus[]
  students: MlStudent[]
}

/** Maps an industry onto one of the eight tracks, for curated mentors. */
const INDUSTRY_TO_TRACK: Record<string, string> = {
  Technology: 'Data Science',
  Telecommunications: 'Software Engineering',
  'Design & Tech': 'Product Design',
  'Agriculture & Tech': 'Entrepreneurship',
}

/** Minutes past midnight for a '6:00 PM' style wall-clock time. */
function parseClockTime(value: string): number | null {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(value)
  if (!match) return null

  let hours = Number(match[1])
  const minutes = Number(match[2])
  const meridiem = match[3]?.toUpperCase()

  if (meridiem === 'PM' && hours !== 12) hours += 12
  if (meridiem === 'AM' && hours === 12) hours = 0

  return hours * 60 + minutes
}

/**
 * Parses the curated events' display strings ('October 15, 2026',
 * '6:00 PM EAT', '9:00 AM – 4:00 PM') into the ISO timestamps the schema stores.
 * This conversion only exists because the mock data was authored as display text.
 *
 * Two details the display strings make easy to get wrong:
 *
 *   - a time range carries an end time, which belongs in `ends_at` rather than
 *     being discarded;
 *   - the trailing token is only a timezone if it isn't the range's own meridiem.
 *     Matching [A-Z]{2,4} at the end of '9:00 AM – 4:00 PM' otherwise captures
 *     'PM' as the zone label, and the event then renders as '9:00 AM PM'.
 */
function parseDisplayDateTime(
  date: string,
  time: string,
): { iso: string; endIso: string | null; tz: string } {
  const trimmed = time.trim()

  // Split on an en dash, em dash, hyphen or the word 'to'.
  const [startPart, endPart] = trimmed.split(/\s*(?:[–—-]|\bto\b)\s*/i)

  const trailing = /([A-Z]{2,4})\s*$/.exec(trimmed)?.[1]
  const tz = trailing && !['AM', 'PM'].includes(trailing) ? trailing : 'EAT'

  const startMinutes = parseClockTime(startPart ?? '') ?? 9 * 60
  const endMinutes = endPart ? parseClockTime(endPart) : null

  const parsedDate = new Date(`${date} UTC`)
  if (Number.isNaN(parsedDate.getTime())) {
    return { iso: nowIso(), endIso: null, tz }
  }

  const start = new Date(parsedDate)
  start.setUTCHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0)

  let endIso: string | null = null
  if (endMinutes !== null && endMinutes > startMinutes) {
    const end = new Date(parsedDate)
    end.setUTCHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0)
    endIso = end.toISOString()
  }

  return { iso: start.toISOString(), endIso, tz }
}

const TABLES_TO_CLEAR = [
  'office_hour_bookings', 'office_hours', 'session_ratings', 'mentorship_goals',
  'reports', 'user_blocks', 'email_tokens', 'notifications', 'admin_audit', 'relationship_checkins', 'mentor_availability',
  'opportunity_applications', 'mentor_opportunities', 'mentor_timeline',
  'mentor_certifications', 'mentor_skills', 'mentor_tracks', 'feedback', 'sessions',
  'mentorship_relationships', 'mentorship_requests', 'match_events', 'messages',
  'conversation_participants', 'conversations', 'group_resources', 'group_members',
  'groups', 'event_registrations', 'events', 'announcements', 'alumni_verifications',
  'mentorship_seekers', 'mentor_profiles', 'users',
]

function clearAll(db: Database): void {
  db.exec('PRAGMA foreign_keys = OFF')
  for (const table of TABLES_TO_CLEAR) db.exec(`DELETE FROM ${table}`)
  db.exec('PRAGMA foreign_keys = ON')
}

async function insertUser(
  db: Database,
  user: { id: string; name: string; email: string; password: string; role: string; status: string },
): Promise<void> {
  // Demo passwords are hashed like any other. The mock shipped them in
  // plaintext inside the JS bundle; nothing here should reproduce that.
  const { hash, salt } = await hashPassword(user.password)
  const timestamp = nowIso()

  execute(
    db,
    `INSERT INTO users (id, name, email, password_hash, password_salt, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.name, user.email.toLowerCase(), hash, salt, user.role, user.status, timestamp, timestamp],
  )
}

function insertMentorProfile(
  db: Database,
  input: {
    id: string
    userId: string
    headline: string
    company: string
    industry: string
    location: string
    bio: string | null
    capacity: number
    availability: string
    cadence: string | null
    formatPref: string | null
    mlPersonId: string | null
    major: string
    hobbies: string[]
    uniqueQuality: string
    country: string
    stateProvince: string
    tracks: string[]
    skills: string[]
  },
): void {
  const timestamp = nowIso()

  execute(
    db,
    `INSERT INTO mentor_profiles
       (id, user_id, headline, company, industry, location, bio, capacity, availability,
        cadence, format_pref, ml_person_id, major, hobbies, unique_quality, country,
        state_province, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id, input.userId, input.headline, input.company, input.industry, input.location,
      input.bio, input.capacity, input.availability, input.cadence, input.formatPref,
      input.mlPersonId, input.major, JSON.stringify(input.hobbies), input.uniqueQuality,
      input.country, input.stateProvince, timestamp, timestamp,
    ],
  )

  for (const track of input.tracks) {
    execute(db, 'INSERT OR IGNORE INTO mentor_tracks (mentor_profile_id, track) VALUES (?, ?)', [
      input.id,
      track,
    ])
  }
  for (const skill of input.skills) {
    execute(db, 'INSERT OR IGNORE INTO mentor_skills (mentor_profile_id, skill) VALUES (?, ?)', [
      input.id,
      skill,
    ])
  }

  seedAvailability(db, input.id, input.availability, timestamp)
}

/**
 * Weekly availability windows, so a seeded mentor is actually bookable.
 *
 * Without these the booking UI has nothing to offer and the feature reads as
 * broken on a fresh demo database. The patterns differ per mentor so the slot
 * picker shows something other than the same grid for everyone; a mentor marked
 * 'Busy' gets a single narrow window, which is what being busy should look like
 * rather than having no schedule at all.
 *
 * Times are minutes from UTC midnight, matching the schema. Weekday numbering
 * follows Date#getUTCDay(): 0 = Sunday.
 */
const AVAILABILITY_PATTERNS: Array<Array<[day: number, startHour: number, endHour: number]>> = [
  [[2, 17, 19], [4, 17, 19]],            // Tuesday + Thursday evenings
  [[1, 9, 11], [3, 16, 18], [5, 9, 11]], // Monday/Wednesday/Friday mix
  [[6, 10, 13]],                         // Saturday mornings only
  [[3, 18, 20], [5, 18, 20]],            // Midweek and Friday evenings
]

function seedAvailability(
  db: Database,
  mentorProfileId: string,
  availability: string,
  timestamp: string,
): void {
  // The curated mentors are the ones a demo actually clicks through, so they get
  // a deliberately generous spread across the week rather than whatever the hash
  // happens to pick — a demo mentor free only on Saturday mornings makes the
  // booking flow look broken when the slot list is nearly empty.
  const isCurated = mentorProfileId.startsWith('mentor-curated-')

  const pattern: Array<[number, number, number]> = isCurated
    ? [
        [1, 16, 18],
        [2, 17, 19],
        [3, 9, 11],
        [4, 17, 19],
        [5, 15, 17],
      ]
    : availability === 'Busy'
      ? [[2, 18, 19]]
      : (AVAILABILITY_PATTERNS[hashToIndex(mentorProfileId, AVAILABILITY_PATTERNS.length)] ??
        AVAILABILITY_PATTERNS[0]!)

  for (const [day, startHour, endHour] of pattern) {
    execute(
      db,
      `INSERT OR IGNORE INTO mentor_availability
         (id, mentor_profile_id, day_of_week, start_minute, end_minute, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId('avail'), mentorProfileId, day, startHour * 60, endHour * 60, timestamp],
    )
  }
}

/** Stable small hash, so the same id always picks the same pattern. */
function hashToIndex(value: string, buckets: number): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 100_000
  }
  return hash % buckets
}

/** Runs the engine's exporter and parses its JSON. */
function loadMlPopulation(alumniCount: number, studentCount: number): MlPayload | null {
  const engineDir = resolve(env.ML_ENGINE_DIR)

  try {
    const stdout = execFileSync(
      env.PYTHON_BIN,
      ['-m', 'ml_bridge.export_seed', '--alumni', String(alumniCount), '--students', String(studentCount)],
      { cwd: engineDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    return JSON.parse(stdout) as MlPayload
  } catch (error) {
    // A missing Python or dataset should degrade the seed to curated-only
    // rather than leaving the database empty.
    console.warn(
      `[seed] Could not load the ML population (${(error as Error).message.split('\n')[0]}).`,
    )
    console.warn('[seed] Continuing with curated demo data only.')
    return null
  }
}

export async function seed(options: { alumni?: number; students?: number } = {}): Promise<void> {
  const db = getDatabase()
  runMigrations(db)

  const curated = JSON.parse(readFileSync(join(seedDir, 'curated.json'), 'utf8')) as Curated
  const ml = loadMlPopulation(options.alumni ?? 300, options.students ?? 900)

  clearAll(db)

  // --- Curated demo accounts ------------------------------------------------
  for (const user of curated.users) {
    await insertUser(db, user)
  }

  const demoAlumniId = curated.users.find((user) => user.role === 'alumni')?.id ?? 'alumni-001'
  const demoStudentId = curated.users.find((user) => user.role === 'student')?.id ?? 'student-001'
  const demoAdminId = curated.users.find((user) => user.role === 'admin')?.id ?? 'admin-001'

  // The curated student's career-goals record, so the demo login is already
  // opted in and can see recommendations immediately.
  const studentDetail = curated.students[0] as Record<string, unknown> | undefined
  execute(
    db,
    `INSERT INTO mentorship_seekers
       (id, user_id, major, year, target_track, career_goal_text, preferred_cadence,
        format_preference, requested_support, interests, skill_tags, hobbies,
        unique_quality, country, state_province, ml_person_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('seeker'), demoStudentId,
      String(studentDetail?.major ?? 'Computer Science'),
      String(studentDetail?.year ?? 'Junior'),
      'Software Engineering',
      'I want to grow into a product-minded software engineering role and learn how to navigate my first few years in industry.',
      'biweekly', 'virtual',
      JSON.stringify(['interview_prep', 'general_guidance']),
      JSON.stringify(studentDetail?.interests ?? []),
      JSON.stringify(studentDetail?.skillTags ?? []),
      JSON.stringify(studentDetail?.hobbies ?? []),
      String(studentDetail?.uniqueQuality ?? ''),
      String(studentDetail?.country ?? 'Kenya'),
      String(studentDetail?.stateProvince ?? 'Nairobi County'),
      null, nowIso(), nowIso(),
    ],
  )

  // --- Curated mentors ------------------------------------------------------
  // The first curated mentor *is* the demo alumni login, so signing in as
  // alumni@demo.com lands on a populated mentor dashboard.
  const curatedMentorIds: string[] = []

  for (const [index, mentor] of curated.mentors.entries()) {
    const isDemoAlumni = index === 0
    const userId = isDemoAlumni ? demoAlumniId : `user-curated-mentor-${mentor.id}`

    if (!isDemoAlumni) {
      await insertUser(db, {
        id: userId,
        name: mentor.name,
        email: `${mentor.name.toLowerCase().replace(/[^a-z]+/g, '.')}@alumni.demo`,
        password: `Curated${mentor.id}!pass`,
        role: 'alumni',
        status: 'active',
      })
    }

    const mentorProfileId = `mentor-curated-${mentor.id}`
    curatedMentorIds.push(mentorProfileId)
    const [country = '', stateProvince = ''] = mentor.location.split(',').map((part) => part.trim()).reverse()

    insertMentorProfile(db, {
      id: mentorProfileId,
      userId,
      headline: mentor.role,
      company: mentor.company,
      industry: mentor.industry,
      location: mentor.location,
      bio: mentor.bio ?? null,
      capacity: 3,
      availability: mentor.availability,
      cadence: 'biweekly',
      formatPref: 'either',
      mlPersonId: null,
      major: mentor.skills[0] ?? 'Computer Science',
      hobbies: [],
      uniqueQuality: mentor.bio?.slice(0, 120) ?? '',
      country,
      stateProvince,
      tracks: [INDUSTRY_TO_TRACK[mentor.industry] ?? 'Research'],
      skills: mentor.skills,
    })

    for (const [position, entry] of (mentor.certifications ?? []).entries()) {
      execute(
        db,
        'INSERT INTO mentor_certifications (id, mentor_profile_id, name, position) VALUES (?, ?, ?, ?)',
        [newId('cert'), mentorProfileId, entry, position],
      )
    }

    for (const [position, entry] of (mentor.timeline ?? []).entries()) {
      execute(
        db,
        'INSERT INTO mentor_timeline (id, mentor_profile_id, year, title, org, description, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [newId('tl'), mentorProfileId, entry.year, entry.title, entry.org, entry.description ?? null, position],
      )
    }

    for (const opportunity of mentor.postedOpportunities ?? []) {
      execute(
        db,
        'INSERT INTO mentor_opportunities (id, posted_by_user_id, mentor_profile_id, title, type, location, description, posted_at, closes_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          `${mentorProfileId}-${opportunity.id}`, userId, mentorProfileId, opportunity.title,
          opportunity.type, mentor.location, null,
          new Date(opportunity.postedAt).toISOString(), null,
        ],
      )
    }
  }

  // --- Groups (DESIGN_BACKLOG #1: alumni-only by default) -------------------
  for (const group of curated.collaborationGroups) {
    execute(
      db,
      `INSERT INTO groups (id, name, topic, description, visibility, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        group.id, group.name, group.topic, group.description,
        // One group is opened to students so the demo can show both states.
        group.id === 'group-1' ? 'open-to-students' : 'alumni-only',
        demoAlumniId, new Date(group.createdAt).toISOString(), nowIso(),
      ],
    )

    execute(db, 'INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)', [
      group.id, demoAlumniId, nowIso(),
    ])

    for (const [position, resource] of group.resources.entries()) {
      execute(
        db,
        'INSERT INTO group_resources (id, group_id, title, url, position) VALUES (?, ?, ?, ?, ?)',
        [newId('res'), group.id, resource.title, resource.url ?? null, position],
      )
    }
  }

  // --- Events ---------------------------------------------------------------
  // The curated events carry fixed 2026 dates, most of which are now in the
  // past — an Events page that is empty by default demos badly. Their
  // time-of-day and ordering are preserved, but each is shifted onto an
  // upcoming week so the page always has something to show.
  for (const [index, event] of curated.events.entries()) {
    const { iso, endIso, tz } = parseDisplayDateTime(event.date, event.time)
    const original = new Date(iso)

    const startsAt = new Date()
    startsAt.setUTCDate(startsAt.getUTCDate() + 7 * (index + 1))
    startsAt.setUTCHours(original.getUTCHours(), original.getUTCMinutes(), 0, 0)
    // The authored time is a wall-clock time in `tz` ('6:00 PM EAT'); store the
    // real instant, which for EAT is three hours earlier in UTC.
    startsAt.setTime(startsAt.getTime() - offsetMinutesFor(tz) * 60_000)

    // The end time moves with the start, keeping the event's duration intact.
    let endsAt: string | null = null
    if (endIso) {
      const durationMs = new Date(endIso).getTime() - original.getTime()
      endsAt = new Date(startsAt.getTime() + durationMs).toISOString()
    }

    execute(
      db,
      `INSERT INTO events (id, title, description, starts_at, ends_at, timezone_label, location, type, tag, image_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id, event.title, event.description, startsAt.toISOString(), endsAt, tz,
        event.location, event.type, event.tag, null, nowIso(),
      ],
    )
  }

  // --- Verification queue + announcements -----------------------------------
  for (const item of curated.verificationQueue) {
    const userId = `user-verify-${item.id}`
    await insertUser(db, {
      id: userId,
      name: item.name,
      email: `${item.name.toLowerCase().replace(/[^a-z]+/g, '.')}@pending.demo`,
      password: `Pending!${item.id}pass`,
      role: 'alumni',
      status: 'pending',
    })

    execute(
      db,
      'INSERT INTO alumni_verifications (id, user_id, class_year, program, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      // Stored as the year alone ('2018'), as signup stores it, not 'Class of 2018'.
      [item.id, userId, item.classYear.replace(/\D/g, ''), item.program, item.status, nowIso()],
    )
  }

  for (const announcement of curated.announcements) {
    execute(
      db,
      'INSERT INTO announcements (id, title, body, audience, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [announcement.id, announcement.title, announcement.body, announcement.audience, demoAdminId, nowIso()],
    )
  }

  // --- Bulk ML population ---------------------------------------------------
  let mlMentorCount = 0
  let mlStudentCount = 0

  if (ml) {
    // A single shared password hash for the bulk accounts: hashing 1,200 of
    // them individually with scrypt at these parameters would take minutes and
    // buys nothing, since none of them are login targets for the demo.
    const bulkPassword = await hashPassword('BulkSeed!DemoOnly2026')

    transaction(db, () => {
      for (const person of ml.alumni) {
        const userId = `user-ml-${person.person_id}`
        const timestamp = nowIso()

        execute(
          db,
          `INSERT INTO users (id, name, email, password_hash, password_salt, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId, person.Name, `${person.person_id.toLowerCase()}@alumni.seed`,
            bulkPassword.hash, bulkPassword.salt, 'alumni', 'active', timestamp, timestamp,
          ],
        )

        insertMentorProfile(db, {
          id: `mentor-ml-${person.person_id}`,
          userId,
          headline: `${person.Major} professional`,
          company: 'Strathmore Alumni Network',
          industry: person.Major,
          location: `${person['State/Province']}, ${person.Country}`,
          bio: person['Unique Quality'],
          capacity: person.capacity,
          availability: 'Available',
          cadence: person.availability_cadence,
          formatPref: person.format_preference,
          mlPersonId: person.person_id,
          major: person.Major,
          hobbies: person.Hobbies,
          uniqueQuality: person['Unique Quality'],
          country: person.Country,
          stateProvince: person['State/Province'],
          tracks: person.mentor_tracks,
          skills: person.Hobbies.slice(0, 3),
        })

        mlMentorCount += 1
      }

      for (const person of ml.students) {
        const userId = `user-ml-${person.person_id}`
        const timestamp = nowIso()

        execute(
          db,
          `INSERT INTO users (id, name, email, password_hash, password_salt, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId, person.Name, `${person.person_id.toLowerCase()}@student.seed`,
            bulkPassword.hash, bulkPassword.salt, 'student', 'active', timestamp, timestamp,
          ],
        )

        execute(
          db,
          `INSERT INTO mentorship_seekers
             (id, user_id, major, year, target_track, career_goal_text, preferred_cadence,
              format_preference, requested_support, interests, skill_tags, hobbies,
              unique_quality, country, state_province, ml_person_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `seeker-ml-${person.person_id}`, userId, person.Major, person.Year,
            person.target_track, person.career_goal_text, person.preferred_cadence,
            person.format_preference, JSON.stringify(person.requested_support),
            JSON.stringify([]), JSON.stringify([]), JSON.stringify(person.Hobbies),
            person['Unique Quality'], person.Country, person['State/Province'],
            person.person_id, timestamp, timestamp,
          ],
        )

        mlStudentCount += 1
      }
    })
  }

  // Demo accounts have addresses nobody can receive mail at, so they are
  // seeded as already confirmed; only accounts created through signup verify.
  execute(db, 'UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL')
  // …and as having accepted the current privacy notice and code of conduct.
  execute(db, 'UPDATE users SET terms_version = ?, terms_accepted_at = created_at WHERE terms_version IS NULL', [
    CURRENT_TERMS_VERSION,
  ])

  console.log('Seed complete:')
  console.log(`  demo logins        : ${curated.users.length}`)
  console.log(`  curated mentors    : ${curatedMentorIds.length}`)
  console.log(`  ML mentors         : ${mlMentorCount}`)
  console.log(`  ML students        : ${mlStudentCount}`)
  console.log(`  groups             : ${curated.collaborationGroups.length}`)
  console.log(`  events             : ${curated.events.length}`)
}

if (isMainModule(import.meta.url)) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Seed failed:', error)
      process.exit(1)
    })
}
