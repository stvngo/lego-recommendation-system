import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to FastAPI so the browser stays same-origin (no CORS).
    // API_URL lets a second copy (e.g. a test run) talk to a different API port.
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:8000' },
  },
})
