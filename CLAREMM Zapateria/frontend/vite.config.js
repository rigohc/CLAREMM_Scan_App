import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendTarget = process.env.CLAREMM_BACKEND_URL || 'http://127.0.0.1:3001'
const httpsPfxPath = process.env.CLAREMM_HTTPS_PFX
const httpsOptions = httpsPfxPath
  ? { pfx: fs.readFileSync(httpsPfxPath) }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    https: httpsOptions,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/events': {
        target: backendTarget,
        changeOrigin: true,
      }
    }
  }
})
