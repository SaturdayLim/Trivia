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
  },
})
