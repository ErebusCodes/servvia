# Servvia production-readiness audit (target: 31 December 2026)

> **Status:** **ADOPTED 2026-10-03** as the planning evidence and backlog baseline (owner gate B, decided under the owner's delegation). It is not a requirements source: `PRD/` prevails on conflict, and its estimates are planning figures, not commitments. Current decision status: section 14. Corrected audit of 2026-10-02 (an evidence pass, then an arithmetic pass), materialised in the repository on 2026-10-03.
> **Audited code:** `pre-bmad-baseline` at `54dcfc0` (D13 → CC-1 → CC-2). The Go and Nest code is identical to validated candidate A apart from path strings.
> **Test basis:** the tests in this audit ran in a throwaway export (`git archive`), never against a real database. Where integration results are quoted, they come from earlier candidate validation (see below).
> **Not a statement of live production state.** Production facts are documented history unless they are marked otherwise.

## 0. Evidence classes

Every important claim carries one of these labels.

| Label | Meaning |
|---|---|
| **CODE-PROVEN** | Read in the repository at `54dcfc0` |
| **TEST-PROVEN** | A test or command ran during this audit, with the result quoted |
| **PREVIOUS VALIDATION EVIDENCE** | A recorded result from candidate validation on 2026-10-01 (candidate A `529e2c5`, candidate B2 `457301a`) on disposable Postgres 18 and Redis |
| **LIVE-ENVIRONMENT VERIFIED** | Observed directly in a live system (here: GitHub, through `gh`) on the stated date |
| **DOCUMENTED HISTORICAL STATE** | Recorded in a repository document at a past date; not re-observed |
| **DOCUMENTED CURRENT STATE** | A repository document that describes itself as current; not re-observed |
| **OWNER DECISION** | Requires the owner; not decided by this audit |
| **ASSUMPTION** | A planning premise this audit relies on |
| **INFERENCE** | A conclusion drawn from evidence, not observed directly |
| **NOT VERIFIED** | Not checked; no claim is made |

"Not run during this audit" never means "never run".

## 1. Verdict

**NO.** A production-ready Servvia Core is not achievable by 31 December 2026 at about 4 focused hours a day.

| | Optimistic | Expected | Conservative |
|---|---|---|---|
| P0 | 288 h | 511 h | 876 h |
| P1 | 56 h | 98 h | 168 h |
| **P0 + P1** | **344 h** | **609 h** | **1,044 h** |
| Share of about 360 h available | 96% | 169% | 290% |

- Only the optimistic case fits, and it leaves about 16 h of contingency.
- **ASSUMPTION:** capacity is 4 focused hours a day, about 360 h for October–December. The December plan in section 9 uses a 364 h window total and schedules 352 h of work in it.

**Achievable by 31 December 2026: a STAGING RELEASE CANDIDATE.** It contains:
- CI green, with Go included;
- the production start and configuration fixed;
- the security must-fixes;
- the database baseline rehearsed;
- Core deployed in staging;
- the web Order Tablet (Staff Mode) and the KDS running on Core;
- order cancel/void;
- legacy code decoupled;
- backups rehearsed, monitoring in place, ordering→kitchen end-to-end tests and runbooks.

**Not achievable by then:** a complete transactional slice, a pilot candidate, or a production launch.

**After 31 December: 257 h remain.** That is P0-09 (85) + P0-14 (30) + P0-11 (20) + P0-17 (24) = 159 h, plus all of P1 (98 h). At 4 h a day the expected finish is about 3 March 2027, or late March with 15% contingency.

**Basis for these dates** (ASSUMPTION: 4 h on every calendar day from 1 January 2027):
- **About 3 March:** the 12 h of unscheduled December capacity (364 − 352) absorbs part of the remainder, so 245 h ÷ 4 = about 61 days. Without that, 257 h ÷ 4 = about 64 days, finishing about 6 March.
- **Late March:** 15% contingency on the whole P0 + P1 expected effort is 609 × 1.15 ≈ 700 h. Less December's 352 h scheduled, that leaves about 348 h, ÷ 4 = about 87 days, finishing about 29 March. Applied to the 257 h remainder alone, the contingency gives about 15 March.

**What drives the verdict** is scope, not test uncertainty:
- client cutover to Core;
- settlement;
- receipts and day close;
- deploying Core on the shared venue Windows PC;
- real-device, LAN and venue validation.

Under scope B, the integrated card terminal, Venue Edge printing and the cash drawer are deferred. They are **not** counted in the 609 h.

## 2. Scope definitions

- **Scope A:** the PRD section 11 pilot as written: no external POS, with a card terminal, receipt and kitchen printing, a cash drawer and the Windows POS. About 1,090 h expected, about 300% of capacity. Not feasible in December.
- **Scope B:** the recommended December core:
  - single venue;
  - web Order Tablet in Staff Mode on Core;
  - web KDS on Core;
  - order cancel/void;
  - a web cashier surface: checks, cash in a shift, standalone EFTPOS recorded as an external card tender, refunds, visit close;
  - a minimum receipt and day-close report;
  - platform safety.

  **OWNER DECISION:** scope B needs these waivers or decisions:
  - a web cashier instead of the Windows POS;
  - an external-card tender (a new Core feature);
  - no printing at pilot (KDS only);
  - Guest Mode off at pilot;
  - NestJS keeps serving login and administration (O-2).

## 3. Evidence

### 3.1 Repository-proven facts (CODE-PROVEN at `54dcfc0`)

- **No client uses Core.** Every client has one base URL pointing at Nest (`VITE_API_URL`, through the Vite proxy to `:3000`), and realtime is socket.io.
- **Core is not deployed from the repository:** no Dockerfile, service definition, CI job or deploy route for it. (The live host: NOT VERIFIED.)
- **Core writes are off by default:** `SERVVIA_CORE_DB_READ_ONLY` defaults to true (`services/core-platform/internal/config/config.go:113,143`).
- **Migration accounting:**
  - Prisma is the only migration authority (`apps/api/prisma/migrations`, 41 directories).
  - Core-related migrations: 11, numbers 31–41 (`20260929000000_table_sessions` … `20261009000000_domain_events`).
  - Pending against production, as documented: 16. That is 5 IdealPOS native-round migrations (26–30) plus the 11 Core migrations.
  - The procedure is to mark 1–25 as applied (baseline), then deploy the 16.
  - An earlier count of "9" was a miscount.
- **IdealPOS assumptions in code:** the code assumes IdealPOS prints the KOT and takes payment (`legacy-external-pos-handoff.ts:150-151`); Nest has no payment route.
  - None of the 3 routes from Servvia to IdealPOS delivers: the bridge uses `DisabledTableRoundWriter`, and WaiterPad is blocked on a licence seat (DOCUMENTED CURRENT STATE).
- **Broken Nest production start** (also PREVIOUS VALIDATION EVIDENCE: candidate A's build output):
  - `nest build` emits `dist/src/main.js`, because `tsconfig.json` has no `rootDir` or `include` and compiles `scripts/*.ts`;
  - but `start:prod`, `docker/backend.Dockerfile:23` and `docker/start-backend.mjs` all run `node dist/main`.
- **Mock admin pages:**
  - Mock: Venue settings (`INITIAL_VENUES` plus localStorage), Staff (`MOCK_WORKFORCE`), Dashboard (`MOCK_KPI`), Reports (`mockData.ts`), Audit logs (`generateMockData`), Inventory.
  - Real: menu, tables at `/settings/tables`, reservations, tablet devices, staff tablet PINs.
  - Staff accounts can be created only by seed.
- **No dine-in payment integration.** Core card payments stay pending until a `payment_adapter` device reports the result, and no adapter exists (`payments/payment.go:8-10`).
- **Kiosk Stripe is broken.** The client adds 15% GST (`KioskOrderPage.tsx:79-80`) while the server treats prices as GST-inclusive (`orders.service.ts:1595`), so `intent.amount` never equals the total. Payments fail, and the customer can be overcharged.
- **No printing or hardware.**
  - The connector's `SupportedCapabilities` has no `print_kot` (`ConnectorPollingLoop.cs:57-62`).
  - The only KOT transport is simulated.
  - Venue Edge, the Windows POS and all Android apps are README-only.
- **No end-to-end or device-journey tests** exist anywhere.

### 3.2 Test results from this audit (TEST-PROVEN, 2026-10-02, throwaway export, no database)

- **Go:** build, vet, race OK. `go test`: 153 pass / 0 fail / 124 skip (database suites skip without a database).
- **Nest:** `tsc` OK; jest 115 suites, 1,910 pass. **Lint FAILS** (2 errors).
- **Admin Console vitest:** 205 pass / 5 fail locally without `VITE_VENUE_ID`; 210/210 with it (and in CI).
- **Window Display:** 3/5 locally without the environment variable; 5/5 with it.
- **Customer Website:** 7/7. **Root scripts:** 82/82. **All web builds pass.**
- The admin CSS is 4 MB (embedded fonts).

### 3.3 Previous validation evidence (2026-10-01)

**Candidate A** (`529e2c5`), on disposable Postgres 18 and Redis:
- Go 318 / 0 / 9; the 9 skips are parity tests, which ran separately at 9/9;
- Go race: no races;
- Nest unit 1,910;
- Nest Postgres integration 310 pass / 5 skip;
- Prisma validate, from-zero, upgrade and drift checks: all exit 0.

**Candidate B2** (`457301a`):
- `npm ci` and all web lint/typecheck/test/build passed;
- API lint exit 1 (the same 2 errors);
- `docker compose config -q` exited 125 (unsupported flag), so **compose was NOT validated**;
- CI workspace paths OK; `ci.yml` parses.

### 3.4 Live-environment verified (GitHub, through `gh`)

Verified 2026-10-02. Re-verified 2026-10-03, unchanged: refs, PR and issue lists, the run list, each job's conclusion for run `36649862489`, branch protection and visibility. The log-level detail (the exact lint lines, and 3 of 502 tests) is 2026-10-02 evidence and was not re-read.
- `main` = `origin/main` = `a005642`; the remote has only `main`. No open or closed PRs or issues.
- The last 3 CI runs on `main` (2026-09-29/30) failed. No run since.
- **Failing jobs:**
  - API lint/typecheck/unit: 2 eslint `no-unnecessary-type-assertion` errors at `apps/api/src/orders/orders.service.spec.ts:477,497`, which stop the rest of that job;
  - Venue Connector .NET: 3 of 502 tests.
- **Passing jobs (7):** API real-Postgres integration, Admin Console (CI sets `VITE_VENUE_ID`), and others.
- `main` is **not protected**. There is no Go job, no security scanning and no CD.
- The repository `ErebusCodes/servvia` is **PUBLIC**.

### 3.5 Documented historical production state (NOT re-observed)

- **Production database empty and unbaselined:** `docs/runbooks/migration-baseline.md`, read-only checks on 2026-09-11, re-verified 2026-09-12. Zero rows in every table, no `_prisma_migrations` table, schema equal to migrations 1–25.
- **Venue till:** IdealPOS is the venue till (`docs/migration/idealpos-retirement.md`, audited 2026-09-28; DOCUMENTED CURRENT STATE at that date). "The venue runs entirely on IdealPOS" is an INFERENCE.
- **Production host** (`docs/windows-production-deployment.md`):
  - one Windows PC on the venue LAN, which is also IdealPOS's server;
  - services under NSSM, reached over HTTP (ports 3000, 5173-5177);
  - no TLS or reverse proxy (INFERENCE: the deployment document describes HTTP endpoints and never mentions TLS);
  - Redis in Docker Desktop, starting only after an interactive (remote-desktop) logon.

### 3.6 NOT VERIFIED

- the current production database contents, migration state and timezone;
- whether Core, or anything else, has been deployed to the venue host since the documents were written;
- whether nightly backups currently run on the host, and whether they succeed;
- current venue operations, hardware and the IdealPOS licence state;
- `docker compose` configuration validity;
- the Go database suites on PostgreSQL 16 (CI uses PG16; they were validated only on PG18).

## 4. Security (CODE-PROVEN unless marked)

1. **Unauthenticated, CSRF-exempt, unlimited-size file write** with a client-controlled key: `PUT /api/admin/media-assets/local-dev-upload/:key` (`apps/api/src/media/providers/local-media-upload.controller.ts`). It is protected only by `NODE_ENV`, and the path check uses `startsWith` with no trailing separator.
2. **Every production guard keys on `NODE_ENV==='production'`**, and Joi defaults it to `development` (`app.module.ts:30`); compose hard-codes `development`. That covers: default JWT and service secrets, PIN 108, 3-digit PINs, fixture routes, simulated printers, and Table-19 mode.
3. **Core realtime fails open on revocation lookups.** PRD section 16.12 requires this fixed before production.
   - **Tablet credentials:** a failed revocation lookup **admits or keeps** the socket: `return err != nil || active` (`services/core-platform/internal/realtime/realtimeapi/handler.go:352`). The same check runs at admission (`:354`) and at every periodic re-check (`:244`).
   - **KDS device credentials** (re-checked 2026-10-03): admission fails closed, but the periodic re-check treats any error other than unauthenticated, wrong kind or wrong venue as still valid (`handler.go:386-389`). A database failure therefore keeps an open socket open.
   - **For comparison:** the HTTP tablet guard already fails closed. A lookup error returns an internal error, not access (`services/core-platform/internal/identity/guards.go:67-73`).
4. **Nest socket.io** accepts CORS `*` and authenticates only at connect.
5. **Admin Console sign-in** is a single shared PIN (`ADMIN_CONSOLE_PIN`) that grants an owner/admin JWT.
6. **KDS venue-PIN token** (role kitchen) can create and cancel any order. Nest status updates are last-write-wins (`orders.service.ts:924`).
7. **No refresh-token revocation** (7 days); access tokens are not re-checked for `isActive`.
8. **Tablet unlock is stateless** (client-only). Elevation looks up staff across the whole organisation; `VenueAccess` is never enforced; PINs are not unique.
9. **Email HTML injection** from public reservation names (Resend). The example environment sets a fake key, which enables the client.
10. **Kiosk `create-payment-intent`** is public and accepts any amount; it uses Stripe SDK v8.
11. **Repository exposure:** the production host's public address and SSH port are committed (`docs/source-of-truth-and-environments.md:31-32`), plus LAN addresses and hostnames (`scratchpad/front-passive-capture.ps1:183-184`). The repository is PUBLIC (LIVE-ENVIRONMENT VERIFIED).
12. **Row-level security is decorative:** 18 tables, no policies, and the application connects as owner.

**Fine as written:** raw SQL is parameterised, passwords use argon2id, and no `.env` files are committed.

## 5. Data integrity (CODE-PROVEN unless marked)

**Strengths:**
- money is integer cents throughout;
- 74 unique constraints and 48 indexes;
- database-unique idempotency keys;
- Core writes run in single transactions with a documented lock order (TableSession → Order → Check → CheckPayment → Shift).

**Risks:**
- totals go stale after round 1 on the IdealPOS-native path (`native-table-round.service.ts:572-590`);
- the Nest status race;
- dual writers (Nest and Core share tables);
- financial children cascade on order delete;
- reservation overbooking (no transaction);
- no statement or lock timeout in Core;
- pending or uncertain card payments block visit close indefinitely;
- production timezone NOT VERIFIED (native-round recovery fails on non-UTC);
- fractional modifier prices never checked on production.

## 6. Infrastructure and operations

- **No staging environment** (CODE-PROVEN: none defined in the repository).
- **Backups** (script CODE-PROVEN; host behaviour DOCUMENTED HISTORICAL STATE): `windows-deploy/ops/pg-backup.ps1` runs a nightly `pg_dump`.
  - It keeps 14 days (the PRD requires 30).
  - Backups are on the same disk, unencrypted, with no restore script and no failure alert.
  - A restore has never been rehearsed with data.
  - Media, Redis and the connector SQLite are not backed up.
  - There is no RPO or RTO.
- **Redis:** the API hangs if Redis is down (`maxRetriesPerRequest: null`; CODE-PROVEN).
- **Observability** (CODE-PROVEN):
  - NestJS has no request IDs or structured logs;
  - Core has JSON logs and correlation IDs but is not deployed;
  - neither has metrics or alerts;
  - "an order disappeared at 7:30 PM" cannot be reconstructed today (INFERENCE).
- **Legacy code is large:**
  - pos-sync is 16.4k lines (about 32k by another count);
  - venue-connector is 18.3k lines;
  - idealpos-bridge is 5.5k lines.

  The IdealPOS dispatcher timers have **no** enable flag (`idealpos-order-dispatcher.service.ts:233-257`). That contradicts retirement step 2 ("stop by env flags").

## 7. Core (Go) facts (CODE-PROVEN)

- **Shape:** about 16k production lines and 53 routes (`internal/server/server.go:62-245`). It has graceful shutdown, `/health` and `/ready` (Postgres only), JSON `slog`, panic recovery and request body limits.
- **Missing features:**
  - order cancel/void/complete (order status never moves past `confirmed`);
  - setup writes and login (Core only verifies tokens NestJS issues);
  - a guest ordering path: every order route uses `RequireStaff`, and `StaffMaySubmit` allows only `waiter_tablet` and `order_tablet` from an elevated tablet;
  - tips and receipts;
  - kitchen routing beyond the single station "kitchen";
  - dead-letter replay;
  - a realtime resume cursor;
  - metrics.
- **CORS** is a hard-coded list that includes `localhost:5173-5177` and the `verdura.co.nz` domains.
- **Tax:** NZ GST-inclusive only; any other profile fails closed.

## 8. Backlog

### 8.1 P0 (optimistic / expected / conservative hours)

| ID | Item | Hours |
|---|---|---|
| P0-01 | Owner decision package | 6/10/16 |
| P0-02 | CI green: fix the 2 lint errors; fix or retire the Venue Connector job; a Go job with Postgres and Redis; an optional parity job; protect `main`. CI uses PG16, but the Go database suites were validated only on PG18 | 3/6/10 |
| P0-03 | Production start and config fail closed: dist path; require explicit environment; remove dev routes; pin Node | 4/8/14 |
| P0-04 | Security must-fixes: named staff accounts in place of the shared PIN; token revocation; realtime fail-closed; socket auth; kitchen-role cancel; email escaping | 20/36/60 |
| P0-05 | Production database baseline: re-verify the live state; rehearse again; back up; resolve 1–25; deploy the 16; modifier and timezone checks | 4/8/14 |
| P0-06 | Staging, Core deployment (Windows service), Nest/Core routing, LAN TLS | 16/28/48 |
| P0-07 | Order Tablet (Staff Mode) on Core: sessions, orders, rounds, Core realtime | 40/70/120 |
| P0-08 | KDS on Core: tickets, realtime, surfaced failures, persisted outage cache (KIT-6) | 20/35/60 |
| P0-09 | Settlement surface (web cashier) plus a new Core external-card tender | 50/85/140 |
| P0-10 | Core order lifecycle: cancel/void with manager authorisation, completion, pending-payment resolution | 24/40/70 |
| P0-11 | Real venue and staff setup (staff CRUD and roles, venue and tax settings), or a governed onboarding script | 10/20/40 |
| P0-12 | Backups: offsite, 30 days, restore script, rehearsal, RPO/RTO | 8/14/24 |
| P0-13 | Monitoring and alerts: down, backup failure, dead letters, stuck orders | 12/20/36 |
| P0-14 | Receipt and day-close report (REC-1, RPT-2; needs O-5 and O-6) | 16/30/55 |
| P0-15 | End-to-end acceptance (PRD section 11, 10 tests) plus failure drills | 20/35/60 |
| P0-16 | Runbooks and rehearsal | 16/28/45 |
| P0-17 | Real-device, LAN and venue validation, dry run | 12/24/40 |
| P0-18 | Legacy decoupling: dispatcher flag, `posAdapterType=none`, coexistence rules | 6/12/20 |
| P0-19 | Kiosk off in production (or fixed) | 1/2/4 |
| | **P0 total** | **288/511/876** |

### 8.2 P1

| ID | Item | Hours |
|---|---|---|
| P1-01 | Tablet and KDS client defects: the tablet starts in Staff Mode while unelevated (`OrderTabletPage.tsx:359`); the close dialog shows a stale error (`:2214`); guests are rehydrated from notes with a fallback of 2 (`:667-675`); any 401 wipes enrollment (`orders.ts:232`); stale socket token; KDS failures are silent (`KitchenDisplayPage.tsx:427-477`); 4 MB CSS | 8/14/24 |
| P1-02 | Nest request IDs and structured logs; Core metrics | 8/14/24 |
| P1-03 | Core database timeouts, device-route rate limits, dead-letter replay | 8/14/24 |
| P1-04 | Hide or relabel the mock admin pages (PR-4) | 4/8/12 |
| P1-05 | Security review and penetration test | 12/20/36 |
| P1-06 | Performance and load smoke test | 6/10/18 |
| P1-07 | Data-driven station routing (only with more than one station) | 10/18/30 |
| | **P1 total** | **56/98/168** |

**P0 + P1:** 344 / 609 / 1,044 hours, which is 96% / 169% / 290% of 360 h.

**Earlier totals:** the first figure was 351/619/1,062. P0-02 was cut by 5/8/14 and P0-05 by 2/2/4, because the suites and migrations already had passing validation evidence.

**Guest Mode on Core** (24/40/70 h) is P2. Switching Guest Mode off for the pilot costs about 2 h.

## 9. December plan

The plan schedules **352 h of work** in a 364 h window total. 352 h is the expected P0 total (511 h) minus the four items carried into 2027 (P0-09, P0-14, P0-11 and P0-17, totalling 159 h).

| Window | Capacity (h) | Work |
|---|---|---|
| October | 120 | P0-01, -02, -03, -04, -19, -05, -06; resolve the 11 October go-live |
| November | 120 | P0-07, P0-08, start P0-10 |
| 1–15 December | 60 | finish P0-10; P0-18; P0-12; start P0-13. Feature freeze |
| 16–31 December | 64 | finish P0-13; P0-15 (ordering→kitchen); P0-16 |

## 10. Assumptions

- About 4 focused hours a day; one implementer.
- Scope B (section 2), including every waiver listed there.
- Integrated card terminal, Venue Edge printing and the cash drawer are deferred and not costed in the 609 h.
- Guest Mode is off at pilot; Guest Mode on Core is P2.
- The Windows POS is deferred; its detail stays PENDING USER POS ANALYSIS REPORT.
- Nest keeps serving login and administration at pilot (O-2).

## 11. Owner decisions needed (open at the audit date; current status in section 14)

| Decision | Latest date |
|---|---|
| The 11 October 2026 Sila Dunedin go-live (ADR 0001 and DL-115 leave it undecided) | IMMEDIATELY |
| Pilot definition: scope A or B | 16 Oct |
| Settlement surface: Windows POS or web cashier | 16 Oct |
| O-3 card: integrated terminal, or standalone EFTPOS recorded manually | 16 Oct |
| O-2 Nest at pilot | 16 Oct |
| O-1 native tablet at pilot (recommendation: no) | 16 Oct |
| O-4 printing, or a KDS-only pilot | 31 Oct |
| Staff venue scoping | 31 Oct |
| Fractional and negative modifier prices | 31 Oct |
| O-13 KDS device authentication | 31 Oct |
| O-5 receipts and NZ tax invoice; O-6 day-close report | 15 Nov |
| RPO/RTO, alert thresholds, defect-severity policy | 30 Nov |
| O-20 and O-21 | Before Guest Mode on Core (Q1 2027); 31 Oct if Guest Mode is needed at the pilot |
| POS analysis report | Only for scope A |

## 12. Deferred (basis for the January–April 2027 roadmap)

- **Scope A items:**
  - Windows POS: 180/260/450 h;
  - integrated card terminal plus acquirer certification: 80/140/260 h, plus calendar time;
  - Venue Edge printing and cash drawer: 40/70/120 h.
- **P2:**
  - Guest Mode on Core;
  - check split/transfer; table transfer;
  - X/Z reports; paid-in/out;
  - reservation transactions;
  - venue-scoped staff; real RLS;
  - retire the duplicate KDS; fix the kiosk properly;
  - window signage;
  - IdealPOS code retirement steps 2–10;
  - moving migrations to `database/`.
- **P3:**
  - native Android apps;
  - online ordering (O-18);
  - moving menu, staff and reservations into Core;
  - inventory (O-9);
  - CRM, loyalty, workforce;
  - analytics and AI;
  - SSO;
  - the landing page.

## 13. Change history

| Date | Change |
|---|---|
| 2026-10-02 | Audit run on `54dcfc0`. |
| 2026-10-02 | Evidence correction: integration and parity suites had passed on candidate A; documented production state is no longer presented as current. |
| 2026-10-02 | Arithmetic correction: 11 Core migrations (not 9); 257 h remaining (not 247). |
| 2026-10-03 | Materialised in the repository, unadopted. Evidence classes made explicit. GitHub state re-verified, unchanged (scope in section 3.4). KDS device realtime re-check found to fail open as well (section 4, item 3). December plan column relabelled as capacity; no number changed. |
| 2026-10-03 | Factual correction: the tablet realtime lookup also runs at admission ("admits or keeps"). Clarifications, no number changed: the basis for the 2027 finish dates; "no TLS" labelled as inference; the fail-closed HTTP guard noted for comparison. |
| 2026-10-03 | **Adopted** (owner gate B). Adoption notes added (section 14). No estimate, total or backlog row changed. |

## 14. Adoption notes (2026-10-03)

These notes record decisions made after the audit date. They change no estimate, total or backlog row.

| Section 11 item | Status at adoption |
|---|---|
| 11 October 2026 Sila Dunedin go-live | **Still open.** A decision record is drafted but not owner-approved. It is not treated as decided |
| Pilot definition: scope A or B | **Decided:** the reduced first pilot ([ADR 0002](../adr/0002-reduced-first-pilot.md), accepted; DL-118). It is neither scope as defined in section 2. See below |
| Settlement surface | **Decided:** the transitional web Order Tablet in Staff Mode (ADR 0002 item 8). No web cashier application |
| O-3 card | **Model decided:** an integrated, adapter-verified terminal is required for the first pilot (ADR 0002 item 2). **Provider and terminal selection (O-3) is still open** |
| O-2 Nest at pilot | **Decided:** transitional credential issuance under PR-7 (PRD section 14) |
| O-1 native tablet at pilot | Still open. Guest Mode is excluded from the first pilot (ADR 0002 item 4) |
| All other section 11 items | Still open |

**Effect on scope and planning figures** (INFERENCE; no estimate changed):
- **Different from Scope B.** The accepted pilot does not use the standalone EFTPOS tender that section 2's Scope B assumed. Integrated card is on the pilot path instead, costed in section 12 at 80/140/260 h plus certification calendar time.
- **P0-09 is unchanged as a figure.** Its description ("web cashier plus a new Core external-card tender") no longer matches the accepted scope. Settlement goes through the Order Tablet's Staff Mode, and no external tender is built. The figure stays unchanged until the backlog is re-estimated from the plan.
- **Kitchen printing is now conditional.** PRD section 11 requires kitchen printing only if the venue requires it. The Scope A estimate is unchanged and remains an upper bound.
- **The December conclusion is unaffected.** A staging release candidate does not include card, settlement or receipts in either scope.
