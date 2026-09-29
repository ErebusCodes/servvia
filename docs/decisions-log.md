# Verdura Decisions Log

> **Current operating authority, 2026-09-28:** [ADR 0001: Servvia is the operational POS](./adr/0001-servvia-is-the-operational-pos.md) (DL-115). It supersedes the Target Operating Model's IdealPOS authority and the entries it names below. The 2026-08-15 notice that follows is kept as the historical record.

> **Current operating authority — 2026-08-15:** [Target Operating Model](./target-operating-model.md) is normative for all Verdura-originated orders and supersedes contrary sequencing in earlier entries.

> **Authority notice — 2026-08-15:** Early entries below document a different repository state. Their observations and file paths are historical unless a later entry revalidates them. Current product authority is PRD v5.2; implementation/readiness authority is [mvp.md](./mvp.md). A `NullAdapter`, mock UI, queued database row or simulated external ID never constitutes completed integration.

## 2026-09-28 — DL-115: Servvia is the operational POS

**Decision:** Recorded in full as [ADR 0001](./adr/0001-servvia-is-the-operational-pos.md).
- Servvia Core owns canonical restaurant transaction state: Order, TableSession, Check, Payment, Settlement, KitchenTicket, Shift, Terminal, Device, idempotency, audit and outbox.
- PostgreSQL is authoritative.
- IdealPOS is legacy integration only during migration and is then retired.
- External POS delivery is not part of the canonical transaction model.

**Supersedes:**
- Target Operating Model §1–3
- DL-060, DL-061 and DL-064 (the vendor gate becomes legacy-only)
- DL-072 for tax and payable-total authority (its NZ GST-inclusive facts stand)

**Partially supersedes or amends:** DL-062, DL-063 and DL-105. Each superseded entry below carries a pointer back here. None of them has been rewritten.

**First implementation:** the IdealPOS handoff was moved out of `OrdersService` into the temporary `apps/api/src/legacy-external-pos/` boundary. Behaviour is unchanged for IdealPOS venues. See [`docs/migration/`](./migration/README.md).

**Not decided here:**
- the replacement in-person payment terminal
- NZ receipt and tax-invoice obligations
- the 11 October 2026 go-live

## 2026-09-01 — DL-105: Verdura Technology Ownership Standard — Current MVP separated from Approved Target Architecture

