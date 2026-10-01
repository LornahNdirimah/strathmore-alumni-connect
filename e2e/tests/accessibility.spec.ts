/**
 * Accessibility pass (DESIGN_BACKLOG #58): every main page is scanned with axe
 * against WCAG 2.1 A and AA, and must have no serious or critical violations.
 * Keyboard use is checked separately: the app can be signed into and moved
 * around without a mouse, with a visible focus ring.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n  ')}`)
  expect(summary, summary.join('\n\n')).toEqual([])
}

const PAGES: Array<{ role?: 'student' | 'alumni' | 'admin'; path: string; ready: string | RegExp }> = [
  { path: '/', ready: /./ },
  { path: '/login', ready: 'Welcome back' },
  { path: '/signup', ready: 'Create your account' },
  { path: '/privacy', ready: /privacy/i },
  { role: 'student', path: '/student', ready: 'Recommended for you' },
  { role: 'student', path: '/mentors', ready: 'Find your mentor' },
  { role: 'student', path: '/student/profile', ready: 'Account' },
  { role: 'student', path: '/events', ready: /Reunions/ },
  { role: 'student', path: '/messages', ready: 'Messages' },
  { role: 'alumni', path: '/alumni', ready: /./ },
  { role: 'alumni', path: '/alumni-directory', ready: 'Alumni directory' },
  { role: 'admin', path: '/admin', ready: 'Platform administration' },
  { role: 'admin', path: '/admin/insights', ready: 'Supply and demand' },
  { role: 'admin', path: '/admin/users', ready: 'Users' },
]

for (const { role, path, ready } of PAGES) {
  test.describe(role ?? 'visitor', () => {
    if (role) test.use({ storageState: `.auth/${role}.json` })

    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: ready }).first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expectNoSeriousViolations(page)
    })
  })
}

test('signing in works from the keyboard alone, with a visible focus ring', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('you@strathmore.edu').focus()
  await page.keyboard.type('admin@demo.com')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Admin123!')

  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)
  const shadow = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow)
  expect(outline !== 'none' || shadow !== 'none', 'the focused field shows where focus is').toBe(true)

  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/admin$/)
})

test.describe('skip link', () => {
  test.use({ storageState: '.auth/student.json' })

  test('takes keyboard users past the navigation', async ({ page }) => {
    await page.goto('/student')
    await expect(page.getByRole('heading', { name: 'Recommended for you' })).toBeVisible()
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
  })
})
