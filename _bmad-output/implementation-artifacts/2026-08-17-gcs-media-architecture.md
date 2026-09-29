---
baseline_commit: HEAD@2026-08-17 (post repository-restructure, pre-stage)
epic: media-architecture
tracer_bullet: false
production_story: true
status: done — real GCP provisioning, canary, and menu-item image migration all completed and verified 2026-08-17 (see "Execution Record" section below); original "blocked" status below describes the state at the START of that session, kept as written for traceability
---

# Story: Google Cloud Storage Canonical Media Architecture

## Execution Record — 2026-08-17 (continuation session, same day)

Everything below the original story text (unchanged, for traceability) described a **repository-side-only** implementation with GCP provisioning explicitly blocked by lack of `gcloud`/credentials. In a same-day continuation session, `gcloud` was installed (Homebrew), the human authenticated interactively (`gcloud auth login` + `gcloud auth application-default login`, account `khn.srwr707@gmail.com`), and every remaining step was completed against the real project. This section is the authoritative current status; treat the original story body below it as the historical starting point, not the current state.

### What was actually provisioned

| Resource | Value |
|---|---|
| Project (verified exactly, 3 independent checks) | `project-10bd9c5c-d379-4338-8b2` (#868880802142) |
| Billing | Enabled (`01DF78-465C24-B0E8A0`) — pre-existing on the project, not created by this work |
| Private originals bucket | `verdura-media-originals-d3794338b2` — `australia-southeast1`, uniform bucket-level access, public access prevention **enforced**, versioning on, 30-day noncurrent-version lifecycle rule, CORS scoped to the four local-dev origins, labeled `app=verdura,environment=production,managed-by=verdura-api,purpose=media-originals` |
| Public-delivery bucket | `verdura-media-public-d3794338b2` — same region/versioning/lifecycle/CORS/labels, **public access prevention deliberately disabled** (see below) |
| Service account | `verdura-media-api@project-10bd9c5c-d379-4338-8b2.iam.gserviceaccount.com` — `roles/storage.objectAdmin` bucket-scoped on both buckets (never project-wide), no key ever created |
| Impersonation grants | `roles/iam.serviceAccountTokenCreator` on the service account, granted to `khn.srwr707@gmail.com` (local dev) and to the service account on itself (future production workload identity) |
| APIs enabled | `storage.googleapis.com` (already enabled), `iamcredentials.googleapis.com` (enabled this session — required for impersonation-based signing) |

### Real defect found and fixed by actual GCS execution

`GcsStorageProvider`'s original implementation (`new Storage({ projectId })`, plain ADC) **failed on the very first real call**: `Error: Cannot sign data without client_email`. V4 signed URLs require signing with a private key; plain ADC (user OAuth login or workload-identity metadata-server credentials) has none. Fixed by making the provider always sign via **service-account impersonation through the IAM Credentials API** (`google-auth-library`'s `Impersonated` class) rather than relying on whatever ambient identity is running — this is the standard keyless pattern and is now the permanent implementation, not a workaround. Regression coverage added: `apps/api/test/gcs-storage-provider.integration-spec.ts` (opt-in, requires real credentials — see the file for exact invocation), which re-proved this fix against the real bucket after being written.

### Canary results (`apps/api` scratch script, deleted after use; superseded by the permanent integration test above)

All 9 checks passed against `verdura-media-originals-d3794338b2`: signed upload URL issued → real PUT succeeded (200) → `verifyObject` reported the exact size and checksum → a nonexistent key correctly reported `exists:false` → signed GET delivery returned the exact original bytes → **anonymous GET on the same object returned 403** (public access prevention proven, not assumed) → a second verify call returned identical results (idempotency) → `deleteObject` removed it → a second `deleteObject` on the already-gone object did not throw.

### Menu-item image migration (46 unique files)

Scope: **menu-item photographs only** — 45 of the 50 duplicate groups from the original inventory, 100% database-driven via `MenuItem.imageUrl`. The `Asset/` hero images and intro video (4 more duplicate groups) are statically imported in `customer-website`'s JS source, not database-driven, and remain **explicitly deferred** — migrating them requires actual frontend code changes, not a data migration, and was not attempted.

Executed via the new permanent script `apps/api/prisma/scripts/migrate-menu-images-to-gcs.ts` (idempotent — checksum-deduplicates against existing `approved` `MediaAsset` rows before uploading, so re-running is always safe):

