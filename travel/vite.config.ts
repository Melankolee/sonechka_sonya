import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Те же заголовки ставит Caddy (deploy/caddy-travel.caddy), здесь — чтобы
// `npm run preview` ломался на нарушениях CSP так же, как прод.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

// В dev и preview /api и /trips уходят в локальный server/travel-api.py
// (npm run api), на проде их разводит Caddy.
const API = process.env.TRAVEL_API ?? 'http://127.0.0.1:8788'
const proxy = { '/api': API, '/trips': API }

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Свой Service Worker (src/sw.ts): precache оболочки + проверка, что она
      // целиком лежит в кеше.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Новая версия приложения ждёт, пока пользователь нажмёт «Reload»,
      // а не подменяет бандл посреди просмотра PDF.
      registerType: 'prompt',
      injectRegister: false,
      // Когда перед сайтом появится HTTP-авторизация, manifest должен
      // запрашиваться с ней же.
      useCredentials: true,
      // Иконки и прочее из public/ уже попадают в precache по globPatterns.
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Поездка',
        short_name: 'Поездка',
        description: 'Текущая поездка, доступна без интернета',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f4ef',
        theme_color: '#f6f4ef',
        lang: 'ru',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico,txt,bcmap,pfb,ttf,icc,wasm}'],
        globIgnores: ['**/LICENSE*'],
        // Воркер pdf.js весит ~1.3 МБ, лимит по умолчанию (2 МБ) близко.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'safari16',
  },
  server: { proxy },
  preview: {
    proxy,
    headers: { 'Content-Security-Policy': CSP },
  },
})
