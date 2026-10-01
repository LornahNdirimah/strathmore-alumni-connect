/**
 * The opt-in forms — DESIGN_BACKLOG #3 and #5.
 *
 * Holding a student or alumni account is no longer the same as participating in
 * the mentorship programme. Submitting the form here creates the
 * `mentorship_seekers` / `mentor_profiles` record that actually grants access,
 * and supplies the fields the matching engine needs. Until then the router
 * keeps sending the user back to this page.
 *
 * These are also the real forms that replace `synthetic_profile.py`'s generated
 * stand-ins: the field names map one-to-one onto what it was synthesising.
 */
import { useState } from 'react'

import { CADENCES, FORMATS, SUPPORT_OPTIONS, TRACKS } from '../../config/navigation'
import { mentorsApi, seekersApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import type {
  AuthSession,
  Cadence,
  EditableMentorProfile,
  FormatPreference,
  Seeker,
  SupportOption,
  Track,
} from '../../types'

type OnboardingPageProps = {
  session: AuthSession
  onComplete: () => void | Promise<void>
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function OnboardingPage({ session, onComplete }: OnboardingPageProps) {
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (action: () => Promise<unknown>) => {
    setIsSubmitting(true)
    setError(null)
    setFieldErrors({})

    try {
      await action()
      await onComplete()
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message)
        setFieldErrors(caught.fieldErrors())
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="content-panel">
      <div className="hero-card">
        <div>
          <span className="eyebrow">One more step</span>
          <h1>{session.role === 'student' ? 'Tell us your goals' : 'Join the mentor network'}</h1>
          <p>
            {session.role === 'student'
              ? 'This is what we match on — the more specific you are, the better your mentor suggestions will be.'
              : 'Set how many students you can take on and what you can help with. You can change this at any time.'}
          </p>
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}

      {session.role === 'student' ? (
        <StudentForm
          fieldErrors={fieldErrors}
          isSubmitting={isSubmitting}
          onSubmit={(payload) => submit(() => seekersApi.create(payload))}
        />
      ) : (
        <MentorForm
          fieldErrors={fieldErrors}
          isSubmitting={isSubmitting}
          onSubmit={(payload) => submit(() => mentorsApi.createProfile(payload))}
        />
      )}
    </section>
  )
}

type FormProps = {
  fieldErrors: Record<string, string>
  isSubmitting: boolean
  onSubmit: (payload: Record<string, unknown>) => void
  /** Heading and button text; the defaults suit first-time onboarding. */
  title?: string
  submitLabel?: string
}

/**
 * The student career-goals form. Used once at onboarding and again, prefilled
 * from `initial`, as the profile editor (DESIGN_BACKLOG #24).
 */
export function StudentForm({
  fieldErrors,
  isSubmitting,
  onSubmit,
  initial,
  title = 'Career goals',
  submitLabel = 'Find me mentors',
}: FormProps & { initial?: Seeker | null }) {
  const [form, setForm] = useState(() => ({
    major: initial?.major ?? '',
    year: initial?.year ?? '',
    targetTrack: (initial?.targetTrack ?? TRACKS[0]) as Track,
    careerGoalText: initial?.careerGoalText ?? '',
    preferredCadence: (initial?.preferredCadence ?? 'biweekly') as Cadence,
    formatPreference: (initial?.formatPreference ?? 'virtual') as FormatPreference,
    requestedSupport: (initial?.requestedSupport ?? ['general_guidance']) as SupportOption[],
    interests: (initial?.interests ?? []).join(', '),
    skillTags: (initial?.skillTags ?? []).join(', '),
    hobbies: (initial?.hobbies ?? []).join(', '),
    uniqueQuality: initial?.uniqueQuality ?? '',
    country: initial?.country ?? '',
    stateProvince: initial?.stateProvince ?? '',
  }))

  const toggleSupport = (value: SupportOption) => {
    setForm((current) => ({
      ...current,
      requestedSupport: current.requestedSupport.includes(value)
        ? current.requestedSupport.filter((item) => item !== value)
        : [...current.requestedSupport, value],
    }))
  }

  return (
    <form
      className="panel form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          ...form,
          interests: parseList(form.interests),
          skillTags: parseList(form.skillTags),
          hobbies: parseList(form.hobbies),
        })
      }}
    >
      <h2>{title}</h2>

      <div className="form-row">
        <label>
          <span>Course / major</span>
          <input
            className="input-field"
            value={form.major}
            onChange={(e) => setForm((c) => ({ ...c, major: e.target.value }))}
            placeholder="Computer Science"
            required
          />
          {fieldErrors.major && <small className="field-error">{fieldErrors.major}</small>}
        </label>

        <label>
          <span>Year of study</span>
          <input
            className="input-field"
            value={form.year}
            onChange={(e) => setForm((c) => ({ ...c, year: e.target.value }))}
            placeholder="Year 3"
            required
          />
        </label>
      </div>

      <label>
        <span>Career track you're aiming for</span>
        <select
          className="select-field"
          value={form.targetTrack}
          onChange={(e) => setForm((c) => ({ ...c, targetTrack: e.target.value as Track }))}
        >
          {TRACKS.map((track) => (
            <option key={track} value={track}>
              {track}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>What do you want from a mentor?</span>
        <textarea
          className="textarea-field"
          value={form.careerGoalText}
          onChange={(e) => setForm((c) => ({ ...c, careerGoalText: e.target.value }))}
          placeholder="I want to move into machine learning engineering and need help choosing projects and preparing for interviews."
          required
        />
        {fieldErrors.careerGoalText && (
          <small className="field-error">{fieldErrors.careerGoalText}</small>
        )}
      </label>

      <fieldset className="checkbox-group">
        <legend>What kind of support?</legend>
        {SUPPORT_OPTIONS.map((option) => (
          <label key={option.value} className="checkbox-row">
            <input
              type="checkbox"
              checked={form.requestedSupport.includes(option.value)}
              onChange={() => toggleSupport(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {fieldErrors.requestedSupport && (
          <small className="field-error">{fieldErrors.requestedSupport}</small>
        )}
      </fieldset>

      <div className="form-row">
        <label>
          <span>Preferred cadence</span>
          <select
            className="select-field"
            value={form.preferredCadence}
            onChange={(e) => setForm((c) => ({ ...c, preferredCadence: e.target.value as Cadence }))}
          >
            {CADENCES.map((cadence) => (
              <option key={cadence} value={cadence}>
                {cadence}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Preferred format</span>
          <select
            className="select-field"
            value={form.formatPreference}
            onChange={(e) =>
              setForm((c) => ({ ...c, formatPreference: e.target.value as FormatPreference }))
            }
          >
            {FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Interests (comma separated)</span>
          <input
            className="input-field"
            value={form.interests}
            onChange={(e) => setForm((c) => ({ ...c, interests: e.target.value }))}
            placeholder="machine learning, product strategy"
          />
        </label>

        <label>
          <span>Skills (comma separated)</span>
          <input
            className="input-field"
            value={form.skillTags}
            onChange={(e) => setForm((c) => ({ ...c, skillTags: e.target.value }))}
            placeholder="Python, React"
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Hobbies (comma separated)</span>
          <input
            className="input-field"
            value={form.hobbies}
            onChange={(e) => setForm((c) => ({ ...c, hobbies: e.target.value }))}
            placeholder="chess, photography"
          />
        </label>

        <label>
          <span>Something distinctive about you</span>
          <input
            className="input-field"
            value={form.uniqueQuality}
            onChange={(e) => setForm((c) => ({ ...c, uniqueQuality: e.target.value }))}
            placeholder="Community volunteer and product-minded builder"
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Country</span>
          <input
            className="input-field"
            value={form.country}
            onChange={(e) => setForm((c) => ({ ...c, country: e.target.value }))}
            placeholder="Kenya"
          />
        </label>

        <label>
          <span>County / state</span>
          <input
            className="input-field"
            value={form.stateProvince}
            onChange={(e) => setForm((c) => ({ ...c, stateProvince: e.target.value }))}
            placeholder="Nairobi"
          />
        </label>
      </div>

      <button className="primary-btn" type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

/**
 * The mentor-join form. Used when an alumnus opts in and again, prefilled from
 * `initial`, as their mentor profile editor (DESIGN_BACKLOG #24).
 */
export function MentorForm({
  fieldErrors,
  isSubmitting,
  onSubmit,
  initial,
  title = 'Mentor profile',
  submitLabel = 'Join the mentor network',
}: FormProps & { initial?: EditableMentorProfile | null }) {
  const [form, setForm] = useState(() => ({
    headline: initial?.headline ?? '',
    company: initial?.company ?? '',
    industry: initial?.industry ?? '',
    location: initial?.location ?? '',
    bio: initial?.bio ?? '',
    capacity: initial?.capacity ?? 3,
    availability: (initial?.availability ?? 'Available') as 'Available' | 'Busy',
    cadence: (initial?.cadence ?? 'biweekly') as Cadence,
    formatPreference: (initial?.formatPreference ?? 'either') as FormatPreference,
    skills: (initial?.skills ?? []).join(', '),
    tracks: (initial?.tracks ?? [TRACKS[0]]) as string[],
    major: initial?.major ?? '',
    hobbies: (initial?.hobbies ?? []).join(', '),
    uniqueQuality: initial?.uniqueQuality ?? '',
    country: initial?.country ?? '',
    stateProvince: initial?.stateProvince ?? '',
  }))

  const toggleTrack = (track: string) => {
    setForm((current) => ({
      ...current,
      tracks: current.tracks.includes(track)
        ? current.tracks.filter((item) => item !== track)
        : [...current.tracks, track],
    }))
  }

  return (
    <form
      className="panel form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          ...form,
          skills: parseList(form.skills),
          hobbies: parseList(form.hobbies),
        })
      }}
    >
      <h2>{title}</h2>

      <div className="form-row">
        <label>
          <span>Current role</span>
          <input
            className="input-field"
            value={form.headline}
            onChange={(e) => setForm((c) => ({ ...c, headline: e.target.value }))}
            placeholder="Senior Data Scientist"
            required
          />
          {fieldErrors.headline && <small className="field-error">{fieldErrors.headline}</small>}
        </label>

        <label>
          <span>Company</span>
          <input
            className="input-field"
            value={form.company}
            onChange={(e) => setForm((c) => ({ ...c, company: e.target.value }))}
            placeholder="Safaricom"
            required
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Industry</span>
          <input
            className="input-field"
            value={form.industry}
            onChange={(e) => setForm((c) => ({ ...c, industry: e.target.value }))}
            placeholder="Technology"
            required
          />
        </label>

        <label>
          <span>Location</span>
          <input
            className="input-field"
            value={form.location}
            onChange={(e) => setForm((c) => ({ ...c, location: e.target.value }))}
            placeholder="Nairobi, Kenya"
            required
          />
        </label>
      </div>

      <label>
        <span>Short bio</span>
        <textarea
          className="textarea-field"
          value={form.bio}
          onChange={(e) => setForm((c) => ({ ...c, bio: e.target.value }))}
          placeholder="What you work on, and what you can help students with."
        />
      </label>

      <fieldset className="checkbox-group">
        <legend>Tracks you can mentor in</legend>
        {TRACKS.map((track) => (
          <label key={track} className="checkbox-row">
            <input
              type="checkbox"
              checked={form.tracks.includes(track)}
              onChange={() => toggleTrack(track)}
            />
            <span>{track}</span>
          </label>
        ))}
        {fieldErrors.tracks && <small className="field-error">{fieldErrors.tracks}</small>}
      </fieldset>

      <div className="form-row">
        <label>
          {/* DESIGN_BACKLOG #2: capacity is self-reported, not a global constant. */}
          <span>How many students can you take on?</span>
          <input
            className="input-field"
            type="number"
            min={0}
            max={20}
            value={form.capacity}
            onChange={(e) => setForm((c) => ({ ...c, capacity: Number(e.target.value) }))}
            required
          />
          {fieldErrors.capacity && <small className="field-error">{fieldErrors.capacity}</small>}
        </label>

        <label>
          <span>Availability</span>
          <select
            className="select-field"
            value={form.availability}
            onChange={(e) =>
              setForm((c) => ({ ...c, availability: e.target.value as 'Available' | 'Busy' }))
            }
          >
            <option value="Available">Available</option>
            <option value="Busy">Busy</option>
          </select>
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Meeting cadence</span>
          <select
            className="select-field"
            value={form.cadence}
            onChange={(e) => setForm((c) => ({ ...c, cadence: e.target.value as Cadence }))}
          >
            {CADENCES.map((cadence) => (
              <option key={cadence} value={cadence}>
                {cadence}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Format</span>
          <select
            className="select-field"
            value={form.formatPreference}
            onChange={(e) =>
              setForm((c) => ({ ...c, formatPreference: e.target.value as FormatPreference }))
            }
          >
            {FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Your degree / field</span>
          <input
            className="input-field"
            value={form.major}
            onChange={(e) => setForm((c) => ({ ...c, major: e.target.value }))}
            placeholder="Computer Science"
            required
          />
          {fieldErrors.major && <small className="field-error">{fieldErrors.major}</small>}
        </label>

        <label>
          <span>Skills (comma separated)</span>
          <input
            className="input-field"
            value={form.skills}
            onChange={(e) => setForm((c) => ({ ...c, skills: e.target.value }))}
            placeholder="Python, Leadership"
          />
        </label>
      </div>

      {/* Two of the matching engine's features. The form kept them in state but
          never showed inputs, so every mentor who joined here was matched with
          them empty. */}
      <div className="form-row">
        <label>
          <span>Hobbies (comma separated)</span>
          <input
            className="input-field"
            value={form.hobbies}
            onChange={(e) => setForm((c) => ({ ...c, hobbies: e.target.value }))}
            placeholder="hiking, chess"
          />
        </label>

        <label>
          <span>Something distinctive about you</span>
          <input
            className="input-field"
            value={form.uniqueQuality}
            onChange={(e) => setForm((c) => ({ ...c, uniqueQuality: e.target.value }))}
            placeholder="Built two startups before joining industry"
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Country</span>
          <input
            className="input-field"
            value={form.country}
            onChange={(e) => setForm((c) => ({ ...c, country: e.target.value }))}
            placeholder="Kenya"
          />
        </label>

        <label>
          <span>County / state</span>
          <input
            className="input-field"
            value={form.stateProvince}
            onChange={(e) => setForm((c) => ({ ...c, stateProvince: e.target.value }))}
            placeholder="Nairobi"
          />
        </label>
      </div>

      <button className="primary-btn" type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
