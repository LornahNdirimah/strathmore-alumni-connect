import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The API's wire types (DESIGN_BACKLOG #55). Imported type-only, so
    // nothing from the backend reaches the bundle; the alias is for tooling.
    alias: { '@contract': fileURLToPath(new URL('../backend/src/contract/index.ts', import.meta.url)) },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
