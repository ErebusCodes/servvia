---
baseline_commit: HEAD@2026-08-17 (Epic 15 review session, applying DL-072)
epic: E15
tracer_bullet: false
production_story: true
---

# Story 15.1: Production Venue Auto-Selection, Tablet Authentication Decision, and Venue Tax/Locale Metadata

Status: done (auth-identity sub-scope completed 2026-08-18, per approved DL-081 — see Scope split and 2026-08-18 Dev Agent Record below; venue auto-selection code change was not separately re-scoped and remains a small, low-risk follow-up — see Deferred/residual items)

## Story

As the platform operator preparing the single Dunedin venue's Order Tablet for production,
I want the tablet to auto-select its one real venue, one consistently-decided authentication model across both its entry points, and the venue's authoritative tax/locale metadata established,
so that later Epic 15 stories (billing, Idealpos handoff, EFTPOS, reconciliation) build on a correct, non-ambiguous foundation rather than re-deriving venue facts or authentication rules themselves.

## Scope split (read before the rest of this file)

This story has two independent sub-scopes, originally tracked separately because one was blocked and one was not:

1. **Tablet authentication decision + implementation** (`docs/epics.md` E15-S1's original scope). Was `BLOCKED ON:` an explicit product/security decision on the tablet's identity model. **Unblocked 2026-08-18** by the owner's approval of Option 3 (hybrid device identity + restricted customer mode + named staff elevation + manager step-up), formalized as `docs/decisions-log.md` DL-081. **Fully implemented and verified 2026-08-18** — see the 2026-08-18 Dev Agent Record below. The venue-auto-selection code change named in the original E15-S1 title was not part of the approved decision's scope and was not implemented this session; it remains a small, independent, low-risk follow-up (see Deferred/residual items).
2. **Venue tax/locale metadata** (added 2026-08-17 per that session's governing brief, formalized as `docs/decisions-log.md` DL-072). Independent of sub-scope 1. **Completed 2026-08-17** — see the original Dev Agent Record below.

Both sub-scopes are now done. The original "not attempted this session" / "remains exactly as blocked" language below describes the state as of 2026-08-17 and is preserved for history — it does not describe the current state.

## Dependencies

- `docs/decisions-log.md` DL-072 (2026-08-17) — the authoritative tax/payable-total split between Verdura and Idealpos, and the NZ venue tax facts this story implements as metadata. Written this session as part of this same governing brief.
- Epic 15 baseline banner (`docs/epics.md`) — corrected this session (see Dev Agent Record) to withdraw its prior, now-superseded conclusion that the tablet's additive 15% GST line was already correct.
- Does **not** depend on, and does not implement, `15-4`/`15-5`/`15-6` (the actual billing-defect fix, authoritative-total reconciliation, and EFTPOS charging) — those remain separately scoped and are not touched by this story.

## Acceptance Criteria — venue tax/locale metadata sub-scope (this session's actual scope)

1. The venue's authoritative tax/locale metadata is established as real, queryable data, not implicit convention: currency `NZD`, locale `en-NZ`, timezone `Pacific/Auckland`, tax jurisdiction `NZ_GST`, `pricesIncludeTax = true`.
2. These are `Venue` schema fields with the above as defaults, so any current or future venue record (including a real Dunedin production venue not yet seeded in this repository) carries this metadata explicitly, overridable per-venue via the same DTOs as `currency`/`timezone` already are.
3. This story's own changes introduce no tax, GST, service-charge, or total-computation logic of any kind, and therefore cannot introduce a new source of double GST. Verified: no file under `backend/src/orders/`, `admin-frontend/src/pages/order-tablet/`, or `kiosk-frontend/src/pages/` was touched this session (see File List).
4. The pre-existing, incorrect tablet total calculation (fabricated 10% service charge; additive 15% GST on a GST-inclusive price) remains untouched, unfixed, and clearly recorded as a defect owned by later stories — not silently fixed here as a scope-creep shortcut, and not silently left undocumented either.
5. Documentation is corrected at the source where it previously asserted the now-superseded GST-exclusive convention, rather than leaving contradictory authority in the repository (`docs/epics.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`).

**As of 2026-08-17, not met and not claimed:** the venue auto-selection code change and the authentication-model decision (sub-scope 1). Superseded — see below.

## Acceptance Criteria — tablet authentication (sub-scope 1, completed 2026-08-18 per DL-081)

1. Four distinct trust layers are implemented and backend-enforced: physical device identity, restricted customer/device mode (default), named staff elevation, manager step-up. Met — see Dev Agent Record.
2. Device identity: unique per device, org/venue bound, single-use time-limited enrollment code, server-generated secret shown once and only ever stored hashed, no secret in frontend source or committed config, revocation and re-enrollment supported, last-seen metadata recorded, device tokens cannot reach Admin Console admin endpoints, Argon2id + secure randomness throughout. Met.
3. Restricted mode permits menu browsing/cart building/viewing the assigned table/submitting an idempotent order via a purpose-built endpoint, and is independently verified (integration tests, plus a real curl-based HTTP run) to reject every discount/void/refund/payment-override/reconciliation/manual-recovery/reprint/staff-management/venue-config/audit-log/manager action. Met.
4. Named staff elevation uses a PIN distinct from and never derived from the staff login password, hashed, org-scoped verification, excludes inactive/revoked staff, is rate-limited, gives enumeration-resistant errors (decoy Argon2id verify), is short-lived, memory-only client-side, explicitly lockable, and cannot be forged client-side (all guards re-verify server-side). Met.
5. Manager step-up is a guard + minimal real (non-fabricated) integration hook only; does not imply from ordinary elevation; is very short-lived and per-action; validates role+venue server-side; success/failure is audited; later void/refund/etc. stories can consume `ManagerStepUpGuard` without redesign. Met.
6. Device enrollment/administration (create codes, enroll, name/identify, list, revoke, re-enroll, rotate) is available only to authorized Admin Console staff through a minimal but real UI (`TabletDevicesPage`) — no manual DB edits as the normal path. Met.
7. The venue PIN remains local unlock/wake control only, cannot identify staff or grant admin authority, is server-validated/rate-limited, and production fails closed (500) if the checked-in default PIN (`108`) is still configured. Met — and the local-dev PIN itself was left as the developer's own configured value, not removed.
8. The standalone Order Tablet PIN/authentication defect is root-caused and fixed (not bypassed): (a) `CsrfMiddleware`'s `/auth/`-only bypass never matched `/api/kiosk/kds/auth` (no trailing slash) — broadened the bypass condition; (b) the checked-in dev `KDS_VENUE_PINS` value (`"108"`, 3 characters) could never pass the DTO's `@Length(4,16)` validation regardless of (a) — corrected to a 4-character dev value. Both verified end-to-end against a running API. Met.
9. Auditability: enrollment-code creation, enrollment success/failure, device auth, device revocation, unlock success/failure, staff elevation success/failure, manager step-up success/failure, lock/logout, and privileged-action authorization decisions are all recorded with org/venue/device/staff-actor/manager-authorizer/action/timestamp/outcome, with no PIN/secret/token ever logged — verified against real `AuditLog` rows from an end-to-end curl run. Met.
10. Migrations are additive, preserve existing data, contain no insecure placeholder hashes, and were verified both from a clean database and against the real local dev database's existing rows. Met.
11. Independent review found and fixed two genuine defects beyond the original design: (a) a revoked device's already-issued staff/manager tokens still worked against the pre-existing `/api/admin/orders` endpoint (fixed via `TabletTokenActiveGuard`); (b) `elevateStaff`/`managerStepUp` were gated on `VenueAccess`, a schema-only model never populated anywhere else in the app, making elevation unconditionally impossible for every real account (fixed by scoping to `organizationId` only, matching how staff-kind tokens are scoped everywhere else in the app). Both fixes are covered by real-Postgres integration tests. Met.
12. Story 15-4 billing behavior, Idealpos-as-pricing-authority, existing Staff email/password auth, connector enrollment, MediaAsset/GCS functionality, and KDS auth are all unmodified and independently regression-tested. Met.
13. A separate Admin Console `AdminPinGate`/story 2-6 shared-owner-account finding is recorded, not fixed, in its own tracked artifact. Met — see `_bmad-output/implementation-artifacts/finding-admin-pin-gate-shared-owner-account.md`.

**Not implemented, by explicit design:** any void/refund/discount/reprint business logic; the venue auto-selection code change; a redesign of Admin Console `AdminPinGate` auth; Idealpos/EFTPOS/online payment logic; KOT dispatch changes; GST/pricing changes.

## Dev Agent Record

### Tablet device identity, restricted mode, staff elevation, manager step-up (2026-08-18, per approved DL-081)

**Trust model implemented** (backend, `apps/api/src/tablet/`): `TabletEnrollment`/`TabletDevice` Prisma models (migration `20260818034619_tablet_device_identity_and_staff_pin`, additive, verified from-zero and against real existing data); JWT `kind` extended to `tablet_device | tablet_staff | tablet_manager`, each carrying `deviceId` (all three) and `actingStaffId` (manager only); `TabletAuthService` (enrollment redemption, revocation, unlock, staff elevation, manager step-up, per-device synthetic system actor for device-attributed audit events); layered guards `TabletDeviceGuard`/`TabletStaffGuard`/`ManagerStepUpGuard`/`StaffSessionOnlyGuard`/`TabletTokenActiveGuard`; controllers `TabletAuthController` (`/api/tablet/enroll|unlock|elevate|manager-step-up|lock`), `TabletDevicesAdminController` (`/api/venues/:venueId/tablet-devices/*`), `TabletOrdersController` (`/api/tablet/orders`, `/api/tablet/manager-actions/test-hook`); `Staff.pinHash`/`pinSetAt` (separate from `passwordHash`) plus `StaffController` (`GET /api/admin/staff`, `POST /api/admin/staff/:id/tablet-pin`).

**Frontend** (`apps/admin-console/src/`): `tabletDeviceAuth.store.ts` (Zustand, `persist`-`partialize`d to device identity only — staff/manager elevation fields are memory-only, so a reload always returns to restricted mode); `TabletDeviceGate.tsx` (replaces `KdsPinGate` for `VITE_APP_MODE=tablet` only; KDS mode unchanged); `TabletDevicesPage.tsx` (enrollment/device/staff-PIN admin UI, `/settings/tablet-devices`); `OrderTabletPage.tsx` updated for real staff-elevation UI (replacing a fabricated "Chowdhury/Server" placeholder with the real elevated staff's name/role), restricted-vs-elevated order routing, and explicit lock.

**Standalone PIN defect root-caused and fixed:** two independent causes — `CsrfMiddleware`'s `/auth/`-bypass check required a trailing slash and never matched `/api/kiosk/kds/auth`; and the checked-in dev `KDS_VENUE_PINS` value `"108"` could never pass `@Length(4,16)` validation. Both fixed (`apps/api/src/common/middleware/csrf.middleware.ts`, `apps/api/.env`, `docker-compose.yml`); verified end-to-end.

**Two genuine bugs found via testing and fixed (not merely demonstrated):**
1. A revoked device's already-issued staff/manager tokens still worked against `/api/admin/orders` (that endpoint never re-checked live `TabletDevice` status). Fixed via `TabletTokenActiveGuard`, applied to all staff-tier `OrdersController` routes.
2. `elevateStaff`/`managerStepUp` gated candidates on `VenueAccess`, a Prisma model present since the original `init` migration but never populated by any other part of the app (confirmed zero rows exist anywhere, including for the seeded owner) — making staff elevation unconditionally impossible for every real account. Fixed by scoping to `organizationId` only, consistent with how every other staff-kind token in this app is scoped. Found during the real end-to-end curl validation run (`owner`'s elevation with a correct, freshly-set PIN was incorrectly rejected), root-caused via direct Prisma inspection, fixed, and covered by a corrected real-Postgres integration test (`test/tablet-auth.integration-spec.ts`) plus a rerun of the full curl journey confirming success.

**Validation performed:**
- Backend unit tests: 514/514 passing (`apps/api`, `npx jest`), including 25 new `tablet-auth.service.spec.ts` tests and new guard/util spec files.
- Backend real-Postgres integration tests: 28/28 passing in `test/tablet-auth.integration-spec.ts` (enrollment, revocation, full device→restricted→staff→manager authorization matrix, cross-venue isolation, audit-attribution and no-PIN-leakage checks, KDS/staff-login/Story 15-4 regression). Full `npm run test:integration` run: 157/166 passing, 5 skipped, 4 failing — the 4 failures are in an untracked, pre-existing `connector-command-harness.integration-spec.ts` file unrelated to this story, failing on a missing `ts-node` binary path (environment/toolchain gap, confirmed via `git status` showing the file as untracked and unrelated to any change in this session).
- Migration verified both via `prisma migrate dev` against the real local dev database (applied cleanly over existing data) and via a from-zero `prisma migrate deploy` in a disposable Docker Postgres container (removed afterward).
- Frontend: 92/92 Vitest component tests passing (`apps/admin-console`), including 5 new `TabletDeviceGate.test.tsx` tests and 4 new `OrderTabletPage.test.tsx` tests covering restricted-vs-elevated order routing, wrong-PIN rejection, and explicit lock.
- Typecheck and lint clean on all touched application files (`npx tsc --noEmit`, `npx eslint`).
- Builds succeeded for API, order-tablet (`VITE_APP_MODE=tablet`), admin-console, and KDS (`VITE_APP_MODE=kds`).
- Real end-to-end HTTP validation against the live local API + real Postgres (pixel-rendered Chrome validation could not be completed — the browser extension failed to connect after 3 attempts; this curl-based run is real-system, real-HTTP, real-database evidence, distinct from and complementary to the jsdom-based component tests): enrollment-code creation → device enrollment → venue-PIN unlock (wrong PIN 401, correct PIN 200) → restricted-mode order via `/api/tablet/orders` (real order `ORD-600001` created) → restricted token rejected (403) by `/api/admin/orders`, the manager hook, and the tablet-devices admin endpoints → staff elevation (wrong PIN 401, correct PIN 200, real owner identity returned) → elevated-staff order via unmodified `/api/admin/orders` (real order `ORD-600002`, truthfully attributed) → elevated-but-not-stepped-up token rejected (403) by the manager hook → manager step-up (wrong PIN 401, correct PIN 200, `actingStaffId` carried) → manager hook succeeds (200), returning both real identities → explicit lock (204) → device revocation → device, staff, and manager tokens from before revocation all rejected (401). Full `AuditLog` review of every event from this run confirmed truthful actor attribution (device-level events to the per-device synthetic actor, elevation/step-up/order events to the real staff member) and zero PIN/secret leakage in any field. No Idealpos submission, EFTPOS initiation, or KOT print occurred at any point. Test data used the real seeded org/venue/owner account (local dev only); the created device was left in its natural, correct revoked end-state rather than hard-deleted; the owner's tablet PIN (set to a disposable test value) was left in place as harmless local-dev state.

### Tax/locale metadata implementation (2026-08-17)

Added three fields to the `Venue` Prisma model (`backend/prisma/schema.prisma`): `locale String @default("en-NZ")`, `taxJurisdiction String @default("NZ_GST")`, `pricesIncludeTax Boolean @default(true)`, alongside the pre-existing `timezone`/`currency` fields (which already defaulted correctly to `Pacific/Auckland`/`NZD` and required no change). Generated and applied migration `20260817005226_venue_locale_tax_metadata` against the local dev Postgres (`npm run db:migrate` equivalent, via `prisma migrate dev`); `prisma migrate dev` reported the database in sync with the schema afterward.

Wired the three new fields through `CreateVenueDto`/`UpdateVenueDto` (`@IsString`/`@IsBoolean`, optional, matching the existing `currency`/`timezone` pattern exactly) and through `VenuesService.create`/`update` (same default-on-create, pass-through-on-update pattern as `currency`/`timezone`). Added the same three fields, with the same values, to the local-dev seed venue (`backend/prisma/seed.ts`) for consistency — that seed venue ("Verdura Auckland") is a different physical venue than the real Dunedin production venue, but is in the same NZ GST jurisdiction, so the same metadata values are correct for it too; the real production Dunedin venue record does not exist in this repository (confirmed: no seed, fixture, or migration anywhere references "Dunedin" or "Saint Andrew Street" — those appear only in documentation) and is out of this session's reach to create.

Added two new test cases to `venues.service.spec.ts` asserting (a) the NZ defaults are applied when not supplied, and (b) they can be explicitly overridden (proven with a non-NZ example, `en-AU`/`AU_GST`/`pricesIncludeTax: false`, to confirm the fields are genuinely per-venue configuration and not hardcoded). All 19 tests in `src/venues/` pass; `npm run typecheck` is clean.

**Independent double-GST check performed and recorded, not assumed:** `git diff --name-only` after all changes was checked against `orders.service|OrderTabletPage|KioskOrderPage|computeTotals` and returned no matches — confirmed no tax-computation code path was touched by this story.

### Documentation corrected at the source (2026-08-17, DL-072)

- `docs/decisions-log.md`: added DL-072, recording the Verdura/Idealpos tax-and-payable-total authority split, the NZ GST-inclusive venue facts (including the `gross × 3 / 23` extraction formula and the `$70/$9.13/$70` worked example from this session's governing brief), the required later payment flow, and — because DL-072's reasoning surfaced it — an explicit, unresolved flag that `OrdersService.computeTotals` and the kiosk checkout's additive "GST (15%)" line likely exhibit the same double-GST pattern this decision prohibits for the tablet. That flag is recorded, not fixed: `computeTotals`/kiosk are shared backend infrastructure outside Epic 15's boundary, and fixing them was not requested and is not part of this story.
- `docs/epics.md`: added a dated correction directly beneath the E15 baseline banner withdrawing its prior "already correct... not a double-count bug" conclusion; corrected the `15-1`, `15-4`, `15-5`, `15-6` story bullets and the epic-level Acceptance Criteria to reflect DL-072's authority split and story ownership (see below).
- `_bmad-output/implementation-artifacts/deferred-work.md`: corrected the `15-4`-owned entry that previously asserted the additive GST line was correct; upgraded its priority from P1 to P0 now that it is confirmed to include a real GST double-count, not only an untracked service charge; reassigned partial ownership to `15-5`/`15-6` for the reconciliation and EFTPOS-charging aspects DL-072 newly assigns them.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: updated inline comments for `15-1`, `15-4`, `15-5`, `15-6` to reflect the same split and cross-references, without changing any status value this story didn't earn (only `15-1`'s metadata sub-scope is actually done; its status field is left as `backlog`, unchanged, because the story as a whole — including the still-blocked auth decision — is not done).
- `docs/domain-model.md`: added a one-line clarification to the `Order` type's `taxCents`/`totalCents` fields noting they are Verdura-side provisional figures pending Idealpos's authoritative total (DL-072), without changing the type shape.

### Story ownership determination (per this session's governing brief, item 3–5)

Reviewed `docs/epics.md`'s full Epic 15 story list against DL-072's required later payment flow (`Verdura provisional GST-inclusive cart → order submitted to Idealpos → Idealpos returns authoritative GST/rounding/final payable total → Verdura compares → customer/staff confirms any permitted change → Idealpos initiates EFTPOS → Verdura records real result`) to decide whether an existing story owns each stage, or whether a new story was needed:

- **Provisional GST-inclusive cart, service-charge correction:** `15-4` (idempotent submission, truthful totals) — already the correctly-scoped owner of the tablet's total-calculation logic; its acceptance criteria were incomplete (assumed the additive GST line was correct) rather than absent, so it was corrected at the source, not replaced.
- **Receiving/reconciling Idealpos's authoritative total, surfacing discrepancies as a blocking conflict:** `15-5` (Idealpos handoff and authoritative POS state) — already the correctly-scoped owner of the Idealpos handoff response in general; its acceptance criteria did not previously mention totals/tax at all (only `POSSyncRecord.status`), so this was an addition, not a correction of a wrong claim.
- **Charging the Idealpos-authoritative amount via EFTPOS:** `15-6` (EFTPOS/cash handoff) — already the correctly-scoped owner of the payment-confirmation gate; its acceptance criteria implied but did not state the amount-authority rule, so this was an addition.

**Conclusion: no new dedicated story was added.** Every stage of the required flow has an existing, correctly-titled Epic 15 story once each one's acceptance criteria are corrected/extended as above. A new story would have duplicated `15-4`/`15-5`/`15-6` rather than covering a genuine gap.

## Deferred/residual items (as of 2026-08-18)

- The venue auto-selection code change named in E15-S1's original title was not part of DL-081's approved scope and was not implemented — remains a small, independent follow-up, not currently blocked on anything.
- The Admin Console `AdminPinGate`/story 2-6 shared-owner-account finding is recorded separately, not fixed — see `_bmad-output/implementation-artifacts/finding-admin-pin-gate-shared-owner-account.md`.
- ~~Pixel-rendered Chrome browser validation could not be completed~~ — **completed in the 2026-08-18 (later) independent-review session below.** The jsdom component tests, the real-HTTP curl journey, and the real pixel-rendered browser journey now all independently cover this story.
- `test/connector-command-harness.integration-spec.ts` (untracked, pre-existing, unrelated to this story) fails in this environment on a missing `ts-node` binary — an environment/toolchain gap, not a regression introduced here.
- Manager step-up has no UI trigger anywhere in the Order Tablet frontend (only the backend guard + `POST /api/tablet/manager-actions/test-hook`), confirmed again during this session's browser walkthrough — this is by design (later stories consume the guard), not a gap, but it means manager step-up itself was validated via the real-Postgres integration suite and direct API calls in this session, not by clicking through the UI (there is nothing to click).

## Dev Agent Record — independent review, real browser validation, and 3 further defects found and fixed (2026-08-18, later same day)

A separate session performed the independent review DL-081/this story call for, and completed the real-browser validation the original implementation session could not (its Chrome extension failed to connect three times; this session's connected once Chrome itself was launched — same fix that resolved an identical issue on the Media Upload Pipeline story).

**Verification performed before any new code was written:** re-ran the full unit suite (518/518, including 4 new controller-spec cases), the full real-Postgres integration suite (162/171 passing, 5 skipped, the same 4 pre-existing unrelated `connector-command-harness` failures as before), `prisma migrate status` (schema up to date, 12 migrations), `tsc --noEmit` and `eslint` on all touched files (clean, modulo pre-existing unrelated debt in `OrderTabletPage.tsx`/elsewhere), and all four builds (API, admin-console, `VITE_APP_MODE=tablet`, `VITE_APP_MODE=kds`) — all green, confirming the prior session's claims held up before extending them.

**Three genuine defects found via the real-browser journey (not merely reviewed in code) and fixed:**

1. Standalone tablet crashed to a blank screen right after venue-PIN unlock (`useNavigate()` called with no `<Router>` ancestor in standalone mode; the value was dead code, never actually invoked). `apps/admin-console/src/pages/order-tablet/OrderTabletPage.tsx`.
2. `GET /api/admin/orders` 403'd for a bare (unelevated) device token, breaking the restricted-mode floor screen's per-table order lookup. Fixed with a new `GET /api/tablet/orders` (device-guarded, venue-pinned) and routed unelevated `useLiveOrders()` calls to it.
3. `GET /venues/:venueId/tables` and `GET /venues/:id/tax-config` also 403'd for a bare device token (missing `viewer` in `@Roles`); `tax-config` additionally never venue-scoped any device-kind token at all before this fix (pre-existing gap, closed alongside the role-list widening so no new cross-venue exposure was introduced).

**Real-browser journey completed end-to-end** (Chrome, via claude-in-chrome): admin creates enrollment code → standalone tablet enrolls, named and bound to the venue → starts in restricted mode → wrong venue PIN rejected, correct PIN unlocks → customer/guest-mode browsing, cart, and a real order submitted via `/api/tablet/orders` (visible on the floor plan, correct GST) → direct in-page fetch calls with the device's own token confirmed 403/401 against every staff/manager/admin-only endpoint, including a forged `{mode: "manager", role: "manager"}` request body (zero effect — role comes only from the verified JWT) → wrong staff PIN rejected, correct PIN elevates, real staff identity (name + role) visibly displayed → explicit lock returns to restricted mode, confirmed by a subsequent direct request that the device-only token still cannot reach `/api/admin/orders` → device revoked from the Admin Console → standalone tablet's next request fails closed and the app self-clears its persisted device identity back to the enrollment screen → `localStorage` inspected at every stage: only `deviceToken`/`deviceId`/`venueId`/`deviceLabel` ever present, `staffToken`/`managerToken` never appear. Console and network were clean of errors after the three fixes above; no PIN, secret, or token appeared in any URL, console message, or localStorage key beyond the device token itself (which is a non-privileged, revocable, venue-scoped credential by design). No Idealpos/EFTPOS/KOT action was taken; the payment screen was reached but "Pay" was never clicked.

Manager step-up itself (no UI trigger exists) was re-verified via 3 independent direct API calls against the live local server (bypassing the Vite dev proxy) plus the real-Postgres integration suite: wrong PIN rejected, non-manager PIN rejected, correct manager PIN succeeds and the resulting token passes the manager-only test hook, carrying `actingStaffId`.

**One reproducible-but-environmental artifact, root-caused and dismissed as non-actionable:** `POST /api/tablet/lock` returned `503` twice from the browser during this session, both times shortly after this session's own file edits triggered API dev-server hot-reloads. Isolated by calling the same endpoint 3 separate times directly against the API port (device token, then an elevated staff token) — all three returned the correct `204` with no error logged server-side. Root cause: the Vite dev proxy's upstream connection churning during concurrent hot-reload/WebSocket-reconnect activity from this session's own simultaneous test runs and file edits — not present in a stable deployment, not a code defect, and not reproducible via any direct API call.

**Test data reconciled:** all tablet devices created during this session (`Browser validation tablet`, `Lock retest tablet`, and two curl-based isolation-test devices) were revoked before finishing; the owner's disposable test tablet PIN was left in place as harmless local-dev state, matching this story's established convention from the prior session. No production data was touched; no cloud resources were mutated.

## File List

### 2026-08-17 (tax/locale metadata sub-scope)

- `backend/prisma/schema.prisma` (modified — `Venue.locale`/`Venue.taxJurisdiction`/`Venue.pricesIncludeTax` added)
- `backend/prisma/migrations/20260817005226_venue_locale_tax_metadata/migration.sql` (new)
- `backend/src/venues/dto/create-venue.dto.ts` (modified)
- `backend/src/venues/dto/update-venue.dto.ts` (modified)
- `backend/src/venues/venues.service.ts` (modified)
- `backend/src/venues/venues.service.spec.ts` (modified — two new test cases)
- `backend/prisma/seed.ts` (modified)
- `docs/decisions-log.md` (modified — DL-072 added)
- `docs/epics.md` (modified — E15 banner correction, `15-1`/`15-4`/`15-5`/`15-6` bullets, epic-level AC)
- `docs/domain-model.md` (modified — `Order.taxCents`/`totalCents` comment clarification, comment-only)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — corrected entry, reassigned partial ownership)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — comments only, no status changes)
- `_bmad-output/implementation-artifacts/15-1-tablet-venue-and-auth-decision.md` (this file, new)

### 2026-08-18 (tablet authentication sub-scope, DL-081)

- `apps/api/prisma/schema.prisma` (modified — `TabletEnrollment`, `TabletDevice`, `TabletDeviceStatus`, `Staff.pinHash`/`pinSetAt`, reverse relations)
- `apps/api/prisma/migrations/20260818034619_tablet_device_identity_and_staff_pin/migration.sql` (new)
- `apps/api/src/auth/interfaces/jwt-payload.interface.ts`, `apps/api/src/auth/strategies/jwt.strategy.ts` (modified — `kind`/`deviceId`/`actingStaffId` extended)
- `apps/api/src/auth/utils/resolve-venue-scope.ts` + new `resolve-venue-scope.spec.ts` (modified — tablet kinds venue-scoped)
- `apps/api/src/auth/utils/insecure-default-pin.util.ts` (new) — wired into `KdsAuthService` and `AuthService.validateAdminPin`
- `apps/api/src/auth/guards/staff-session-only.guard.ts` + spec (new)
- `apps/api/src/auth/guards/tablet-token-active.guard.ts` (new)
- `apps/api/src/common/middleware/csrf.middleware.ts` (modified — standalone PIN CSRF-bypass root-cause fix)
- `apps/api/.env`, `docker-compose.yml` (modified — `KDS_VENUE_PINS` dev value corrected to pass DTO validation)
- `apps/api/src/tablet/` (new module) — `tablet-auth.service.ts` + spec, `tablet-auth.controller.ts`, `tablet-devices-admin.controller.ts`, `tablet-orders.controller.ts`, `tablet.module.ts`, `guards/tablet-device.guard.ts`, `tablet-staff.guard.ts`, `manager-step-up.guard.ts` + specs, `dto/*.ts`
- `apps/api/src/staff/dto/set-staff-pin.dto.ts` (new), `apps/api/src/staff/staff.service.ts` (modified — `setTabletPin`/`listForOrganization`), `apps/api/src/staff/staff.controller.ts` (new), `apps/api/src/staff/staff.module.ts` (modified)
- `apps/api/src/orders/orders.controller.ts` (modified — `TabletTokenActiveGuard` added to staff-tier routes)
- `apps/api/src/app.module.ts` (modified — `TabletModule` wired in, new env vars)
- `apps/api/test/tablet-auth.integration-spec.ts` (new, 28 tests)
- `apps/admin-console/src/store/tabletDeviceAuth.store.ts` (new)
- `apps/admin-console/src/components/tablet/TabletDeviceGate.tsx` + `.test.tsx` (new)
- `apps/admin-console/src/App.tsx` (modified — tablet mode wired to `TabletDeviceGate`, new route)
- `apps/admin-console/src/shared/orders.ts` (modified — `getAuthToken` tablet-token precedence)
- `apps/admin-console/src/pages/tablet-devices/TabletDevicesPage.tsx` (new)
- `apps/admin-console/src/components/layout/AdminLayout.tsx` (modified — nav entry)
- `apps/admin-console/src/pages/order-tablet/OrderTabletPage.tsx` + `.test.tsx` (modified — real staff-elevation UI, restricted-vs-elevated order routing, lock)
- `docs/decisions-log.md` (modified — DL-081 formalized as approved/implemented)
- `_bmad-output/implementation-artifacts/finding-admin-pin-gate-shared-owner-account.md` (new — separate finding, not a fix)
- `_bmad-output/implementation-artifacts/15-1-tablet-venue-and-auth-decision.md` (this file, modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — `15-1` status to `done`)

### 2026-08-18 (later same day, independent review + real browser validation)

- `apps/api/src/tablet/tablet-orders.controller.ts` (modified — new `GET /tablet/orders`)
- `apps/api/test/tablet-auth.integration-spec.ts` (modified — 8 new tests: restricted-mode order listing, cross-venue isolation, revocation, tables/tax-config device access)
- `apps/api/src/tables/tables.controller.ts` (modified — `StaffRole.viewer` added to `GET` `@Roles`)
- `apps/api/src/tables/tables.controller.spec.ts` (modified — `tablet_device` venue-scoping tests)
- `apps/api/src/venues/venues.controller.ts` (modified — `StaffRole.viewer` added to `tax-config` `@Roles`; `resolveVenueScope` now called, closing a pre-existing gap)
- `apps/api/src/venues/venues.controller.spec.ts` (modified — device-token venue-scoping tests)
- `apps/admin-console/src/pages/order-tablet/OrderTabletPage.tsx` (modified — removed the crashing dead `useNavigate()` call; restricted-mode live-orders routing)
- `apps/admin-console/src/shared/orders.ts` (modified — `useLiveOrders({ restrictedEndpoint })` option, `liveOrdersQueryKey`)
- `apps/admin-console/src/shared/orders.test.ts` (new)
- `docs/decisions-log.md` (modified — DL-081 addendum recording this review's findings/fixes and real browser validation completion)
- `_bmad-output/implementation-artifacts/15-1-tablet-venue-and-auth-decision.md` (this file, modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — comment addendum only)

## Change Log

- 2026-08-17: venue tax/locale metadata sub-scope implemented and tested; Epic 15 documentation corrected at the source per DL-072 to withdraw a previously-incorrect GST-convention conclusion and assign discrepancy-handling/EFTPOS-charging ownership to `15-5`/`15-6`. Auth-identity sub-scope (original E15-S1 scope) untouched, still blocked on a product/security decision not made this session.
- 2026-08-18: tablet authentication sub-scope unblocked and fully implemented per approved DL-081 (device identity, restricted mode, named staff elevation, manager step-up); standalone PIN defect root-caused and fixed (two independent causes); two genuine authorization bugs found via testing and fixed (revoked-device-token-still-works gap; unconditionally-broken elevation due to an unpopulated `VenueAccess` gating condition); real-Postgres integration and unit test coverage added and passing; a real end-to-end curl-based HTTP journey run and verified against the live local API/database; separate Admin Console `AdminPinGate` finding recorded (not fixed). Story marked done.
- 2026-08-18 (later, independent review): real pixel-rendered browser validation completed (previously blocked on browser-extension connectivity); found and fixed 3 further genuine defects invisible to the prior curl/jsdom evidence — a standalone-mode `useNavigate()` crash, and two more staff-only endpoints (`GET /api/admin/orders`-adjacent floor data via `/venues/:id/tables` and `/venues/:id/tax-config`) that 403'd for a bare device token; closed a pre-existing cross-venue read gap on `tax-config` at the same time. Full unit/integration/build/lint/typecheck suite rerun clean. Manager step-up re-verified via direct API calls (no UI trigger exists by design). All session test devices revoked; local dev environment left as found.
