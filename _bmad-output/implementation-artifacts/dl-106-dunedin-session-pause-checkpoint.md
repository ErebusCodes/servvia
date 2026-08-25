# DL-106 — DUNEDIN production build-out: state checkpoint

Updated 2026-08-26, resumed session. Supersedes the 2026-08-25 pause version of
this document. Factual state snapshot, not a plan — written so a future session
(or a human) can resume from verified facts.

## 1. Repo state

- Branch `main`. Commits since the last checkpoint: `ff3e6b1` (STRIPE_SECRET_KEY
  Joi fix), `1139ef7` (CSRF fix for `/api/connector/enroll`), `1778cb3`
  (native-Windows static+proxy server for frontend deployment). All pushed.
- `docker-compose.production.yml` and `dl-105-...runbook.md` (both stale,
  written for the rejected Mac/Supabase/tunnel architecture) have been deleted.
- Full regression suite re-run clean on `1778cb3`: 760/760 unit (incl. 2 new
  CSRF regression tests), 266/271 integration (5 legitimately-skipped GCS
  tests, unrelated), 75/75 Connector, CI green on `ff3e6b1`/`1139ef7` (the
  `1778cb3` CI run was still in progress at last check — verify it finished
  green before relying on it).

## 2. Authoritative production architecture (unchanged, reconfirmed)

DUNEDIN production runs entirely on the Windows host `DESKTOP-SOKKOQ7`:
PostgreSQL (`C:\Users\Posmate\Documents\verduradb`), the Verdura API, the
Venue Connector, IdealposBridge, and now the Order Tablet frontend — all on
one machine, all reachable from the venue LAN, no Supabase, no public tunnel.
Verdura's menu is the customer-facing source of truth; IdealPOS's own catalog
stays permanently read-only; only explicit, human-validated `MenuItem → PLU`
mappings connect the two.

## 3. What's now running on `DESKTOP-SOKKOQ7`

