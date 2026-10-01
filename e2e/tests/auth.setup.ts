/**
 * Signs each demo account in once and saves the session, so the specs start
 * signed in without spending the sign-in rate limit (10 a minute) per test.
 */
import { expect, test as setup } from '@playwright/test'

const ROLES = [
  { role: 'student', home: '/student' },
  { role: 'alumni', home: '/alumni' },
  { role: 'admin', home: '/admin' },
] as const

for (const { role, home } of ROLES) {
  setup(`sign in as the ${role} demo`, async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: `Fill ${role} demo` }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page).toHaveURL(new RegExp(`${home}$`))
    await page.context().storageState({ path: `.auth/${role}.json` })
  })
}
