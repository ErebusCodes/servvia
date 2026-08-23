---
baseline_commit: 8b5c1714defd48a7d6ad52a909956d5a6aad5894
---

# Story 1.7: Scaffold Verdura Kiosk

Status: done

> **Enterprise conformance addendum — 2026-08-15:** The kiosk/tablet shell must support two truthful journeys: standard submission to Idealpos followed by existing EFTPOS/cash, and optional verified online prepayment followed by Idealpos `PREPAID / ONLINE`. It must distinguish POS handoff, kitchen release and payment state, and cannot confirm an order before durable connector acceptance except in authorized emergency mode. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a developer,
I want to scaffold the `kiosk` frontend application workspace,
so that I can build the self-ordering kiosk and menu display interfaces.

## Acceptance Criteria

1. **Workspace Creation & Monorepo Registration:**
   - Create a directory `kiosk` in the root of the repository.
   - Register `"kiosk"` in the root `package.json` workspaces list.

2. **Scaffold Vite React TypeScript App:**
   - Setup React 18, TypeScript, Vite, Tailwind CSS, and Zustand.
   - Configure shared linting and TypeScript configuration.
   - Define standard scripts in `kiosk-frontend/package.json`: `dev`, `build`, `typecheck`, `lint`.

3. **Environment and Build Quality:**
   - Create `.env.example` in the `kiosk-frontend/` directory.
   - Ensure the app builds successfully (`npm run build --workspace=kiosk-frontend`).
   - Ensure typecheck and lint run cleanly with zero errors.

## Tasks / Subtasks

- [x] Task 1 — Scaffold Project Structure
  - [x] Create `kiosk-frontend/` directory and run scaffolding.
  - [x] Add `"kiosk"` to workspaces in root `package.json`.

- [x] Task 2 — Configure Tailwind CSS, TypeScript, and ESLint
  - [x] Setup PostCSS, Tailwind config, and basic index.css.
  - [x] Align linting/Prettier config with project standards.

- [x] Task 3 — Verify Build & Scripts
  - [x] Verify `npm run dev`, `npm run build`, `npm run typecheck`, and `npm run lint`.

## Dev Notes

### Shared Configs
Reuse formatting, linting rules, and TS configurations from `admin` workspace to maintain uniformity.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (orchestrator: Claude Code)

### Debug Log References

### Completion Notes List

- `kiosk-frontend/` directory existed as an untracked partial scaffold; all config files verified and corrected
- Root `package.json` already had `"kiosk"` in workspaces with `dev:kiosk`, `build:kiosk`, `lint:kiosk` scripts — no changes required
- Removed `@vercel/edge` from devDependencies (admin-specific edge middleware dep; no middleware in kiosk)
- Updated `.env.example`: changed `VITE_API_URL=http://localhost:3000` to empty string with proxy guidance comment, matching admin workspace pattern
- All configs (tsconfig.json, vite.config.ts, eslint.config.js, tailwind.config.ts, postcss.config.js) mirror admin workspace exactly
- `npm install --workspace=kiosk-frontend` — installed cleanly
- `npm run typecheck --workspace=kiosk-frontend` — zero errors ✅
- `npm run lint --workspace=kiosk-frontend` — zero errors ✅
- `npm run build --workspace=kiosk-frontend` — built in 2.47s, 78 modules, dist output clean ✅

### File List

- `kiosk-frontend/package.json` — modified: removed `@vercel/edge` devDependency
- `kiosk-frontend/.env.example` — modified: empty VITE_API_URL with proxy guidance comment
- `kiosk-frontend/tsconfig.json` — verified (mirrors admin, no changes)
- `kiosk-frontend/vite.config.ts` — verified (mirrors admin with /api proxy, no changes)
- `kiosk-frontend/eslint.config.js` — verified (mirrors admin flat config, no changes)
- `kiosk-frontend/tailwind.config.ts` — verified (mirrors admin, no changes)
- `kiosk-frontend/postcss.config.js` — verified (mirrors admin, no changes)
- `kiosk-frontend/index.html` — verified (Verdura Kiosk title, no changes)
- `kiosk-frontend/src/main.tsx` — verified (StrictMode + QueryClientProvider, no changes)
- `kiosk-frontend/src/App.tsx` — verified (placeholder landing screen, no changes)
- `kiosk-frontend/src/index.css` — verified (Tailwind directives, no changes)
- `kiosk-frontend/src/vite-env.d.ts` — verified (Vite client types, no changes)

### Senior Developer Review (AI)

**Review date:** 2026-06-20
**Outcome:** Changes Requested
**Layers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor

#### Action Items

- [x] [Review][Patch] `??` operator on `VITE_API_URL` passes empty string through to proxy — use `||` instead [`kiosk-frontend/vite.config.ts:11`]
- [x] [Review][Patch] No explicit `server.port` declared — Vite defaults to 5173, colliding with admin at the same port [`kiosk-frontend/vite.config.ts`]
- [x] [Review][Patch] Viewport not locked for tablet kiosk — missing `user-scalable=no, maximum-scale=1.0` [`kiosk-frontend/index.html:5`]
- [x] [Review][Defer] `tsc -b` + `composite: false` contradiction [`kiosk-frontend/package.json:8`, `kiosk-frontend/tsconfig.json:12`] — deferred, pre-existing admin pattern
- [x] [Review][Defer] `VITE_API_URL` is dev-proxy only; no production API client wired [`kiosk-frontend/.env.example`] — deferred, scaffold scope; address when first API-calling story arrives
- [x] [Review][Defer] `@typescript-eslint/no-explicit-any: 'off'` disables type-safety escape-hatch warning [`kiosk-frontend/eslint.config.js:22`] — deferred, pre-existing admin pattern
- [x] [Review][Defer] `loadEnv('')` loads all process env vars, not just `VITE_` prefix [`kiosk-frontend/vite.config.ts:5`] — deferred, pre-existing admin pattern

## Change Log

- 2026-06-20: Story 1.7 complete — kiosk workspace scaffolded, verified, and registered. Removed @vercel/edge dev dep; updated .env.example to proxy-first pattern. typecheck + lint + build all pass. (claude-sonnet-4-6 via bmad-dev-story)
- 2026-06-20: Code review complete — applied 3 patches (proxy ?? bug, explicit port, kiosk viewport). 4 items deferred (pre-existing admin patterns + scaffold scope). (claude-sonnet-4-6 via bmad-code-review)
