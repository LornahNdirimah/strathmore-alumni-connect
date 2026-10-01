/**
 * The demo path in a real browser, against the single-origin build: what
 * scripts/verify-demo.sh checks over HTTP, seen through the pages themselves.
 */
import { expect, test } from '@playwright/test'

test.describe('signed out', () => {
  test('the landing page leads to sign-in, and a wrong password is explained', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.goto('/login')
    await page.getByPlaceholder('you@strathmore.edu').fill('student@demo.com')
    await page.getByPlaceholder('Enter your password').fill('not-the-password')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText(/incorrect email or password/i)).toBeVisible()
  })

  test('a signed-in page sends a visitor to sign in', async ({ page }) => {
    await page.goto('/student')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('student', () => {
  test.use({ storageState: '.auth/student.json' })

  test('sees recommended mentors and can open one', async ({ page }) => {
    await page.goto('/student')
    await expect(page.getByRole('heading', { name: 'Recommended for you' })).toBeVisible()
    await page.goto('/mentors')
    await expect(page.getByRole('heading', { name: 'Find your mentor' })).toBeVisible()
    const profileLinks = page.getByRole('button', { name: /^View .+'s profile$/ })
    await expect(profileLinks.first()).toBeVisible()
    await profileLinks.first().click()
    await expect(page).toHaveURL(/\/mentors\/[^/]+$/)
  })

  test('deep links survive a reload, because the server hands every page to the app', async ({ page }) => {
    await page.goto('/student/profile')
    await page.reload()
    await expect(page).toHaveURL(/\/student\/profile$/)
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  })
})

test.describe('admin', () => {
  test.use({ storageState: '.auth/admin.json' })

  test('reads the insights and searches users', async ({ page }) => {
    await page.goto('/admin/insights')
    await expect(page.getByRole('heading', { name: 'Supply and demand' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Matching pipeline' })).toBeVisible()

    await page.goto('/admin/users')
    await page.getByLabel('Search users').fill('student@demo.com')
    await expect(page.getByText('1 accounts')).toBeVisible()
  })
})

test.describe('alumnus', () => {
  test.use({ storageState: '.auth/alumni.json' })

  test('can leave the alumni directory from account settings', async ({ page }) => {
    await page.goto('/alumni/profile')
    const toggle = page.getByRole('checkbox', { name: 'Show me in the alumni directory' })
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await expect(page.getByText('You are no longer listed in the alumni directory.')).toBeVisible()
    await toggle.check()
    await expect(page.getByText('You are listed in the alumni directory.')).toBeVisible()
  })
})
