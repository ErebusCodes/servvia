---
baseline_commit: HEAD@2026-08-18 (post GCS media migration, DL-075; repository remains uncommitted)
epic: media-architecture
tracer_bullet: false
production_story: true
status: done — Admin Console upload UI wired to the MediaAsset pipeline; the previously-missing publish (private→public promotion) and associate-menu-item transitions implemented; proven end-to-end against both the local provider and real GCS; two pre-existing defects blocking the local provider found and fixed; real-browser validation completed 2026-08-18 (see "Browser Validation" section below), which found and fixed one further real defect (cross-provider checksum-dedup reuse)
---

# Story: Wire Admin Console Media Uploads to the MediaAsset Pipeline

Canonical decision-log entry: `docs/decisions-log.md` DL-076 (full narrative — this file is the shorter evidence/reference companion).

## What changed

### API (`apps/api`)

- `StorageProviderPort`: new `publishObject()` method — the only server-side private→public promotion path.
- `GcsStorageProvider.publishObject()`: real GCS-to-GCS server-side copy + long-lived immutable cache headers on the destination only.
- `LocalStorageProvider`: gained a second root (public), `publishObject()` (copy between roots), `readPublic()`, and a bucket-aware `verifyObject()`; `generateDeliveryUrl()`'s public branch now points at a real serving route.
- New `LocalMediaPublicController` (`GET /api/media-assets/public/:key`) — dev/test-only, deliberately unauthenticated, emulates anonymous GET on a real public bucket. NODE_ENV-gated like `LocalMediaUploadController`.
- `MediaAssetsService`: new `publishAsset()` (compare-and-set guarded, idempotent, verifies the copy before flipping `visibility`) and `associateWithMenuItem()` (atomic, verified write of the delivery URL onto an existing `MenuItem`, org-scoped, best-effort supersession of the previously-associated asset). `getDeliveryUrl()` fixed to resolve against the correct bucket for a published asset (previously would have used the private bucket column even for a public asset — never hit in practice because nothing could publish before this story).
- `MediaAssetsController`: two new routes, `POST /admin/media-assets/:id/publish` and `POST /admin/media-assets/:id/associate-menu-item`. Same `admin`/`manager` role guard as every other route in this controller — no new permission was introduced.
- New config: `GCS_MEDIA_PUBLIC_BUCKET` (required alongside `GCS_MEDIA_BUCKET` when `MEDIA_STORAGE_PROVIDER=gcs`).
- Two pre-existing defects fixed (see DL-076 for full detail): `LocalStorageProvider` URLs missing the `/api` global prefix; `CsrfMiddleware` blocking the local-dev-upload PUT.
- `MediaController`/`MediaService` (legacy `POST /admin/media/:folder`): marked `@deprecated` in place, left registered. Confirmed zero remaining consumers repository-wide.

### Admin Console (`apps/admin-console`)

- New `src/lib/mediaAssets.ts` — provider-neutral client: `sha256Hex`, `isImageDecodable`, `validateMenuImageFile`, and `uploadAndPublishMenuImage()` (the full request-upload → PUT → finalize → publish → delivery-url state machine, cancellable via `AbortSignal`, reporting truthful `UploadStage` values), plus `associateMenuItem`/`archiveAsset`/`getDeliveryUrl` wrappers.
- `store/reservation.store.ts`: `resolveVenueId()` exported for reuse (previously module-private) — the existing "first venue of this organization" pattern, not a new concept.
- `MenuManagementPage.tsx`'s `ItemDrawer`: image upload rewired off the legacy endpoint entirely. New per-upload generation counter (stale-response/duplicate-click safe), `AbortController`-based cancel, Save disabled while an upload is in flight, accessible `role="status"` live region, old image preserved until the new one is fully published (and, for an existing item, associated) — never before.

## Endpoints — before and after

