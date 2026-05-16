import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://5ebe3051.r9.cpolar.cn',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'https://5ebe3051.r9.cpolar.cn',
        changeOrigin: true,
      },
    },
  },
})
