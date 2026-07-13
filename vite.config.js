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
    // The jsdom live-screen tests drive several React screens over the real
    // mock driver and poll for BroadcastChannel convergence. Each completes in
    // ~2-3s in isolation, but the suite runs its files concurrently in the forks
    // pool, and under that CPU contention a 5s default timeout is too tight —
    // they intermittently trip it while doing correct work. Give them headroom;
    // a genuine hang still fails well inside this window.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
