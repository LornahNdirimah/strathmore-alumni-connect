/**
 * A whole mentorship in the browser, from both sides: the demo student asks
 * the demo mentor, she accepts, they message each other, the student books a
 * session, and ending the mentorship cancels it and asks both for feedback.
 *
 * Each step builds on the one before, against the run's fresh database (see
 * server.mjs), so the steps run in order and a failure stops the rest. The
 * student and the mentor each have their own signed-in browser, open side by
 * side, so a change one makes is checked from the other's screen.
 */
import { expect, test, type Browser, type Page } from '@playwright/test'

const MENTOR = 'Dr. Amina Osei'
const MENTOR_PROFILE = '/mentors/mentor-curated-1'
const STUDENT = 'Kevin Otieno'

// Retrying one step alone would replay it against state it already changed.
test.describe.configure({ mode: 'serial', retries: 0 })

let student: Page
let mentor: Page

async function signedIn(browser: Browser, role: 'student' | 'alumni'): Promise<Page> {
  const context = await browser.newContext({ storageState: `.auth/${role}.json` })
  return context.newPage()
}

test.beforeAll(async ({ browser }) => {
  student = await signedIn(browser, 'student')
  mentor = await signedIn(browser, 'alumni')
})

test.afterAll(async () => {
  await student.context().close()
  await mentor.context().close()
})

test('a student asks a mentor for mentorship', async () => {
  await student.goto(MENTOR_PROFILE)
  await expect(student.getByRole('heading', { name: MENTOR })).toBeVisible()
  await student.getByRole('button', { name: 'Request mentorship' }).click()

  await student.getByLabel('What do you need help with?').fill('Moving into product engineering')
  await student.getByLabel('Message').fill('I would value your view on my first two years in industry.')
  await student.getByRole('button', { name: 'Send request' }).click()
  await expect(student.getByText('Request sent.')).toBeVisible()

  await student.goto('/student/my-mentors')
  const requests = student.locator('.panel', { has: student.getByRole('heading', { name: 'My requests' }) })
  await expect(requests.getByText(MENTOR)).toBeVisible()
  await expect(requests.getByText(/Waiting for a reply/)).toBeVisible()
})

test('the mentor accepts, and both see the mentorship', async () => {
  await mentor.goto('/alumni/my-mentees')
  await expect(mentor.getByText('Moving into product engineering')).toBeVisible()
  await mentor.getByRole('button', { name: `Accept ${STUDENT}'s request` }).click()

  await expect(mentor.getByRole('button', { name: `End mentorship with ${STUDENT}` })).toBeVisible()
  await expect(mentor.getByRole('button', { name: `Accept ${STUDENT}'s request` })).toHaveCount(0)

  await student.goto('/student/my-mentors')
  await expect(student.getByRole('button', { name: `End mentorship with ${MENTOR}` })).toBeVisible()
})

test('they message each other, and a reply arrives without reloading', async () => {
  await student.goto('/student/my-mentors')
  await student.getByRole('button', { name: `Message ${MENTOR}` }).click()
  await expect(student).toHaveURL(/\/messages\?c=/)

  const studentBox = student.getByRole('textbox', { name: `Message to ${MENTOR}` })
  await studentBox.fill('Thank you for accepting! When suits you for a first chat?')
  await student.getByRole('button', { name: 'Send' }).click()
  const studentThread = student.getByRole('log', { name: `Conversation with ${MENTOR}` })
  await expect(studentThread.getByText('When suits you for a first chat?')).toBeVisible()
  await expect(studentBox).toHaveValue('')

  await mentor.goto('/messages')
  await mentor.getByRole('button', { name: new RegExp(STUDENT) }).first().click()
  const mentorThread = mentor.getByRole('log', { name: `Conversation with ${STUDENT}` })
  await expect(mentorThread.getByText('When suits you for a first chat?')).toBeVisible()
  await mentor.getByRole('textbox', { name: `Message to ${STUDENT}` }).fill('Welcome, Kevin. Book any open slot that works.')
  await mentor.getByRole('button', { name: 'Send' }).click()

  // The student's page is still open from before: the live-update stream
  // brings the reply in, with no reload.
  await expect(studentThread.getByText('Book any open slot that works.')).toBeVisible({ timeout: 15_000 })
})

