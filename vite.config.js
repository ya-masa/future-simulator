import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages project-site path:
  // https://ya-masa.github.io/future-simulator/
  base: '/future-simulator/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '未来シミュレーター',
        short_name: '未来シミュレーター',
        description: '家計と資産の将来をシミュレーションするアプリ',
        lang: 'ja',
        start_url: '/future-simulator/',
        scope: '/future-simulator/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#f4efe6',
        background_color: '#f4efe6',
        icons: [
          { src: '/future-simulator/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/future-simulator/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/future-simulator/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        navigateFallback: '/future-simulator/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ],
})
