# D10 implementation note: closing a visit (TableSession)

Status: implemented 2026-09-29, tested against disposable databases only. **No schema change.** No client is switched. The results are in [README.md](README.md#phase-d10-result).

## CURRENT (audited 2026-09-29)

| Path | Behaviour before D10 | Risk |
|---|---|---|
| Close (`POST /table-sessions/{id}/close`, D2) | Locks the session `FOR UPDATE`, checks it is open at the version read, closes it, and writes `TABLE_SESSION_CLOSED`. **No financial check at all.** A retry after success is 409 `TABLE_SESSION_NOT_OPEN`. | A visit with unpaid checks, unbilled rounds or unresolved money could close. A lost response turned into an error. |
| Cancel (D2/D3) | Refused (`TABLE_SESSION_HAS_ORDERS`) once any order exists, under the same row lock. | Already correct: a real visit has orders, so cancel cannot bypass close. Kept, and regression-tested. |
| Order create (D3) | Holds the session `FOR SHARE` and requires it open, in its transaction. | Race A is already safe: close's `FOR UPDATE` and create's `FOR SHARE` serialize. |
| Round submit (D3) | Locks the **order** `FOR UPDATE`, **then** the session `FOR SHARE`, and requires it open. | Race B is correct but uses the **opposite lock order** to check creation (session → orders). With close holding the session exclusively, that cycle can deadlock. |
| Check create (D5) | By session: the session is held `FOR SHARE`, but **open is not required**. By order ids: **no session lock at all.** | **Race C is unsafe:** a check could be created on a closed visit, or during a close. |
| Payment result, refund, reversal, settlement, void (D6/D9) | Lock the check, then the payment, then the shift. Never the session. | They must stay possible after close (post-visit corrections), so close must not block them. Close must still see their committed outcome deterministically. |
| Completeness rule (D9) | `docs/migration/checks/visit-financially-complete.sql`, a documented invariant, tested. | Not enforced anywhere. |

## Decisions

| Concept | Decision |
|---|---|
| Visit | `TableSession` is the visit; no new entity. |
| **One close operation** | The existing D2 `POST /close` is strengthened. There is no second route. |
| Close rule | Close only when the visit is financially complete: the D9 rule. It is now **executed in Core** (`tables/pgstore.closeReadiness`), and the documentation SQL is kept identical and cross-checked by a test. Four counts, all 0: **open checks** (standing `open` checks; voided checks don't count, settled ones are complete), **unbilled lines** (round lines of non-cancelled orders on no standing check line, so a voided check's lines count as unbilled: no loophole), **unresolved payments** (pending or uncertain), **unresolved adjustments** (pending or uncertain refunds and reversals). Failed payments and failed adjustments don't count. Kitchen state and `Order.status` are **not** consulted. |
| Refusal | 409 `VISIT_NOT_FINANCIALLY_COMPLETE`, carrying the four counts. The client never asserts readiness. |
| Idempotency | State-based, with no request key: **close of a closed session → 200 with the session, unchanged**, whatever version was sent (no second transition, no second audit). The same holds for cancel of a cancelled session. Close of a cancelled session, or cancel of a closed one → 409 `TABLE_SESSION_NOT_OPEN`. A stale version on an open session → 409 `VERSION_CONFLICT`, never an overwrite. |
| **Lock discipline** (one global order) | **TableSession → Order → Check → CheckPayment → Shift.** Changed: a round now locks its session (`FOR SHARE`, open required) **before** its order. A check create locks the sessions of its orders (`FOR SHARE`, open required) before the orders, on both paths. Close takes the session `FOR UPDATE`, then the visit's checks `FOR SHARE` (in id order), then evaluates readiness, so a payment result, refund or void holding a check commits first and is seen. Nothing that holds a check ever waits for a session. |
| Races A–C | Anything that adds an obligation to a visit (order, round, check) holds the session `FOR SHARE`, and close holds it `FOR UPDATE`. Either the obligation commits first and close counts it (and refuses), or close commits first and the obligation sees `closed` and is refused. |
| Races D, E | Payment, refund and reversal work locks the check, and close waits for it (`FOR SHARE` on the checks). If money is returned first, the check is open and close refuses. If close commits first, a later refund may reopen the check and the session **stays closed**. |
| After close | Refused: new orders, rounds and checks for the visit (`TABLE_SESSION_NOT_OPEN`). Still allowed: reads, payment results, refunds, reversals, re-settlement and voids of existing checks. Post-visit financial correction never changes the session, because the session is not a live projection of money. |
| Occupancy | Closing releases the table. The partial unique index still allows one open session per table; the next open waits for an in-flight close and succeeds after it. |
| Audit | `TABLE_SESSION_CLOSED` (existing) now also records the readiness summary. Exactly one per close. Refusals are not audited. |
| Authorization | Unchanged (D2): staff only; owner, admin, manager or cashier. KDS, kitchen, viewer and customer tablets are refused. |
| Non-table orders | Unaffected: no session, no close. |
| Schema | **None.** State-based idempotency and the existing audit are enough. |
| Future event | `table_session.closed` is a candidate fact for the realtime phase; nothing is built now. |