| Step | Before | After |
|---|---|---|
| Request upload | `POST /api/admin/media/menu-items` (multipart body proxy) | `POST /api/admin/media-assets/request-upload` (JSON, returns signed URL) |
| Upload bytes | (part of the same POST above) | Direct browser `PUT` to the signed URL |
| Verify | *(none — server trusted the multipart body)* | `POST /api/admin/media-assets/:id/finalize` |
| Publish | *(did not exist)* | `POST /api/admin/media-assets/:id/publish` **— new this story** |
| Associate | *(implicit — `imageUrl` string set directly by the client)* | `POST /api/admin/media-assets/:id/associate-menu-item` **— new this story**, or included in the create payload for a brand-new item |

## Real evidence (not simulated)

Full pipeline run twice against the live dev API (real Postgres, real Redis, real Nest process), against a disposable menu item ("Mezze Platter For Four", `imageUrl` was `null`), restored to `null` afterward in both runs:

| Check | Local provider | Real GCS |
|---|---|---|
| Signed/emulated upload URL issued, PUT accepted | ✅ 200 | ✅ 200 (real V4 signed URL) |
| Finalize verifies real object (size + SHA-256) | ✅ `approved` | ✅ `approved` |
| Publish copies to public bucket, verifies the copy | ✅ `visibility:public` | ✅ `visibility:public` |
| Publish is idempotent on retry | ✅ | ✅ |
| Anonymous GET on public copy returns correct bytes/content-type | ✅ 200, bytes match | ✅ 200, bytes match |
| Private original still denies anonymous GET | ✅ 404 (no route exists) | ✅ 403 (public access prevention) |
| `associate-menu-item` atomically writes the verified URL | ✅ | ✅ |
| Cleanup (archive/delete test objects, restore MenuItem) | ✅ | ✅ (real `gcloud storage rm` on both buckets) |
| Pre-existing 46 `MediaAsset` rows / 38 GCS `MenuItem.imageUrl` values untouched | ✅ confirmed before + after | ✅ confirmed before + after |

Real GCS opt-in integration test (`apps/api/test/gcs-storage-provider.integration-spec.ts`, extended this story with `publishObject` coverage) also run directly against the provisioned buckets: 5/5 passing.

## Tests and builds

| Check | Result |
|---|---|
| `apps/api` unit tests | 453/453 (was 449; +4 CSRF bypass regression tests, existing media suite extended to 53 media-specific tests) |
| `apps/api` typecheck / lint / prettier | Clean |
| `apps/api` build (`nest build`) | Clean |
| `apps/api` real-GCS opt-in integration test | 5/5 passing |
| `apps/admin-console` unit/component tests | 45/45 (was 30; +12 `mediaAssets.test.ts`, +3 `MenuManagementPage.test.tsx`) |
| `apps/admin-console` typecheck / lint | Clean (one pre-existing, unrelated `reservation.store.ts` lint warning left untouched — predates this session) |
| Builds: `admin-console`, `kitchen-display`, `order-tablet`, `customer-website`, `window-display` | All 6 clean |
| Real local-provider runtime flow (curl trace against live dev API) | Full pipeline proven, see table above |
| Real GCS opt-in flow | Full pipeline proven, see table above |
| Browser (Chrome) pixel-rendered validation | **Not executed** — `claude-in-chrome` extension not connected in this environment. Compensating evidence: `MenuManagementPage.test.tsx` renders the real page component (not a mock) through React Testing Library and asserts the same sequence, disabled-Save-during-upload, and old-image-preserved-until-success. |
| Credential/secret scan | Clean (`grep` for key material, signed-URL fragments, service-account JSON across every touched file) |
| Legacy-endpoint consumer scan | Zero remaining consumers of `POST /api/admin/media/:folder` anywhere in the repository |

## Deferred / follow-up (as originally recorded — see the append below for what was subsequently closed)

See `_bmad-output/implementation-artifacts/deferred-work.md`, "Deferred from: Wire Admin Console Media Uploads to the MediaAsset Pipeline (2026-08-18)" for the full list (image-dimension validation, abandoned-upload lifecycle sweep, the heuristic replacement-supersession logic, and the missing browser-rendered validation).

---

## Browser Validation — 2026-08-18 (same-day follow-up session)