**Decision:** [`architecture.md` §10](./architecture.md#10--technology-standard-current-mvp-and-approved-target-architecture) is now the single canonical Verdura technology ownership standard, replacing the former flat "§10 Technology Stack Summary" table. It explicitly separates **current MVP implementation** from **approved target architecture**, and records migration ownership boundaries rather than treating today's stack as permanent.

**Approved target ownership:** React + TypeScript → web applications. Kotlin + Android → native device applications. **Go → Core Platform** (transactional business services, orders, venue state, table/order lifecycle orchestration, staff/authorization orchestration, menu/platform APIs, connector command orchestration, device/venue configuration, event publication) **and Venue/Edge** (cloud-to-venue communication, durable local command handling, sync, retries, telemetry, edge state, platform-independent venue orchestration). **Python → AI/Data/Analytics** (analytics, pipelines, forecasting, optimization, ML, anomaly detection, menu intelligence, kitchen analytics, demand prediction). C#/.NET → the Windows/IdealPOS integration boundary only. PostgreSQL → transactional source of truth. Google Cloud Storage → media. Docker → packaging/deployment standard. Go and Python are recorded as **first-class target technologies, not optional/future**.

**Current MVP is explicitly not the target.** NestJS/Node + TypeScript + Prisma core services, Node.js/PM2 on-premise services, and the current breadth of .NET venue-connector orchestration are labelled CURRENT IMPLEMENTATION of capabilities the target standard assigns to Go. React + TypeScript + Vite, PostgreSQL, Redis, GCS and Docker are already target-aligned and unaffected.

**Key boundaries recorded:** (1) **Go owns transactional truth; Python derives intelligence** — Python must never own create-order, close-table, payment lifecycle, staff transactional state, venue transactional truth, POS command truth, or transactional menu/order source-of-truth operations. (2) **Go Venue/Edge owns general platform-independent edge orchestration; C#/.NET stays a narrow IdealPOS/Windows adapter** (vendor SDK, Webit, IPS/POSServer, Windows APIs, UI Automation, interactive terminal agent) and must not become a competing general Core Platform or general edge platform. This does not alter the existing outbound-only, mutually authenticated connector trust boundary (DL-054, `target-operating-model.md` §8) — that constraint applies to whichever technology implements the connector. (3) Existing React-based device surfaces (KDS, Order Tablet, Window Display, Kiosk) remain valid; Kotlin/Android is the standard for **new** native device apps and for migrations that materially improve device control, reliability, kiosk behaviour, offline operation, peripherals, lifecycle or device management.

**Exceptions and prohibitions:** Next.js is a **permitted exception, not a general standard** — public customer website only, where SSR/SEO/metadata/public-web performance materially justify it; no blanket migration of Admin, KDS, Order Tablet or Window Display. Kubernetes is a **later-scale deployment option** — not required for MVP, not required for Go adoption, not an application architecture standard; preferred progression is Docker → managed container runtime → Kubernetes/GKE. Docker is standard for packaging, but the native IdealPOS Windows stack (`IPS.exe`, `POSServer`, `IdealposService`, Windows/IdealPOS C# adapters, the interactive UI-automation agent) is explicitly exempt. **Bun** is not part of the approved architecture (no unique ownership domain; specifically not to be introduced to optimize Node tooling during a migration away from Node-owned core services). **Rust** requires a specific architecture exception. **Rails** and **Laravel** must not be introduced (duplicate Core Platform responsibilities). **Django** is not automatically approved by Python's approval — permitted only inside the Python AI/Data/Analytics domain with specific justification, never as a second general transactional backend.

**Governance rule added:** *No new implementation may create a second long-term owner for an existing capability.* Temporary migration overlap requires all five of: a defined source owner, a defined target owner, explicit cutover criteria, explicit retirement criteria, and a bounded migration period.

**Amended 2026-09-28 by DL-115 / [ADR 0001](./adr/0001-servvia-is-the-operational-pos.md):**
- C#/.NET is also the Windows POS terminal technology, as a client of Go Core.
- Kotlin/Android is the target for every dedicated venue device app, and the existing React device runtimes are migration sources.
- The IdealPOS-adapter role of C#/.NET is legacy.
- The rest of this entry stands.

**Scope of this entry:** documentation only. No code, service, dependency, or deployment was changed, and no Go, Kotlin, Python or Next.js implementation exists in this repository today — this entry records the approved destination and the rules for reaching it, not work performed. Secondary alignment: `README.md` §2 relabelled as current implementation with a pointer to §10 (it previously read as the standing technology standard). No other document was found to contradict this standard.

## 2026-08-25 — DL-104: Order Tablet Production-Readiness Pass — CI Fixed Green, Secrets Hardened, Documentation Provenance Reconciled; Real IdealPOS Delivery Still NOT YET VERIFIED

**Status:** All 7 CI jobs on `main` verified green for the first time since this workflow existed (previous HEAD `9033692`: 4 of 7 red; every prior run before that was also red). Nothing about real Windows/IdealPOS hardware was touched or newly claimed — that gate is unchanged and remains the correct terminal blocker.

**Why CI had never gone green, layer by layer (each layer was hidden behind the one before it, so fixing one revealed the next):** (1) `apps/api` had 391 lint errors, all `@typescript-eslint/no-unsafe-*` noise from supertest's `Response#body` being typed `any` by design — scoped an override to test files only (`eslint.config.mjs`), leaving production `src/` at full strict typing. (2) `apps/admin-console` had 36 lint errors across mostly-unrelated pages (reservations, table-management, reports, kitchen, inventory) — each fixed on its own merits (see below), not blanket-suppressed. (3) `apps/window-display` had 6 (four inert `@ts-ignore`s on cross-workspace JSX imports that `tsc` proved produce zero errors either way, plus two genuinely dead exports). (4) `apps/customer-website` had ~30 typecheck errors, all the same root cause: `tsc -p jsconfig.json` (checkJs) infers a component's prop type from its own destructuring pattern, so any optional prop without a default value gets flagged as "missing" at every call site that omits it — fixed with semantically-neutral default values, not suppressions. (5) Clearing all of the above let the API and admin-console *test* steps run for the first time — surfacing three more real, previously-invisible problems: `apps/admin-console`'s `sha256Hex()` failed under Node 20's jsdom (CI's pinned version; this session's own Node is 24) because `File.arrayBuffer()`'s result fails `crypto.subtle.digest()`'s strict `ArrayBuffer` instanceof check in that environment — fixed by normalizing through `new Uint8Array(buf)`. `apps/api`'s `GcsStorageProvider` assigned an un-awaited, uncaught promise to `this.storage` in its constructor — a real latent bug, not CI-only: if that promise ever rejects before something awaits `this.storage` (true whenever GCS Application Default Credentials are unavailable, e.g. this CI job, or a transient credential problem in a real deployment), it's an unhandled rejection that crashes the whole Node process. Fixed with a no-op `.catch()` that doesn't consume the promise for its real awaiters. And two CI jobs (`api-lint-typecheck-unit`, `admin-console`) had no `env:` block at all, so `ConfigModule`'s Joi-required vars and `VITE_VENUE_ID` were simply unset — added, matching values already established elsewhere in the repo (`api-integration`'s existing CI-only values; `.env.example`'s documented dev-seed venue).

**Every fix was reproduced against a real Node 20 container** (`docker run node:20`, fresh `git clone` — not `cp -r`, which was initially and silently leaking this session's own `.env`/`node_modules` into an early, falsely-passing reproduction attempt), not assumed from a locally-passing run on a different Node major version.

**Two real (non-lint) defects fixed along the way**, found while investigating *why* a variable was unused rather than just deleting it: `ReportBuilder.tsx` clicking a saved report only pre-filled local form state — it never called the `onLoadReport` prop the parent actually needed to switch tabs and confirm the load; now calls it. `AuditLogsPage.tsx` had a catch block silently swallowing a corrupted-localStorage error with zero logging, inconsistent with an identical sibling block two lines above it; now logs the same way. Everything else removed was independently confirmed dead (no other consumer, nothing in JSX referencing it) rather than assumed dead from the lint error alone.

**Secrets:** `INTERNAL_SERVICE_TOKEN` and `SEED_OWNER_PASSWORD` had checked-in insecure-default values (`local-docker-service-token-change-me`, `change-me-in-production`) with no fail-closed protection in production, unlike `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`ADMIN_CONSOLE_PIN` which already had it (`insecure-default-secret.util.ts`/`insecure-default-pin.util.ts`). Extended the same pattern to both.

**Deploy config:** `docker-compose.yml` had `order-tablet`/`admin-console` published ports inverted relative to `scripts/dev-lock.mjs`'s canonical map — the 2026-08-24 dev-tooling port fix (commit `9033692`) had touched dev tooling only, not this file. Fixed, and `scripts/dev-lock.test.mjs` extended with 5 new regression tests (one per service) that read the compose file's actual port mappings and cross-check them against `CANONICAL_PORTS`, so this exact class of drift can't silently recur.

**Documentation provenance reconciled, not just re-asserted:** `sprint-status.yaml` marked stories 15-4/15-5 "done"/correctly-"blocked" while citing commits (`a4081a4`/`d32cc50`/`0855193`) and a branch (`order-tablet-idealpos-reconciled`) that do not exist anywhere in this repository's history (`git rev-parse` fails on all three hashes; the branch exists neither locally nor on `origin`) — the same class of gap DL-094 itself already flagged. The underlying engineering claims were independently re-verified this session by direct code inspection and real test execution against `main` HEAD, and mostly held up (idempotent submission, truthful totals, fail-closed `posProductCode` mapping, the connector lease/CAS protocol) — it was specifically the *citations* that were false, not the code. Replaced the false provenance with what was actually verified this session, and corrected 15-11's now-simply-false "zero test files exist" claim (127/127 admin-console tests exist and pass). `apps/order-tablet/README.md` was independently stale on the same three points, plus one more found during this session's own investigation: it claimed Order Tablet is "the only Verdura application authorised to construct and submit orders," which is false — `apps/window-display`'s `KioskOrderPage` (`POST /api/kiosk/orders`) is a separate, real, reachable customer-self-service path with its own Stripe card-present payment step, sharing Order Tablet's idempotency/KOT-exclusivity guarantees via the same `OrdersService.persistOrder` core. `apps/window-display/README.md` already documented this honestly and did not need correction. `apps/venue-connector/README.md`'s test count (claimed "22 unit + 4 crash/replay") was stale in the safe direction — real count today, confirmed via `dotnet test`: 75/75 passing.

**Explicitly still NOT YET VERIFIED, unchanged by this session:** real IdealPOS/EFTPOS hardware delivery. No Windows host, no real IdealPOS installation, and no live IdealposBridge instance were available in this session — every claim about native IdealPOS consumption, KOT generation, or physical kitchen print remains exactly as unproven as before this session started. Nothing above should be read as evidence toward that gate; DL-064 remains the correct, unmet blocker for 15-5/15-12/the 11 October journey.

## 2026-08-23 (k) — DL-103: Customer Website and Window Display Hero Videos Moved to GCS

**Status:** Complete. Both apps now load the hero video from Verdura's existing public-media GCS bucket instead of a local/symlinked repository file; both local `public/video/intro.mp4` dependencies are gone (one deleted, one never existed on disk — see below); verified via source, real `gcloud storage`/`gsutil` queries against the live bucket, production builds, and real-Chrome network/byte-level checks (Mac only — see Windows caveat below).

**Existing architecture reused, not reinvented:** the GCS public-media pipeline documented in README §4.3 and `_bmad-output/implementation-artifacts/2026-08-17-gcs-media-architecture.md` (buckets `verdura-media-originals-d3794338b2`/`verdura-media-public-d3794338b2` in `project-10bd9c5c-d379-4338-8b2`, ADC + service-account impersonation, no key files). That work had already externalized 46 menu-item photos and several `website/*` static images (`website/about/`, `website/contact/`, `website/home/`, `website/shared/`) — an established `website/<section>/<file>` convention for first-party static site assets outside the per-venue `MediaAsset`/`MenuItem` model. `gcloud storage ls gs://verdura-media-public-d3794338b2/website/hero/` found the hero video **already uploaded** at `website/hero/intro.mp4`, from an earlier, undocumented session (object metadata: `x-goog-meta-source-path: Asset/video/intro.mp4`, created 2026-08-17). Its `x-goog-meta-sha256` (`fc9228b7…5c4ce`) was verified byte-for-byte identical to a fresh local `shasum -a 256 Asset/video/intro.mp4` of this branch's current file before trusting it. No new upload was performed — this task reused that existing, verified, already-public object rather than creating a duplicate.

**One shared object, not two:** `apps/customer-website`'s and `apps/window-display`'s local video references were confirmed (not assumed) to be the exact same content — both ultimately resolved to the one physical `Asset/video/intro.mp4` (window-display via a `public/video/intro.mp4` symlink; customer-website via a build-time Vite-alias import of the same absolute path, a materially different mechanism than window-display's — see below). Since the hashes are identical and an existing convention/object already covers this content, both apps now reference the single object `https://storage.googleapis.com/verdura-media-public-d3794338b2/website/hero/intro.mp4` — matching the source code's own long-standing design intent ("shared... not bundled/duplicated per app") rather than creating two redundant GCS objects.

**The two implementations were confirmed different, per this task's own instruction not to assume:** `apps/window-display/src/pages/KioskWindowSignagePage.tsx` referenced the video as a plain public-asset URL (`/video/intro.mp4`, served by the dev/build static-file layer via a symlink — the exact mechanism DL-102 just repaired). `apps/customer-website/src/pages/Home.jsx` instead held a non-functional-looking literal (`"~/verdura_MVP/Asset/video/intro.mp4"`) that a custom Vite `transform` plugin (`apps/customer-website/vite.config.js`) rewrote at compile time into a real `import` of that alias-resolved absolute path, letting Vite's asset pipeline serve it directly from outside the workspace (`server.fs.allow` was configured specifically to permit this). Both mechanisms are now removed in favor of a plain URL string, and the now-dead `Home.jsx` video-transform branch in `vite.config.js` was removed (the other, unrelated image-transform branches for Home/About/Contact were left untouched — out of scope).

**Upload/integrity verification (of the pre-existing object, confirmed this session):** `gsutil stat` → `Content-Type: video/mp4`, `Content-Length: 65995858` (matches local file exactly), `Hash (crc32c)`/`Hash (md5)` present, custom metadata `sha256` matches a fresh local hash. Public HTTP delivery independently verified via anonymous `curl` (no auth) — `200`/`206`, `accept-ranges: bytes`, correct `content-type`/`content-length` — and via `fetch()` executed inside a real Chrome tab on both `localhost:5173` and `localhost:5174`, confirming the first bytes decode to the MP4 `ftyp`/`mp42` container header.

**Application changes:** `apps/window-display/src/pages/KioskWindowSignagePage.tsx`, `apps/customer-website/src/pages/Home.jsx`, `apps/customer-website/src/assets/index.js` (`homeHeroVideo` — confirmed unused/dead-code today, updated anyway since it's literally the asset in scope) now hold the GCS URL directly, matching the exact convention already used for `MenuItem.imageUrl` (a full, direct `https://storage.googleapis.com/...` URL, not a runtime-interpolated env var — there is no existing frontend media-base-URL abstraction to reuse, and inventing one for two call sites would be the "unnecessary new abstraction" this task was told to avoid). `apps/customer-website/vite.config.js` had its now-dead video-transform branch and a now-stale comment removed.

**Local files:** `apps/window-display/public/video/intro.mp4` (a symlink, created earlier this session by DL-102) was deleted after the GCS reference was verified working. `apps/customer-website/public/video/intro.mp4` was never present in this checkout at any point in this session — there was nothing to delete there; its actual local dependency (now removed) was the direct `Asset/video/intro.mp4` import described above. `Asset/video/intro.mp4` itself (the original 66MB master, still git-tracked) was deliberately **not** deleted — outside this task's explicit two-file deletion scope; flagged as a follow-up.

**Regression evidence:** `npm run build:window-display` (`tsc -b && vite build`) and `npm run build --workspace=apps/customer-website` both succeed, and neither `dist/` output contains `intro.mp4` or any video asset any more — resolving `AUDIT_REPORT_V2.md`'s previously-flagged "66 MB `intro.mp4` bundled directly into `dist/assets`" finding as a side effect. `npm run lint --workspace=apps/customer-website` is clean. `npm run lint --workspace=apps/window-display` reports 3 pre-existing errors (`@ts-ignore`, two unused variables) at lines nowhere near this change (confirmed via `git diff` isolation) — not introduced by this task, not fixed by this task (out of scope).

**Explicitly not claimed:** Windows browser verification. Only this Mac's real Chrome was exercised (network/byte-level proof solid on both apps; pixel-confirmed motion playback was not obtainable in the automation tab used — see DL-102 for the identical, already-diagnosed `document.hidden` limitation of this tooling, unrelated to the app). Windows itself was not tested this session.

## 2026-08-23 (j) — DL-102: Window Display Hero Video Was Missing Locally (Stale `.gitignore` Rename), Not a Windows-Specific Defect

**Status:** Fixed and verified live on this Mac's dev server (curl + real-Chrome network/byte checks); Windows itself not tested this session (no remote access).

**Root cause:** `apps/window-display/public/video/intro.mp4` — the file `KioskWindowSignagePage.tsx`'s hero `<video>` requests — did not exist on disk in this checkout, so Vite's dev server fell back to serving `index.html` (its default SPA-fallback behavior for any unmatched path) instead of a 404. The `<video>` element received an HTML document instead of MP4 bytes, producing a black/static hero while the rest of the page rendered normally. Reproduced live via `curl` before any fix (`200 text/html`) — **this was not Windows-specific**; it reproduced identically on this Mac.

**Why the file was missing:** the video is meant to reach `window-display` (and `customer-website`) via a symlink to the single master `Asset/video/intro.mp4`, exactly as each app's own code comments already documented. The root `.gitignore`'s `*.mp4`-blocking block carried two negation exceptions still pointing at the pre-2026-08-17-restructure directory names (`customer-frontend/`, `kiosk-frontend/`) instead of the renamed `apps/customer-website/`, `apps/window-display/` — so any symlink recreated at the *current* correct path was silently git-ignored, uncommittable by anyone, on any machine.

**Fix:** corrected the two stale `.gitignore` paths; recreated `apps/window-display/public/video/intro.mp4` as a symlink to `../../../../Asset/video/intro.mp4`. Verified via `curl` (was `200 text/html`, became `200`/`206` `video/mp4` with correct `Content-Length`/range support) and via a real Chrome tab (`fetch()` from the page's own JS context returned real MP4 `ftyp`/`mp42` bytes; no console errors).

**Known limitation of this session's verification:** the automated Chrome tab used (`claude-in-chrome`) reported `document.hidden === true` / `visibilityState: "hidden"` throughout, on every tab opened, unaffected by click/focus — a property of this specific tooling (Chrome throttles media buffering on backgrounded tabs), not the application. Pixel-confirmed video motion was therefore not obtained; the underlying defect (missing/mistyped asset, proven via HTTP headers and real decoded MP4 bytes) is fixed regardless.

**Superseded same day:** DL-103 (above) moves this video off local storage into GCS entirely, deleting the symlink this entry created.

## 2026-08-23 (i) — DL-101: Order Tablet Windows Enrollment/PIN Discrepancy — Root-Caused, No Code Defect Found, Windows Browser Acceptance Still NOT YET VERIFIED

**Status:** Investigation complete against this Mac's live local stack (source + passing test suites + direct query of the running dev Postgres database). No code change made — evidence shows the implementation is correct. Windows-side browser acceptance was **not** executed this session (no remote-execution access to the Windows machine) and must not be treated as proven until it is.

**Trigger:** a Windows browser (via AnyDesk) showed the pre-enrollment screen ("VERDURA ORDER TABLET" / "Invalid or expired enrollment code") while a Mac browser on the same branch/commit showed an already-unlocked device ("repro-test" / PIN screen), raising a concern that Windows device auth had regressed or was never really proven.

**Root cause — enrollment stage (why Windows never reached the PIN screen):** `TabletEnrollment` codes (`apps/api/src/tablet/tablet-auth.service.ts`) are, by design (DL-081), single-use (CAS-guarded `usedAt`), 15-minute TTL, and scoped to whichever Postgres database issued them. Live query of this Mac's dev DB confirms every enrollment row created today is already `usedAt` (including the one that produced "repro-test", consumed within 68ms of creation — normal immediate redemption). This Mac's dev stack (`scripts/dev.mjs`, confirmed via process cwd) runs its own local API (`:3000`) against its own local Postgres (`verdura-postgres-1`, port 5434) — nothing here is shared with the separate Windows checkout at `C:\Users\Posmate\Desktop\verdura_MVP`, which — per this repo's dev tooling design (`vite.config.ts` proxies `/api` to `localhost:3000` unless `VITE_API_URL` is set; every `.env` is machine-local and gitignored) — runs its own independent API/DB unless deliberately configured otherwise. A code minted on one machine's database cannot resolve on the other's; reusing an already-consumed or cross-environment code produces exactly the observed "Invalid or expired enrollment code," which is the enrollment guard working as designed, not a defect.

**Naming — resolved, intentional, not a defect:** "VERDURA ORDER TABLET" (`TabletDeviceGate.tsx:104`) is fixed pre-enrollment product branding, shown whenever no device identity exists yet — there is no device to name at that stage. "repro-test" is not a venue name (`Venue.name` = "Verdura Auckland" in this DB) — it is the operator-chosen `label` typed into the Admin Console's "Create enrollment code" field at issuance time (`TabletDevicesPage.tsx`), carried onto the resulting `TabletDevice.label` row on redemption, and rendered as the PIN screen's title once a device is enrolled (`device.deviceLabel || 'VERDURA ORDER TABLET'`). Pre-enrollment generic branding vs. post-enrollment operator-assigned device label are two different, correctly-separated concepts.

**PIN 108 — two independent, intentional reasons it can legitimately fail that must be checked before assuming a bug, given this task is explicitly validating a "production-ready" build:** (1) `IsPinLength` (`apps/api/src/auth/validators/pin-length.validator.ts`) requires 4+ characters once `NODE_ENV === 'production'` (3 allowed only outside production) — a 3-character PIN fails DTO validation outright in production. (2) `assertPinNotInsecureDefault` (`apps/api/src/auth/utils/insecure-default-pin.util.ts`) makes `/api/tablet/unlock` fail closed with a 500 whenever `NODE_ENV === 'production'` **and** the configured venue PIN still equals the checked-in insecure default `'108'` — a deliberate DL-081 production hardening, not a bug. This Mac's running API confirmed `NODE_ENV=development`, so neither guard fires and `108` (`KDS_VENUE_PINS` scoped to venue `10000000-0000-4000-8000-000000000001`) unlocks normally. **If the Windows environment's API process has `NODE_ENV=production` set — plausible, since the task is explicitly about validating a "production-ready" build — `108` is structurally guaranteed to fail there by design, even after enrollment succeeds, and must not be worked around by weakening either guard.** This is also why the task's own guardrails forbid hardcoding/bypassing `108`: doing so would defeat exactly the protection DL-081 built.

**What was NOT done this session:** no access to the Windows machine (`C:\Users\Posmate\Desktop\verdura_MVP`) or its AnyDesk session — this repo's tools have no remote-execution path to it. Windows-side enrollment, PIN unlock, floor-plan reach, reload-persistence, and negative-path checks remain **NOT YET VERIFIED** and must be executed and reported by whoever has hands-on/AnyDesk access to that machine, using the diagnostic/provisioning procedure this session produced (generate a fresh enrollment code from the Windows *Admin Console's own* Tablet Devices page — not a code copied from Mac — enter it within 15 minutes, and confirm `NODE_ENV` on the Windows API process before assuming a PIN failure is a bug).

**Documentation correction (Phase 6 of this investigation):** `_bmad-output/implementation-artifacts/sprint-status.yaml`'s `15-1-tablet-venue-and-auth-decision` line had read `backlog` since 2026-08-16, contradicted by DL-081 (ratified/implemented 2026-08-18, including a same-day real-browser validation pass) and by the code itself. Corrected to `done` with a note distinguishing "device auth logic is PROVEN on the Mac stack it was actually browser-tested against" from "Windows browser acceptance is NOT YET VERIFIED" — no prior artifact in this repository claimed Windows validation as proven; that claim, where it was made in conversation, was not backed by Windows-side execution and should not have been stated as resolved.

**Consequences:** no code changed, no migration run, no `.env` changed on any machine, nothing committed. Device enrollment/PIN/revocation logic: re-confirmed correct via source review + full existing test suites (`tablet-auth.service.spec.ts`, `tablet-device.guard.spec.ts`, `pin-length.validator.spec.ts` — 38/38 passing, zero changes). Windows Order Tablet login/startup: **NOT YET VERIFIED**.

## 2026-08-23 (h) — DL-099: Controlled Windows + IdealPOS Validation Package Prepared

**Status:** Planning/documentation only. No hardware accessed, no code changed, no order submitted.
Full package: `_bmad-output/implementation-artifacts/dl-099-windows-validation-package.md`.

**What this is:** composes the existing Bridge Table 12 preflight package (external repo,
`/Users/sarwarkhan/Documents/IdealposBridge/docs/table12-preflight/`) with the Connector's own
deployment requirements (env vars, enrollment flow, build command) into one operator-executable
package, with evidence requirements for connector/Bridge/native-consumption/modifier/KOT kept in
strictly separate tiers throughout, per this repo's own standing evidence-tier rule.

**New gaps found while composing (not previously flagged):** the Connector has no packaging script
(unlike the Bridge's `build-and-package.ps1`) and the exact `dotnet publish -r win-x64` command for
`VerduraIdealposTracer.Cli` has never been run successfully anywhere — the first real Windows build of
this artifact is itself part of what the validation proves. The Connector also has no file/Event Log
logging provider yet (console only) and no Windows-Service-account guidance — both noted as reasons to
run it in the foreground for the first controlled test, not as a Windows Service.

**Consequences:** no production-readiness status promoted. Validation package prepared: YES. Native
proof: NOT YET VERIFIED. Hardware access: REQUIRED — unchanged, this task cannot close that gap.

## 2026-08-23 (g) — DL-098 Gated: No Real Windows Environment Reachable This Session

**Status:** Gate 0 blocker (Path B outcome) — not executed, not fabricated. No code/schema change.

**What was attempted:** re-examined the existing, already-prepared `docs/table12-preflight/` package
in the external Bridge repository (`/Users/sarwarkhan/Documents/IdealposBridge`) — operator runbook,
`evidence-queries.sql` (read fully this pass; confirms the exact native-consumption evidence shape:
`WebPendingOrder.Processed=1`/`DateProcessed` for H3, `PendingSales.Code` vs the requested
Caption/Code for H2), `request-fixture.md`, `table-assignment-review.md` — with the specific goal of
executing it to resolve the Bridge-internal Caption→native-`Code` question DL-097 deliberately left
open. Framed four separable hypotheses (table validation / native table translation / native
consumption / KOT), per this pass's own governing task.

**Why it stopped at Gate 0:** this session has no SSH configuration, no known Windows host in
`~/.ssh/known_hosts`, and no remote-execution tool connected to any Windows machine — verified
directly, not assumed. There is no real Windows/IdealPOS environment reachable from here at all, let
alone one confirmable as disposable/authorized/safe per the preflight's own Phase 0 gate. The one real
Idealpos installation this project has ever recorded (2026-08-21 SSH discovery, `DESKTOP-SOKKOQ7`) is
not reachable this session, and its only known checkout of this Verdura repository is the explicitly
protected `C:\Users\Posmate\Desktop\verdura_MVP` path — never accessed, consistent with every prior
DL-094–097 session's own standing constraint.

**Decision:** do not fabricate execution evidence. DL-098 remains blocked exactly where DL-096 already
placed it — real Windows/IdealPOS access is a standing prerequisite (DL-064) this session cannot
supply. Nothing about the existing Table 12 preflight package was found unsound or needing a rewrite;
it remains ready to execute unchanged the moment real access exists.

**Consequences:** no production-readiness status changes. Native IdealPOS Consumption and Native KOT
Printing remain NOT YET VERIFIED; the Bridge-internal Caption→native-`Code` question DL-097 identified
remains NOT YET VERIFIED, unchanged.

## 2026-08-23 (f) — `Table.posTableCode` Contract Formalized: IdealPOS `TableMapSetups.Caption`

### DL-097 — `Table.posTableCode` holds IdealPOS's `TableMapSetups.Caption` string, never `.Code` or `Table.tableNumber`; this was already the implemented and tested behaviour, only lacking a top-level decision record

**Status:** Documentation-only pass, no code/schema change (none needed), no hardware accessed. Full
report: `_bmad-output/implementation-artifacts/dl-097-table-posTableCode-contract.md`.

**Decision:** `Table.posTableCode` = the exact string `VerduraIdealposBridge`'s `GET /api/tables`
returns as `TableDto.Table` (sourced from `dbo.TableMapSetups.Caption`) — the same string
`OrderValidator`/`OrderService.SubmitOrder` require the `POST /api/orders` request's `table` field to
match. Never `TableMapSetups.Code` (a separate internal integer), never derived from
`Table.tableNumber`. This was already decided and implemented in commit `76c0200` (2026-08-22,
predating DL-094/095/096) — this entry formalizes it at decisions-log level for the first time, so a
future session cannot reinterpret it without first finding and reading this entry.

**Evidence:** independently re-verified against the Bridge's own source this pass (not merely trusting
the existing schema comment): `IdealposReadRepository.GetTables()` maps `TableDto.Table` from the
`Caption` SQL column; `OrderService.SubmitOrder` builds its validation set from `TableDto.Table`;
`OrderValidator.Validate()` rejects any request `table` value not in that set. On the Verdura side, the
payload mapper passes `Table.posTableCode` straight through with no transformation and fails closed
(`unmapped_table`) when null; the DTO validation is an unconstrained string (not numeric); and the
existing real-Postgres integration test (`tables-pos-mapping.integration-spec.ts`) already names its
own test value `PHASE2_CAPTION_...` and already documents the misrouting risk in Caption terms.

**Clarifies (does not contradict) DL-096:** DL-096 restated a genuinely open question from the external
Bridge repository's own `table-assignment-review.md` — whether the Bridge's internal
`ITableAssignmentStrategy` correctly causes native `PendingSales.Code` to match the requested table —
in a way that could be misread as "Verdura's `posTableCode` contract is unresolved." It is not, and has
not been since `76c0200`. That Bridge-internal question remains open, tracked where it already was
(the external repo's own docs and its Table 12 preflight, DL-096's Phase A), and is orthogonal to what
value `Table.posTableCode` holds.

**Risk if this had been wrong:** a Bridge `400 validation_failed` on the very first submission —
immediate and loud, never a silent misroute or a false-positive "success" discovered later. Current
code was already safe regardless (fail-closed on null, no derivation from `tableNumber`).

**Consequences:** No code, schema, or test change. PLU/Table Mapping's production-readiness tier is
unchanged (PROVEN, software/source-review evidence) — this pass adds independent-source-review rigor
to that evidence, not a new evidence tier. Native IdealPOS Consumption and Native KOT Printing remain
NOT YET VERIFIED, unaffected.

**Confidence:** [VERIFIED] — direct, independent read of the relevant Bridge source files this pass
(not a re-read of a prior claim), cross-checked against every Verdura-side reference to this field.

## 2026-08-23 (e) — Real Windows Connector Validation Readiness Gate

### DL-096 — A real, previously-uncommitted `IdealposBridge` implementation and its own Table 12 preflight validation package already exist outside this repository; the production chain still needs a Connector-inclusive test plan on top of it

**Status:** Planning-only pass, no code changed, no hardware accessed, no order submitted. Full report:
`_bmad-output/implementation-artifacts/dl-096-real-windows-connector-validation-readiness.md`.

**Finding:** `/Users/sarwarkhan/Documents/IdealposBridge` (and an older duplicate under `Idealpos
Solutions/`) contains a real `net48` Bridge service, already `dotnet build`/`dotnet publish -r win-x64`
verified against the real vendor DLLs (Idealpos v6.05.0001) on 2026-08-19, with a full independent
source review (2 P0s + 1 P1 found and fixed), a Windows Service install script, and a complete,
dated "Table 12" controlled-experiment preflight package (`docs/table12-preflight/`) — none of it
tracked by any version control system, and none of it previously cross-referenced against this
repository's DL-094/095 work. Its documented `POST /api/orders` contract was re-checked this pass
against `IdealposBridgeClient.cs` and matches exactly (including 502 classification). Its own
investigation surfaced a real, previously-undocumented risk that also applies to this repository:
Idealpos's `TableMapSetups.Caption` (string, what the Bridge validates against) and `.Code` (int, what
native `PendingSales.Code` is expected to actually use) are not proven to coincide, and this
repository's own `Table.posTableCode` has no documented convention for which one it should hold.

**Decision:** Treat the external Bridge repository's existing Table12 preflight as Phase A of a larger
plan, not something to re-derive — DL-096's Real Windows Test Plan adds Phase B (first-ever Connector
build/startup on real Windows) and Phase C (one controlled command through the full
Order→Dispatcher→Connector→Bridge chain) on top of it, gated on Phase A succeeding first. See the full
report for the exact sequence, evidence checklist (with connector-lifecycle vs native-IdealPOS vs KOT
evidence kept structurally separate), and failure-handling table.

**Consequences:** No production-readiness status changes as a result of this pass — Connector
Execution and Always-On Hosting remain PROVEN (software only, unchanged from DL-095); Native IdealPOS
Consumption and Native KOT Printing remain NOT YET VERIFIED. The single highest-priority next action is
resolving the Caption-vs-Code table-mapping ambiguity in writing (a documentation/decision task, not
code), before any real submission is attempted — see the report's §6 for why this, and not "get
hardware access" (already the standing DL-064 blocker), is the actionable next step.

**Confidence:** [VERIFIED] for the contract cross-check (direct source comparison, both sides) and for
the external repository's own build/review claims (read in full, not re-executed — its own
`validation-report.md` already discloses exactly what was and wasn't run and why). [NOT VERIFIED] for
anything requiring real Windows/Idealpos execution, unchanged by this planning-only pass.

## 2026-08-23 (d) — Venue Connector: Always-On Host Replaces Single-Shot CLI Invocation

### DL-095 — `IdealposOrderDispatcherService`'s Cli entry point becomes a continuous, restart-safe polling host under the .NET Generic Host, instead of one bounded 30-second poll per manual invocation

**Status:** Code change, isolated worktree (`/private/tmp/verdura-order-tablet-reconcile`, branch `order-tablet-idealpos-reconciled`). Nothing pushed; main's dirty tree untouched.

**Background:** DL-094 established `IdealposOrderDispatcherService`/`idealpos-order-payload-mapper.ts`/`VerduraIdealposTracer.Cli` as the sole, real, production-wired IdealPOS delivery path (`Cli/Program.cs:85` routes `idealpos.submit_order.v1` to the real `IdealposOrderSubmissionService`). But the Cli itself only ever polled once, processed at most the first of up to `MAX_POLL_BATCH=5` commands the server hands back per poll (`connector-command.service.ts:25`), and exited — bounded by a hard 30-second `CancellationTokenSource`. Operating this in production meant a human (or an external scheduler this repo never built or documented) re-launching the Cli over and over, and any command beyond the first in a batch sat claimed-but-unprocessed until its 2-minute lease (`CLAIM_LEASE_MS`, `connector-command.service.ts:23`) expired.

**Decision:** Cloud mode (`TRACER_MODE=cloud`) now runs under the standard .NET Generic Host (`Host.CreateApplicationBuilder` + `Microsoft.Extensions.Hosting.WindowsServices.AddWindowsService`) instead of exiting after one poll. The claim/execute/report dispatch logic itself moved, unchanged, into a new cross-platform, unit-tested class — `VerduraIdealposTracer.Core.Hosting.ConnectorPollingLoop` — which loops: poll, process every command the poll returned (not just the first), sleep, repeat, until the host's own shutdown token fires (Ctrl+C, SIGTERM, or Windows SCM stop). Local mode (`TRACER_MODE=local`, the discovery dry-run/real-discovery diagnostic) is completely unchanged — still one bounded, on-demand run.

No execution semantics changed: every command still goes through the exact same `DiscoveryTracerService.RunCloudModeAsync`/`IdealposOrderSubmissionService.RunCloudModeAsync` methods, the same accept-before-Bridge-call ordering, the same fail-closed handling of an unrecognized command type or unsupported schema version, and the same "never synthesize an outcome" posture on an unexpected exception (see `ConnectorPollingLoop.ProcessOneCommandAsync`'s catch block). Concurrency/duplicate-delivery safety is not reinvented — it is entirely the existing server-side lease + CAS `updateMany` protocol (`connector-command.service.ts`'s `poll`/`accept`); this loop (and even two instances of it running by accident) is only ever a client of that already-safe protocol. A losing `AcceptAsync` race now surfaces as a caught, logged, per-command error that the loop survives, rather than an uncaught exception that used to crash the whole single-shot process.

**Evidence:** 10 new unit tests (`ConnectorPollingLoopTests.cs`) covering start/stop lifecycle, prompt cancellation mid-delay, successful/deterministic-failure/transient-failure/network-failure command processing, duplicate command redelivery across polls, a multi-command poll batch, a losing accept-claim race, and restart recovery via a fresh loop instance — all against fake `HttpMessageHandler`s for the real poll/accept/report and Bridge contracts, the same technique this project's existing tests already use. Full regression: 65/65 (was 55/55) `dotnet test` on `VerduraIdealposTracer.slnx`, zero failures, zero reduced coverage. Additionally smoke-tested as a real separate OS process (a throwaway, non-shipped cross-platform harness swapping only the Windows-only automation client for the existing `FakeIdealposUiAutomationClient` fixture, since the real Cli cannot build on this non-Windows machine at all — see the "environment limitation" note below): confirmed real structured startup logs, real connection-refused poll failures retried with backoff without crashing, and a real graceful `SIGTERM` shutdown with clean process exit.

**Explicitly NOT claimed:** this is UNIT_OR_MOCK / dry-run-harness evidence for the *hosting/loop* behaviour only. It does not touch, and does not change the truth of, native IdealPOS consumption, native modifier handling, KOT generation, or physical printing — all of these remain NOT YET VERIFIED, exactly as DL-094 left them, pending real Table 12/Windows/IdealPOS hardware access (DL-064).

**Environment limitation (unrelated, pre-existing):** `VerduraIdealposTracer.Cli` (`net8.0-windows`) cannot be built on this non-Windows development machine — MSBuild aborts before reaching Cli's own compilation because its hard `ProjectReference` to `VerduraIdealposTracer.Windows` fails first (`System.Windows.Automation`/`AutomationElement` unavailable outside Windows). This is the same limitation already recorded for this project before today's change, confirmed unaffected by it (the failure is byte-identical, in the same file, at the same line, before and after this change).

**Confidence:** [VERIFIED] for the hosting/loop logic itself (unit tests + real-process smoke test); [NOT VERIFIED] for anything requiring the real Windows Cli build or a real Windows Service install, both blocked on the same pre-existing hardware/OS-access gate as DL-064.

## 2026-08-23 (c) — Order Tablet → IdealPOS Reconciliation: Rescue and Single-Owner Adoption

### DL-094 — The rescued `IdealposOrderDispatcherService` lineage is adopted as the sole authoritative IdealPOS delivery path; the competing, uncommitted `IdealposOrderReconciliationService` (main's dirty tree) is excluded, not merged

**Status:** Git-safety/architecture decision, executed inside an isolated worktree (`/private/tmp/verdura-order-tablet-reconcile`, branch `order-tablet-idealpos-reconciled`). Nothing pushed; main's working tree (committed HEAD and dirty tree alike) untouched.

**Background:** A prior session's validated IdealPOS delivery work (`a4081a4`..`bfef6d7`, 8 commits) existed only as a detached `git worktree` HEAD at `/private/tmp/verdura-15-4-worktree` — unreachable from any branch, and that same worktree also held a 9th, fully-tested but uncommitted layer (DL-093, stale-`unknown` recovery). Independently, main's own working tree carries a second, never-committed, more elaborate IdealPOS implementation (`IdealposOrderReconciliationService`: a 12-state `IdealposReconciliationState` machine, `IdealposEvidenceTier`/`IdealposDiscrepancyState`, authoritative-total comparison, plus orthogonal Story 15-6/8-1 work — payment observation, KDS delivery outbox, KOT dispatch producer, service mode). Both implementations target the same `POSSyncRecord` row family; running both would be incoherent (see rejected-alternative note below).

**Decision:** Rescued the 8 detached commits onto local branch `idealpos-connector-delivery` (exactly `bfef6d7`), committed the uncommitted DL-093 layer on top and protected it as `idealpos-connector-delivery-dl093` (`4589165`), then fast-forwarded a fresh worktree from current main HEAD (`24a1396`) onto that commit — a clean, conflict-free fast-forward, because `24a1396` is a direct ancestor of `4589165` (main's committed history never actually diverged from this lineage; only main's *uncommitted* tree did). `IdealposOrderDispatcherService` + `idealpos-order-payload-mapper.ts` is therefore the one and only IdealPOS delivery/mapping/retry owner going forward. Main's dirty-tree `IdealposOrderReconciliationService` and its migrations (`20260820020000_idealpos_order_reconciliation` and siblings) are deliberately **not** committed or merged anywhere — left exactly as uncommitted working-tree state, untouched, for a possible future salvage pass.

**Evidence for excluding `IdealposOrderReconciliationService` rather than reconciling a hybrid today:**
- Its own `schema.prisma` additions have no `Table.posTableCode`/`MenuItem.posProductCode` columns at all — structurally cannot carry a real PLU/table mapping. Its payload-building code sends `productCode: item.menuItemId` (a Verdura UUID) with its own comment reading `KNOWN GAP, not a real mapping` (`idealpos-order-reconciliation.service.ts:259-270`, read directly, not staged).
- Its connector-side C# handler (`VerduraIdealposTracer.Core/IdealposOrders/IdealposSubmitOrderCommandHandler.cs`) is wired only into `VerduraIdealposTracer.DryRunCli/Program.cs` (`TRACER_RUN_MODE=idealpos_order`) — never into the real production `VerduraIdealposTracer.Cli/Program.cs`. It cannot reach a real Windows/IdealPOS install today regardless of any server-side merge.
- The rescued lineage's `IdealposBridgeClient`/`IdealposOrderSubmissionService` (`VerduraIdealposTracer.Cli/OrderSubmission/`) **is** wired into the real production `Cli/Program.cs` (confirmed at `Program.cs:85`, routing `IdealposOrderSubmissionService.CommandType`).
- Both trees independently fixed the same legacy-BullMQ-vs-new-dispatcher race on the same file (`pos-sync-dispatcher.service.ts`): the dirty tree excludes `adapterType: api` from the legacy candidate query; the rescued lineage (DL-091) gates the entire legacy timer behind `POS_SYNC_DISPATCH_ENABLED` (default `false`). The rescued lineage's fix is already validated end-to-end in this reconciliation and is kept; the dirty tree's alternative edit to the same file is superseded, not applied.

**Rejected alternative:** Grafting the dirty tree's 12-state reconciliation/evidence-tier model onto the rescued dispatcher today. Rejected because that model's entire post-submission state machine (`discrepancy`, `native_order_accepted`, authoritative-total comparison) is built on top of a payload-construction layer that cannot produce a truthful native order in the first place; re-deriving it against the rescued lineage's mapper would be a large, untested rewrite with no same-day validation path, for a P0 that only requires one truthful, working, fail-closed submission path today. Preserved uncommitted for a deliberate, separately-scoped future pass rather than silently dropped.

**Consequences:** Exactly one IdealPOS delivery owner (`IdealposOrderDispatcherService`) exists after this reconciliation. Payment observation, KDS delivery outbox, KOT dispatch producer, and service-mode/takeaway work in main's dirty tree are orthogonal to IdealPOS delivery itself and remain preserved-uncommitted, unaffected by this decision, for their own future landing.

**Confidence:** [VERIFIED] — direct read of `schema.prisma` diffs (both trees vs. main), `idealpos-order-reconciliation.service.ts`, `idealpos-order-payload-mapper.ts`, both C# `Program.cs` entry points, and `pos-sync-dispatcher.service.ts` diffs on both trees; full validation run (empty-DB + upgrade migration apply, `tsc --noEmit`, 619 backend unit tests, 207/217 backend integration tests against a disposable throwaway Postgres — the 10 non-passing were 5 skipped plus 2 pre-existing, byte-identical-to-main environment issues unrelated to this change, not regressions — 16/16 admin-console frontend tests, 55/55 .NET connector unit tests), 2026-08-23.

## 2026-08-23 (b) — Connector Delivery: Stale `unknown` Commands Are Now Automatically Recovered

### DL-093 — `IdealposOrderDispatcherService` recovers a stale `unknown` `idealpos.submit_order.v1` command after a bounded grace period, reusing the original payload byte-for-byte

**Status:** Code change (no new migration — existing columns sufficient), committed as `4589165` on top of the rescued `bfef6d7` lineage during the 2026-08-23 rescue (see DL-094); previously implemented and tested but never logged here.

**Decision:** A `ConnectorCommand` that reaches `unknown` (accepted, never terminally reported within `ConnectorCommandService`'s own 5-minute `TERMINAL_REPORT_WINDOW_MS`) is left at `queued_for_connector` for a second, additional configurable grace period (`IDEALPOS_UNKNOWN_RECOVERY_GRACE_MS`, default 10 minutes) so a connector that briefly lost network still has a real chance to land its true outcome. Once stale, `IdealposOrderDispatcherService` — which alone knows IdealposBridge deduplicates on `externalOrderId=order.id` — creates a new attempt-qualified `ConnectorCommand` carrying the original unknown command's own stored payload verbatim (never rebuilt from current `Table.posTableCode`/`MenuItem.posProductCode`, which could have changed since the ambiguous attempt). The original `unknown` row is never reopened or mutated; a late report against it is rejected (409, unchanged) but now durably audited (`CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN`) so a true outcome arriving late is never silently lost from an operator's view. Recovery is bounded by the existing `maxDispatchAttempts` ceiling and exhausts to a truthful `errorMessage` stating the outcome is UNPROVEN, never a fabricated native rejection.

**Rationale:** Before this change, an `unknown` result stranded its `POSSyncRecord` at `queued_for_connector` indefinitely with no automatic path forward, requiring manual reconciliation for every transient connector disconnect that happened to occur mid-report — a realistic, not hypothetical, failure mode for a Windows connector on a restaurant LAN.

**Confidence:** [VERIFIED] — unit tests (grace-period boundary, payload-reuse, lost-CAS-race no-op, exhaustion) and real-Postgres/real-connector-protocol integration tests (grace period, recovery, mapping-change-after-attempt non-leak, concurrent sweeps produce exactly one recovery, restart safety via a fresh service instance, repeated unknown→recovery→unknown, exhaustion, late-original-success-races-in-flight-recovery), full suite passing 2026-08-23 (see DL-094's validation summary for exact counts).

## 2026-08-23 — Story 15-5: Transient Bridge/Connector Delivery Failures Are Now Automatically Retried

### DL-092 — `IdealposOrderDispatcherService` distinguishes deterministic from transient ConnectorCommand failures; only the latter are retried, bounded and restart-safe

**Status:** Code change (additive migration, reversible via config), validated in the same disposable worktree (`8ac0ee8` chain, now including `165cb49`/`dd8385a`) prior to this entry.

**Decision:** `sweepReconcile()` no longer maps every terminal `ConnectorCommand.failed`/`expired` outcome uniformly onto terminal `POSSyncRecord.failed`. Only `bridge_rejected` (a real, negative Bridge response) and this dispatcher's own `connector_payload_invalid` (a pure function of the order's own data — retrying reproduces the identical failure) remain terminal. Everything else that reaches `failed` — chiefly `bridge_unreachable_or_failed`, and, deliberately, any resultType this dispatcher does not yet recognize — or `expired` (never even claimed/accepted by a connector — zero side effects, always safe to retry) returns the record to `not_synced` with a computed `nextRetryAt` (bounded exponential backoff: 30s/60s/120s/240s, capped at 10 minutes, reusing the existing `maxDispatchAttempts` ceiling of 5 — no second attempt-count concept introduced). Once that ceiling is reached, the record becomes terminal `failed` with a new `retryExhaustedAt` timestamp set, distinguishing "exhausted after real, repeated delivery attempts" from an immediate deterministic rejection. `cancelled` (an administrator explicitly cancelled the command) remains terminal, never resurrected. `unknown` (accepted but never terminally reported) is untouched — it stays `queued_for_connector`, exactly as before; this dispatcher does not attempt to auto-retry a command already `accepted` at Bridge, since Story 2-10's own protocol has no existing mechanism to safely requeue one (see Investigation below) and doing so risks a false duplicate-order impression rather than a real one.

**Investigation (required before implementing anything, per this task's own instruction):**
- `ConnectorCommand.createCommand()` is a plain create-then-catch-P2002-and-return-existing call keyed on `(organizationId, venueId, idempotencyKey)`. Calling it again with the **same** idempotencyKey after the row is already terminal (`failed`) returns that same dead row — it does not, and cannot, reopen it. There is no `reopen`/`requeue` method anywhere in `ConnectorCommandService`, and `report()`'s own doc comment states a terminal command's outcome is "never silently overwritten." Reusing the original idempotencyKey for a retry was therefore not viable.
- The chosen mechanism instead mints an **attempt-qualified** idempotencyKey only for retries (`idealpos-submit-order:<orderId>:retry:<attemptCount>`) — the very first attempt keeps the exact original key, byte-identical to pre-DL-092 behavior. Each retry is a genuinely new `ConnectorCommand` row (full audit history preserved, queryable via `sourceAggregateType:'Order', sourceRecordId:<orderId>`), while `externalOrderId` inside the payload — the only identity IdealposBridge/IdealPOS ever sees — is always `order.id`, structurally never regenerated. `POSSyncRecord.connectorSubmitCommandId` always points at the current/latest attempt only (nulled while backing off, repopulated on the next dispatch); it is not a history table by itself.
- `POSSyncRecord.attemptCount`/`maxDispatchAttempts` already existed in `8ac0ee8` and were already read by `sweepDispatch`'s eligibility query, but no code path had ever incremented `attemptCount` more than once for a given order before this change (a transiently-failed order never returned to `not_synced`) — this decision is what actually activates that pre-existing but dormant ceiling, not a new counter.
- Retry ownership: `IdealposOrderDispatcherService` itself (already the sole real owner of IdealPOS delivery per DL-091) owns both scheduling (`sweepReconcile` computing `nextRetryAt`) and execution (`sweepDispatch`'s existing candidate query, extended with a `nextRetryAt` time-gate). No second retry mechanism, timer, or service was introduced — this was the explicit goal (one delivery attempt per command execution; durable server-side orchestration owns retries) and the smallest change that achieves it, since both halves already existed in the same class.
- Schema: two new nullable columns on `POSSyncRecord` — `nextRetryAt`, `retryExhaustedAt` — mirroring `dispatchClaimExpiresAt`/`dispatchExhaustedAt`'s exact established pattern one model up the same file. No enum change, no new counter field. Purely additive; validated both from an empty database and as an upgrade against an already-migrated one.
- Interaction with DL-091: a retry-pending record sits at `status: not_synced`, indistinguishable at that column alone from a never-yet-attempted one. If an operator ever manually sets `POS_SYNC_DISPATCH_ENABLED=true` for some other, non-IdealPOS reason, `PosSyncDispatcherService`'s own candidate query (which has no knowledge of `nextRetryAt`/`attemptCount`) would be equally able to claim a retry-pending row as a freshly-created one — this is not a new race introduced by this decision, it is the exact race DL-091 already documented and defaulted off; DL-092 does not broaden or narrow that exposure, and no additional code change was made here because DL-091's default-off posture already fully covers it.

**Consequences:** A transient Bridge/connector outage (connection refused, 5xx, a connector briefly offline) no longer permanently strands a valid order after a single attempt — it is retried automatically, up to 5 times over roughly 7.5 minutes, before requiring manual review. A genuinely ambiguous outcome (connector timeout after the request may have reached Bridge) is untouched — it is never converted into either a false failure or a false success, exactly as `dd8385a` already established. `docs/decisions-log.md` entries for `8ac0ee8`/`165cb49`/`dd8385a` remain accurate for the behavior they describe; this entry supersedes only `sweepReconcile()`'s prior uniform-terminal-failure behavior.

**Confidence:** [VERIFIED] — direct source inspection of `connector-command.service.ts` (`createCommand`, `report`, `sweep`), `idealpos-order-dispatcher.service.ts`, and the `POSSyncRecord`/`ConnectorCommand` Prisma models; 24 unit tests (deterministic fake-timer backoff assertions, no wall-clock waiting) and 5 new real-Postgres/real-connector-protocol integration tests (transient-failure scheduling, retry redispatch with a new attempt-qualified command and identical `externalOrderId`, recovery via a later duplicate-safe success, exhaustion, and concurrent-sweep no-duplicate-command proof), 2026-08-23.

---

## 2026-08-22 (b) — Story 15-5 Pre-Work: Legacy POS-Sync Dispatch Race Found and Closed

### DL-091 — DL-069 superseded for rows also claimed by IdealposOrderDispatcherService: `PosSyncDispatcherService`'s automatic timer defaults OFF in production

**Status:** Code change (config-gated, reversible, no schema change), no migration, no commit yet at the time this entry was written; validated in a disposable worktree at `8ac0ee8` prior to implementing the `idealpos.submit_order.v1` connector handler (story 15-5).

**Decision:** `PosSyncDispatcherService.onModuleInit`'s periodic sweep timer now also requires `POS_SYNC_DISPATCH_ENABLED=true` (new, defaults `false`) in addition to the pre-existing `NODE_ENV !== 'test'` check. `sweep()` itself, `PosSyncProcessor`, and every existing test that calls either directly are unchanged.

**Rationale:** DL-069 approved `PosSyncDispatcherService`'s automatic dispatch specifically because, at the time, `PosSyncProcessor` "makes zero network calls of any kind" and could only ever resolve a row to `not_applicable`/`unsupported` — a safe, inert classifier with nothing else contending for the same rows. Story 15-4 (`8ac0ee8`, uncommitted-to-main isolated work) later added `IdealposOrderDispatcherService`, which claims candidates from the identical `POSSyncRecord.findMany({ where: { status: 'not_synced' } })` precondition, with no `adapterType` filter or other discriminator separating the two services' domains — confirmed by direct inspection of both `pos-sync-dispatcher.service.ts` and `idealpos-order-dispatcher.service.ts`, not inferred. Both run independent 5-second timers in the same NestJS process (`PosSyncModule` and `IdealposOrderDispatcherService` are both instantiated unconditionally from the same root `AppModule`/`main.ts` bootstrap — no separate worker deployment, no existing feature flag). Whichever service's compare-and-swap `UPDATE ... WHERE status = 'not_synced'` commits first is authoritative for that row:
- If `PosSyncDispatcherService` enqueues first and `PosSyncProcessor` resolves the BullMQ job before `IdealposOrderDispatcherService`'s next tick, the row flips to the terminal `unsupported` status. `IdealposOrderDispatcherService.sweepDispatch()`'s own candidate query permanently excludes non-`not_synced` rows, and nothing else ever revisits `unsupported` — **the order silently never reaches IdealPOS, with no automatic recovery**, while the customer already received durable order acceptance upstream.
- The `POSSyncStatus.queued_for_connector` enum comment's claim that this status "naturally stops [the legacy dispatch] from selecting this row... without that file needing to change at all" is true only *after* `IdealposOrderDispatcherService` has already won that race — it does not address, and was evidently written without accounting for, the race window before either service's first write lands. That comment should be read as aspirational/incomplete, not as evidence the race was already closed.

This is exactly DL-069's own risk model, just no longer satisfied: `PosSyncProcessor` is still inert on its own, but it is no longer the only writer of these rows, and its inertness does not protect the *other* writer's ability to ever see them again.

**Fix chosen (smallest, evidence-scoped):** disable the automatic trigger, not the mechanism. No `POSAdapterType` value cleanly represents "owned by the new IdealPOS connector path" (the enum predates story 15-4 and encodes integration *mechanism* — `api`/`sql`/`odbc`/`csv`/`local_agent`/`none` — not vendor/pipeline ownership), so a schema-level partition would require a migration and a coordinated change to both dispatchers' candidate queries for a currently-single-tenant-of-real-traffic problem (no other real adapter exists yet per DL-064). A config-gated kill switch on the legacy timer achieves DL-069's original, still-valid goal — decision-log-approved production processing for a `PosSyncProcessor` that only ever produces `unsupported`/`not_applicable` — for any deployment that still wants it, while making `IdealposOrderDispatcherService` the sole practical writer of `POSSyncRecord.not_synced → *` transitions today. Fully reversible via config; zero lines of `PosSyncProcessor`, `PosSyncRecordsService`, or Story 9 test code touched.

**Consequences:** Story 9-3's automatic production dispatch is paused by default pending an explicit decision to re-enable it (e.g. for a future venue genuinely configured with a non-IdealPOS adapter this mechanism could legitimately classify). `docs/decisions-log.md` DL-069 remains historically accurate for the deployment shape it was written against; this entry is the record of what changed and why, not a retraction.

**Confidence:** [VERIFIED] — direct source inspection of `pos-sync-dispatcher.service.ts`, `idealpos-order-dispatcher.service.ts`, `pos-sync.processor.ts`, `app.module.ts`, `queue.module.ts`, and `schema.prisma`'s `POSSyncStatus`/`POSAdapterType` enums, 2026-08-22.

---

## 2026-08-22 — GCS Media Pipeline: Commit-Boundary Reconciliation Pass

### DL-090 — Correction pass: DL-074 through DL-077's session-time test counts and API surface reconciled against the four commits actually landed; DL-078 (`Asset/` static-asset migration) explicitly left unreconciled as still-uncommitted, separate-scope work

**Status:** Documentation correction/reconciliation only. No application code, database, migration, Git history, cloud resource, IdealPOS state, or Windows environment was changed by this entry.

DL-074 through DL-077 (below) each describe one work session against a repository state that, at the time, was entirely uncommitted — every file they mention was sitting in a large, mixed working tree alongside unrelated Story 15/IdealPOS/KDS/payment work. That work was subsequently split into four narrow, independently reviewed, independently re-validated commits:

| Commit | Message | Scope |
|---|---|---|
| `90d954f` | `feat(media): add GCS MediaAsset storage pipeline` | `MediaAsset` schema/migration, `StorageProviderPort`/`GcsStorageProvider`/`LocalStorageProvider`, `MediaAssetsController`/`Service`, the narrow local-dev-upload CSRF bypass |
| `257f55f` | `feat(media): wire Admin Console menu uploads` | `apps/admin-console/src/lib/mediaAssets.ts`, the `MenuManagementPage` upload flow, `resolveVenueId` export |
| `1eaf657` | `chore(media): add menu image reassociation tooling` | `reassociate-orphaned-menu-item-media.ts` and its migration manifest |
| *(this entry)* | `docs(media): record GCS media migration and upload pipeline` | This reconciliation |

Three corrections:

1. **Test-count reconciliation.** DL-074's "431/431", DL-075/076's "453/455 tests", and DL-076's "45/45 `apps/admin-console` tests" describe the full, mixed working-tree suite at each session's end — not the narrower scope that was ultimately committed. Independently re-run against each commit's own isolated, clean-checkout content (fresh `npm ci`, no dirty-tree file present): `90d954f` — 459/459 `apps/api` tests passing in isolation (the one pre-existing, unrelated `app.module.spec.ts` failure, present identically at the parent commit with zero media changes, is not counted as a regression); `257f55f` — 55/55 `apps/admin-console` tests across 9 files; `1eaf657` — validated by direct script execution against a disposable, migrated Postgres instance (dry-run/apply/idempotency/concurrent-modification/malformed-input scenarios), not a unit-test count, since a two-file `chore` commit intentionally carries no test file of its own. These numbers are not directly comparable to the session-time counts above — they measure a smaller, hand-audited scope, not the same working tree.
2. **API surface.** DL-074 describes "four new API endpoints (`request-upload`/`finalize`/`delivery-url`/`archive`)"; DL-076 separately describes adding `publish` and `associate-menu-item` in a later session. `90d954f` commits all six together as one unit — the incremental two-session narrative is historically accurate for how the work happened, but the commit boundary does not mirror it 1:1.
3. **Two additional defects found and fixed during commit construction, not described in DL-074–077 below (found after those entries were written):** (a) `media.module.ts`'s storage-provider factory previously cast possibly-`undefined` GCS config to `string`, so an incomplete `MEDIA_STORAGE_PROVIDER=gcs` configuration would construct a broken provider instead of failing at boot — rebuilt fail-closed, with regression coverage, before `90d954f` was committed. (b) A failed `associate-menu-item` call after a successful `publish` left the newly-public `MediaAsset` permanently orphaned — `MenuManagementPage`'s upload flow now best-effort archives it on that specific failure path, with regression coverage, before `257f55f` was committed. Separately, the reassociation script's `--dry-run` flag originally only activated on an exact string match, so omitting flags (or a typo) silently ran in write mode; rebuilt so no-flags/`--dry-run` is the default and `--apply` is the explicit, required opt-in, with an unrecognized argument failing closed — before `1eaf657` was committed.

**The earlier, separate rendering repair — not to be conflated with the four commits above:** `4e7b8a5` (`fix(media): restore GCS-backed menu images`) and `4f3408a` (`fix(order-tablet): sort menu items and improve image cards`) landed *before* the `MediaAsset` pipeline commits and address a different problem: Customer Website, Window Display, and Order Tablet rendering a stale local image path or a broken image with no fallback. `4e7b8a5` added the shared, non-looping fallback (`shared/media/menuImageFallback.mjs`) used whenever a menu item has no photo, or its configured image fails to load; `4f3408a` added the Order Tablet's equivalent `MenuItemThumbnail` fallback and alphabetical-within-category sort. Neither commit depends on or was aware of `MediaAsset` — the fallback exists precisely because, at that point, nothing yet reassociated the affected rows.

**The 38-row local-development repair, and Künefe specifically:** the reassociation script (`1eaf657`) was run for real, once, against this machine's local development database prior to `90d954f` being committed (recorded in that commit's own message) — 38 `MenuItem.imageUrl` values were repointed from a stale `/menu-images/<file>` path to the matching, already-approved, already-public `MediaAsset`'s stable GCS URL. One row, `Künefe` (`imageUrl=/menu-images/kunefe.png`), has no corresponding manifest entry — `kunefe.png` does not exist anywhere in the repository and never did — and was correctly left unmatched, `NO_MANIFEST_ENTRY`, never given a fabricated URL. Re-confirmed independently during `1eaf657`'s own validation: a dry-run against the shared local development database reported exactly this one row and zero others, and an MD5 digest of the entire `MenuItem` table's `id`/`imageUrl` state was byte-identical before and after that dry-run. The 38-row write itself was not, and must not be, re-applied to the shared database by any of these four commits or by this entry.

**Items with no authoritative photo:** the canonical menu (70 items) has always had more items than migrated photographs. An item with a genuinely null `imageUrl` is never assigned a fabricated one by any commit in this sequence — it renders the shared branded fallback (Customer Website/Window Display/Order Tablet) or a letter-avatar placeholder (Admin Console), the same treatment as a load failure.

**Configuration truthfulness, restated:** none of the four commits in this sequence set, change, or commit any `.env` value. `MEDIA_STORAGE_PROVIDER=gcs` — and therefore whether any given environment, including this local development machine, is actually running against real GCS right now — remains an operator/environment decision entirely outside this commit sequence. Application Default Credentials plus service-account impersonation is the intended and only supported credential mechanism; no service-account JSON key file belongs in this repository. The real-GCS bucket behavior, anonymous-access boundary, and V4-signing defect described in DL-074/075/architecture.md's Execution Record are prior, separately recorded real-GCS evidence — not re-executed, re-verified, or re-claimed by this documentation pass, and not evidence that any current production deployment is using GCS.

**DL-078 is deliberately not reconciled by this entry.** It describes migrating the repository-root `Asset/` directory (hero images, intro video, brand assets) to GCS and deleting it — a separate system (`shared/media/staticMedia.mjs`, no `MediaAsset` row, no database record at all) with zero corresponding code in any of the four commits above. `Asset/` remains tracked in Git, uncommitted-deleted in the working tree; `shared/media/staticMedia.mjs` remains untracked. Treat DL-078's "removed entirely" as accurate for the working tree at the time it was written, and not yet reflected in any commit.

**Affected documents:** `README.md` (§4.3 Media Storage added), `docs/decisions-log.md` (this entry; DL-074–077 staged verbatim alongside it, unedited; DL-078 left in the working tree, unstaged, per the note above), `_bmad-output/implementation-artifacts/2026-08-17-gcs-media-architecture.md` (staged through its "Execution Record" and original story body; both `Asset/`-removal addenda excluded from this pass for the same reason as DL-078), `_bmad-output/implementation-artifacts/2026-08-17-gcs-media-local-cleanup-log.txt`, `2026-08-17-gcs-media-migration-results.json`, and `2026-08-18-media-upload-wiring.md` (staged in full — verified to contain no `Asset/`-specific content).

**What this does not do:** does not change any commit already made (`5c69e19`, `4e7b8a5`, `4f3408a`, `90d954f`, `257f55f`, `1eaf657`); does not run a migration; does not run the reassociation script; does not touch the shared or any disposable database; does not access GCS; does not change `.env`; does not commit the `Asset/`→GCS migration or `shared/media/staticMedia.mjs`; does not push.

## 2026-08-18 — Order Tablet Device Identity, Restricted Mode, Staff Elevation & Manager Step-Up (DL-081)

### DL-081 — Decision 3: Order Tablet authentication — APPROVED and IMPLEMENTED (2026-08-18)

**Status:** Approved. Option 3 (hybrid device identity + restricted customer mode + named staff elevation + manager step-up) ratified and implemented in story 15-1. This entry supersedes the earlier pending/recommendation-only draft below; the original question/options/trade-offs are preserved for historical context.

**Approved model — four trust layers, backend-enforced:**

1. **Physical device identity.** Each physical tablet is individually enrolled: an authorized Admin Console user (owner/admin/manager, `RolesGuard`) creates a single-use, time-limited enrollment code (`TabletEnrollment`, Argon2id-hashed code, CAS-guarded single redemption, expiry). The tablet redeems it once for a long-lived (30d default), revocable device credential (`TabletDevice`, Argon2id-hashed secret, org+venue bound). The server-generated secret is shown once at enrollment and never stored in plaintext or committed to source. Device tokens (`kind: "tablet_device"`) cannot reach any Admin Console admin endpoint (enforced by `StaffSessionOnlyGuard`) and are always venue-scoped (`resolveVenueScope`). Revocation is checked live on every request via `TabletTokenActiveGuard`/`assertDeviceActive`, including for already-issued staff/manager tokens derived from that device (see the cross-cutting fix below).
2. **Restricted customer/device mode (default).** The default state for an enrolled, unlocked device. Permits menu browsing, cart building, viewing the assigned table, and submitting an idempotent order through a purpose-built endpoint (`POST /api/tablet/orders`) — never `/api/admin/orders`. Explicitly cannot discount, void, refund, override payment, reconcile, access Idealpos manual-recovery, reprint, manage staff, change venue config, view the audit log, or take any manager action; every such surface is guarded and independently verified rejected from a restricted-only token (integration-tested).
3. **Named staff elevation.** A distinct, Argon2id-hashed numeric PIN (`Staff.pinHash`/`pinSetAt`) set only via an authorized admin/manager endpoint (`POST /api/admin/staff/:id/tablet-pin`), never equal to or derived from the staff member's login password (checked at set-time). Elevation (`POST /api/tablet/elevate`) verifies against active, PIN-set staff in the device's organization, using a decoy Argon2id verify against a dummy hash so "no PIN set" and "wrong PIN" are not distinguishable by timing; short-lived (20m default), memory-only client-side (never persisted to localStorage — only the device identity is persisted), auto-expires, and is explicitly clearable via lock. Every order placed while elevated is attributed to the real named staff member, not a shared/synthetic identity.
4. **Manager step-up.** A further, very short-lived (5m default) elevation on top of an active staff session, restricted to manager/admin/owner roles, using the same PIN mechanism and decoy-verify pattern. Carries `actingStaffId` so the underlying staff identity is preserved alongside the manager authorization. Implemented as guard + minimal, real (non-fabricated) demonstration hook (`POST /api/tablet/manager-actions/test-hook`) only — no void/refund/payment/reprint business logic was implemented; later stories consume the guard (`ManagerStepUpGuard`) without redesign.

**Venue PIN's role, clarified:** The existing venue-wide PIN (`KDS_VENUE_PINS`) remains as a local unlock/wake control only (`POST /api/tablet/unlock`) — it does not identify staff, grant admin/owner authority, substitute for device enrollment, or elevate into staff/manager mode. It is server-validated and rate-limited. A new guard (`assertPinNotInsecureDefault`) fails closed with a 500 in production if the configured PIN is still the checked-in local-dev default (`108`); this does not touch the local-dev PIN value itself, which was left as the developer's own dev-config choice (see the standalone-defect fix below for why `108` specifically could never have worked).

**Audit requirements — implemented.** Every enrollment-code creation, enrollment success/failure, device auth, device revocation, unlock success/failure, staff elevation success/failure, manager step-up success/failure, lock/logout, and privileged-action authorization decision is recorded via `AuditLog` with org/venue/device/staff-actor/manager-authorizer/action/timestamp/outcome, attributed either to the real named staff/manager or to a real (inactive, random-credentialed) per-device synthetic system actor when no one is elevated — never to a shared/anonymous identity. PINs, secrets, and tokens are never logged; verified directly against a real Postgres audit trail from an end-to-end run (see Dev Agent Record).

**Explicitly excluded from this decision's scope:** The Admin Console `AdminPinGate`/story 2-6 shared-owner-account authentication gap is a separate, pre-existing weakness, not fixed or claimed fixed by DL-081 or story 15-1. It is tracked independently — see the dedicated finding in `_bmad-output/implementation-artifacts/` referenced from story 15-1's Dev Agent Record.

**A genuine cross-cutting bug found and fixed during implementation:** a revoked device's already-issued elevated staff/manager token continued to work against the pre-existing `/api/admin/orders` endpoint, because that endpoint's guard chain validated JWT signature/role but never re-checked the underlying `TabletDevice` status. Fixed via `TabletTokenActiveGuard`, added to all staff-tier `OrdersController` routes; verified via a real-Postgres integration test that revocation invalidates device, staff, and manager tokens alike.

**A second genuine bug found and fixed after the initial implementation:** `elevateStaff`/`managerStepUp` originally gated candidate staff on a `VenueAccess` join — a schema model defined since the original `init` migration but never populated anywhere else in the codebase (confirmed: zero rows existed for any staff, including the seeded owner, and no other endpoint in the app reads or writes it). This made elevation unconditionally impossible for every real account. Fixed by scoping candidates to `organizationId` only, matching how every other staff-kind token in this app is scoped (org-wide, restricted by role via `RolesGuard`, not by a per-venue ACL) — verified by a corrected real-Postgres integration test and a real curl-based end-to-end run against the live local dev API.

**Independent review (2026-08-18, later same day): real pixel-rendered browser validation completed and three further genuine defects found and fixed.** A fresh review pass (separate from the implementation session above) completed the standalone Order Tablet's real-browser journey the prior session could not finish (its Chrome extension failed to connect three times; this session's did, once Chrome itself was actually running). That real-browser run surfaced defects none of the prior curl-based/jsdom-based evidence had exercised:

1. **Standalone tablet crashed to a blank screen immediately after venue-PIN unlock.** `OrderTabletPage.tsx` called `useNavigate()` unconditionally, but standalone mode (`VITE_APP_MODE=tablet`) renders the page with no `<Router>` ancestor at all — the call threw ("useNavigate() may be used only in the context of a `<Router>` component"), and the value was never even used anywhere in the file (already flagged as dead code by lint, previously unnoticed because no session had rendered this build mode in a real browser before). Fixed by removing the unused call.
2. **`GET /api/admin/orders` 403'd for an unelevated device token**, breaking the restricted-mode floor screen's "does this table already have an order" check — `useLiveOrders()` always called the staff-only endpoint regardless of elevation state. Fixed by adding a purpose-built `GET /api/tablet/orders` (guarded by `TabletDeviceGuard`, venue-pinned) and routing the unelevated case to it, mirroring the order-creation split `POST /api/tablet/orders` already had.
3. **`GET /venues/:venueId/tables` and `GET /venues/:id/tax-config` also 403'd for a bare device token** (`viewer` role was never in either endpoint's `@Roles` list — both predate story 15-1 and were written assuming only `kds_device`/staff tokens would call them), breaking table-id resolution and GST calculation in restricted mode. Fixed by adding `StaffRole.viewer` to both. `tax-config` additionally never called `resolveVenueScope` at all before this fix — a pre-existing cross-venue read gap for *any* device-kind token, closed at the same time so widening its role list didn't widen its exposure.

All three fixes are covered by new real-Postgres integration tests (`tablet-auth.integration-spec.ts`) and/or controller unit tests, verified live in the browser after each fix, and the full 14-step enrollment→restricted-mode→staff-elevation→lock→revocation journey was then re-run to completion with clean console/network output and localStorage inspected at each stage (confirmed: only `deviceToken`/`deviceId`/`venueId`/`deviceLabel` ever persist; `staffToken`/`managerToken` never appear in `localStorage`, matching the design). Direct in-page privilege-escalation attempts — forging `mode`/`role: "manager"` in a request body against a bare device token, reusing the device token against every staff/manager/admin-only endpoint, reusing a revoked device's token — were all rejected (403/401) exactly as designed. Full evidence in story 15-1's Dev Agent Record.

---

<details>
<summary>Original pending/recommendation-only draft (superseded above, preserved for history)</summary>

**Question:** Ratify the existing venue-scoped shared PIN, require per-staff JWT, or adopt a hybrid model, for both tablet entry points (standalone `VITE_APP_MODE=tablet` and the embedded `/order-tablet` admin route)?

**Current evidence:** The standalone build already gates `OrderTabletPage` behind `KdsPinGate` (a shared, venue-wide PIN, no per-staff identity); the embedded admin route gates the identical component behind full JWT `ProtectedRoute` login. Both are live today, simultaneously, for the same payment-marking UI — the exact inconsistency story 15-1 names and remains blocked on. A separate, unrelated device-mode PIN-auth bug currently prevents the standalone entry point from being used at all (`deferred-work.md`, "GCS media provisioning," P1) — worth fixing regardless of which model is ratified.

**Options:** (a) ratify shared venue PIN for both entry points, with per-staff PIN-entry logging as the audit-attribution mechanism; (b) require per-staff JWT login on both; (c) hybrid — e.g. shared PIN for fast table-side re-entry within an already-authenticated staff shift, JWT for the underlying shift/session boundary.

**Recommended option:** (c), hybrid — matches how table-service staff actually move between tables faster than a full login flow tolerates, while still attributing every payment-marking action to an individual via the underlying shift session. This is a recommendation only; story 15-1 remains formally blocked until the owner decides.

**Trade-offs:** (a) is fastest for staff but weakens per-action audit attribution to "which PIN was entered," not "which staff member." (b) has the strongest attribution but adds friction to every table interaction at a device staff share throughout a shift. (c) is more implementation work (two mechanisms, one boundary) for a better attribution/friction balance.

**Affected stories:** 15-1 (blocked on this decision), and by extension every later E15 story building payment/audit UI on top of whichever model is chosen.

**Blocker severity:** High — not critical-path-blocking in the sense of stopping other engineering work in parallel, but every E15 story after 15-1 is building on an identity model that may need rework if decided late.

**Decision owner:** Product/security owner.

**Required-by date:** Before E15-S6 (payment-confirmation gate) and E15-S10 (audit/reconciliation) are built, since both need a stable actor-identity model to attribute against — recommend within 1–2 weeks of this plan's circulation.

**Safe default if unanswered:** Continue building E15 stories against the existing inconsistent state is unsafe (it duplicates work if the model changes later); the safer default is to treat the embedded JWT-gated route as canonical and gate the standalone route closed (fail-closed) until decided, rather than build further payment UI behind the weaker shared-PIN-only surface.

**Effect on 11 October:** Indirect but real — late resolution risks rework across multiple E15 stories already built against an undecided identity model.

</details>

## 2026-08-18 — Real-Browser Validation of the MediaAsset Upload Pipeline; Cross-Provider Dedup Defect Found and Fixed

### DL-077: Closed DL-076's real-browser-validation gap; found and fixed a real defect where checksum-based upload dedup could reuse a MediaAsset row created under a different storage provider than the one currently active

**Decision:** DL-076 (below) implemented the full Admin Console upload pipeline and real-GCS/local HTTP-trace evidence, but left one gap open: no real Chrome browser session was available to validate the actual UI. `claude-in-chrome` was reattempted in a same-day follow-up session and connected successfully (Chrome itself had not been running previously). The full required browser journey was performed for real: PIN login, file-type/size rejection, happy-path upload on a disposable test item, reload persistence, image replacement on an existing item (via the verified `associate-menu-item` path, with the superseded asset auto-archived), duplicate/rapid file selection (proving the abort/generation-counter guard under real timing), Save correctly blocked while an upload is in flight (confirmed by network inspection showing zero `PATCH` calls), and item deletion through the real confirmation-gated UI. Downstream rendering was independently verified on Customer Website, Order Tablet (via its embedded Admin Console route), Window Display, and Kitchen Display (confirmed to still render no images at all, consistent with its documented text-only ticket design).

**Real defect found during this validation:** uploading a file byte-identical to one of DL-075's 46 already-migrated real-GCS photos produced a broken image. Root cause: `MediaAssetsService.requestUpload()`'s checksum-dedup lookup matched an `approved` row regardless of which `storageProvider` it was created under — this repository's own dev database mixes real `gcs`-originated rows (the 46 migrated assets) with whatever a developer uploads while running `MEDIA_STORAGE_PROVIDER=local`, and a match against the former while running the latter produces a `mediaAssetId` whose bytes live only in real GCS, not on local disk. Fixed by scoping the dedup query to `storageProvider: <the provider actually active on this process>`, with regression coverage. Verified fixed live in the same browser session: the identical re-upload correctly created a new asset and rendered successfully. Confirmed the defect never mutated or endangered any of the 46 real migrated assets — `publishAsset()`'s pre-existing idempotent early-return meant the erroneous reuse never wrote anything to them.

**Unrelated finding, recorded not fixed:** a pre-existing `<button>`-inside-`<button>` HTML-validity issue in `ItemCard`'s availability toggle (`MenuManagementPage.tsx`), surfaced by React's `validateDOMNesting` console warning during this session. Not touched by this or the prior media story; recorded in `deferred-work.md` for its own owner.

**What this does not touch:** Story 15.1's blocked authentication decision, Stories 15-4/15-5/15-6 billing ownership, Window Display's documented transitional non-compliance, Order Tablet/Kitchen Display's shared-source architecture, or the standalone device-mode PIN-auth issue (DL-075) — all confirmed untouched by exact accounting of the two files this session modified.

**Phase:** 11 | **Confidence:** [CONFIRMED — real Chrome browser session, real network-request inspection at every step, real DOM/computed-style/fetch verification (not screenshot-only) across all four applicable rendering surfaces, real defect reproduced/fixed/re-verified live, 455/455 `apps/api` tests (+2), exact database/storage baseline reconciliation confirmed (46 MediaAsset / 38 GCS MenuItem / 70 total items, unchanged from session start). Full record: `_bmad-output/implementation-artifacts/2026-08-18-media-upload-wiring.md`'s "Browser Validation" section.]

## 2026-08-18 — Admin Console Wired to the MediaAsset Pipeline; Publish Transition Implemented

### DL-076: Admin Console menu-image uploads now run the full request-upload → finalize → publish → associate pipeline; the missing private→public promotion transition was implemented; two real pre-existing defects blocking the local provider were found and fixed

**Decision:** `MenuManagementPage`'s item-image picker no longer calls the legacy `POST /admin/media/:folder` (direct body proxy, local disk, three-way frontend copy). It now runs, in order: client-side validation (MIME/size/non-empty/decodability) → `POST /admin/media-assets/request-upload` (server-generated object key, checksum-deduplicated) → a direct browser PUT to the private originals bucket using the returned short-lived signed URL and required headers → `POST /admin/media-assets/:id/finalize` (server re-verifies the real object's size/checksum) → `POST /admin/media-assets/:id/publish` (new — the previously-missing explicit, authorised, idempotent private→public promotion, added this story) → `POST /admin/media-assets/:id/associate-menu-item` (new — an atomic, server-verified write of the resulting public URL onto an *existing* `MenuItem`; a brand-new item instead carries the already-verified delivery URL directly into its create payload, since there is no row yet to associate against). The browser at no point receives a bucket name, a credential, or write access to the public bucket.

**The missing publish transition, specifically:** DL-075's migration script promoted all 46 real assets to the public bucket by hand (a one-off Node script, `migrate-menu-images-to-gcs.ts`, run once by a human). No API endpoint could do this for a *new* upload — `MediaAssetsService` had no method that copied a private object to the public bucket, and `getDeliveryUrl()` resolved a public asset's URL using `asset.bucket` (the private bucket column), which would have been wrong for any newly-published asset. Both gaps are fixed: `StorageProviderPort.publishObject()` (implemented for both `GcsStorageProvider` — real server-side GCS-to-GCS copy plus long-lived immutable cache headers — and `LocalStorageProvider` — copies between two local roots and serves the public one over a new, deliberately unauthenticated route, `GET /api/media-assets/public/:key`, emulating anonymous GET on a real public bucket) and `MediaAssetsService.publishAsset()` (requires `status:approved`, verifies the copy landed correctly before flipping `visibility`, compare-and-set guarded against concurrent double-publish, idempotent on retry). `MenuItem` has no `venueId` or `mediaAssetId` column (single-venue-MVP, organization-wide catalog) — `associateWithMenuItem`'s cross-tenant boundary is therefore `organizationId` on both the `MediaAsset` and the `MenuItem`, the only scoping concept the schema actually has; this is a deliberate, documented decision, not an oversight, and no schema change was made to work around it.

**Two real, previously-undiscovered defects found and fixed while making the local provider actually work end-to-end (not merely against mocks):**
1. `LocalStorageProvider`'s generated upload/delivery URLs omitted the app's `app.setGlobalPrefix('api')` prefix, so every local-dev signed-URL PUT and public-delivery GET 404'd against the real running server. Never caught before because the provider's own unit tests exercised `writeLocal()`/`verifyObject()` directly against disk, never through the actual HTTP routes with the real Nest app booted.
2. `CsrfMiddleware` rejected the local-dev-upload PUT with 403 (no Bearer token present, no CSRF cookie/header — by design, since a signed upload URL, real or emulated, must never carry this app's session credentials). Fixed with a narrow, path-scoped bypass mirroring the existing `/auth/` and Bearer-token exemptions, regression-covered in a new `csrf.middleware.spec.ts`.

Both were found only by actually running the full HTTP flow against a live local dev stack (real Postgres, real Redis, real Nest process) — not by unit tests alone, which is why this story's validation deliberately included that runtime trace rather than stopping at green test suites.

**Real evidence, not simulated:** the complete pipeline was run twice against the live dev API — once with `MEDIA_STORAGE_PROVIDER=local`, once with `MEDIA_STORAGE_PROVIDER=gcs` against the real `verdura-media-originals-d3794338b2`/`verdura-media-public-d3794338b2` buckets — in both cases proving: signed upload accepted, finalize verifies the real object, publish copies server-side and is idempotent on retry, the published copy is anonymously readable while the private original still returns 403 anonymously, and `associate-menu-item` atomically writes the verified URL onto a real `MenuItem` row. All test-created objects and rows were deleted afterward; the pre-existing 46 `MediaAsset` rows / 38 GCS-backed `MenuItem.imageUrl` values from DL-075 were confirmed untouched before and after.

**What remains unresolved:** real-browser (Chrome) pixel-rendered validation was not performed this session — the `claude-in-chrome` extension was not connected in this environment; a full React Testing Library render of the real `MenuManagementPage` component plus the authenticated HTTP trace above stand in its place, but are not the same as a screenshot-verified browser session. Image-dimension/video-duration server-side validation and an abandoned-upload lifecycle sweep remain unimplemented (both pre-existing deferred items, not newly introduced). Full list: `_bmad-output/implementation-artifacts/deferred-work.md`, "Deferred from: Wire Admin Console Media Uploads to the MediaAsset Pipeline (2026-08-18)".

**Relationship to other in-flight work:** does not touch Story 15.1's blocked authentication decision, Stories 15-4/15-5/15-6's billing ownership, the `apps/` repository restructure (DL-073), or the Idealpos/EFTPOS/KDS/KOT device-mode PIN issue (DL-075's own "what remains unresolved" note) — confirmed by `git diff` review of every file this session touched.

**Phase:** 11 | **Confidence:** [CONFIRMED — real local-provider and real-GCS end-to-end runs, both with anonymous-access proof and cleanup; 453/453 `apps/api` tests (49 media, including new `publishAsset`/`associateWithMenuItem`/CSRF-bypass coverage) and 45/45 `apps/admin-console` tests (15 new) passing; 6 frontend build configurations clean; real GCS opt-in integration test (`gcs-storage-provider.integration-spec.ts`, including new `publishObject` coverage) passing against the actual provisioned buckets. UNCONFIRMED: pixel-rendered browser verification (extension unavailable this session).]

## 2026-08-17 — GCS Provisioning and Menu-Image Migration Executed

### DL-075: Real GCS buckets provisioned and all 46 canonical menu-item images migrated; DL-074's GCP-access blocker resolved same day

**Decision:** Following DL-074 (below), `gcloud` was installed and the human authenticated interactively; every step DL-074 recorded as blocked was then executed for real against `project-10bd9c5c-d379-4338-8b2`. Two buckets provisioned in `australia-southeast1`: `verdura-media-originals-d3794338b2` (private, public access prevention enforced, never anonymously accessible) and `verdura-media-public-d3794338b2` (public read granted **only** after explicit human authorization, requested and given after the auto-mode permission classifier independently blocked the first attempt — see the architecture record for the exact scope reviewed and applied). A dedicated service account (`verdura-media-api@...`) was granted bucket-scoped `storage.objectAdmin` only, never project-wide.

**Real defect found and fixed:** `GcsStorageProvider`'s original design (plain Application Default Credentials) failed against real GCS — V4 signed URLs require signing with a private key, which neither a human's OAuth login nor workload-identity metadata-server credentials have. Fixed by always signing through service-account impersonation via the IAM Credentials API — the standard keyless pattern, not a workaround, and now the permanent implementation with regression coverage (`apps/api/test/gcs-storage-provider.integration-spec.ts`).

**Migration executed:** all 46 unique canonical menu-item photographs (checksum-deduplicated, scope: database-driven `MenuItem.imageUrl` only — `Asset/`'s statically-imported hero images and video remain explicitly deferred) uploaded to both buckets; 46 `MediaAsset` rows created (`status=approved`); 38 `MenuItem.imageUrl` values repointed at the new public GCS URLs. Rendering verified with real browser checks (network requests, console logs, screenshots) across Customer Website, Admin Console, Order Tablet, and Window Display — zero requests to the private originals bucket from any client, confirming the security boundary holds in practice, not just in configuration. 138 now-redundant local files removed (99.68 MB, 46.7% of the repository's media footprint) only after upload, public accessibility, and application rendering were all independently confirmed.

**What remains unresolved:** the `Asset/` hero images/video migration (requires frontend code changes, not a data migration); wiring the Admin Console upload UI to the new `MediaAsset` pipeline; a pre-existing, unrelated broken image reference (`Künefe` → `kunefe.png`, which does not exist in the repository) found but not fixed; a pre-existing, unrelated device-mode PIN-auth issue on the standalone `VITE_APP_MODE=tablet`/`=kds` entry points found but not investigated (out of scope — the underlying page components were verified working via their embedded Admin Console routes instead).

**Relationship to other in-flight work:** unchanged from DL-074 — does not touch Story 15.1, Stories 15-4/15-5/15-6, or the `apps/` repository restructure beyond what DL-074 already recorded.

**Phase:** 11 | **Confidence:** [CONFIRMED — real GCP resources, real uploads, real anonymous-access tests, real browser-verified rendering. Full evidence: `_bmad-output/implementation-artifacts/2026-08-17-gcs-media-architecture.md`'s "Execution Record" section.]

## 2026-08-17 — Google Cloud Storage Canonical Media Architecture

### DL-074: GCS (not Google Drive) is the canonical media provider; MediaAsset domain model and upload/validation pipeline implemented; actual bucket provisioning and asset migration remain blocked on unavailable GCP access

**Decision:** Google Cloud Storage is established as Verdura's canonical media store for menu-item photographs, promotional imagery, and video — never Google Drive, which is unsuitable as an application media backend (no signed-URL upload model, no IAM-scoped service-account access pattern, no CDN-safe object versioning). A `MediaAsset` domain model, a provider abstraction (`StorageProviderPort`, implemented by `GcsStorageProvider` and a dev/test-only `LocalStorageProvider`), and four new API endpoints (`request-upload`/`finalize`/`delivery-url`/`archive`) were implemented this session — additive only, zero changes to any existing application behavior, defaulting to the `local` provider so no developer needs real GCP credentials to run `npm run dev`.

**What was not done, and why:** no `gcloud` CLI and no GCS-capable tool were available in the execution environment (only Google Drive/Calendar tools, explicitly excluded from this decision). No bucket was created, no IAM configured, no asset uploaded, no local file deleted. A full evidence-based inventory (167 media files, 69 unique by SHA-256 checksum, 66.92 MB of exact-duplicate menu-item photos triplicated across `apps/customer-website`/`apps/admin-console`/`apps/window-display`) and a deterministic migration manifest were produced and are ready to execute the moment GCP access exists. Full record: `_bmad-output/implementation-artifacts/2026-08-17-gcs-media-architecture.md`.

**Why no frontend rendering code changed:** `MenuItem.imageUrl`/`Category.imageUrl` already accepted and rendered any absolute URL identically across every frontend before this session (pre-existing `IMAGE_URL_PATTERN` validation). A `MediaAsset`'s resolved delivery URL is designed to be written into that same existing field on approval — there is nothing for any frontend component to change until a real asset is actually migrated, which is blocked on the same GCP access gap above.

**Relationship to other in-flight work:** does not touch Story 15.1's blocked authentication decision, does not touch Stories 15-4/15-5/15-6's billing/Idealpos-authoritative-total ownership, does not touch the 2026-08-17 `apps/` repository restructure (DL-073) beyond adding new files inside the already-restructured `apps/api/`.

**Phase:** 11 | **Confidence:** [CONFIRMED for the repository-side implementation — 431/431 tests passing including 19 new, real runtime boot verified, migration applied to local Postgres. UNVERIFIED for anything requiring actual GCS access — explicitly not claimed as done.]

## 2026-08-17 — Idealpos/Verdura Tax and Payable-Total Authority

### DL-072: Idealpos owns statutory tax, fiscal rounding, receipt facts and the final payable total; Verdura owns provisional commercial pricing and reconciliation

> **Superseded for authority 2026-09-28 by DL-115 / [ADR 0001](./adr/0001-servvia-is-the-operational-pos.md).** Servvia now owns statutory tax, rounding and the final payable total. The New Zealand facts recorded below still stand: prices are GST-inclusive, GST is shown as `gross × 3 / 23`, and no surface may add GST on top.

**Decision:** For all Verdura-originated orders that reach Idealpos, the authority split is: Verdura owns menu presentation, configured commercial prices, discounts, and the provisional Order Tablet (and kiosk) cart total shown before submission. Idealpos owns statutory GST treatment, fiscal rounding, receipt facts, and the final payable total once an order is submitted. Existing in-person EFTPOS must always charge the Idealpos-authoritative payable amount, never Verdura's provisional figure. Verdura reconciles its provisional commercial calculation against the amounts Idealpos actually returns; a material discrepancy between the two becomes a visible, blocking conflict presented to staff — it must never be silently absorbed, rounded away, or auto-corrected.

**New Zealand venue tax facts, established as authoritative venue metadata (not implementation):**
- Customer-facing restaurant menu prices at the Dunedin venue are **GST-inclusive** — the displayed price is the price, not a base to which tax is added afterward.
- No Verdura surface (Order Tablet, kiosk, or any future channel) may add a further 15% on top of an already GST-inclusive displayed menu price. Doing so double-counts GST.
- Where GST is shown at all against a GST-inclusive amount, it is shown as the component already contained within the total, computed as `gross × 3 / 23` (the standard NZ 15%-rate GST-inclusive extraction formula) — never as an additive 15% line.
- Any surcharge or service charge must be sourced from authoritative configuration and clearly disclosed to the customer before ordering. No genuine, configured charge may be silently removed; no charge that lacks configuration backing may be silently kept. The currently observed hardcoded 10% "service charge" in `OrderTabletPage.tsx` has no configuration backing and must not be treated as production truth.
- Worked example: a menu item displayed as `$70.00` (GST-inclusive) contains a GST component of `$9.13` (`70 × 3 / 23`), and its total without an authorised surcharge is `$70.00`. The tablet's current presentation of this same item as `$70 + $7.00 service charge + $10.50 GST = $87.50` is a confirmed billing-integrity defect, not a display nuance — it fabricates a service charge with no configuration source and adds a second, additive 15% GST computation on top of a price that already contains GST.
- Venue metadata of record: currency `NZD`, locale `en-NZ`, timezone `Pacific/Auckland`, tax jurisdiction `NZ_GST`, `pricesIncludeTax = true`. Established as `Venue` schema fields with these values as defaults (`backend/prisma/schema.prisma`, migration `20260817005226_venue_locale_tax_metadata`) so any current or future venue record carries this metadata explicitly rather than by unstated assumption.

**Correction to prior record:** `docs/epics.md`'s E15 baseline banner (2026-08-16) and `_bmad-output/implementation-artifacts/deferred-work.md`'s corresponding entry both concluded that the tablet's additive 15% GST line was "already correct... consistent with the backend/kiosk convention... not a double-count bug," on the reasoning that `OrdersService.computeTotals` (`backend/src/orders/orders.service.ts:1033-1036`) already adds 15% on top of `MenuItem.priceCents` system-wide, so matching it was "not inventing a new convention." That reasoning is superseded by this decision: the existing backend/kiosk convention itself now conflicts with the confirmed business fact that customer-facing menu prices are GST-inclusive. **This decision does not fix `computeTotals` or the kiosk checkout** — that is backend/kiosk-shared infrastructure outside Epic 15's scope (`OrdersService.computeTotals` also serves non-tablet order sources) and is not addressed by this entry or by story `15-1`. It is flagged here as a materially significant, currently-unowned finding: if `MenuItem.priceCents` is meant to represent the GST-inclusive customer-facing price, then the kiosk checkout (`kiosk-frontend/src/pages/KioskOrderPage.tsx`, "GST (15%)" line) most likely exhibits the same additive-GST pattern this decision prohibits for the tablet, using the same shared `computeTotals` call. Confirming and, if confirmed, correcting this is a separate decision and story outside Epic 15's boundary and is not resolved here.

**Required later payment flow** (target architecture, not this session's implementation): `Verdura provisional GST-inclusive cart → order submitted to Idealpos → Idealpos returns authoritative GST/rounding/final payable total → Verdura compares → customer/staff confirms any permitted change → Idealpos initiates EFTPOS → Verdura records the real result`. Until real Idealpos confirmation exists for a given order, any amount shown on the tablet must be truthfully labelled provisional or estimated, per this repository's standing truthful-state rule (`target-operating-model.md`, `mvp.md` Non-Negotiable Principle #1). ~~The current Card/Cash buttons marking an order paid/complete without authoritative payment evidence remain a known, separately-owned defect (`docs/epics.md` E15 baseline banner; owner `15-6`) — unaffected by, and not resolved by, this decision.~~ **Superseded 2026-08-20 by DL-087:** the Order Tablet never processes payment at all — the Card/Cash buttons referenced above were removed outright, not fixed or gated. The GST-inclusive pricing/totals rules in this decision remain unchanged and fully in force; only the payment-initiation framing above is superseded. "Customer/staff confirms any permitted change → Idealpos initiates EFTPOS" in the flow sketched above never happens on the Order Tablet — Idealpos/EFTPOS payment happens independently, outside Verdura's UI, per DL-087.

**Story ownership (Epic 15):** this decision does not add a new story. Existing stories, corrected at the source (`docs/epics.md`):
- `15-1` (venue and auth decision): establishes the venue tax/locale metadata above and must not introduce a new source of double GST. Does not touch cart-total, service-charge, or Idealpos-reconciliation logic.
- `15-4` (idempotent submission, truthful totals): owns removing the fabricated 10% service charge and correcting the tablet's provisional-total display to the GST-inclusive convention above (GST shown as the contained component, not added again), sourced from real configuration, and visibly labelled provisional/estimated.
- `15-5` (Idealpos handoff, authoritative POS state): owns receiving and displaying Idealpos's authoritative GST/rounding/final payable total once returned, and surfacing a material discrepancy against Verdura's provisional total as a visible, blocking conflict per this decision — not previously part of its stated scope.
- `15-6` (EFTPOS/cash handoff): owns charging the Idealpos-authoritative payable amount established by `15-5`, never Verdura's provisional total, for the card path.

**Rationale:** Prevents the same class of silent, undocumented drift DL-067 already guards against for KDS/KOT — an authority split stated once, here, rather than each downstream story re-deriving (or mis-deriving, as the superseded reasoning above shows happened once already) its own tax convention.

**Confidence:** [APPROVED RECOMMENDATION] — authoritative for Epic 15 and any Verdura surface sharing `MenuItem.priceCents`; the flagged kiosk/backend `computeTotals` question remains open and requires its own confirmation and decision.


## 2026-08-16 — Idealpos Local Evidence and API-less Adapter Planning

### DL-065: Local Idealpos installation evidence recorded

**Decision:** Record, as evidence only (not entitlement or availability), the safe filesystem/metadata findings from a read-only inspection of a copied Idealpos Windows installation: Windows-based, 32-bit and .NET Framework 4.6.1 components; COM-visible assemblies; ecommerce/online/transaction-related DLLs and method-name metadata including a new corroborating find (`ProcessDoshiiService`); a confirmed reverse-engineering restriction in the licence text. Full detail in `docs/integrations/idealpos.md` §12.

**Rationale:** These facts materially inform (but do not resolve) DL-064 and the adapter-boundary decision (DL-066). No code, service start, decompilation, or database/credential access occurred; no secret was recorded.

**Confidence:** [CONFIRMED] — direct, safe, static inspection, 2026-08-16.

### DL-066: API-less interim adapter architecture proposed, not adopted for production

**Decision:** Define a replaceable Idealpos adapter boundary with two implementations: (1) a preferred, vendor-supported Idealpos Online/ecommerce/Doshii/SDK interface, remaining preferred whenever available; (2) a proposed, Verdura-managed, unproven API-less interim adapter — a Windows Connector service paired with a separate interactive Idealpos POS Bridge UI-automation process. Full specification in `docs/integrations/idealpos.md` §13–§17.

**Rationale:** No vendor-supported, licensed, documented integration contract is confirmed (DL-064 remains blocked). The API-less path gives a controlled, disclosed fallback that does not require direct database access or undocumented DLL/COM calls, but it is explicitly not vendor-endorsed unless written approval is obtained, and requires its own live-discovery and tracer-bullet evidence gates (DL-068) before any production commitment.

**Confidence:** [APPROVED RECOMMENDATION] — architecture proposed for downstream implementation, not itself proof of viability.

### DL-067: KDS/KOT duplicate-print decision remains blocked; default preserved

**Decision:** Verdura remains the intended owner of KDS/KOT for Verdura-originated orders (reaffirms DL-063) under the API-less adapter as well. Whether Idealpos kitchen printing can be selectively suppressed for API-less-originated orders is a blocking live-discovery item (`docs/integrations/idealpos.md` §18, discovery checklist §F). If suppression proves impossible, a formal decision between (a) Verdura-owns-both-KDS-and-KOT-with-Idealpos-printing-disabled [default, no new approval required] and (b) Verdura-owns-KDS-while-Idealpos-owns-physical-KOT-with-Verdura-print-suppression [requires a separate, explicit architecture/TOM decision and end-to-end duplicate-prevention evidence] is required. No production pilot may allow both systems to print the same KOT.

**Rationale:** Prevents silent, undocumented drift into option (b), which would materially change kitchen operations and duplicate-prevention responsibility without an explicit decision trail.

**Confidence:** [APPROVED RECOMMENDATION] — decision framework approved; the underlying discovery question is `BLOCKED`.

### DL-068: Idealpos delivery sequence corrected; tracer bullet gate added

**Decision:** The authoritative delivery sequence for all Idealpos work (vendor-supported and API-less) is: (1) record safe local installation evidence [done] → (2) complete live Windows discovery → (3) resolve connector identity/durable transport (story 2-9) → (4) execute the non-production UI-bridge tracer bullet (story 9-2) → (5) decide adapter viability → (6) implement production-grade mapping/recovery/observability/reconciliation → (7) real-venue UAT. Full adapter implementation (E9-S3–S7) is not scheduled ahead of steps 2 and 4.

**Rationale:** Building production-grade adapter code before proving the mechanism works at all (steps 2 and 4) risks investing in an approach that live discovery or the tracer bullet could disprove cheaply. This mirrors the tracer-bullet pattern already used successfully for stories 6-1/8-1/9-1.

**Confidence:** [APPROVED RECOMMENDATION].

---

## 2026-08-16 (b) — Outbox Dispatch Reachability

### DL-069: pos-sync direct dispatch is safe now; print-jobs direct dispatch remains prohibited pending the connector

**Decision:** The repository audit (`_bmad-output/audits/repository-story-audit-2026-08-16.md`) found both the `pos-sync` and `print-jobs` BullMQ queues dormant and recommended, in shorthand, "wire the enqueue calls." Direct code inspection of both consumers (`backend/src/queue/processors/pos-sync.processor.ts`, `backend/src/queue/processors/print-jobs.processor.ts`) shows these two queues are **not symmetric in risk**, and must be treated differently:

- `PosSyncProcessor` makes **zero network calls of any kind**. Given no real Idealpos adapter exists (DL-064), it is a pure, deterministic, already-reviewed database-state classifier that always resolves a `POSSyncRecord` to `not_applicable` (adapter `none`) or `unsupported` (any other configured adapter type) — story 9-1's tested, truthful ceiling. Feeding this queue in production touches no venue LAN, requires no connector identity, and cannot violate target-operating-model.md §8 or DL-054, because it never leaves the cloud process. **Direct dispatch to `pos-sync` is approved.**
- `PrintJobsProcessor`, for `tcp`/`network`-connection-type printers, opens a live `net.Socket` connection from the cloud API process directly to `printer.host:printer.port` (`print-jobs.processor.ts`'s `sendToTcpPrinter`). This is a literal instance of the direct-cloud-to-LAN pattern that `docs/architecture.md`'s banner, `docs/printers.md`'s implementation-status banner, `target-operating-model.md` §8, and DL-054/DL-027's correction all already prohibit as the production trust boundary. **Direct dispatch to `print-jobs` remains prohibited** until either a real venue connector (story 2-9 plus a printer-side connector component) exists to carry the command instead, or a separate, explicit, written decision restricts production dispatch to the connection types that make no network call (`usb`, `windows_shared`, `simulated` in non-production, or an unsupported type — all of which already fail closed to `manual`/`failed` without touching a socket). No such restriction decision is made here.

**Rationale:** The audit's own shorthand recommendation ("wire the enqueue calls," treating both queues as one fix) would have silently resurrected the prohibited direct-cloud-to-LAN pattern for any venue with a `tcp`/`network` printer configured, the moment print-jobs was fed. Evaluating the two consumers' actual code — not their shared "dormant queue" framing — is what surfaces this; the fix is smaller and safer than the audit's shorthand implied for one queue, and must not be attempted at all yet for the other.

**Consequences:** Story `9-3` (POS-Sync Outbox Dispatch) implements only the `pos-sync` half. A separate, later, connector-dependent story is required for `print-jobs` production dispatch — not created by this decision, and not to be inferred as approved by it.

**Confidence:** [VERIFIED] — direct source inspection of both processors, 2026-08-16.

---

## 2026-08-16 (c) — Connector Command/Session Transport

### DL-070: authenticated HTTPS polling is the connector command transport for Story 2-10; a persistent session (WebSocket/SignalR) remains a reversible future option, not adopted now

**Decision:** The Verdura Connector's command channel is **connector-initiated, authenticated HTTPS polling** against the existing NestJS/Express HTTP surface — `POST /connector/commands/poll`, `POST /connector/commands/:id/accept`, `POST /connector/commands/:id/report` — re-authenticated via Story 2-9's `ConnectorAuthGuard` on **every single call**, not a persistent session negotiated once at connect time. No inbound port, WebSocket listener, or long-held server connection is opened for this purpose. This is the narrowest reversible engineering choice for story 2-10's tracer; it does not foreclose adding a persistent-session transport (Socket.io, matching the existing KDS gateway's own established pattern, or a future .NET-native option such as SignalR) later, since the durable `ConnectorCommand` table this decision governs is itself transport-agnostic — any future transport still claims/accepts/reports against the same rows and the same state machine.

**Evaluated alternatives:**
1. **Authenticated HTTPS polling (adopted).** Connector-initiated (outbound from the venue LAN, satisfying `architecture.md` §4.8's and `target-operating-model.md` §8's outbound-only requirement identically to the existing IdealPOS Agent's own network-requirement framing), stateless per call, and reuses Story 2-9's `ConnectorAuthGuard` exactly as built — no new authentication mechanism, no new revocation-checking logic. Trivially portable to any language with an HTTP client (a future .NET connector needs only `HttpClient` and a timer — no library, no persistent-connection lifecycle code, no reconnection state machine).
2. **A persistent authenticated WebSocket session** (reusing the existing Socket.io/Redis-adapter infrastructure the KDS gateway already runs). Rejected **for this story**, not permanently: a persistent session requires its own revocation-during-an-active-session mechanism (Story 2-9's guard re-authenticates per HTTP request; a socket that authenticated once at connect time would keep trusting a since-revoked connector until the socket is separately, explicitly checked or force-disconnected — new logic this story would have had to invent and test from scratch). It also requires a `socket.io`-compatible client on the future .NET side (a real but nontrivial library dependency, unlike plain `HttpClient`), and NestJS holding many long-lived server-side connections has operational implications (memory, Redis-adapter fan-out) disproportionate to a single-venue MVP's needs today.
3. **A different existing architecture pattern** (e.g. the `pos-sync`/`print-jobs` BullMQ queue pattern, story 9-3). Rejected as inapplicable: those queues are consumed by in-process cloud workers, never by an external, authenticated, venue-bound party — reusing that pattern here would mean handing a venue-side process direct Redis/BullMQ access, which is exactly the DL-054-prohibited shared-cloud-Redis-credential case `target-operating-model.md` §8 and story 9-3's own security section explicitly rule out.

**Protocol contract this decision governs** (implemented in `backend/src/connector/connector-command.service.ts`, `connector-command.controller.ts`; enforced by `ConnectorAuthGuard`/`RateLimitGuard`):
- **Authentication on connection and reconnection:** identical on every call — there is no separate "connection" event to distinguish from "connect" vs. "later"; each `poll`/`accept`/`report` call is independently authenticated exactly as any other Story 2-9-guarded request. A "reconnect" (e.g. after a network drop) is simply the next poll call, authenticated the same way.
- **Session ownership:** there is no session object. Ownership of an individual command is recorded on the row itself (`claimedByInstallationId`), not on a connection/session — this is what makes rotation/replacement's ownership-recovery story-testable and deterministic (see the story file's AC and test evidence) rather than dependent on socket-level session teardown timing.
- **Venue and installation binding:** resolved exclusively from the authenticated `ConnectorIdentity` (`installationId`/`organizationId`/`venueId`) on every call — never from a request parameter, matching Story 2-9's own established invariant.
- **Revocation during an active session:** trivial and provable by construction — since every call re-authenticates against the live `ConnectorInstallation.status`, a revoked or replaced installation's very next poll/accept/report call is rejected (401) before it reaches any command logic. No separate "kick an active session" mechanism is needed or built.
- **Command delivery:** connector-pulled (poll), never server-pushed. A command is only "delivered" in the sense of being returned from a poll call the connector itself initiated.
- **Backpressure:** bounded two ways — a fixed per-poll batch cap (`MAX_POLL_BATCH`) and a per-installation outstanding-commands cap (`MAX_OUTSTANDING_PER_INSTALLATION`, counting `claimed`+`accepted` rows); once at the cap, poll returns an empty result rather than erroring, so a slow or stuck connector cannot be handed unbounded additional work.
- **Heartbeat/liveness:** unchanged from Story 2-9 — `POST /connector/heartbeat` remains the liveness/health signal (`lastSeenAt`), independent of this story's command polling cadence. This story additionally reuses the same heartbeat payload's self-reported `capabilities` to gate which commands a given installation may claim (`requiredCapability`).
- **Reconnection:** stateless by design — there is nothing to "reconnect" beyond making the next authenticated HTTP call. A connector that was offline for any length of time simply resumes polling; any command it had claimed before going offline becomes safely reclaimable once its lease expires (see the story's lease/redelivery mechanics), and this decision's transport choice does not add any additional reconnection-specific state.
- **Duplicate delivery:** governed by the command table's own claim CAS (a database compare-and-swap on `status`/`leaseExpiresAt`), not by transport-level message deduplication — a duplicate poll (two overlapping calls, a retried request) can only ever win the claim once per row, proven under real concurrent load in the story's real-Postgres test suite.
- **Acknowledgement semantics:** two-phase — `CONNECTOR_ACCEPTED` (durable local persistence confirmed) is a distinct, separately-idempotent step from the later truthful terminal report (`succeeded`/`failed`), exactly as specified in the story's state model. Neither step is transport-level (e.g. no WebSocket ack frame) — both are ordinary idempotent HTTP calls.
- **Maximum payload and batch limits:** a defensive per-command payload size ceiling (`MAX_PAYLOAD_BYTES`, enforced at command-creation time in the service layer) and the poll batch/outstanding caps above. No transport-level frame-size concern exists since this is plain HTTP/JSON, not a persistent binary protocol.
- **Protocol/version negotiation:** explicit and versioned per command, not per connection — `ConnectorCommand.schemaVersion` travels with every command envelope; a connector that does not understand a given `commandType`/`schemaVersion` combination simply never reports the matching capability and therefore never claims it (capability-gated, not negotiated over a handshake).
- **Secure transport boundary (explicit, not implemented here):** this decision governs the *application-layer* protocol only. It reuses whatever transport security the existing NestJS/Express app already runs on (Story 2-9's own established boundary). **This decision does not implement, and must not be read as implementing, mutual TLS, certificate pinning, or hardware/Windows-credential-store binding** — those remain deployment-configuration and/or later-Windows-connector-story concerns, identical to Story 2-9's own explicit transport-security boundary note.
- **Compatibility with the future .NET Windows connector:** by design, this transport requires nothing beyond an HTTP client and a timer — no persistent-connection library, no reconnection state machine, no Node.js runtime. The durable local persistence this decision's protocol requires before `CONNECTOR_ACCEPTED` (see the story's own persist-before-ack requirement) is explicitly storage-technology-agnostic — this story's own proof harness uses a plain fsync'd file specifically to demonstrate that no particular storage technology (e.g. SQLite) is mandated by the protocol itself.

**Unresolved, explicitly deferred (not decided here):** the poll interval/cadence for a production connector, and whether a future real command type (e.g. an eventual Idealpos-order-submit command) should move to a persistent-session transport for lower latency, are product/performance decisions for whichever later story introduces real, latency-sensitive command types. Nothing in this decision or story 2-10's implementation forecloses that later choice.

**Confidence:** [APPROVED RECOMMENDATION] — the narrowest reversible choice for this story's tracer scope; a persistent-session transport remains a legitimate, undecided option for later, latency-sensitive command types.

---

## 2026-08-16 (d) — Idealpos Integration Route Selection (Story 9-2, Discovery-Only)

### DL-071: API-less Windows UI Automation selected as the interim integration route, discovery phase only; three vendor-supported candidates remain capability-evidence-only, not selectable

**Decision:** Evaluated in the mandated priority order — (1) a vendor-supported installed ecommerce/online-ordering/integration mechanism, (2) a vendor-supported file/import/local-service mechanism, (3) a vendor-approved UI automation mechanism, (4) a carefully bounded Windows UI Automation bridge as an interim route — routes 1–3 are **not selectable** today; route 4 is **selected, discovery phase only**.

**Evidence considered:**
- Three real, named candidate vendor-integration surfaces now exist in the static installation-copy evidence (`idealpos.md` §12.1/§12.4): Doshii (`ProcessDoshiiService`), an internally-named "WebIt" web-ordering product (`IdealPos.Webit.Core.dll`, confirmed via embedded PDB debug paths), and the Ecommerce/Online service architecture itself (a separate long-running process with its own SignalR client and licensing-service SOAP contract). A fourth, unrelated-to-Verdura surface (ResDiary EPOS consumer helpers) was also found, recorded for completeness only.
- None of these has confirmed licence entitlement, commercial availability, sandbox access, or a documented acknowledgement/transaction-reference contract for any real venue — `idealpos.md` §13.1's standing "all of the following confirmed in writing" requirement remains unmet for all three. This is capability evidence (the code paths exist in this installer copy), never availability evidence.
- No written vendor/reseller position on UI-automation-based order entry has been obtained — discovery checklist item I remains `BLOCKED_REQUIRES_VENDOR`. Route 3 (vendor-*approved* automation) is therefore not selectable either, independent of route 4's own merits.
- Route 4 (the API-less interim adapter, `idealpos.md` §13.2/§14) has an existing, independently-reviewed architecture specification and is the only route this session could make concrete, tested progress on without live access or vendor engagement — specifically, its **discovery phase** (process detection, UI-profile matching, safe-state checking, one harmless reversible navigation), which requires no order/payment interaction and therefore does not require the live-discovery gates §14.2's full order-entry Bridge would need.

**Consequences:** Story `9-2` implements and proves only route 4's discovery phase this session (`windows-connector/`) — never order entry, EFTPOS, or printing. Route 4 remains Verdura's own engineering risk to disclose to the venue operator, not a vendor-endorsed integration, per `idealpos.md` §13.2's existing framing (unchanged by this decision). Routes 1–3 remain preferred and re-evaluated the moment written vendor/reseller confirmation is obtained (checklist item I, and items A/B/C/D covering the three named surfaces specifically) — this decision does not deprioritise pursuing them, only records that none is available to act on today.

**Rejected outright, not merely deprioritised:** undocumented database writes, binary injection/decompilation, screen-coordinate-only clicking as the primary mechanism, and any undocumented DLL/COM invocation — unchanged from `idealpos.md` §14.2's existing prohibitions; no new evidence this session changes this.

**Confidence:** [APPROVED RECOMMENDATION] — the correct route given real evidence gathered this session; explicitly revisitable the moment vendor/reseller evidence changes the picture for routes 1–3.

**2026-08-17 addendum (static-only session, no live Windows access):** a deeper static pass (`idealpos.md` §12.5) substantially strengthens the Doshii finding — from a single method name (`ProcessDoshiiService`) to a full, compiled, first-party Doshii client (`DoshiiService`/`PosserverService` classes, OAuth token flow, `ApiKey`/`LocationId` config fields). It also establishes, by searching specifically and finding nothing, that Idealpos's four core Ecommerce/Online service DLLs contain **no local server-hosting evidence** (`NOT_FOUND` — no `HttpListener`/Kestrel/named-pipe/bound-port string in that targeted search) — they are outbound-only cloud-polling clients. WebIt was not part of that specific search and its local-hosting question remains open. **This does not change this decision**: routes 1–3 remain not selectable (entitlement/commercial/technical confirmation is still unconfirmed in writing for any of them) and route 4 remains selected, discovery-phase only. It does sharpen what route 1 would concretely mean if Doshii entitlement is later confirmed — most likely a Doshii marketplace/partner-app relationship (Verdura pushes to Doshii's cloud API, which Idealpos polls), not a direct local Verdura↔Idealpos call — which changes the vendor questions worth asking (consolidated in `idealpos.md` §12.6), not the route priority order itself. Story `9-2` remains `blocked`; this session had no live Windows/Idealpos access either (confirmed: `uname`/`sw_vers` → macOS/Darwin), so no checklist item moves past static-evidence status as a result of this addendum.

---

## 2026-08-15 — Assessment Re-baseline

### DL-060: Verdura engagement layer; Idealpos POS authority

> **Superseded 2026-09-28 by DL-115 / [ADR 0001](./adr/0001-servvia-is-the-operational-pos.md).** Servvia is the operational POS. IdealPOS is legacy integration only.

**Decision:** Verdura owns ordering, reservations, operational workflow, KDS/KOT routing, inventory, CRM and analytics. Idealpos remains authoritative for the POS transaction and in-person payment.

### DL-061: Idealpos-first standard order flow

> **Superseded 2026-09-28 by DL-115 / [ADR 0001](./adr/0001-servvia-is-the-operational-pos.md).** Kitchen release no longer waits on external-POS acceptance.

**Decision:** Standard Verdura orders are durably accepted by the venue connector for Idealpos submission before Verdura releases KDS/KOT. Payment then follows the existing Idealpos-integrated EFTPOS/cash workflow.

### DL-062: Optional online payment remains provider-neutral

> **Partially superseded 2026-09-28 by DL-115 / [ADR 0001](./adr/0001-servvia-is-the-operational-pos.md).** Provider neutrality stands. Online payments are now recorded as Servvia Payments, not mapped to an Idealpos `PREPAID / ONLINE` transaction.

**Decision:** Verdura verifies online payment before production release and maps the Idealpos transaction to `PREPAID / ONLINE`. Stripe is the MVP default unless an approved Verifone/Oolio ecommerce service meets the documented API, webhook, idempotency, refund and reconciliation gates.

### DL-063: Verdura owns kitchen delivery for Verdura-originated orders

> **Retained under DL-115 / [ADR 0001](./adr/0001-servvia-is-the-operational-pos.md).** The clause about Idealpos not duplicating tickets applies only while the legacy integration runs.

**Decision:** Verdura routes KDS and station KOTs; Idealpos must not duplicate these tickets. POS, KDS, each printer and payment retain separate state and acknowledgements.

### DL-064: Idealpos vendor-discovery decision record (formal)

> **Superseded as a product gate 2026-09-28 by DL-115 / [ADR 0001](./adr/0001-servvia-is-the-operational-pos.md).** It now governs only the legacy IdealPOS integration, for as long as that integration exists.

**Status:** `BLOCKED` — no code beyond `NullAdapter`/`none` may be built against this decision until it is resolved.

**Decision owner:** Product/technical owner of the Idealpos relationship (venue owner or delegate), in coordination with Idealpos, Oolio, or the reseller of record.

**Required evidence before unblocking:**
- Installed Idealpos version/build.
- Written confirmation of what the existing perpetual licence entitles (or does not entitle) with respect to integration modules, Idealpos Online, APIs, or reseller add-ons.
- Confirmation of a supported order-ingress mechanism (ecommerce/web-order API, approved reseller module, documented API/import, or — last resort — a vendor-approved direct-database pattern with written recovery/upgrade-testing sign-off).
- Table, PLU/item, modifier, tax, surcharge and tender mapping rules.
- Whether Idealpos exposes a stable, synchronously-obtainable transaction reference, or only a delayed/batch one.
- Whether Idealpos can suppress its own kitchen-ticket printing for API/import-originated orders (duplicate-KOT prevention).
- Existing Oolio Pay/Verifone terminal configuration and its EFTPOS payment-observation mechanism.
- Whether a Verifone/Oolio ecommerce (online) product is commercially and technically available in NZ, meeting target-operating-model.md §8's bar (sandbox, tokenised/hosted capture, signed webhooks, idempotency, refunds, settlement reconciliation).

**Options under evaluation (see `docs/integrations/idealpos.md` §5 for full trade-off detail):** ApiAdapter, SqlAdapter, OdbcAdapter, CsvAdapter, LocalAgentAdapter, in the vendor-supported preference order set by target-operating-model.md §8. `NullAdapter`/`none` is development-only and is never a production option.

**Consequences of each option:** documented per-adapter in `docs/integrations/idealpos.md` §5.1–5.5 (advantages/disadvantages/recommended-if). SqlAdapter/OdbcAdapter carry the highest data-corruption and vendor-support risk and require written vendor approval plus recovery/upgrade testing before use (target-operating-model.md §8).

**Default fail-safe behavior while blocked:** `posAdapterType` defaults to `none`; `POSSyncRecord.status` reports `not_applicable`, never `synced`. Kitchen/KDS release for Verdura-originated orders may proceed under the venue's approved manual/EFTPOS workflow, but no code path may represent a manual or absent POS handoff as a confirmed Idealpos transaction.

**Blocking dependent stories:** `9-1-pos-sync-truthful-states` (real adapter work beyond the truthfulness fix), `9-2-idealpos-uibridge-tracer` (API-less tracer bullet, see DL-066/DL-068 and `docs/integrations/idealpos.md` §19–§21), any future `9-3..9-7` adapter-implementation stories, `2-9-internal-service-auth`'s Idealpos-facing capability negotiation, and the "standard-idealpos-eftpos-journey" and "idealpos-adapter-and-mapping-validation" entries in `sprint-status.yaml`.

**2026-08-16 addendum:** see DL-065–DL-068 for newly recorded local Idealpos installation evidence and the proposed (unproven) API-less interim adapter architecture. This evidence informs but does not resolve this decision — DL-064 remains `BLOCKED` until the live discovery package (`docs/discovery/idealpos-live-discovery-checklist.md`) is complete.

### DL-051: Production readiness claim withdrawn

**Decision:** Withdraw the previous `98/100 PRODUCTION-READY` conclusion. Classify the repository as a controlled operational prototype, not approved for production payments or POS-connected operation.

**Rationale:** Stripe is not verified server-side; POS success is fabricated; print and POS records are not enqueued; edge services do not exist; enterprise permissions, tenancy and audit are incomplete.

**Confidence:** [VERIFIED]

### DL-052: Phase 1A provider-neutral proof is the active product gate

**Decision:** Prioritize one real canonical order handoff, reconciliation path and multi-channel availability workflow before later-phase modules.

**Rationale:** These workflows prove the v5.2 buying outcome; additional mock dashboards do not.

**Confidence:** [APPROVED RECOMMENDATION]

### DL-053: External delivery and confirmation are separate facts

**Decision:** Model `Queued`, `Delivered`, `Acknowledged`, `Confirmed`, `Rejected`, `Failed`, `Conflict`, `Unsupported` and `Manual` explicitly. No adapter may infer confirmation from elapsed time or local delivery.

**Confidence:** [APPROVED RECOMMENDATION]

### DL-054: Venue agents use a scoped connector boundary

**Decision:** Production venue agents connect outbound using revocable installation identities and a scoped command/event API. Do not expose shared cloud Redis directly or rely on cloud-to-LAN TCP access.

**Confidence:** [APPROVED RECOMMENDATION]

### DL-055: Real-money checkout fails closed

**Decision:** Disable real-money kiosk checkout until the server verifies PaymentIntent amount, currency, status and uniqueness and processes signed idempotent webhooks. Remove fabricated token fallbacks.

**Confidence:** [VERIFIED BLOCKER]

### DL-056: Historical plans and specs do not establish completion

**Decision:** Treat `docs/superpowers/` plans/specifications as historical design records. Completion requires current source evidence and the acceptance gates in `docs/mvp.md`.

**Confidence:** [VERIFIED]

> Single source of truth for all non-obvious choices made across every phase.
> Format per entry: **Decision** | Rationale | Phase | Confidence

---

## Phase 0 — Repository Audit

### DL-001: The existing codebase is integrated with a Supabase BaaS backend
**Decision:** Utilize the existing Supabase PostgreSQL database as the primary source of truth, but replace the simulated email/calendar triggers with real integrations via a cloud NestJS API.
**Rationale:** Codebase review of `src/api/apiClient.js` and `supabase/migrations/` confirms that the app is connected to Supabase Auth, PostgreSQL, and Deno Edge Functions in production. LocalStorage is only a local dev fallback when environment variables are omitted.
**Phase:** 0
**Confidence:** [CONFIRMED] — `src/api/apiClient.js`, `supabase/migrations/`

### DL-002: No IdealPOS integration exists in this codebase
**Decision:** The IdealPOS printer/POS integration described in the brief must exist entirely outside this repository (Windows service, separate script, or another codebase). It is not present here.
**Rationale:** Zero references to "idealpos", "mssql", "odbc", "escpos", "tcp socket", or any printer library in `package.json`, `package-lock.json`, or any `.js`/`.jsx` file.
**Phase:** 0
**Confidence:** [UNKNOWN] — mechanism is confirmed absent from *this* repo; where it actually lives is unknown

### DL-003: The existing stack is JavaScript (not TypeScript)
**Decision:** The frozen customer-facing codebase is React 18 + JavaScript (`.jsx`), not TypeScript. All new surfaces (kiosk, admin, kitchen display) will be built in TypeScript as specified in Technical Preferences — the existing frontend stays in JS untouched.
**Rationale:** Every source file under `src/` uses `.jsx` or `.js` extension. No `tsconfig.json` exists (only `jsconfig.json`). No `.tsx` files found.
**Phase:** 0
**Confidence:** [CONFIRMED] — `jsconfig.json`, all files in `src/`

### DL-004: Admin functionality is currently embedded in the public SPA
**Decision:** Extract `/admin/daily-email` into the new standalone Admin Dashboard. This is the sole permitted change to `App.jsx`.
**Rationale:** The route `/admin/daily-email` is registered in `App.jsx`. It calls Supabase Edge Functions (`dailyReservationSummary`, `backfillCalendarEvents`). It is protected via `ProtectedRoute.jsx` which queries Supabase auth session contexts directly. For security containment, this must move to `admin.verdura.co.nz`.
**Phase:** 0
**Confidence:** [CONFIRMED] — `src/App.jsx`, `src/lib/AuthContext.jsx` line 29

### DL-005: Menu and category data are static JSON files
**Decision:** `menuItems.json` and `categories.json` are the canonical source of menu data for the existing public site. Any new Menu Management system must treat these as the migration seed — not overwrite them — and the question of whether the frozen public site becomes a consumer of the new backend's menu API is a Tension requiring human decision.
**Rationale:** `src/api/categories.json` and `src/api/menuItems.json` are imported directly at line 1–2 of `apiClient.js`. 66+ menu items confirmed. No `imageUrl` values are populated (all `null`).
**Phase:** 0
**Confidence:** [CONFIRMED] — `src/api/apiClient.js` lines 1–2; `src/api/menuItems.json`

### DL-006: No Zustand in current codebase
**Decision:** The Technical Preferences list Zustand for state management. The existing codebase uses React local state (`useState`) only — no global state library is present. New surfaces (kiosk, admin, kitchen display) will use Zustand as specified. The existing site is untouched.
**Rationale:** `package.json` has no `zustand` dependency. State management in existing pages and components is entirely `useState`/`useContext`.
**Phase:** 0
**Confidence:** [CONFIRMED] — `package.json`

---

## Phase 1 — Discovery

### DL-008: Self-ordering kiosk is not in this repository
**Decision:** Treat the kiosk as a new surface to be built, not a component to be extracted or migrated.
**Rationale:** Zero kiosk, cart, order submission, or table-selection code found anywhere in `src/`. The integration described in the brief (print on submit, save to IdealPOS) also has no evidence here.
**Phase:** 1
**Confidence:** [UNKNOWN] — it may exist in a separate system; Phase 0 search was exhaustive within this repo

### DL-009: Google Calendar and email integrations are simulated database-side
**Decision:** Implement real Resend and Google Calendar API integrations in the NestJS backend, triggered by status changes on the PostgreSQL database.
**Rationale:** The current system tracks calendar and email actions via database tables (`pending_calendar_events` and `email_logs`) and Deno Edge Functions, but the actual delivery of emails and calendar events is simulated. We will replace these simulations with cloud integrations.
**Phase:** 1
**Confidence:** [CONFIRMED] — `src/api/apiClient.js`, `supabase/migrations/`

### DL-010: Stripe SDK is present but integration status unknown
**Decision:** Flag Stripe as [UNKNOWN] — do not assume payment processing is working in production. Phase 2 PRD must treat payment as a requirement to confirm or scope.
**Rationale:** `@stripe/react-stripe-js` and `@stripe/stripe-js` present in `package.json` but no Stripe publishable key, no `<Elements>` provider, and no active `useStripe` hook confirmed in visible page components.
**Phase:** 1
**Confidence:** [UNKNOWN]

---

## Phase 2 — PRD

### DL-011: Self-ordering kiosk is order-capture only — no payment (SUPERSEDED)
**Decision:** [SUPERSEDED by DL-050] — Ordering Kiosk now processes card payments directly.
**Rationale:** Overridden by confirmed product requirements on 2026-06-20. The ordering kiosk requires card payments to be captured and tracked at the kiosk terminal.
**Phase:** 2
**Confidence:** [SUPERSEDED]

### DL-012: Admin Dashboard deployed at admin.verdura.co.nz (separate subdomain)
**Decision:** Option 1 (separate subdomain) selected as the default. Admin Dashboard deployed independently from the public site.
**Rationale:** Master prompt's Phase 4 section recommends this as the default. It keeps the frozen public site's deploys and CDN completely untouched by admin changes and contains the blast radius of any admin incident. Sub-path routing (Option 2) would require modifying the public site's server config, which may conflict with the Frontend Freeze.
**Phase:** 2
**Confidence:** [ASSUMED] — pending Q6 (production hosting setup) confirmation

### DL-013: Menu management uses object storage for images, DB stores URL only
**Decision:** Images are uploaded to object storage (S3/Cloudinary/GCS — to be decided in Phase 4). The database stores only the resulting URL string. Raw image bytes never enter PostgreSQL.
**Rationale:** Required by master prompt. Storing binary data in relational or document databases degrades query performance and backup efficiency. Object storage provides CDN integration and cost-effective large-file handling.
**Phase:** 2
**Confidence:** [CONFIRMED design decision] — supported by master prompt requirement

### DL-014: Kiosk offline queue uses IndexedDB
**Decision:** Self-Ordering Kiosk uses IndexedDB for offline order queuing (not localStorage).
**Rationale:** localStorage is synchronous, limited to ~5–10MB, and not suited for structured data or large order queues. IndexedDB is async, supports larger storage, and is designed for offline-first PWA patterns.
**Phase:** 2
**Confidence:** [CONFIRMED design decision]

### DL-015: Audit log stored in PostgreSQL JSONB
**Decision:** `AuditLog` entity lives in PostgreSQL as a table with `jsonb` columns.
**Rationale:** Audit log entries carry arbitrary `before`/`after` state snapshots of any entity type. Storing these as `jsonb` columns inside PostgreSQL gives us document-like schema flexibility while maintaining single-database transactional consistency.
**Phase:** 2
**Confidence:** [CONFIRMED design decision]

---

## Phase 3 — Domain Model

### DL-016: Price is Cents (integer) — never float
**Decision:** All monetary values use an integer `Cents` type alias (NZD cents). No floats anywhere in the domain model or API layer.
**Rationale:** Floating-point arithmetic produces rounding errors on money. `$18.50 → 1850` is unambiguous. Existing JSON data uses floats and requires conversion during migration (see DL-007).
**Phase:** 3
**Confidence:** [CONFIRMED design decision] — consistent with master prompt requirement

### DL-017: ModifierGroups are embedded in MenuItem, not a separate top-level entity
**Decision:** `ModifierGroup` and `ModifierOption` are embedded arrays within `MenuItem`, not separate database entities with their own ID namespaces.
**Rationale:** Modifiers have no meaning outside their parent MenuItem. Embedding avoids a join on every menu fetch and simplifies the kiosk query path. These are stored as JSONB columns inside PostgreSQL MenuItem table, avoiding multiple databases.
**Phase:** 3
**Confidence:** [CONFIRMED design decision]

### DL-018: OrderItem stores price snapshots, not live references
**Decision:** `OrderItem` stores `menuItemTitle`, `unitPriceCents`, and `selectedModifiers` as snapshots at the time of ordering. It does not join back to `MenuItem` for display.
**Rationale:** Menu items can change price, be renamed, or be deleted after an order is placed. Historical orders must be reportable with their original values. Order history integrity depends on immutable snapshots.
**Phase:** 3
**Confidence:** [CONFIRMED design decision]

### DL-019: ReservationMenuSelection also stores snapshots
**Decision:** `ReservationMenuSelection` stores `menuItemName` and `unitPriceCents` at selection time, not live FK references.
**Rationale:** Same rationale as DL-018 — reservation pre-orders must be stable even if the menu changes before the reservation date.
**Phase:** 3
**Confidence:** [CONFIRMED design decision]

### DL-020: Staff uses soft delete; MenuItem uses soft delete
**Decision:** Both `Staff` and `MenuItem` are soft-deleted (`deletedAt` timestamp) rather than hard-deleted.
**Rationale:** Staff who have created reservations or orders must remain referenceable for audit and reporting. MenuItems that appear in historical orders must remain identifiable even when removed from the active menu.
**Phase:** 3
**Confidence:** [CONFIRMED design decision]

### DL-021: Role permissions are code-defined, not database rows
**Decision:** The `ROLE_PERMISSIONS` matrix is defined in code (a constant), evaluated at runtime by the RBAC guard. Roles are not stored as configurable database rows.
**Rationale:** Verdura's role model is simple and unlikely to require per-tenant customisation at launch. Database-driven RBAC adds significant complexity (UI, migration surface, attack surface) for no MVP benefit. This can be promoted to a configurable model in a later phase if SaaS customers need custom roles.
**Phase:** 3
**Confidence:** [CONFIRMED design decision] — revisit if SaaS custom roles become a requirement

### DL-022: POSSyncRecord fields marked VERIFY AGAINST VENDOR DOCS
**Decision:** `posOrderId`, `posTableId`, `requestPayload`, and `responsePayload` fields on `POSSyncRecord` are typed as `Record<string, unknown>` and flagged `VERIFY AGAINST VENDOR DOCS`. No IdealPOS field names are invented.
**Rationale:** Operating Instruction #3 — do not fabricate vendor specifics. These fields will be concretised in Phase 5 once the adapter mechanism is confirmed.
**Phase:** 3
**Confidence:** [UNKNOWN] — pending Q1 resolution

---

## Phase 4 — Solution Architecture

### DL-023: Separate subdomain for Admin Dashboard (admin.verdura.co.nz)
**Decision:** Option 1 selected. Admin Dashboard deployed to a fully separate subdomain with its own CDN distribution, completely decoupled from verdura.co.nz.
**Rationale:** Eliminates blast radius between public site and admin; no changes to public site hosting config; independent deployment cadences. Sub-path routing (Option 2) would require touching the public site's server config — a freeze violation.
**Phase:** 4
**Confidence:** [CONFIRMED design decision] — pending Q6 (production DNS/hosting provider)

### DL-024: Edge Function enforces auth before serving admin bundle
**Decision:** A CDN Edge Function (Cloudflare Worker / Vercel Edge Middleware / Lambda@Edge) checks for a valid session cookie on every request to admin.verdura.co.nz. Unauthenticated users receive a 302 redirect to /login — no dashboard JavaScript is served to them.
**Rationale:** Client-side route guards are insufficient (the attacker can read the JS bundle). Server-side interception before bundle delivery is the only safe boundary at the CDN layer.
**Phase:** 4
**Confidence:** [CONFIRMED design decision]

### DL-025: JWT (15 min) + HttpOnly refresh cookie (7 days) for admin auth
**Decision:** Short-lived JWT in Authorization header for API calls; long-lived refresh token in HttpOnly Secure SameSite=Strict cookie for silent renewal.
**Rationale:** Short JWT expiry limits the window of a stolen token. HttpOnly cookie prevents XSS from reading the refresh token. SameSite=Strict prevents CSRF from using it. Standard pattern for SPA + REST API auth.
**Phase:** 4
**Confidence:** [CONFIRMED design decision]

### DL-026: AWS S3 + CloudFront for object storage; sharp for on-upload image optimisation
**Decision:** Menu item images stored in S3, served via CloudFront CDN. sharp (Node.js native) performs resize + webp conversion at upload time in the API container. Two variants: full (1200px) and thumb (400px).
**Rationale:** S3 + CloudFront is the most operationally mature choice. sharp avoids per-transform SaaS cost. Cloudinary was considered but adds vendor lock-in and cost at scale. Images converted to .webp at upload eliminates repeated runtime conversion.
**Phase:** 4
**Confidence:** [CONFIRMED design decision]

### DL-027: On-premise gateway PC runs Printer Service + IdealPOS Agent as PM2 processes (transport superseded)
**Decision:** Both on-premise services run as Node.js processes managed by PM2 on a dedicated always-on PC at the restaurant. ~~They connect outbound to Redis (cloud)~~ and inbound to LAN devices (printers, IdealPOS). **Correction (2026-08-15, superseded by DL-054):** the services connect outbound via a mutually authenticated connector session to a scoped command/event API — never a direct shared cloud Redis credential (target-operating-model.md §8). The PM2-process-topology decision itself stands; only the transport mechanism is corrected.
**Rationale:** Neither service can run in the cloud without local network access to printers and (likely) IdealPOS. PM2 provides process supervision, auto-restart on crash, and log management without requiring a full container runtime on the restaurant PC.
**Phase:** 4
**Confidence:** [ASSUMED] — depends on Q1 and Q2 confirmation. If IdealPOS has a cloud API, the agent could move to cloud.

### DL-028: Database Consolidation (No MongoDB/Mongoose)
**Decision:** MongoDB and Mongoose are removed from the system. Prisma handles all database operations.
**Rationale:** Consolidated all data stores to a single PostgreSQL (Supabase) database to decrease complexity. All document schemas are mapped via PostgreSQL JSONB columns.
**Phase:** 4
**Confidence:** [CONFIRMED design decision]

### DL-029: Kiosk and KDS served from kiosk.verdura.co.nz, sharing a single SPA codebase
**Decision:** Self-Ordering Kiosk, Menu Display Kiosk, and KDS are three routes in a single React application at kiosk.verdura.co.nz. Not separate deployments.
**Rationale:** All three are LAN-resident browser apps with no sensitive admin data. Sharing a codebase reduces maintenance overhead. Route separation (/order, /display, /kds) provides clear boundaries. A single CDN deployment covers all three.
**Phase:** 4
**Confidence:** [CONFIRMED design decision]

### DL-030: Resend as primary email provider
**Decision:** Resend selected as the transactional email provider. SendGrid noted as fallback.
**Rationale:** Resend has a generous free tier, excellent developer experience, and React Email component support (matching the React stack). The existing simulated email address (bookings.verdura@gmail.com) will be the recipient in production.
**Phase:** 4
**Confidence:** [ASSUMED] — no prior email provider confirmed in codebase (all simulated)

---

## Phase 5 — Integration Strategy

### DL-031: IdealPOS adapter is pluggable via registry pattern — no adapter locked in
**Decision:** The IdealPOS Agent loads an adapter at startup from venue configuration. Switching adapters requires only a config change, not code deployment.
**Rationale:** Q1 is unresolved. Locking the agent to any specific adapter before Q1 is answered risks building the wrong thing. The registry pattern means all adapter code can be written speculatively; the correct one activates via config.
**Phase:** 5
**Confidence:** [CONFIRMED design decision]

### DL-032: Build NullAdapter and CsvAdapter first; ApiAdapter second; others on demand
**Decision:** Implementation order: NullAdapter (unblocks everything) → CsvAdapter (lowest-risk real adapter) → ApiAdapter (most future-proof) → SqlAdapter/OdbcAdapter/LocalAgentAdapter only if Q1 demands them.
**Rationale:** NullAdapter lets the entire order pipeline (kiosk → API → KDS → printers) be built and tested without Q1 being resolved. CsvAdapter validates the agent infrastructure with minimal risk. ApiAdapter is most likely to be the eventual production choice if IdealPOS has a modern API.
**Phase:** 5
**Confidence:** [CONFIRMED design decision]

### DL-033: POS sync is asynchronous — does not block order confirmation response
**Decision:** `POST /api/kiosk/orders` returns the order confirmation to the customer immediately. POS sync is enqueued and runs asynchronously via BullMQ.
**Rationale:** POS sync failure must not prevent the customer from seeing their confirmation or the kitchen from receiving the print job. The order is valid and the kitchen gets the ticket regardless of IdealPOS state.
**Phase:** 5
**Confidence:** [CONFIRMED design decision]

### DL-034: POS sync queue uses exponential backoff — 5 attempts over ~60 seconds
**Decision:** BullMQ retry config: 5 attempts, exponential backoff starting at 2 seconds (2s, 4s, 8s, 16s, 32s).
**Rationale:** Covers transient IdealPOS unavailability (e.g. brief reboot) without hammering a system that may be genuinely down. After 5 attempts the job enters failed state and the Admin Dashboard alerts staff to retry manually.
**Phase:** 5
**Confidence:** [CONFIRMED design decision]

### DL-035: SqlAdapter and OdbcAdapter are documented but flagged highest-risk
**Decision:** Both are implemented as available adapters but documented as last-resort options due to database corruption risk and schema fragility on POS upgrades.
**Rationale:** Writing directly to a third-party application's database bypasses all application-layer validation. If IdealPOS upgrades and changes its schema, silent data corruption is possible. These adapters should only be selected if no safer option exists and the schema has been confirmed by direct inspection.
**Phase:** 5
**Confidence:** [CONFIRMED design decision]

---

## Phase 6 — Printer Architecture

### DL-036: Fixed 3-second retry delay for printers (not exponential)
**Decision:** Print job retries use a fixed 3-second delay, not exponential backoff.
**Rationale:** Printer failures are typically transient hardware blips (paper jam, sleep mode, TCP timeout) resolved in seconds. Exponential backoff is appropriate for rate-limited APIs; for local hardware, fixed short intervals recover faster.
**Phase:** 6 | **Confidence:** [CONFIRMED design decision]

### DL-037: Local SQLite queue on Printer Service gateway PC
**Decision:** `better-sqlite3` used as the local offline queue when Redis is unreachable.
**Rationale:** SQLite is synchronous, zero-config, no external process, and survives gateway PC reboots. Appropriate for a queue that may hold ≤ 100 jobs during a typical outage window.
**Phase:** 6 | **Confidence:** [CONFIRMED design decision]

### DL-038: KDS is the fallback for kitchen printer failure
**Decision:** KDS is a required MVP feature, not optional, specifically because it serves as the fallback when the kitchen printer goes offline.
**Rationale:** If kitchen tickets stop printing, kitchen staff need another way to see orders. The KDS screen provides this without requiring any staff action to switch modes.
**Phase:** 6 | **Confidence:** [CONFIRMED design decision]

---

## Phase 7 — Offline Strategy

### DL-039: Kiosk never blocks order submission — worst case is IndexedDB queue
**Decision:** The kiosk always accepts order submissions. If the API is unreachable, the order goes to IndexedDB and syncs automatically on reconnect.
**Rationale:** Blocking the customer-facing order flow during an outage creates a worse user experience than accepting the order and reconciling later. The risk of a delayed sync is operationally acceptable.
**Phase:** 7 | **Confidence:** [CONFIRMED design decision]

### DL-040: Automatic reprint NOT triggered on printer restore — manual only
**Decision:** When a printer comes back online after an outage, failed jobs are NOT automatically reprinted. Staff use the Admin Dashboard reprint button.
**Rationale:** Automatic reprinting could produce unexpected ticket bursts in the kitchen (e.g. 10 tickets suddenly printing for orders now 30 minutes old). Manual reprint lets staff decide what is still relevant.
**Phase:** 7 | **Confidence:** [CONFIRMED design decision]

---

## Phase 8 — MVP Definition

### DL-041: Menu images excluded from MVP — no S3 in Sprint 1
**Decision:** Image upload (S3 + sharp) is Sprint 4 work, not Sprint 1. MVP menu data has null imageUrls.
**Rationale:** The order flow (kiosk → API → KDS → print) is the critical MVP path. Image upload adds infrastructure complexity (S3, CDN, sharp) that can be deferred without blocking the core flow.
**Phase:** 8 | **Confidence:** [CONFIRMED design decision]

### DL-042: Menu CRUD admin UI is read-only in MVP; full CRUD in Sprint 4
**Decision:** Admin Dashboard shows menu items in read-only mode for MVP. Full CRUD (create/edit/delete) ships in Sprint 4 alongside image upload.
**Rationale:** The migration script seeds all existing menu data. No new items need to be created before the core order flow is validated. Deferring CRUD reduces Sprint 5 scope.
**Phase:** 8 | **Confidence:** [CONFIRMED design decision]

---

## Phase 9 — Epics

### DL-043: 13 epics defined; E9 (IdealPOS) and E8 (Printer) have explicit BLOCKED ON gates
**Decision:** Epics E8 and E9 are included in the plan with BLOCKED ON markers. Implementation starts with NullAdapter / CsvAdapter; real adapter activates once Q1/Q2 are resolved.
**Rationale:** Building the agent infrastructure and NullAdapter now means Q1/Q2 resolution drops directly into a working scaffold. No rework of surrounding code is required.
**Phase:** 9 | **Confidence:** [CONFIRMED design decision]

---

## Phase 10 — Sprint Plan

### DL-044: Sprint 6 (Printer) is on the critical path and Q2-blocked
**Decision:** Sprint 6 cannot fully complete until Q2 (printer hardware) is confirmed. If Q2 is unresolved by Sprint 6 start, parallel work is shifted to Sprint 9/10 tasks to avoid blocking the overall schedule.
**Rationale:** Printer hardware confirmation is the single most schedule-sensitive external dependency after Q1.
**Phase:** 10 | **Confidence:** [CONFIRMED design decision]

### DL-045: 1-sprint buffer recommended before Sprint 12 (Go-Live)
**Decision:** Sprint plan allows a one-sprint buffer (Sprint 11.5) if UAT uncovers hardware compatibility issues.
**Rationale:** Restaurant technology deployments regularly surface hardware-specific issues (printer models, Windows versions, LAN configuration) that are impossible to anticipate in development. A buffer prevents a hard deadline forcing a risky go-live.
**Phase:** 10 | **Confidence:** [ASSUMED] — depends on business timeline flexibility

### DL-007: Pricing stored as floats in current data
**Decision:** Flag as a migration concern. The existing `menuItems.json` stores `price` as a JavaScript float (e.g. `18.5`, `6.5`, `23.5`). The new domain model will store price in cents as integers. A data migration/conversion step is required when seeding the new backend.
**Rationale:** Multiple items in `menuItems.json` have fractional prices. The master prompt mandates integer-cents storage.
**Phase:** 0
**Confidence:** [CONFIRMED] — `src/api/menuItems.json` (e.g. line 193: `"price": 18.5`)

---

## Phase 11 — Product Readiness Assessment (MVP Decisions)

### DL-046: IdealPOS Auckland Pilot uses NullAdapter (SUPERSEDED)
**Decision:** [SUPERSEDED by DL-061 and DL-064] — Launch the Auckland pilot with the NullAdapter (already scaffolded). ~~POS integration will run in mock mode (status set to synced immediately).~~ Cashier manually inputs kiosk orders into the IdealPOS terminal at the counter.
**Rationale:** The physical IdealPOS installation audit is scheduled for pre-pilot. Proceeding with NullAdapter unblocks the entire upstream transaction flow (kiosk, database, KDS) without locking in integration assumptions. **Correction (2026-08-15):** "status set to synced immediately" is exactly the fabricated-success pattern the operating model prohibits (mvp.md Non-Negotiable Principle #1; target-operating-model.md §7). NullAdapter must report `not_applicable`/`unsupported`, never `synced`. A manual-entry pilot is a legitimate emergency/manual mode (per DL-064) but must be recorded as `MANUAL`, not silently as `synced`.
**Phase:** 11 | **Confidence:** [SUPERSEDED]

### DL-047: Printer Integration uses ESC/POS over TCP 9100 with KDS Web-to-Print fallback
**Decision:** Implement ESC/POS over raw TCP socket on port 9100 as the primary printing mechanism. If physical printer verification fails during on-site audit, use KDS-based web printing (browser print from KDS screen) as the MVP operational workaround.
**Rationale:** Standard thermal network printers on restaurant LANs typically use TCP port 9100. Web-to-print from KDS prevents physical printing issues from blocking core kiosk operations during trials.
**Phase:** 11 | **Confidence:** [CONFIRMED by Stakeholder]

### DL-048: Reservation Payment Card option deferred for MVP
**Decision:** Defer Stripe card integration for MVP launch. Remove/block the card selection option in the booking wizard UI (in the frontend `Step5Payment` flow). Support bank transfer and pay-at-restaurant manual confirmation flows only.
**Rationale:** Avoids Stripe setup and compliance overhead on critical path. Manual confirmation flows are sufficient for pilot.
**Phase:** 11 | **Confidence:** [CONFIRMED by Stakeholder]

### DL-049: Public Website Menu pipeline remains static for Pilot (SUPERSEDED)
**Decision:** [SUPERSEDED by DL-051] — The public website menu must be dynamically api-driven from day one.
**Rationale:** Overridden by confirmed product requirements on 2026-06-20. The public website must reflect the same live menu data and availability state as the kiosks directly from the centralized Supabase database.
**Phase:** 11 | **Confidence:** [SUPERSEDED]

### DL-050: Kiosk Checkout Processes Card Payments Directly
**Decision:** The Ordering Kiosk handles card payment processing directly at checkout. Status of these payments must be recorded and tracked in the unified Supabase PostgreSQL instance.
**Rationale:** Standard product requirements locked on 2026-06-20. Allows diners to browse, order, and pay in one kiosk session.
**Phase:** 11 | **Confidence:** [CONFIRMED by Stakeholder]

### DL-051: Live Menu Pipeline Overrides Frontend Freeze
**Decision:** All customer-facing experiences (including the public website and kiosks) must query live menu and availability data directly from the centralized Supabase API. Dynamic menu synchronization replaces static exports/rebuilds.
**Rationale:** Avoids duplicate data maintenance and ensures instant menu edits/availability toggling across all channels.
**Phase:** 11 | **Confidence:** [CONFIRMED by Stakeholder]

### DL-052: Decommission & Remove Airtable Mocks
**Decision:** Fully remove all Airtable dependencies, synchronization logic, and simulation loops from all workspaces and Edge functions. Decommission the calendar sync Airtable mocks.
**Rationale:** Standardizes database architecture on Supabase PostgreSQL (via NestJS API integrations) as the single source of truth.
**Phase:** 11 | **Confidence:** [CONFIRMED by Stakeholder]

### DL-053: Reservation Management Architecture Consolidation
**Decision:** Reservation management must follow the same Supabase-only architecture. Airtable is completely decommissioned for reservations, and all reservation synchronization jobs/queues (like the `pending_calendar_events` table and the associated Edge functions) are removed. All reservation data is operational data stored exclusively in Supabase Postgres, and workflows are managed directly through the NestJS API and the Admin Dashboard.
**Rationale:** To maintain architectural consistency, eliminate duplicate data stores, remove external automation latency, and comply with the single source of truth mandate. Google Calendar integrations (if used) will run synchronously via direct NestJS API calls on status transitions, rather than asynchronous sync queues or third-party bridges.
**Phase:** 11 | **Confidence:** [CONFIRMED by Stakeholder]
