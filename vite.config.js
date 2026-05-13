import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Allow flake swatch images saved by Cursor in the project metadata area.
      allow: [resolve(__dirname), 'C:/Users/Seth/.cursor/projects/c-Users-Seth-Desktop-EPOXY-TWINS-ECOS-APP/assets'],
    },
  },
})
