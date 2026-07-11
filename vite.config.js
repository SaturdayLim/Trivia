import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @vitejs/plugin-react does not run on Vitest's SSR transform, so JSX inside
  // tests (and inside the src/ modules they import) is compiled by esbuild via
  // the block below; the plugin still handles dev/build. Tests default to the
  // node environment; DOM tests opt in with @vitest-environment jsdom pragmas.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    // `forks`, not the default `threads`: the mock sync driver talks over
    // Node's `BroadcastChannel`, which is process-global. Under `threads` every
    // concurrently-running test file shares one dispatcher, and a reveal diff
    // meant for one room's tab can be starved by another file's traffic —
    // flaky, and nothing to do with the app. Separate processes give each file
    // its own channel space.
    pool: 'forks',
  },
})
