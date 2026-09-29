# D11 implementation note: promotions (canonical discounts)

Status: implemented 2026-09-30, tested against disposable databases only. Additive migration `20261007000000_promotions`, **not applied to production**. No client is switched. The results are in [README.md](README.md#phase-d11-result).

## CURRENT (audited 2026-09-30)

| Where | What exists | Verdict |
|---|---|---|
| Prisma | No Promotion or Discount model. No discount column on `Order`, `OrderItem`, `Check` or `CheckLine`. `MediaAssetPurpose.promotion` is a media folder. | Nothing to migrate. Every historical order has no discount. |
| Nest `orders.service.ts` | Line = unit × qty, subtotal = Σ lines, `taxCents = round(subtotal × 3/23)`, total = subtotal. No discount step. `manager-step-up.guard.ts` reserves "discount" for a later story. | D1 already ports this. D11 adds a discount step after D1 pricing and before tax. |
| Admin Console `order-tablet/billing.ts` | `DiscountInput = none \| percent`, `round(subtotal × percent)` clamped to the subtotal, payable = subtotal − discount, contained GST = `round(payable × 3/23)`, largest-remainder split across seats. The page always passes `{kind:'none'}`: `VERDURA10` was removed as "client-side fiction" (E15-S3). | **Worth keeping:** percent-only, GST on the discounted payable, largest-remainder allocation. **Must disappear:** any client that computes the discount. It becomes a display of the server's result. |
| customer-website `Step5Payment.jsx` | Hard-coded `VERDURA10`: 10 % off (menu + 5 % service charge) in floating-point dollars. Never sent to a server. | Client fiction. Remove it when that client is cut over (not in D11). |
| Window Display / kiosk signage | `Promotion {title, badge, text, priority, start, end, enabled}` in localStorage, shown as slides. Includes a disabled text item "Happy Hour Mezze: half-price cold mezze, 4–6pm weekdays". | Signage content, not pricing. Out of scope (the architecture puts it under Window Display and media). |
| Reports / audit pages | "discount" and "promotion" filters and a "Happy Hour 10%" row, all mock data. | Evidence of intent only. |
| IdealPOS | `TriggerPromotions = false` on WebOrder. Non-item rows are ignored by the read model. No discount ids. | Nothing to import (frozen). |
| Requirements | DL-072 and ADR 0001: Servvia owns discounts, and client totals are estimates. E15-S3: "implement a real backend-validated promo/discount entity or remove the UI". Loyalty/CRM: deferred (`mvp.md`). No requirement exists for promo codes, stacking, vouchers, BOGO or fixed amounts. | Build the smallest server-owned promotion. |

## Decisions

| Concept | Decision |
|---|---|
| Promotion | A configured offer on **one venue** (`venueId` required). There are no organization-wide promotions: nothing requires them, and a missing venue never means "everywhere". |
| Types | **Percentage only** (`kind = percentage`, `basisPoints` 1..10000). This is the only type with repository evidence. **Deferred:** fixed amount, codes, stacking, BOGO, bundles, tiers, loyalty, vouchers and gift cards. The enum is the extension point. |
| Targets | `all_items`, `categories` (category ids) or `menu_items` (menu item ids), in typed columns, never executable JSON. The ids must belong to the venue's organization when saved. An id deleted later simply stops matching. |
| Lifecycle | `inactive` (the state at creation) and `active`, via explicit activate and deactivate. Nothing is ever deleted. Expiry by time does not rewrite the status. |
| Time | Optional `startsAt` / `endsAt`: UTC instants, half-open `[startsAt, endsAt)`, compared with the server clock. Recurring local-time windows ("4–6pm weekdays") are **deferred**: they need venue-local evaluation, DST rules and a requirement that does not exist yet. |
| Where it applies | Chosen by staff when an **order is created or a round is submitted** (`promotionId`, at most one per submission). The server decides validity, eligible lines, amount and tax. The client never sends an amount (a `discountCents` field is refused). |
| Money | D1 pricing owns the math: `pricing.ApplyPercentage` and `pricing.ComputeDiscountedTotals`. Discount = `round_half_up(eligible × bp / 10000)` on the submission's eligible subtotal, then allocated to the eligible lines by largest remainder (ties go to the earlier line). Integers only, with checked arithmetic. A line is never discounted below zero, and a promotion that would bring a submission's total to 0 is refused, because D6 cannot settle a zero check. |
| GST | Discounts reduce the consideration: GST is the contained 3/23 of the **discounted** total. This is the rule in `billing.ts` and in NZ GST. |
| Snapshot | `AppliedPromotion` (one per round at most): promotion id, version, name, kind, basis points, eligible subtotal and discount. `OrderItem.discountCents` + `appliedPromotionId`, and `Order.discountCents`. A check copies each line's `discountCents` into `CheckLine`, and `Check.discountCents` is their sum. Nothing reads the live Promotion after acceptance. |
| Totals | `subtotalCents` = gross (unchanged meaning), `discountCents` = Σ line discounts, `totalCents` = subtotal − discount, `taxCents` = GST contained in the total. Every existing row has discount 0, so for it total = subtotal, as before. |
| Concurrency | The order transaction locks the Promotion `FOR SHARE` and requires the **same version**, still active and in its window. Otherwise it answers 409 `PROMOTION_CHANGED` and the client may retry. Admin writes are version CAS (`VERSION_CONFLICT`). Lock order: TableSession → Order → Promotion. |
| Idempotency | `promotionId` is part of the order and round fingerprints. A replay is decided before pricing and returns the stored snapshot: no second evaluation and no second discount. |
| Check / refund | A check never evaluates promotions. A refund never reprices. |
| Admin API | `contracts/openapi/promotions.yaml`. Writes (create, update, activate, deactivate) need owner, admin or manager from a staff login session. Reads need owner, admin, manager or cashier. KDS and customer tablets are refused. |
| Audit | `PROMOTION_CREATED`, `PROMOTION_UPDATED`, `PROMOTION_ACTIVATED`, `PROMOTION_DISABLED`: one per change, none on a replay or no-op. |
| Check-time manual discounts | **Deferred.** The architecture lists "Discount" under Check, and Nest reserves manager step-up for it. That is a comp or authorization feature, not a promotion. |
| Events | Candidate facts `promotion.created`, `promotion.updated`, `promotion.activated`, `promotion.disabled`. **Not built:** D12 and D13 own delivery. |