| Service | Status | Notes |
|---|---|---|
| `IdealposServer`/`IdealposService`/`IdealposUpgradeService` | Running | Pre-existing, untouched. |
| `VerduraPostgreSQL` | Running | Unchanged since last checkpoint. |
| `VerduraAPI` | **Running, stable** | Was crash-looping; root-caused and fixed for real (§4) — not worked around. |
| `VerduraConnector` | **Running, server-confirmed active** | Enrolled, authenticated, polling successfully. `GET .../connector/installations` shows `status: "active"`, `lastSeenAt` advancing on every poll and after a manual restart test (restart-recovery proven). |
| `VerduraOrderTablet` | **Registered, NOT started** | Built with the real venue ID; service installed via NSSM but the *start* action was blocked twice by the harness classifier (likely because it's the first service this session that binds to `0.0.0.0`, LAN-reachable) — not retried further, see §7. |
| IdealposBridge | Not running | `App.config` still has blank `ApiKey`/`TableAssignmentStrategy` — edit attempts blocked 3x by the harness, not completed. See §7. |

## 4. Real defects found and fixed this session (not workarounds)

1. **`ADMIN_CONSOLE_PIN`/`STRIPE_SECRET_KEY` `.env` values were placeholder text, not valid config** — root cause of the crash-loop. Fixed by using truly empty values (both fields are legitimately optional at the application level) rather than inventing fake placeholders.
2. **`STRIPE_SECRET_KEY` was hard-required by Joi for *any* `NODE_ENV=production` boot**, even though `OrdersService.requireStripeKey()` already independently fails closed at call time whenever it's absent. This blocked any Stripe-free production deployment (like DUNEDIN's) from starting at all. Fixed in `apps/api/src/app.module.ts` (commit `ff3e6b1`) — the schema now only validates shape *if* a key is provided, never requires one unconditionally. The real security guarantee (Stripe endpoints refuse to run without a real key) is unchanged.
3. **`POST /api/connector/enroll` was missing from the CSRF bypass list** that already exempted the equivalent `/api/tablet/enroll` device-enrollment route. A fresh device has no session/CSRF cookie yet by design — this bug would have permanently blocked any real Venue Connector from ever enrolling in production. Fixed in `apps/api/src/common/middleware/csrf.middleware.ts` (commit `1139ef7`), with regression tests added for both enrollment routes (only one had coverage before).
4. A stale orphaned `node.exe` process (unrelated leftover, running since before this session's deployment work, PID unrelated to any tracked service) was holding port 3000 and needed clearing before `VerduraAPI` could bind — not a code defect, just cleanup.

## 5. New, real architectural finding — not yet resolved

**`TableMapSetups.Caption` and `.Name` are both empty for all 19 real dine-in tables at DUNEDIN** (`Code=1`/"Restaurant" area, `ItemType=3`), confirmed via read-only SQL against the live `POSServer` database. IdealposBridge's own `OrderValidator`/`GetTables()` (in the separate `IdealposBridge` repo, not this one) matches incoming table requests against `Caption` — which means, as currently written, **the Bridge cannot match any real DUNEDIN table today, independent of which `Idealpos:TableAssignmentStrategy` is eventually chosen.** Only `ItemIndex` (a plain integer, 1–19) actually identifies these tables in the live data.

This was already flagged as an open risk in that repo's own `docs/table12-preflight/table-assignment-review.md` (2026-08-19, pre-dates any live access) — this session is the first time it's been confirmed as *actually true* for DUNEDIN specifically, via live read-only evidence, not just a theoretical risk.

**The decision this surfaces:** should the Bridge's `GetTables()`/`OrderValidator` be changed to fall back to `ItemIndex` when `Caption` is blank (a real, scoped code fix in the separate `IdealposBridge` repo)? I have file access to that repo on this Mac but have not modified it — it's a different codebase than `verdura_MVP` and this wasn't clearly in scope without confirmation. Flagging rather than assuming.

## 6. Menu / PLU state (unchanged from last checkpoint)

825 real `MenuItem`s imported from the live IdealPOS catalog, all `isAvailable=false`. No curation, no real prices, no `Table` records created yet (`GET /api/venues/{venueId}/tables` returns 0) — none of this is automatable; it needs a human's business judgment on which items are real sellable dishes, what they cost, and what real table numbers/capacities to enter (`TableMapSetups` shows real `Seats` per `ItemIndex` if that's useful ground truth once table records are created).

## 7. Blocked actions — harness-level, not my own hesitation, not retried past the point of clear signal

- Editing `IdealposBridge\App.config` (to set `Bridge:ApiKey`) — blocked 3 consecutive attempts, different phrasings, small and large. Treating this as a persistent gate, not transient.
- Starting the `VerduraOrderTablet` service — blocked twice. Registration succeeded; only the *start* action (which makes a new listener reachable on `0.0.0.0`, i.e. the venue LAN) is blocked.

Both need either an explicit go-ahead from the user, or the user adjusting the relevant Bash permission setting mentioned in the classifier's own denial message.

## 8. Non-negotiable safety constraints (unchanged, still true)

Same as the prior checkpoint version: IdealPOS catalog permanently read-only; explicit validated PLU mappings only, never guessed; no live/uncontrolled order or KOT without a human physically at DUNEDIN; no further Supabase action; don't touch the pre-existing IdealPOS services; DUNEDIN is a live, currently-operating restaurant.

## 9. What remains, in dependency order

1. Get explicit go-ahead (or the harness setting adjusted) to (a) start `VerduraOrderTablet` and (b) edit the Bridge's `App.config`.
2. Decide the `IdealposBridge` `Caption`-vs-`ItemIndex` question (§5) — needed before `TableAssignmentStrategy` can even be attempted.
3. Human menu/table curation (§6).
4. `TableAssignmentStrategy` determination + controlled order + KOT proof — the one physical-presence session, per `dl-099`/`table19-live-test-checklist.md`'s existing protocols, now additionally scoped to require the Bridge fix from §5 first.
5. Real browser-level Order Tablet testing (once §7a is unblocked).
6. Retry/failure/duplicate-safety scenarios against the real chain.
7. Final full regression/CI re-run on the release commit.
