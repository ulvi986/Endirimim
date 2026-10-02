import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API runs on :3000. Proxying keeps the web app same-origin with it, so the
// httpOnly refresh cookie works and CORS never depends on which port Vite picked.
const api = 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/uploads': { target: api, changeOrigin: false },
    },
  },
  preview: {
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/uploads': { target: api, changeOrigin: false },
    },
  },
})
