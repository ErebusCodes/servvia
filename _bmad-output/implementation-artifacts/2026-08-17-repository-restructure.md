# Repository Structure Decision Record — 2026-08-17

Status: **structural migration complete; functional boundary compliance (Window Display, Order Tablet/Kitchen Display independence) explicitly deferred**

See also: `docs/decisions-log.md` DL-073 (the canonical, append-only decision-log entry this file expands on) and `_bmad-output/implementation-artifacts/deferred-work.md`'s "repository restructure to apps/" section (the open follow-up items).

## Why

The repository's four customer-facing frontends were named after their original build order (`customer-frontend`, `admin-frontend`, `kiosk-frontend`, `tablet-frontend`), not their actual product role, and the top level mixed deployable applications, a shared backend, a static asset directory, and a .NET integration project with no consistent grouping. This made it hard for a new developer to tell what's a deployable application, what's shared, and what's vendor-specific integration code — and, as this migration discovered, the old names had drifted from reality (`kiosk-frontend` is not read-only; `tablet-frontend` was an abandoned scaffold with no real Order Tablet code in it).

## What changed

### Directory moves (behavior-preserving)

| Old path | New path | Notes |
|---|---|---|
| `customer-frontend/` | `apps/customer-website/` | Pure move + path-depth fixes (see below) |
| `admin-frontend/` | `apps/admin-console/` | Pure move + path-depth fixes. Contains Order Tablet and Kitchen Display source — see "Order Tablet / Kitchen Display" below |
| `kiosk-frontend/` | `apps/window-display/` | Pure move — **contents unchanged**, including the ordering flow it should not have. See "Window Display" below |
| `backend/` | `apps/api/` | Pure move + path-depth fixes |
| `windows-connector/` | `apps/venue-connector/` | Pure move — self-contained .NET solution, no internal path changes needed |
| `tablet-frontend/` | *(removed)* | Abandoned scaffold — see "tablet-frontend disposition" below |
| *(new)* | `apps/order-tablet/README.md` | Documentation-only — no source. See "Order Tablet / Kitchen Display" |
| *(new)* | `apps/kitchen-display/README.md` | Documentation-only — no source. See "Order Tablet / Kitchen Display" |

### Package identity renames

| Old `package.json` name | New name |
|---|---|
| `verdura-customer-frontend` | `customer-website` |
| `verdura-kiosk-frontend` | `window-display` |
| `verdura-admin-frontend` | `admin-console` |
| `verdura-backend` | `api` |

Root `package.json` workspaces list updated to `apps/api`, `apps/customer-website`, `apps/admin-console`, `apps/window-display`. All root scripts renamed and repointed (`dev:backend`→`dev:api`, `dev:kiosk-frontend`→`dev:window-display`, etc. — full list in `package.json`). `dev:kitchen-display` and `dev:order-tablet` now build `apps/admin-console` with `VITE_APP_MODE=kds`/`=tablet` respectively, replacing the old `admin-frontend`/`tablet-frontend` targets.

### `tablet-frontend` disposition

Inspected before removal: `src/` contained only `App.tsx`/`main.tsx`/`index.css`/`vite-env.d.ts` (default Vite React template, no application code). `vite.config.ts` and `tsconfig.json` both had a fully-configured `@admin` alias into `../admin-frontend/src` (plus React/react-dom/react-router-dom/react-query de-duplication aliases) — real, deliberate scaffolding for a "thin shell that imports Admin Console's Order Tablet page" architecture. `App.tsx` never used the alias. The team evidently pivoted to building `OrderTabletPage.tsx` directly inside `admin-frontend` with a `VITE_APP_MODE=tablet` branch instead (the same pattern already used for Kitchen Display), leaving this scaffold fully superseded. Removed via `git rm` (full history recoverable via `git log -- tablet-frontend`); its `vercel.json` (`buildCommand: npm run build --workspace=tablet-frontend`) was removed with it rather than recreated, since there's no evidence it was ever deployed.

### Order Tablet / Kitchen Display: shared-source device builds, not independent apps

**Discovery:** `admin-frontend/src/pages/order-tablet/OrderTabletPage.tsx` (1,969 lines — table map, cart, seat/course assignment, real `POST /api/admin/orders` submission) is the actual, working Order Tablet implementation — far more complete than `kiosk-frontend`'s `KioskOrderPage`/`TableSelectionPage`, and already wired into a `VITE_APP_MODE=tablet` branch in `admin-frontend/src/App.tsx` (gated by the same `KdsPinGate` device-auth pattern as Kitchen Display), just not yet connected to a root npm script.

**Dependency check (before deciding how to move it):**

