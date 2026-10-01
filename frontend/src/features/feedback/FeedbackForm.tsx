/**
 * Post-match feedback form — DESIGN_BACKLOG #5.
 *
 * The fields map one-to-one onto `matching_engine/feedback_schema.py`, which is
 * what makes these responses usable as Tier-2 training data later. Nothing here
 * is ever auto-filled or simulated: a row exists only because a person answered.
 */
import { useState } from 'react'

import type { FeedbackPayload } from '../../lib/api'

type FeedbackFormProps = {
  relationshipId: string
  counterpartName: string
  isSubmitting: boolean
  onSubmit: (payload: FeedbackPayload) => void
}

export function FeedbackForm({
  relationshipId,
  counterpartName,
  isSubmitting,
  onSubmit,
}: FeedbackFormProps) {
  const [form, setForm] = useState({
    satisfactionRating: 4,
    wouldMatchAgain: true,
    sessionsHeld: 1,
    relationshipStatus: 'ongoing' as FeedbackPayload['relationshipStatus'],
    primaryGoalProgress: 'some' as FeedbackPayload['primaryGoalProgress'],
    freeTextComments: '',
  })
  const [submitted, setSubmitted] = useState(false)

  if (submitted) {
    return (
      <p className="success-msg">Thanks — your feedback on {counterpartName} was recorded.</p>
    )
  }

  return (
    <form
      className="form-grid"
      style={{ marginTop: '1rem' }}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ relationshipId, ...form })
        setSubmitted(true)
      }}
    >
      <h3>How is it going with {counterpartName}?</h3>

      <div className="form-row">
        <label>
          <span>Satisfaction (1–5)</span>
          <input
            className="input-field"
            type="number"
            min={1}
            max={5}
            value={form.satisfactionRating}
            onChange={(e) => setForm((c) => ({ ...c, satisfactionRating: Number(e.target.value) }))}
            required
          />
        </label>

        <label>
          <span>Sessions held so far</span>
          <input
            className="input-field"
            type="number"
            min={0}
            value={form.sessionsHeld}
            onChange={(e) => setForm((c) => ({ ...c, sessionsHeld: Number(e.target.value) }))}
            required
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          <span>Relationship status</span>
          <select
            className="select-field"
            value={form.relationshipStatus}
            onChange={(e) =>
              setForm((c) => ({
                ...c,
                relationshipStatus: e.target.value as FeedbackPayload['relationshipStatus'],
              }))
            }
          >
            <option value="ongoing">Ongoing</option>
            <option value="ended">Ended</option>
            <option value="never_started">Never started</option>
          </select>
        </label>

        <label>
          <span>Progress toward your goal</span>
          <select
            className="select-field"
            value={form.primaryGoalProgress}
            onChange={(e) =>
              setForm((c) => ({
                ...c,
                primaryGoalProgress: e.target.value as FeedbackPayload['primaryGoalProgress'],
              }))
            }
          >
            <option value="none">None yet</option>
            <option value="some">Some</option>
            <option value="significant">Significant</option>
          </select>
        </label>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={form.wouldMatchAgain}
          onChange={(e) => setForm((c) => ({ ...c, wouldMatchAgain: e.target.checked }))}
        />
        <span>I would match with them again</span>
      </label>

      <label>
        <span>Anything else? (optional)</span>
        <textarea
          className="textarea-field"
          value={form.freeTextComments}
          onChange={(e) => setForm((c) => ({ ...c, freeTextComments: e.target.value }))}
        />
      </label>

      <button className="primary-btn" type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Submit feedback'}
      </button>
    </form>
  )
}