- **46/46 unique files uploaded** to both buckets (private original + public delivery copy with `Cache-Control: public, max-age=31536000, immutable`), each under an immutable `venues/{venueId}/menu-items/{mediaId}/original/{filename}` key.
- **46 `MediaAsset` rows created**, all `status=approved, visibility=public`.
- **38 `MenuItem` rows repointed** from `/menu-images/<filename>` to the new public GCS URL. The remaining 8 uploaded files are genuinely unreferenced by any current `MenuItem` (confirmed by direct DB search, not a matching bug — the canonical image set has always had a small surplus over currently-assigned menu items).
- **One pre-existing, unrelated data defect found, not fixed**: the `MenuItem` "Künefe" has `imageUrl=/menu-images/kunefe.png`, but `kunefe.png` does not exist anywhere in the repository and was never in the source inventory — a broken reference that predates this migration. Left untouched (out of scope; recorded here for the owner).
- The pre-existing test-data leak (`"Phase 2 Integration Test Relative Image Item"` rows — documented, unrelated, tracked separately in `deferred-work.md`) was correctly left untouched.

### The public-bucket decision (explicit, human-authorized)

Uploading 46 files to `verdura-media-public-d3794338b2` initially left them **inaccessible** (403) — the bucket's own `public_access_prevention: enforced` setting (applied at creation, a deliberate safety default) blocks any `allUsers`/`allAuthenticatedUsers` binding regardless of IAM policy. The Claude Code auto-mode permission classifier independently blocked the first attempt to grant `allUsers:objectViewer`; rather than finding a workaround, this was surfaced directly to the human, who reviewed the exact scope and explicitly authorized it. Applied narrowly:

```text
gcloud storage buckets update gs://verdura-media-public-d3794338b2 --no-public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://verdura-media-public-d3794338b2 \
  --member=allUsers --role=roles/storage.objectViewer
```

Verified after applying: all 46 objects return 200 anonymously with correct `Content-Type`/`Cache-Control`/exact checksum; anonymous PUT and DELETE both return 403; `verdura-media-originals-d3794338b2` remains fully private (403 anonymous GET, confirmed both before and after this grant); the public bucket contains exactly the 46 intended objects and nothing else.

### Local cleanup (verified-redundant copies only)

After confirming (a) real upload, (b) real anonymous-read access, and (c) real rendering across all four browser-verified applications (see below) — **138 local files removed** (`apps/{admin-console,customer-website,window-display}/public/menu-images/`, the 46-file set × 3 apps), via a script that re-verified each file's SHA-256 against the manifest immediately before deleting it (0 skipped, 0 checksum mismatches). Every deletion is `git`-recoverable (working-tree removal only, nothing staged or committed). Each app's `public/menu-images/README.md` was left in place, updated separately to describe the new GCS-canonical state.

### Application rendering — real browser verification, not assumed

Full dev stack started (`npm run dev`); verified in an actual Chrome tab via `claude-in-chrome`, with real network-request and console inspection, not just visual screenshots:

| Application | Route checked | Result |
|---|---|---|
| Customer Website | `/menu` | Real images rendered across multiple categories; network requests to `storage.googleapis.com` returned 200; zero console errors |
| Admin Console | `/menu-management` | Real images rendered; items with no `imageUrl` correctly show a letter-avatar placeholder, not a broken image; zero console errors |
| Order Tablet | `/order-tablet` (embedded route, same `OrderTabletPage` component the standalone `VITE_APP_MODE=tablet` build renders) | Real images rendered throughout the ordering grid; cart/table-selection flow unaffected |
| Window Display | `/menu` (aliased from Customer Website) | Real images rendered; unset-image items show the Verdura logo placeholder |
| Kitchen Display | `/kitchen-display` (embedded route) | Loads and connects live (`useLiveOrders`) with zero console errors; does not render item photos at all (ticket view is text/quantity/modifiers only), so there is no image-rendering claim to make here — confirmed by reading the component, not assumed |

Across every page checked: **zero requests to the private originals bucket** (confirmed via network-request inspection) — only the public bucket is ever referenced client-side, exactly as designed.

**Known, separate, pre-existing issue found and explicitly not fixed**: the standalone device-mode entry points (`http://localhost:5177` port with `VITE_APP_MODE=tablet`, and presumably `:5175` with `=kds`) are gated by `KdsPinGate`, and entering the correctly-configured `KDS_VENUE_PINS` value (`108` for the local seed venue) returned "Incorrect PIN" / API `403` on `/api/kiosk/kds/auth`. This is unrelated to GCS/media — the underlying page components (`OrderTabletPage`, `KitchenDisplayPage`) were still fully verified via their embedded Admin Console routes, which use the same components. Not investigated further (out of scope for this media migration); recorded here for whoever picks it up next.

