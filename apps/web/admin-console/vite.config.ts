import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// One workspace, three deployed apps: which one a build produces is chosen
// entirely by VITE_APP_MODE (see src/App.tsx, which dispatches on 'kds' and
// 'tablet', with unset meaning the full Admin Console). Each mode therefore
// MUST write to its own outDir.
//
// Vite's default outDir is a constant 'dist', so before this map existed all
// three modes built into apps/web/admin-console/dist and silently overwrote one
// another. That was not merely untidy: on the Windows production host that
// exact directory is what NSSM's VerduraOrderTablet serves on 5176, so a
// plain `npm run build:admin-console` would have replaced the live Order
// Tablet with the Admin Console build. CI compounded it by running all three
// builds back-to-back, each clobbering the last,
// so only the third was ever really exercised. The Windows deployment
// scripts worked around it with an ad-hoc `npx vite build --outDir
// dist-admin` -- caller-side knowledge that drifts the moment someone runs
// the plain npm script instead.
//
// Keep this map the single source of truth: docs/windows-production-
// deployment.md pins each NSSM service to one of these directories by name.
const OUT_DIR_BY_APP_MODE: Record<string, string | undefined> = {
  '': 'dist-admin', // no VITE_APP_MODE -> full Admin Console (port 5177)
  tablet: 'dist', // VITE_APP_MODE=tablet -> Order Tablet (port 5176)
  kds: 'dist-kds', // VITE_APP_MODE=kds   -> Kitchen Display (port 5175)
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // cross-env (package.json's build:*/dev:* scripts) sets this as a real
  // process env var; loadEnv covers it being set in a .env file instead.
  const appMode = process.env.VITE_APP_MODE ?? env['VITE_APP_MODE'] ?? '';
  const outDir = OUT_DIR_BY_APP_MODE[appMode];
  // Fail loudly rather than falling back to a default: a silent default is
  // precisely how a typo'd mode would reintroduce the overwrite above.
  if (outDir === undefined) {
    const known = Object.keys(OUT_DIR_BY_APP_MODE)
      .map((m) => (m === '' ? '<unset> (admin-console)' : m))
      .join(', ');
    throw new Error(
      `Unknown VITE_APP_MODE ${JSON.stringify(appMode)} — expected one of: ${known}`,
    );
  }

  return {
    plugins: [react()],
    build: {
      // Mode-determined; see OUT_DIR_BY_APP_MODE above. Never override this
      // per-caller with `vite build --outDir` for a standard mode build.
      outDir,
    },
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
