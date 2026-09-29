# D7 implementation note: shifts and cash

Status: implemented 2026-09-29, tested against disposable databases only. Not applied to production; no client is switched and no cashier UI is built. The results are in [README.md](README.md#phase-d7-result).

## CURRENT (audited 2026-09-29)

| Looked for | Found |
|---|---|
| Shift / till / drawer / cash-up / float models | **None** in `schema.prisma`. |
| Clock-in / timekeeping | **None**. |
| Cash terminology | Only `PaymentMethod.cash` on the unused legacy reservation `Payment`. |
| Close Table | Records no money. "Paid externally" means cash and cards are handled on the IdealPOS till today. |
| Terminals / drawers | `TabletDevice` (Order Tablet enrolment) only. There is no POS terminal or drawer identity. |
| Admin console | No shift or cash screens. The inventory page's "Shift" is a free-text note on stock counts, unrelated. |
| RBAC | `cashier` is a member of the financial role sets (payment observation, printer reprint). There is no cash-specific permission. |
| D6 | `TenderType` is `card` only. Card results come only from the payment adapter. |

**Ownership today: nonexistent.** Cash accountability lives on the external till. D7 adds the smallest canonical model; nothing legacy is ported.

## Decisions

| Concept | Decision | Why |
|---|---|---|
| Ownership | **Staff-owned shift, per venue.** The staff member who opens it is accountable for the cash taken under it. | The repository has no terminal or drawer identity, and D7 must not fabricate one. A cashier who takes cash accounts for it. A `terminalId`/`drawerId` column can be added (nullable, additive) in the devices phase. |
| Cardinality | **At most one open shift per (venue, staff)** (partial unique index). Several staff may have open shifts at one venue. | There is no "one open shift per venue" trap. Concurrent opens are refused by the index. |
| Shift | Venue, responsible staff, `open`/`closed`, currency, opening float, open request key, version, and at close: counted, expected and variance cents, who closed it, and when. | Close facts are stored, not recomputed, so they are immutable history. |
| Opening float | A column on the shift (≥ 0, integer cents), not a movement. | It is the starting balance of the account, not a change to it. |
| `CashMovement` | Kind `cash_sale` only, amount > 0, shift, the payment it records (unique), and the staff actor. | The only cash change D7 needs. **No paid-in/paid-out**: there is no requirement in the repository, and no client may post signed ledger entries. New kinds are additive. |
| Expected cash | `openingFloat + Σ cash_sale`, computed on the server (`shifts.ExpectedCash`). | Card payments never touch it, whatever their status. |
| Close | Lock and version-check the shift, compute expected under the lock, store counted, expected and variance (`counted − expected`). | Variance is never taken from a client. A CHECK constraint enforces `variance = counted − expected`. |
| Cash tender | `POST /checks/{checkId}/payments` with `tenderType: cash`. It is **succeeded at once**: staff accepting physical cash is the result, so there is no adapter involved. | The card path is unchanged: card starts `pending`, and only the adapter reports its result. Cash never uses the adapter route. |
| Transaction boundary | One transaction in `payments/pgstore`: lock the check, then the tendering staff's open shift (`shifts/pgstore.Ledger`, injected), then write the payment (succeeded), its history, the `CashMovement`, the settlement (if paid in full) and the audit. | Payments owns payment, balance and settlement (the D6 algorithm, reused). Shifts owns which shift is eligible and how a movement is recorded. Neither duplicates the other. |
| Change | Not modelled: tendered = applied. The amount must fit the check's available amount (D6 rule). | There is no requirement in the repository. |
| Close vs cash race | Tender holds the shift row `FOR UPDATE`; close takes the same lock. Either the tender commits first and the close counts it, or the close commits first and the tender's `status = 'open'` re-check refuses it. | Deterministic test with the lock held. |
| Authorization | Open own shift, and cash tender: owner, admin, manager, cashier. Close, read: the shift's owner, or manager, admin, owner for any shift at the venue. Refused: KDS, kitchen, viewer, customer tablets. | Least privilege, following the audited RBAC. |
| Audit | `AuditLog`: `SHIFT_OPENED`, `SHIFT_CLOSED`, `CASH_PAYMENT`. Cash payments keep the D6 `CheckPaymentTransition` history. | Every actor is staff. |
| Out of scope | Drawer hardware, terminals, refunds, X/Z reports, business day, payroll | Later phases. |

History payments (card) have no shift and need none. No shifts or movements are fabricated.
