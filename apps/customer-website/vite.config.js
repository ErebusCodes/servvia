import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Menu.jsx and the reservation step components import shared modules
      // from the monorepo-root shared/ directory (e.g. shared/media/
      // menuImageFallback.mjs, shared/menu/menuData.mjs), so the dev server
      // needs filesystem access outside this workspace root.
      fs: {
        allow: [
          path.resolve(__dirname),
          path.resolve(__dirname, '..', '..'),
        ],
      },
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  }
});
