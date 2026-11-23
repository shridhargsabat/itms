import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.BUILD_SHA || 'local'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
    // autoUpdate: new SW activates itself (skipWaiting+clientsClaim) so
    // phones never stay on a stale bundle — prompt mode left 110px safe-area
    // gaps from old precached index.html (Aug 2026 incident)
    registerType: 'autoUpdate',
    // manual registration in src/lib/pwa.ts (update toast + periodic checks)
    injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ITMS — IT Management System',
        short_name: 'ITMS',
        description: 'Unified IT Management System — ITAM, ITSM & CMDB',
        start_url: './',
        scope: './',
        id: './',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Fresh-first: ALL list/CRUD surfaces — audit log, dashboard
            // metrics, masters, users, assets, tickets, cmdb. Network wins
            // when online; the short cache is only an offline fallback.
            // NetworkFirst never blocks the page on CacheStorage (iOS hangs
            // on cache.match with a stale SWR cache — permanent loading
            // skeletons). Cache reads happen only when the network fetch
            // fails or exceeds the 3s Workbox timeout.
            urlPattern: /^https?:\/\/[^/]+\/api\/v1\/(audit|dashboard|masters|users|assets|tickets|cmdb|templates|kb|notifications|sla|locations|vendors|claims|licenses|requests|onboarding|reports)(\/|\?|$).*/,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-fresh',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Everything else under /api — never cache (mutations bypass SW anyway;
            // this guards unknown/uncached GETs). Workbox v7: regex matches FULL url.
            urlPattern: /^https?:\/\/[^/]+\/api\/.*/,
            handler: 'NetworkOnly',
            method: 'GET',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Stable vendor chunk: framework libs change rarely → cached long-term;
        // lazy route chunks + small app core change every build.
        manualChunks(id) {
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/@tanstack')
          ) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