The one gap the record above left open — real-browser, pixel-rendered validation — was closed this session. `claude-in-chrome` was unavailable at the start (Chrome itself was not running); launching Chrome resolved the connection, and the full validation below was performed for real, not simulated.

### Environment

Local dev stack reused (all already running and healthy): PostgreSQL + Redis (Docker), API on `:3000`. Found **four stale `nest start --watch` process trees** left over from the prior session's local↔GCS provider-switching (only one was actually bound to the port) — killed all of them and started one clean, explicit `MEDIA_STORAGE_PROVIDER=local` instance before testing, to remove any ambiguity about which provider was under test. Admin Console (`:5176`), Customer Website (`:5173`), Window Display (`:5174`) reused as-is (already healthy). Order Tablet verified via its embedded Admin Console route (`/order-tablet`) — the standalone `VITE_APP_MODE=tablet` build's PIN-auth issue is the same pre-existing, unrelated, already-documented gap from DL-075 and was not touched. Storage provider under test: **local** for the primary journey, confirmed by inspecting delivery URLs (`http://localhost:3000/api/media-assets/public/...`) throughout.

### Real defect found, root-caused, and fixed

**Symptom:** Uploading a file byte-identical to one of the 46 already-migrated (real-GCS) menu photos produced a menu item whose image failed to load (404 on the delivery URL), even though every API call in the sequence returned success.

**Root cause:** `MediaAssetsService.requestUpload()`'s checksum-based dedup (`findFirst({ venueId, purpose, checksum, status: 'approved' })`) did not filter by `storageProvider`. This repository's own local dev database mixes 46 real `storageProvider: 'gcs'` rows (from the DL-075 migration) with whatever a developer uploads while running `MEDIA_STORAGE_PROVIDER=local` — both against the *same* Postgres database. A checksum match against a `gcs`-originated row was reused while the active process was running the `local` provider, producing a `mediaAssetId` whose bytes exist only in real GCS, not on local disk — the resulting delivery URL 404'd (confirmed by direct `curl`, matching the app's own response byte-for-byte; the browser extension's network log labeled the same failure "503", a reporting-granularity quirk of the tool, not a second bug — the real HTTP response was verified independently).

**Correction:** Added `storageProvider: this.activeProvider` to the dedup lookup's `where` clause (`apps/api/src/media/media-assets.service.ts`), and refactored the provider-detection expression (previously computed inline twice) into a single `private readonly activeProvider` field so the dedup query and the new-row `storageProvider` value can never disagree. Smallest possible correction — no schema change, no new config, no behavior change to the GCS path itself.

**Regression coverage:** Two new tests in `media-assets.service.spec.ts` — one asserting the dedup `where` clause includes `storageProvider` matching the active provider, one proving a differently-provisioned row is correctly NOT reused and a fresh upload proceeds instead.