| `OrderTabletPage.tsx` dependency | Also required by |
|---|---|
| `store/auth.store.ts` | App.tsx, ProtectedRoute, AdminLayout, useBootstrapAuth, `lib/api.ts` — the entire admin app's auth |
| `store/menu.store.ts` | `MenuManagementPage` |
| `store/reservation.store.ts` | `ReservationsPage` |
| `shared/orders.ts` | `KitchenDisplayPage.tsx` (the canonical KDS), `OrdersPage` |
| `shared/tables.ts` | `ReservationsPage`, `TableManagementPage` |
| `components/TableMap.tsx` | `TableManagementPage` |

None of these are exclusive to Order Tablet. Extracting `apps/order-tablet` as a fully independent application with its own `package.json` would require either duplicating this state (real drift risk — Order Tablet and Kitchen Display would run on two independently-mutating copies of live order data) or a genuine shared-package extraction refactor. Both were rejected for this pass:

- Duplication was rejected because it directly conflicts with this project's "never fakes success" / single-source-of-truth principle for order state.
- A shared-package extraction was rejected because it's a materially larger change than a structural relocation, touches code shared with `KitchenDisplayPage.tsx` and general Admin Console pages, and — specifically for `store/auth.store.ts` — cannot be done safely while Story 15.1's tablet authentication-model decision (shared device PIN vs. per-staff JWT vs. hybrid) remains explicitly blocked (`_bmad-output/implementation-artifacts/15-1-tablet-venue-and-auth-decision.md`). Extracting or duplicating the auth store now would be making that decision by implementation accident.

**Resolution:** `OrderTabletPage.tsx` and `KitchenDisplayPage.tsx` stay inside `apps/admin-console`, unmodified except for the path-depth fixes every moved file needed. `apps/order-tablet/` and `apps/kitchen-display/` are documentation-only directories (a `README.md` each, no `src/`, no `package.json`) describing this as an explicit **shared-source, separately-built transitional architecture** — real device-mode build commands exist (`npm run dev:order-tablet`, `npm run build:kitchen-display`, etc.), but the source is not independently owned. The eventual extraction is deferred to its own future story (see deferred-work.md), gated on Story 15.1's decision landing first.

### Window Display: moved as-is, not yet boundary-compliant

`kiosk-frontend` bundles four things in one Vite app: read-only signage (`KioskWindowSignagePage.tsx`), table selection + order construction + `@stripe/terminal-js` payment (`TableSelectionPage.tsx`, `KioskOrderPage.tsx` — reachable via `/tables` and `/order` routes), an embedded second Kitchen Display (`KdsPage.tsx`, `/kds` route, no test coverage), and direct source imports of `customer-frontend`'s marketing pages via a `@` alias (`Menu`, `BookTable`, `About`, `Contact`).

This was moved to `apps/window-display` with **zero code changes to its routing or pages** — the ordering flow and embedded KDS are still fully reachable. This is a deliberate, documented non-compliance, not an oversight: retiring or relocating what looks like live, payment-capable ordering code inside a bulk structural-migration pass, without dedicated testing or confirmation that it's actually safe to touch, was judged too risky. `apps/window-display/README.md` states this plainly. Follow-up is tracked in deferred-work.md and requires, in order: (1) confirming whether this flow is still relied on in the live venue setup, (2) a dedicated extraction/retirement story if so.

### Path-depth fixes required by the extra `apps/` nesting level

Every moved app gained one directory of nesting (e.g. `customer-frontend/` → `apps/customer-website/`), which broke every relative reference reaching outside its own tree. Found and fixed by grepping each app for `../../` (and deeper) patterns, cross-referenced against a full pre-move dependency inventory:

- `apps/customer-website/vite.config.js`: the `~/verdura_MVP` alias (kept under that literal name — it's matched by exact string in `Home.jsx`/`About.jsx`/`Contact.jsx`'s own transform-plugin code, not filesystem-path-dependent) and `server.fs.allow`, both repointed one level deeper.
- `apps/window-display/vite.config.ts`: `@` alias (`../customer-frontend/src` → `../customer-website/src`) and `fs.allow`.
- `apps/window-display/tailwind.config.ts` and `tsconfig.json`: same `../customer-frontend` → `../customer-website` fix in their `content`/`paths`/`include` globs — **these do not surface as TypeScript or build errors when broken** (Tailwind silently generates no styles for unmatched content globs; `tsconfig` `include` silently excludes files), so they were only caught by an explicit repo-wide grep re-scan, not by `tsc`/`vite build` succeeding.
- Six `../../shared/...` / `../../../shared/...` references across `apps/customer-website`, `apps/admin-console`, and `apps/window-display` source files (menu data, table config, kiosk config), each needing one more `../`.
- `apps/api/prisma/seed.ts`, `seed-status.ts`: `require('../../shared/...')` calls, needing one more `../`. **Not caught by `tsc --noEmit`** (dynamic `require`, not a statically-checked import) — verified by direct `node -e` path resolution instead.
- `apps/api/src/tables/tables.service.ts`: a 4-candidate runtime path-resolution fallback (`cwd`-based and `__dirname`-based, for different dev/prod/dist layouts), all four candidates needing one more `../`. Verified by resolving all four candidates directly against the actual `apps/api/dist/src/tables/` build output.
- `apps/api/src/media/media.service.ts`: `MediaService`'s `projectRoot` detection walked up **exactly one** parent directory looking for `docker-compose.yml` — correct when `backend/` sat directly at repo root, silently wrong (resolves to a nonexistent nested path, `mkdir -p` would have created bogus new directories rather than erroring) once `apps/api/` sits two levels down. Changed from a single fixed-depth check to a small bounded walk-up loop. **This was not caught by any type-check, lint, or build** — found and fixed only by directly simulating the resolution logic with Node and observing it return the wrong `projectRoot`.

