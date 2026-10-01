/**
 * Vitest global setup.
 *
 * `globals: false` means Testing Library cannot register its own cleanup, so
 * it is done here; without it, one test's rendered tree leaks into the next.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Pages are lazy-loaded, so the first render of each one waits on Vite
// transforming its module. Under a loaded machine (test files run in parallel)
// that alone can exceed Testing Library's 1s default for findBy/waitFor, which
// made route tests fail intermittently. 5s still fails fast on a real miss.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