### Final size measurement

| | Files | Size |
|---|---|---|
| Before | 167 | 213.63 MB |
| After | 29 | 113.95 MB |
| **Reduction** | **138 files** | **99.68 MB (46.7%)** |

### Validation summary

`npm run typecheck`/`test`/`build` clean on `apps/api` (431/431 tests, including the 19 added in the repository-side session plus this session's new integration test), `apps/admin-console` (30/30), and clean production builds for `customer-website`/`admin-console`/`window-display`. `git diff`/`git status` reviewed — no credential, token, or signed URL appears anywhere in the diff (grep-verified). No commit, push, or production deployment performed.

---

## Original story (repository-side-only session — kept as written for traceability)

## Story

As the platform operator responsible for Servvia's media footprint,
I want Google Cloud Storage established as the canonical, deduplicated media store for menu/promotional/venue imagery and video, with the repository-side upload/validation/delivery machinery ready to activate the moment real GCP access exists,
so that the ~67 MB of triplicated menu-item photos across `apps/customer-website`, `apps/admin-console`, and `apps/window-display` stop being copied on every clone/build, and future media additions have one governed upload path instead of three independent `public/menu-images/` directories.

## Scope split — read before the rest of this file

This story has two sub-scopes, tracked separately because one is blocked and one is not:

1. **GCP provisioning** (bucket, IAM, actual upload of real assets, local-file deletion). **Blocked this session** — no `gcloud` CLI and no GCS-capable tool were available in this execution environment (confirmed: `gcloud` not on `PATH`; no MCP tool for Google Cloud Storage — only Drive/Calendar, which this architecture explicitly does not use). See "GCP discovery" below for the exact evidence and the exact human/CLI action required to unblock it.
2. **Repository-side architecture** (Prisma schema, provider abstraction, API endpoints, config, tests, documentation). **Done this session**, fully build/test-validated, selectable via `MEDIA_STORAGE_PROVIDER=local` with zero behavior change to any existing application until someone explicitly flips it to `gcs` with real credentials.

Nothing in this file should be read as claiming sub-scope 1 is complete. No bucket exists. No asset has been uploaded. No local file has been deleted.

## GCP discovery (Phase 1 — evidence)

Attempted, in order:

1. `which gcloud` → not found. `gcloud auth list` / `gcloud config get-value project` → `command not found: gcloud`.
2. Searched available MCP tools for a Google Cloud Storage integration (`ToolSearch("google cloud storage gcs gcp bucket")`) → only Google Drive and Google Calendar tools are available in this environment. The mission explicitly requires GCS, not Drive, and forbids treating Drive as a substitute.

**Conclusion: this session has zero ability to authenticate to, inspect, or modify `project-10bd9c5c-d379-4338-8b2`.** Per this story's own governing instructions ("if authentication or permission is unavailable, do not simulate cloud changes"), no bucket, IAM binding, or org-policy claim below is asserted as done — every such item is written as "not verified" or "required next step," never as completed.

### Exact minimum human/CLI action required to unblock sub-scope 1

Run the following from a machine with `gcloud` installed and a Google account authorized on the project (or paste into Cloud Shell — no local install needed there):

```bash
gcloud auth login                                   # or: use Cloud Shell, already authenticated
gcloud config set project project-10bd9c5c-d379-4338-8b2
gcloud services list --enabled --filter="name:storage.googleapis.com"
gsutil ls -p project-10bd9c5c-d379-4338-8b2          # confirm no pre-existing Verdura bucket before creating one
gcloud iam service-accounts list
gcloud resource-manager org-policies list --project=project-10bd9c5c-d379-4338-8b2
```

The first person with access should run these, record the output, and only then proceed to bucket creation (see "GCS storage design" below for the exact `gsutil mb` command this story recommends, once a bucket name is confirmed available and not already claimed by an existing Verdura resource).

## Repository media inventory (Phase 1 — evidence, fully executed)

Method: `find` across the repository excluding `node_modules/`, `dist/`, `.git/`, `dev-dist/`, `.worktrees/`, `bin/`, `obj/`, `coverage/`, `test-results/`, matching image/video/font extensions; SHA-256 computed for every file (never filename-based dedup). Raw data: `/tmp/media_inventory.json` (session-local, not committed — regenerate with the script logic below if needed). Deterministic per-asset manifest: [`2026-08-17-gcs-media-migration-manifest.csv`](./2026-08-17-gcs-media-migration-manifest.csv) (69 rows, one per unique checksum).

| Metric | Value |
|---|---|
| Total media files found | 167 |
| Total size (with duplicates) | 224,005,880 bytes (213.63 MB) |
| Unique files by checksum | 69 |
| Unique bytes (deduplicated) | ~153.8 MB |
| Duplicate groups (checksum shared by 2+ paths) | 50 |
| Bytes wasted by duplication | 70,167,036 bytes (66.92 MB) |

**Size by top-level location:**

| Location | Size | File count |
|---|---|---|
| `Asset/` (customer-website's hero images + master video, symlinked into `apps/customer-website` and `apps/window-display` — not physically duplicated) | 112.99 MB | 15 |
| `apps/customer-website/public/menu-images/` | 33.95 MB | 53 |
| `apps/window-display/public/menu-images/` | 33.44 MB | 52 |
| `apps/admin-console/public/menu-images/` | 33.23 MB | 46 |

**Duplicate pattern:** 45 of 50 duplicate groups are the *exact same set* — a menu-item photo physically copied once into each of the three frontends' `public/menu-images/` (per `apps/*/public/menu-images/README.md`'s own documented convention: "bundled into every frontend build... each frontend serves its own copy"). One group (`Baklava.jpg`) is quadruplicated, additionally present in `Asset/image/`. Four more groups are `Asset/image/*.avif` hero images also bundled a second time into `apps/customer-website/src/assets/image/` under different filenames (e.g. `about_hero.avif` / `about_main.avif`, same bytes).

**Largest individual files:** `Asset/video/intro.mp4` (62.94 MB — the hero video, single copy, symlinked not duplicated), `Asset/image/menu_main.avif` (29.56 MB — unusually large for a web image; flagged for future optimization, out of this story's scope).

**Orphaned assets found (not referenced by any current application source — `grep -rl` across every `apps/*/src` and `apps/*/public` returned zero matches):** `tableMap.svg` (repo root, 15.6 KB), `Asset/Verdura_logo.svg` (446 KB), `Asset/Verdura Mediterranean Swirl.png` (359 KB). Not deleted this session — flagged for owner review; a `grep` miss does not prove non-use (could be referenced via a build step or documentation this session didn't check), and deleting on inventory evidence alone would violate this story's own rollback-safety requirement.

**Excluded from this inventory (dependency/vendor/build content, correctly out of scope):** all `node_modules/`, `dist/`, `dev-dist/`, `.git/`, `.NET` `bin/`/`obj/` directories, `coverage/`, `test-results/`.

## Asset classification

Full per-asset detail in the manifest CSV. Summary:

- **Externalize to GCS (59 of 69 unique assets):** all 46 canonical menu-item photographs (`apps/*/public/menu-images/*`), the hero/promotional imagery and video under `Asset/` and `apps/customer-website/src/assets/image/` (`menu_main.avif`, `home-menu.avif`, `about_*.avif`, `intro.mp4`, etc.), the one quadruplicated `Baklava.jpg`.
- **Retain locally (7 assets):** PWA/app icons (`icon-192.png`, `icon-512.png`, `icon-maskable-*.png`, `apple-touch-icon.png`), `manifest.webmanifest`-referenced branding, `verdura-fallback.svg` (the documented broken-image/offline fallback — see `apps/window-display`'s PWA config). These are exactly the "small, operationally essential, needed at initial load or offline" category this story's governing instructions call out — none are migrated.
- **Orphaned, flagged not moved (3 assets):** see above.
- **Historical/documentation:** none found in this inventory pass — no documentation screenshots or archived evidence matched the image/video extension search inside `docs/`/`_bmad-output/`. (If any exist as non-standard extensions or inside a subfolder this pass didn't target, they were not found and are therefore also not touched.)
- **Removed as redundant:** **zero, this session.** The governing instructions require cloud upload, application rendering, and rollback evidence to exist *before* any local original is deleted — none of that evidence exists without GCP access. Every local file identified above remains exactly where it was found.

## GCS storage design (specification — not provisioned)

### Bucket naming

Recommend `verdura-media-<env>-<project-suffix>` (e.g. `verdura-media-prod-10bd9c5c`), derived from the project ID per this story's naming requirement rather than a guessed literal name — **must be confirmed available via `gsutil mb` (which fails loudly on a global collision) by whoever runs the unblocking steps above**, not assumed reserved by this document. Separate buckets (or at minimum separate top-level prefixes with distinct IAM bindings) recommended for `dev`/`staging`/`prod` per the story's requirement not to mix test uploads into a production bucket — given this is a single-venue MVP with one Postgres database today (no separate staging environment exists yet — confirmed via `docker-compose.yml`, `apps/api/.env.example`), the pragmatic near-term choice is **one bucket for now** (`verdura-media-<project-suffix>`, no `-dev`/`-prod` suffix) with environment separation deferred until a real staging deployment exists — recorded here as a decision, not silently assumed.

### Location

New Zealand has no GCP region. Nearest supported regions: `australia-southeast1` (Sydney) or `australia-southeast2` (Melbourne). **Recommendation: `australia-southeast1` (Sydney)** — GCP's more mature/higher-availability Australian region, materially lower latency to Dunedin than any US region, and consistent with `docs/target-operating-model.md`'s NZ-data-locality expectations for the rest of the stack. **Not provisioned — this is a recommendation for whoever runs the unblocking steps, not an irreversible choice already made.** Bucket location cannot be changed after creation without a full object copy to a new bucket, so this choice should be confirmed once, deliberately, by someone with project access — not defaulted silently.

### Object key layout

Implemented exactly as specified in the mission brief, via `buildObjectKey()` (`apps/api/src/media/media-assets.constants.ts`):

```
venues/{venueId}/menu-items/{mediaId}/original/{filename}
venues/{venueId}/promotions/{mediaId}/original/{filename}
venues/{venueId}/videos/{mediaId}/original/{filename}
venues/{venueId}/branding/{mediaId}/original/{filename}
venues/{venueId}/documents/{mediaId}/original/{filename}
venues/{venueId}/categories/{mediaId}/original/{filename}      # extension beyond the spec — MenuItemPurpose.category
venues/{venueId}/venue-gallery/{mediaId}/original/{filename}   # extension beyond the spec — MenuItemPurpose.venue_gallery
```

`{venueId}` is the real `Venue.id` UUID (Prisma), never the street address — per this story's explicit requirement. **Caveat confirmed this session:** the real Dunedin venue (17 Saint Andrew Street) has no `Venue` row in this database yet (confirmed in `_bmad-output/implementation-artifacts/15-1-tablet-venue-and-auth-decision.md`: "the real production Dunedin venue record does not exist in this repository"). The manifest CSV uses the local-dev seed venue's id (`10000000-...-000000000001`, "Verdura Auckland") as a placeholder for illustration only — every real object key will use whatever `Venue.id` is created for the actual Dunedin venue, whenever that row is created (out of this story's scope).

`variants/{thumbnail,medium,large}.webp` from the mission brief's suggested layout is **not implemented this session** — see Deferred work.

### Security controls — specified, not applied (nothing to apply them to without a bucket)

- **Uniform bucket-level access**, **public-access prevention** on the bucket by default (private originals never anonymously public — enforced at the bucket level, not just by convention).
- **A separate, explicitly public-read prefix or bucket** (not decided which — see Deferred work) only for the small subset of `approved` + `visibility: public` objects, isolated from private originals — `GcsStorageProvider.generateDeliveryUrl()` already branches on `visibility` so the code is ready for either choice.
- **Least-privilege IAM**: a dedicated service account (e.g. `verdura-media-api@project-10bd9c5c-d379-4338-8b2.iam.gserviceaccount.com`) granted `roles/storage.objectAdmin` scoped to the one media bucket only via an IAM Condition (`resource.name.startsWith("projects/_/buckets/verdura-media-...")`) — never project-level `Storage Admin`. The running API authenticates as this identity via **Application Default Credentials only** (workload identity in any real deployment; `gcloud auth application-default login` for a developer running the `gcs` provider locally) — confirmed no service-account JSON key is read, written, or referenced anywhere in this repository (`GcsStorageProvider`'s constructor takes only a `projectId` string; grep confirms no `keyFilename` usage).
- **Versioning**: recommended enabled — supports the `archived` `MediaAssetStatus` and rollback-to-previous-object story requirement.
- **Lifecycle policy**: recommended — auto-delete objects under any future `pending`/`incomplete` prefix older than the signed-URL TTL (an abandoned upload that never reaches `finalizeUpload` leaves an orphaned bytes-only object with no `MediaAsset` row pointing at anything else; a lifecycle rule is cheaper and more reliable than a cron sweep for this).
- **Google-managed encryption** (default) — no CMEK requirement found in any repository document.
- **CORS**: restrict `origin` to the real deployed origins of `apps/customer-website`, `apps/window-display`, `apps/admin-console` (plus `http://localhost:5173/5174/5176/5177` for local development against a real bucket) — not yet configured (no bucket exists).
- **Audit logging**: enable Cloud Audit Logs (Data Access) on the bucket once created — separate from, and in addition to, this repository's own `AuditLog` table (`MediaAssetsService` already writes `media_asset.upload_requested`/`.approved`/`.rejected`/`.archived` audit rows for every state transition, proven by `media-assets.service.spec.ts`).
- **Labels**: `app=verdura`, `environment=<env>`, `managed-by=verdura-api` recommended on the bucket for cost attribution.
- **Budget alert**: recommended — not configured (requires Billing API access this session didn't have).

## Verdura media domain model — implemented and migrated

Inspected first: no pre-existing `MediaAsset`/`Media` model existed (`grep -n "model MediaAsset\|model Media " apps/api/prisma/schema.prisma` → no match before this session). `MenuItem.imageUrl`/`Category.imageUrl` already existed as plain nullable strings, already rendered identically across all three frontends via `IMAGE_URL_PATTERN` (accepts absolute `http(s)://` or site-relative `/...`) — **confirmed this means no frontend rendering code needs to change**: once a `MediaAsset` is approved, its resolved delivery URL is written into the existing `imageUrl` field, and every frontend already renders whatever string is there.

Implemented: `MediaAsset` model (venue- and organization-scoped, `MediaAssetPurpose`/`MediaAssetType`/`MediaAssetStatus`/`MediaAssetVisibility`/`StorageProvider` enums), migration `20260817024943_gcs_media_asset` — **purely additive** (new table + enums only; no existing column, table, or index touched — confirmed by reading the generated SQL before applying it). Applied against the local dev database; `npx prisma generate` succeeded; full test suite (431 tests) passes after the schema change.

Status lifecycle exactly as specified: `pending_upload → uploaded/failed`, then `validating → approved/rejected`, plus `archived` (manual). Canonical delivery values (bucket + object key) are stored; **no expiring signed URL is ever persisted** — `MediaAssetsService.getDeliveryUrl()` derives one on demand from the stored `bucket`/`objectKey`, confirmed by `media-assets.service.spec.ts`'s "resolves a delivery URL for an approved asset" test.

## API — implemented, unit-tested, GCS path unverified against real GCS

New files (all under `apps/api/src/media/`):

- `providers/storage-provider.port.ts` — the abstraction. Application code never imports `@google-cloud/storage` directly.
- `providers/gcs-storage.provider.ts` — real implementation (`@google-cloud/storage@^8`, ADC-only). **UNVERIFIED against a real bucket** — the file's own doc comment says so; only exercised by mocked unit tests this session.
- `providers/local-storage.provider.ts` + `providers/local-media-upload.controller.ts` — dev/test-only, zero external dependency, real disk I/O. **This is the one implementation genuinely exercised end-to-end against real bytes this session** (`local-storage.provider.spec.ts`: write → verify reports the exact sha256 and size; delete; path-traversal defense).
- `media-assets.constants.ts` — MIME/size allowlists, filename normalization, object-key generation.
- `media-assets.service.ts` — venue-scoped authorization (`assertVenueInOrganization`), checksum-based dedup lookup before issuing a new upload, the full status state machine, audit logging via the existing `AuditLogService`.
- `media-assets.controller.ts` — `POST /admin/media-assets/request-upload`, `POST /admin/media-assets/:id/finalize`, `GET /admin/media-assets/:id/delivery-url`, `POST /admin/media-assets/:id/archive`. Guarded identically to the existing `MediaController` (`JwtAuthGuard`, `RolesGuard`, `admin`/`manager` only).

**Checksum integrity design:** GCS's own object hash is MD5/CRC32C, not SHA-256, so a naive comparison against a client-declared SHA-256 would be meaningless. Instead, the signed upload URL embeds the declared SHA-256 as required custom object metadata (`x-goog-meta-sha256`, part of the V4 signature itself, alongside `Content-Type`) — the client's PUT must include it exactly or the signature fails closed, and `verifyObject()` reads it back for an exact comparison. `LocalStorageProvider` proves this exact-match logic end-to-end against real bytes since it computes the real SHA-256 directly.

**Existing `MediaController`/`MediaService` (direct-body-proxy upload, local disk, three-frontend-copy write) is completely untouched** — zero lines changed, all its existing tests still pass unmodified. The new `MediaAssetsController` is additive, not a replacement, so nothing about the current Admin Console menu-photo-upload UI behavior changes until that UI is explicitly rewired to the new endpoints (see Deferred work — not done this session).

**Safe-by-default config:** `MEDIA_STORAGE_PROVIDER` defaults to `local` — confirmed via `app.module.ts`'s Joi schema and `media.module.ts`'s factory provider, both independently defaulting to `local` (not `gcs`) when unset, so a fresh clone's `npm run dev` never needs real GCP credentials. Production is required to set `MEDIA_STORAGE_PROVIDER=gcs` explicitly (Joi `.when('NODE_ENV', 'production', ...)` rejects `local` and requires `gcs`, which then requires `GCP_PROJECT_ID`/`GOOGLE_CLOUD_PROJECT` and `GCS_MEDIA_BUCKET`).

## Frontend — no rendering changes required or made

Confirmed via `grep -rl "imageUrl"` across all four consuming apps: `Customer Website`, `Window Display`, `Order Tablet`/`Admin Console` (`OrderTabletPage.tsx`, `MenuManagementPage.tsx`), and `Kitchen Display` (`KitchenDisplayPage.tsx`, via `shared/menu/menuData`) all already render `MenuItem.imageUrl`/`Category.imageUrl` as an opaque string through the same `IMAGE_URL_PATTERN`-validated field, already supporting an absolute URL. **No component was changed this session** — there is genuinely nothing to change until a real `MediaAsset` is approved and its delivery URL is written into that field, which requires the blocked GCP sub-scope. Wiring the Admin Console's `MenuManagementPage` upload UI to the new signed-URL flow (replace the current single `POST` with request-upload → direct PUT → finalize) is explicitly deferred — see below.

## Offline and resilience — unchanged, not evaluated further

`apps/window-display`'s existing PWA service worker (`vite-plugin-pwa`, `NetworkOnly` for `/api/*`, precached static assets including `verdura-fallback.svg`) and `Order Tablet`'s existing image rendering already fail gracefully on a missing/broken `imageUrl` (standard `<img>` `onerror` / browser broken-image behavior — confirmed no code path blocks order submission on an image load failure). No new offline machinery was built this session, consistent with "media availability must not be treated as equivalent to menu/order availability" — the existing behavior already satisfies this; GCS-hosted images will fail exactly the same way a missing local image does today, with no special-casing needed.

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | GCP project/identity confirmed, or exact blocker documented | ✅ Blocker documented (no `gcloud`, no GCS tool) |
| 2 | Every media asset inventoried by checksum | ✅ 167 files, 69 unique, full manifest |
| 3 | Duplicate assets have one canonical object identified | ✅ 59 externalize candidates mapped to one object key each |
| 4 | `MediaAsset` domain model implemented, additive migration applied | ✅ Migration `20260817024943_gcs_media_asset`, 431/431 tests pass |
| 5 | Provider abstraction implemented (GCS + local) | ✅ Both implementations, local proven end-to-end |
| 6 | Upload authorization is venue-scoped, checksum-deduped | ✅ Proven by `media-assets.service.spec.ts` |
| 7 | No credential/secret committed | ✅ Confirmed — grep for key material below |
| 8 | Frontend renders migrated media | ⛔ Not applicable yet — no asset has been migrated (no GCP access); existing `imageUrl` rendering already proven to accept any absolute URL |
| 9 | Repository size reduction measured | ⚠️ Measured as **zero this session** — no local file was deleted (correctly, per the "cloud upload → rendering → rollback evidence" gate); the 66.92 MB duplication is quantified and ready to eliminate the moment sub-scope 1 unblocks |
| 10 | Applications build/test/lint clean | ✅ See Validation |

## Rollback plan

Trivial for this session's actual changes, because nothing destructive was done:

- **Prisma migration**: `npx prisma migrate resolve --rolled-back 20260817024943_gcs_media_asset` then a hand-written down-migration (`DROP TABLE "MediaAsset"; DROP TYPE ...`) — safe because the table has zero production data (created this session, never populated outside unit tests against a disposable local database).
- **API code**: entirely additive new files plus one new `npm` dependency (`@google-cloud/storage`) and one modified file (`app.module.ts`'s Joi schema, `media.module.ts`'s existing controller/provider list) — reverting is `git checkout` on the touched files, or simply not staging them.
- **Local media files**: **untouched** — nothing to roll back.
- **`.env.example`**: additive block only.

No GCS-side rollback is needed because no GCS-side action was taken.

## Validation performed this session

| Check | Command | Result |
|---|---|---|
| Migration generation review | `prisma migrate dev --create-only`, manual SQL read | Purely additive — confirmed before applying |
| Migration apply | `prisma migrate dev` | Applied cleanly against local Postgres |
| Typecheck | `npm run typecheck --workspace=apps/api` | Clean |
| Full test suite | `npm test --workspace=apps/api` | **431/431 passing** (412 pre-existing + 19 new: 13 `media-assets.service.spec.ts`, 6 `local-storage.provider.spec.ts`) |
| Lint | `eslint apps/api/src/media --config apps/api/eslint.config.mjs` | Clean (after fixing 2 genuine `require-await` issues and Prettier formatting) |
| Build | `npm run build:api` (`nest build`) | Clean |
| **Real runtime boot** | `npm run start:dev --workspace=apps/api` against live local Postgres+Redis | **"Nest application successfully started"**, all new routes mapped correctly (`/api/admin/media-assets/request-upload`, `/:id/finalize`, `/:id/delivery-url`, `/:id/archive`, `/local-dev-upload/:key`) — proves the full DI graph (including the `STORAGE_PROVIDER_PORT` factory provider) resolves at runtime, not just at compile time. `/api/health` responded `{"status":"ok","db":"ok","redis":"ok"}`. Process cleanly terminated after verification — nothing left running. |
| Secret scan | `git diff` review of every new/modified file | No service-account JSON, no OAuth token, no signed URL, no real credential — `.env.example` contains only empty placeholders and one non-secret default (`MEDIA_STORAGE_PROVIDER=local`) |
| GCS itself | — | **Not executed — no GCP access this session.** `GcsStorageProvider` is code-reviewed and unit-tested against a mocked SDK only. |

## Deferred work (not attempted this session, recorded honestly)

- **GCP provisioning** (bucket creation, IAM binding, org-policy check, CORS, lifecycle, versioning, budget alert) — blocked on human/CLI access; exact commands above.
- **Image variant generation** (`variants/thumbnail.webp`/`medium.webp`/`large.webp`) — `sharp` is already a dependency (used elsewhere in this codebase) but no resize pipeline was wired into `finalizeUpload`; the mission brief's suggested key layout anticipates this but it is not implemented.
- **Server-side image-dimension / video-duration validation** — `MAX_IMAGE_DIMENSION_PX`/`MAX_VIDEO_DURATION_MS` are recorded as constants but not enforced; doing so needs `sharp`'s metadata probe wired into `finalizeUpload` (images) and a video-duration library this repository doesn't currently depend on (video).
- **Malware/content-safety scanning hook** — not implemented; no such capability exists anywhere in this repository today.
- **Admin Console upload UI rewire** — `MenuManagementPage`'s existing single-POST upload flow is untouched; wiring it to `request-upload → direct PUT → finalize` is real frontend work deserving its own careful pass and manual browser verification, not bolted onto this backend-focused session.
- **Actual asset migration** (upload the 59 externalize candidates, verify rendering, then remove the 118 now-redundant local copies) — the deterministic manifest is ready; execution is blocked on GCP access.
- **Public-delivery isolation decision** (separate bucket vs. separate prefix with distinct IAM for `visibility: public` objects) — flagged as an open decision in "Security controls" above, not resolved.
- **Cloud CDN / load balancer** — explicitly out of scope per the mission brief; `generateDeliveryUrl()`'s public branch returns a direct `storage.googleapis.com` URL as the minimal safe default, not a CDN-fronted one.
- **Environment separation (dev/staging/prod buckets)** — deferred with recorded rationale (no staging environment exists yet in this repository's deployment model).
- **Orphaned-asset disposition** (`tableMap.svg`, `Verdura_logo.svg`, `Verdura Mediterranean Swirl.png`) — flagged, not deleted; needs an owner decision, not an inventory grep. `tableMap.svg` is outside `Asset/`, at the repo root, and remains untouched. A later, separate session recorded further `Asset/`-directory disposition for the other two files (see `docs/decisions-log.md` DL-078); that work is a distinct, still-uncommitted system (`shared/media/staticMedia.mjs`, no `MediaAsset` row) and is out of scope for this commit — the "public or not" owner decision on the two brand files remains open here regardless.
