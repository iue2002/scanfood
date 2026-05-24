import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'

// HTTPS 开发证书：优先使用 mkcert 生成的 localhost+2.pem（推荐），
// 兼容旧的 localhost.pem 命名。两个都没有时启动 HTTP。
const certCandidates = [
  ['localhost+2.pem', 'localhost+2-key.pem'],
  ['localhost.pem', 'localhost-key.pem'],
] as const
const httpsCert = (() => {
  for (const [certName, keyName] of certCandidates) {
    const certFile = path.resolve(__dirname, certName)
    const keyFile = path.resolve(__dirname, keyName)
    if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
    }
  }
  return false
})()

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.svg', 'icon-512.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '扫码点餐管理系统',
        short_name: '点餐管理',
        description: '扫码点餐商家管理端',
        theme_color: '#2563EB',
        background_color: '#F8FAFC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        icons: [
          {
            src: 'icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60,
              },
            },
          },
        ],
      },
      devOptions: {
        // 开发环境关闭 Service Worker：避免 SW 缓存 API 响应（如登录失败的 401）
        // 导致页面状态错乱、白屏等开发期不可复现的诡异问题
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    https: httpsCert,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
