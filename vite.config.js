import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

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
