import { existsSync } from 'node:fs'

import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.E2E_PORT ?? '3101'

/**
 * Browser tests against the single-origin build (DESIGN_BACKLOG #54). Locally,
 * an installed Chrome is used when Playwright's own Chromium is not
 * downloaded; CI installs Chromium (`npm run install-browser`).
 */
const useSystemChrome = !process.env.CI && existsSync('/usr/bin/google-chrome')

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...(useSystemChrome ? { channel: 'chrome' } : {}),
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(useSystemChrome ? { channel: 'chrome' } : {}) }, dependencies: ['setup'] },
  ],
  webServer: {
    command: 'node server.mjs',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
