import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/Sassywasm/',
  resolve: {
    alias: {
      'sassy-wasm': path.resolve(__dirname, '../sassy-wasm/pkg'),
    },
  },
  optimizeDeps: {
    exclude: ['sassy-wasm'],
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