**Verified fixed, live, in the same browser session:** re-attempted the identical upload after the fix; the request-upload call returned a *new* `mediaAssetId` (not the real GCS asset's id), the full PUT→finalize→publish→delivery-url sequence executed for real (previously skipped, since dedup had short-circuited it), and the delivery URL returned 200 with the correct image.

**What this defect does *not* affect:** the real, pre-existing 46 `MediaAsset` rows and 38 `MenuItem.imageUrl` values from DL-075 — none were mutated (confirmed via `updatedAt` before/after) — because `publishAsset()`'s idempotent early-return (`if (asset.visibility === 'public') return asset;`) meant the erroneous reuse never wrote anything. The only symptom was a broken URL on the *new* item being created, not corruption of existing data.

### Real Admin Console browser journey — performed, not simulated

1. Logged out and back in via the real PIN gate (owner PIN, not a persisted session) — confirms the actual authenticated path, not just a stale token.
2. Menu Management → New item → typed a disposable title (`BROWSER TEST ITEM - DELETE ME`).
3. **Unsupported-type rejection**: uploaded a plain-text file disguised with a `.jpg` extension — client-side decodability check correctly rejected it ("This file could not be read as an image...") with **zero network requests made** (confirmed via network-request inspection).
4. **Oversized-file rejection**: uploaded a 6.4 MB file — correctly rejected ("Image is too large...") before any network call.
5. **Happy path (new item)**: uploaded a real photo → full `request-upload → PUT → finalize → publish → delivery-url` sequence, each call individually verified via network-request inspection (correct order, correct status codes) → saved → item persisted with the real image, confirmed via direct DOM/computed-style inspection and a same-origin `fetch()` proving the exact byte count served.
6. **Reload persistence**: hard-navigated back to Menu Management; the image was still correct (verified via the API's own `GET /admin/menu/items` response, not just the cached UI state).
7. **Replacement (existing item)**: edited the same item, replaced its image with a different real photo → sequence included `associate-menu-item` (not a raw create), confirmed via network trace → DB confirmed the old `MediaAsset` was auto-archived (`status: 'archived'`, bytes preserved) while the new one is `approved`/`public`, and `MenuItem.imageUrl` points only at the new one.
8. **Duplicate/rapid selection**: selected two different files back-to-back with no pause between them. The first selection's `request-upload` call completed server-side (visible in the network log, `201`), but the client correctly never issued a PUT/finalize/publish for it — confirmed via network trace showing no follow-up calls for that `mediaAssetId`. The second (later) selection's image is what was ultimately displayed and saved. This is the abort/generation-counter guard working under real, not simulated, timing.
9. **Save blocked during upload**: triggered a new upload and, in the same batch (no artificial wait), attempted to click "Save changes" immediately. Confirmed via network-request inspection that **no `PATCH /admin/menu/items/:id` request was ever sent** — the click landed on the disabled button and did nothing. Re-clicked after the upload genuinely completed; the save then succeeded normally.
10. **Removal**: used the real "Delete item" button — a confirmation dialog appeared ("Are you sure you want to permanently delete... This action cannot be undone") and required an explicit second click; canceling it was not separately tested but the dialog's presence itself is the required explicit-confirmation behavior.

Local network latency on loopback proved too fast (sub-tool-round-trip) to visually catch the transient `uploading`/`finalizing`/`publishing` UI states in a screenshot, or to force a true mid-flight cancellation via manually-timed clicks — both are already covered by the deferred-promise-based automated tests (`mediaAssets.test.ts`, `MenuManagementPage.test.tsx`) using controlled timing, and the *sequencing* itself (proof that the UI never skips a step) was independently confirmed via network-request inspection in the real browser, which is the evidence that actually matters for correctness.

### Downstream rendering — verified per surface

| Surface | Route | Result |
|---|---|---|
| Admin Console | `/menu-management` | Real image renders; confirmed via DOM/computed-style + same-origin fetch (not just a screenshot — see methodology note below) |
| Customer Website | `/menu` | Real image renders; network request to the delivery URL returns 200; zero console messages of any kind |
| Order Tablet | `/order-tablet` (embedded Admin Console route, same `OrderTabletPage` component the standalone build renders — consistent with how DL-075 verified this surface) | Real image renders in the ordering grid; zero console messages |
| Window Display | `/menu` (aliased from Customer Website, per its documented architecture) | Real image renders; zero console messages |
| Kitchen Display | `/kitchen-display` | Loads cleanly, zero console errors; does not render item photos at all (ticket view is text-only) — consistent with the DL-075 finding, so there was nothing to check beyond "no regression," confirmed |

**Methodology note:** the browser extension's full-page `screenshot` tool twice appeared to show a broken/placeholder image when the real page state (verified independently via DOM inspection, computed styles, and a live `fetch()` of the exact URL in use) was actually correct — a rendering/compositing artifact of that specific tool for this page, not a product defect. Zooming into the specific region with the `zoom` action consistently showed the correct, real photo. Recorded here so a future session doesn't re-chase the same false lead; every rendering claim in this section is backed by DOM/network/fetch evidence, not a full-page screenshot alone.

### Security boundary re-confirmed live

- Private-original URL pattern (`/api/media-assets/private/...`) returns 404 — no route serves it at all (confirmed via direct request).
- Public delivery URLs returned 200 with correct `Content-Type` and exact byte counts throughout.
- No signed URL, token, cookie, or private object path appeared in any screenshot, log excerpt, or this document.
- No CORS, CSRF, or mixed-content failures observed on any of the four verified surfaces (Kitchen Display included) — confirmed via `read_console_messages` on each tab.

### Unrelated finding (not fixed — recorded per the task's separation rule)

**Nested `<button>` inside `<button>` in `ItemCard`'s availability toggle** (`MenuManagementPage.tsx`, pre-existing, not touched by either media-pipeline story): the "Available" control wraps a `<Toggle>` component (which itself renders a native `<button role="switch">`) inside an outer `<button onClick={onToggleAvail}>`. React logs a `validateDOMNesting` warning on every Menu Management page load. Invalid HTML, real accessibility concern (nested interactive elements have undefined/inconsistent keyboard and screen-reader behavior), but **entirely unrelated to media uploads** — present in code neither this nor the prior media session touched. Not fixed, per the instruction to record unrelated issues separately rather than silently expanding scope. Severity: P2 (accessibility/HTML-validity, not a functional or security defect — the control is still clickable and visually correct). Evidence: `read_console_messages` output during this session, and direct source inspection (`ItemCard`'s footer `<button onClick={onToggleAvail}>...<Toggle .../></button>`, `Toggle` itself at line 171 rendering `<button role="switch">`). Recommended owner: Admin Console / design-system.

### Reconciliation performed

- Deleted the disposable `BROWSER TEST ITEM - DELETE ME` `MenuItem` via the real UI delete flow (confirmation dialog required and used), then hard-deleted the row (soft-delete alone would have been the authentic production behavior, but full removal better matches "remove disposable records created solely for this validation").
- Deleted all 4 test-created `MediaAsset` rows (two archived-by-replacement, one orphaned `pending_upload` from the duplicate-selection test, one final `approved` one) and their underlying local-disk bytes (`apps/api/storage-assets/`, `storage-assets-public/`).
- Deleted the real GCS objects created during the *prior* session's GCS validation had already been cleaned up then; this session's testing used the local provider exclusively, so no real-GCS cleanup was required here.
- **Verified baseline restored exactly**: 46 `MediaAsset` rows, 38 GCS-backed `MenuItem.imageUrl` values, 70 total active `MenuItem` rows — identical to the counts at the start of this session.

### Validation executed this session (exact results)

| Check | Result |
|---|---|
| `apps/api` unit tests | 455/455 (was 453; +2 for the cross-provider dedup fix) |
| `apps/api` typecheck | Clean |
| `apps/api` lint (changed files) | Clean |
| `apps/api` prettier (changed files) | Clean |
| `apps/api` build | Clean |
| `apps/admin-console` unit/component tests | 45/45 (unchanged — no admin-console source changed this session) |
| `apps/admin-console` typecheck | Clean |
| `apps/admin-console` lint (changed-file scope) | Clean, except the same pre-existing unrelated `reservation.store.ts` warning noted in the prior session (not touched) |
| `apps/admin-console` build | Clean |
| Real local-provider browser journey | Performed live — see above |
| Downstream rendering (Admin Console, Customer Website, Order Tablet, Window Display, Kitchen Display) | All verified live — see table above |
| Real-GCS opt-in test | **Not re-run this session** — no GCS-path code changed (the fix is provider-agnostic dedup-scoping logic); the prior session's real-GCS run remains the current evidence for that path |
| Legacy-endpoint repository-wide scan | Zero remaining consumers (unchanged from prior session) |
| Secret/credential scan | Clean, on every file touched this session |
| Database/storage reconciliation | Confirmed exact baseline restoration (46 / 38 / 70) |

### Confirmation

No commit, push, force-push, merge, or pull request occurred. No production deployment. No live Idealpos action, payment, or KOT print. No unrelated file was modified — confirmed by exact accounting of every file touched this session (two files: `media-assets.service.ts`, `media-assets.service.spec.ts`, plus this documentation).
