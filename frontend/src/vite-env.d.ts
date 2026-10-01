/// <reference types="vite/client" />

/**
 * Typed environment variables. Vite only exposes keys prefixed with `VITE_`
 * to client code, which is the mechanism that stops a stray server secret in
 * `.env` from being bundled into the browser.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
