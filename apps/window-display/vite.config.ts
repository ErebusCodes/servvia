import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // Serve the manifest/service-worker in `vite dev` too, so installability
        // can be verified against localhost:5174 without a production build.
        devOptions: {
          enabled: true,
          type: 'module',
        },
        includeAssets: ['qrcode.min.js', 'branding/verdura-fallback.svg'],
        manifest: {
          name: 'Servvia Kiosk',
          short_name: 'Servvia Kiosk',
          description: 'Servvia self-service ordering kiosk',
          start_url: '/',
          scope: '/',
          id: '/',
          // 'fullscreen' is the strongest suppression Chrome/PWA installs support;
          // display_override lets the browser fall back gracefully on platforms
          // that don't honour 'fullscreen' (e.g. desktop Chrome installs as
          // 'standalone' with a minimal title bar instead of failing outright).
          display: 'fullscreen',
          display_override: ['fullscreen', 'standalone', 'minimal-ui'],
          orientation: 'landscape',
          theme_color: '#0a0a0a',
          background_color: '#0a0a0a',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Kiosk menu/order data must always be fresh — never let the service
          // worker serve a cached API response for a stale menu or table state.
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^\/api\//,
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        // Cross-app source import: window-display renders customer-website's
        // marketing pages (Menu/BookTable/About/Contact) as its own fallback
        // routes. Both apps are siblings under apps/, so this stays a plain
        // relative sibling path, not a package dependency.
        '@': path.resolve(__dirname, '../customer-website/src'),
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      fs: {
        allow: [
          path.resolve(__dirname),
          // repo root — needed for both the apps/customer-website sibling
          // import above and the repo-root shared/ imports in src/pages/.
          path.resolve(__dirname, '../..'),
        ],
      },
      proxy: {
        '/api': {
          target: env['VITE_API_URL'] || 'http://localhost:3000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: env['VITE_API_URL'] || 'http://localhost:3000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
