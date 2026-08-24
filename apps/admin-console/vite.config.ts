import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      // Base/default admin-console mode only. Kitchen Display (VITE_APP_MODE=kds)
      // and Order Tablet (VITE_APP_MODE=tablet) override this via explicit
      // --port flags in package.json's dev:kitchen-display/dev:order-tablet
      // scripts (5175/5176) -- this default is what plain `npm run
      // dev:admin-console` (no VITE_APP_MODE) binds to. Final locked port
      // map: see scripts/dev-lock.mjs's CANONICAL_PORTS, the single source
      // of truth every other port reference in this repo must match.
      port: 5177,
      strictPort: true,
      proxy: {
        '/api': {
          target: env['VITE_API_URL'] || 'http://localhost:3000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: env['VITE_API_URL'] || 'http://localhost:3000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