test('the student books a session, and the mentor sees it', async () => {
  await student.goto('/student/my-sessions')
  await student.getByText(new RegExp(`^${MENTOR} — `)).click() // opens the booking panel

  const booking = student.locator('details.booking-block[open]')
  await expect(booking.getByRole('button', { name: 'Pick a slot first' })).toBeDisabled()
  const firstSlot = booking.getByRole('button', { pressed: false }).first()
  const slotName = await firstSlot.getAttribute('aria-label')
  await firstSlot.click()
  await expect(booking.getByRole('button', { name: slotName! })).toHaveAttribute('aria-pressed', 'true')

  await booking.getByLabel('What is this session about?').fill('Portfolio review')
  await booking.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(booking.locator('.success-msg')).toBeVisible()

  const upcoming = student.locator('.panel', { has: student.getByRole('heading', { name: 'Upcoming sessions' }) })
  await expect(upcoming.getByText('Portfolio review')).toBeVisible()

  // A booked slot is no longer offered.
  await student.reload()
  await student.getByText(new RegExp(`^${MENTOR} — `)).click()
  await expect(student.locator('details.booking-block[open]').getByRole('button', { name: slotName! })).toHaveCount(0)

  await mentor.goto('/alumni/availability')
  const mentorSessions = mentor.locator('.panel', { has: mentor.getByRole('heading', { name: 'Your upcoming sessions' }) })
  await expect(mentorSessions.getByText('Portfolio review')).toBeVisible()
})

test('ending the mentorship cancels the session and asks both for feedback', async () => {
  await student.goto('/student/my-mentors')
  await student.getByRole('button', { name: `End mentorship with ${MENTOR}` }).click()
  await student.getByLabel(`Reason (optional, shared with ${MENTOR})`).fill('I have what I needed — thank you!')
  await student.getByRole('button', { name: 'Yes, end it' }).click()
  await expect(student.getByRole('button', { name: `End mentorship with ${MENTOR}` })).toHaveCount(0)

  await student.goto('/student/my-sessions')
  const upcoming = student.locator('.panel', { has: student.getByRole('heading', { name: 'Upcoming sessions' }) })
  await expect(upcoming.getByText('Portfolio review')).toHaveCount(0)

  const studentForm = student.locator('form', { has: student.getByRole('heading', { name: `How is it going with ${MENTOR}?` }) })
  await studentForm.getByLabel('Satisfaction (1–5)').fill('5')
  await studentForm.getByLabel('Relationship status').selectOption('ended')
  await studentForm.getByLabel('Progress toward your goal').selectOption('significant')
  await studentForm.getByRole('button', { name: 'Submit feedback' }).click()
  await expect(student.getByText(`Thanks — your feedback on ${MENTOR} was recorded.`)).toBeVisible()

  await mentor.goto('/alumni/my-mentees')
  const mentorForm = mentor.locator('form', { has: mentor.getByRole('heading', { name: `How is it going with ${STUDENT}?` }) })
  await mentorForm.getByLabel('Relationship status').selectOption('ended')
  await mentorForm.getByRole('button', { name: 'Submit feedback' }).click()
  await expect(mentor.getByText(`Thanks — your feedback on ${STUDENT} was recorded.`)).toBeVisible()

  // Feedback is asked once: after a reload neither form comes back.
  await student.reload()
  await expect(student.getByRole('heading', { name: `How is it going with ${MENTOR}?` })).toHaveCount(0)
})

test('with a conversation open, the messages page still passes the accessibility scan', async () => {
  const AxeBuilder = (await import('@axe-core/playwright')).default
  await student.goto('/messages')
  await student.getByRole('button', { name: new RegExp(MENTOR) }).first().click()
  await expect(student.getByRole('log', { name: `Conversation with ${MENTOR}` })).toBeVisible()
  const results = await new AxeBuilder({ page: student }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
})