### Docker / scripts / environment

`docker-compose.yml` service names renamed to match (`backend`→`api`, `kiosk`→`window-display`, `admin`→`admin-console`, `tablet`→`order-tablet` — now builds `apps/admin-console` with `VITE_APP_MODE=tablet` instead of the removed `tablet-frontend`, `kds`→`kitchen-display`). `docker/backend.Dockerfile`, `docker/frontend.Dockerfile`, and `docker/start-backend.mjs` updated to the new `COPY`/`--workspace=` paths; the container-internal storage path changed from `/app/backend/storage` to `/app/apps/api/storage` for consistency (purely internal to the container, no external consumer). `scripts/dev.mjs`, `scripts/validate-menu.mjs`, `scripts/db-local-reset.mjs`, `scripts/db-status.mjs` updated (workspace paths, `FRONTEND_DIRS`, `SERVICES`, user-facing error-message text). `.gitignore`/`.dockerignore` path entries updated. The two `Asset/video/intro.mp4` symlinks (`customer-frontend/public/video/`, `kiosk-frontend/public/video/`) were recreated with corrected relative targets — a plain directory `mv` does not rewrite a symlink's stored relative-path string, so these would otherwise have silently pointed at a nonexistent location one level too shallow.

## Package dependency boundaries

Not materially exercised this pass — no `packages/` directory was created (see "Deferred" below). The boundary that *was* enforced: **apps never gained new app-to-app runtime dependencies**. `apps/window-display`'s pre-existing `@` alias into `apps/customer-website/src` is a carry-over from before this migration (not introduced by it) and is recorded as existing technical debt, not endorsed as a pattern to repeat.

## Compatibility decisions

- **Ports unchanged**: 3000 (API), 5173 (customer-website), 5174 (window-display), 5175 (kitchen-display), 5176 (admin-console), 5177 (order-tablet).
- **npm script names changed** (`dev:backend`→`dev:api`, etc.) — no CI exists in this repository and no external consumer of the old script names was found, so this was a clean rename rather than requiring a compatibility alias.
- **Docker Compose service names changed** (`backend`→`api`, etc.) — same reasoning; `docker compose up backend` becomes `docker compose up api`.
- **Database schema, migrations, and API contracts**: untouched by this migration.

## Validation performed

Full command list and results in the handoff response for this session. Summary: `npm install` (workspace resolution), `tsc --noEmit` × 4 workspaces, `vite build` × 6 (customer-website, window-display, admin-console plain/tablet/kds modes, — 3 modes of the same app), `nest build` (apps/api), `eslint` × 4 workspaces (pre-existing lint debt found and left alone — confirmed via targeted grep that none of it is a module-resolution error), full test suites (`apps/api`: 412/412 Jest tests passing across 42 suites; `apps/admin-console`: 30/30 Vitest tests passing; `apps/venue-connector`: `dotnet build` + `dotnet test`, 28/28 xUnit tests passing).

## Known deferred structural work

See `_bmad-output/implementation-artifacts/deferred-work.md`, "Deferred from: repository restructure to apps/ (2026-08-17)":

1. `apps/window-display` still contains a reachable ordering flow and an untested duplicate KDS — not yet boundary-compliant.
2. `apps/order-tablet` / `apps/kitchen-display` independence requires a dedicated shared-package extraction story, gated on Story 15.1's authentication-model decision.
3. `docker compose --profile host build` and Vercel deployments were updated by inspection but not executed against real infrastructure this session.
4. No `apps/order-tablet` Vercel deployment config exists (the old `tablet-frontend/vercel.json` had no evidence of real use).

## Migration date

2026-08-17.
