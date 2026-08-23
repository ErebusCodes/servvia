# Verdura — Offline Strategy

> **Normative outage decision — 2026-08-15:** Offline behaviour must preserve the [Target Operating Model](./target-operating-model.md). Connector durable acceptance is the boundary before normal KDS/KOT release. If that boundary cannot be reached, the order is blocked unless an explicitly authorized emergency mode is active. Uncertain Idealpos outcomes must be reconciled before retry; paid online orders are never charged again; every POS, KDS and KOT destination retains an independent replay-safe state.

> **Readiness correction — 2026-08-15:** This document is principally a target design. The required on-premises durable connector queue and proven replay path do not exist in the current repository. Database `queued` rows are not equivalent to BullMQ delivery, and BullMQ is not a venue-local durable queue. No production claim may be made for offline POS handoff or printing until restart/outage/reconnect tests pass without loss, reordering or duplication.

**Recommendation:** assign one idempotency key per business command/version, persist the edge queue locally before acknowledgement, preserve sequence per order, expose queue depth and oldest age, require explicit emergency-override authority, and reconcile every uncertain outcome after connectivity returns.

**Phase 7 Output**
**Date:** 2026-06-18

> This document defines behaviour during four distinct outage types and the recovery workflow for each. "Offline" is relative to the component experiencing the outage — not all components need internet simultaneously.

---

## Outage Taxonomy

| ID | Outage Type | Affected path | Detection |
|----|-------------|---------------|-----------|
| O1 | Internet outage (restaurant LAN loses internet) | API unreachable from kiosks, KDS, on-premise services | TCP connect failure to api.verdura.co.nz |
| O2 | Cloud / API outage (API service down, DB unavailable) | All clients lose connectivity even with internet | HTTP 5xx or TCP timeout from API |
| O3 | POS outage (IdealPOS offline or unresponsive) | POS sync fails; printers unaffected | POSSyncRecord.status = failed after retries |
| O4 | Printer outage (one or more printers offline) | Print jobs fail; orders still saved to API | PrinterJob.status = failed after retries |

---

## O1 — Internet Outage

**Duration assumption:** Minutes to hours. Restaurant staff continue operating.

### Self-Ordering Kiosk

Offline queueing is strictly restricted to comply with PCI-DSS requirements. Raw card data or card tokens must never be stored locally.

#### Outage Scenario 1: Complete Offline (Before Payment)
If the network is down and Stripe terminal connectivity is unavailable:
1. Card checkout is disabled on the kiosk UI.
2. A prominent banner displays: "Card payments temporarily offline. Please select Pay at Counter."
3. The customer proceeds through the cart to Table Selection, checks out with the "Pay at Counter" selection, and the order details are stored in IndexedDB.
4. The kiosk displays: "Order registered. Please pay at the front counter."

#### Outage Scenario 2: API Unreachable After Payment Success
If the integrated Stripe Terminal successfully processes the card transaction, but the subsequent API call to `POST /api/kiosk/orders` fails (e.g. timeout or network blip):
1. The kiosk writes the completed order details along with the Stripe transaction identifier, transaction metadata, and payment timestamp to the IndexedDB local queue.
2. The kiosk displays: "Payment successful. Order confirmed — sending to kitchen."
3. A background process automatically retries submission to `POST /api/kiosk/orders` as soon as the API becomes reachable.

**IndexedDB schema (kiosk local queue):**
```typescript
interface LocalOrder {
  localId:             string;    // Client-generated UUID
  venueId:             string;
  tableNumber:         string;
  items:               LocalOrderItem[];
  totalCents:          number;
  paymentMethod:       'card' | 'counter';
  paymentStatus:       'paid' | 'pending';
  transactionId?:      string;    // Stripe transaction ID (if paid)
  paymentMetadata?:    any;       // Stripe response metadata
  paymentTimestamp?:   string;
  submittedAt:         string;    // ISO timestamp
  synced:              boolean;
}
```

**Recovery:** When internet restores, a background sync process drains the IndexedDB queue in order:
1. POST each local order to `POST /api/kiosk/orders` (which verifies payment metadata prior to creation if paymentStatus is 'paid')
2. On success: mark `synced: true`
3. On failure: retry with exponential backoff (3 attempts), then surface error to staff for manual intervention

**Ordering:** Queued orders retain their original `submittedAt` timestamps so kitchen tickets print in correct sequence even if batched after reconnection.

**Edge case — kiosk rebooted while offline:** IndexedDB survives browser reboot on the same device. Orders persist across restarts and sync when internet returns.

### Menu Display Kiosk

Service Worker caches the last-fetched menu response.

```typescript
// Service Worker strategy: StaleWhileRevalidate for menu endpoints
// Cache-first for static assets (images, CSS, JS bundle)
```

During outage: serves stale menu data transparently. Customers see the last known menu — no error state visible. A small indicator shows "Last updated: X minutes ago" if staleness > 10 minutes.

### KDS (Kitchen Display System)

The KDS maintains an in-memory copy of all active orders received via WebSocket. During an internet outage:
- No new orders arrive (orders are queued at the kiosk)
- Existing orders on-screen remain visible and interactive
- Staff can still update order status (pending → preparing → ready) — status changes are queued in memory
- On reconnection: WebSocket reconnects, queued status updates are flushed to API, new orders from the kiosk sync queue appear

### Admin Dashboard

Read-only cached view of today's reservations and active orders (last fetched before outage). Editing is disabled with a banner: "Connection lost — changes will resume when internet is restored." No local writes.

### Printer Service (on-premise)

The Printer Service is on the restaurant LAN and connects outbound to the Verdura connector command/event API — never to shared cloud Redis (target-operating-model.md §8). During internet outage:
- Cannot reach the connector API — switches to local durable queue mode
- New orders arriving from kiosk local queue (once internet restores) trigger print jobs that are also queued locally first
- Physical printers are on LAN — printing continues uninterrupted once jobs are in the local queue

### IdealPOS Agent (on-premise)

Cannot reach the connector command/event API. Switches to polling its local durable queue for pending sync jobs. If IdealPOS is on LAN, sync attempts can continue locally even without internet — but results cannot be reported back to Verdura until internet restores. Result is stored locally and flushed on reconnection.

---

## O2 — Cloud / API Outage

**Duration assumption:** Minutes (deployment, crash) to hours (infrastructure incident).
Distinct from O1 — the restaurant has internet, but the API is down.

### All Clients

Identical offline behaviour to O1 for kiosk and KDS — they cannot distinguish "no internet" from "API down". Same IndexedDB queue, same Service Worker cache.

### Printer Service

Cannot reach the connector command/event API. Falls back to its local durable queue. **This is the critical case:** new orders are queued at the kiosk (IndexedDB) and cannot yet be submitted to the API, so no print jobs are created. Staff notice nothing is printing.

**Staff escalation procedure (documented in Admin Dashboard help section):**
1. Staff can take orders manually (pen and paper or via IdealPOS directly)
2. When API restores, kiosk drains its queue → API creates orders → print jobs are dispatched
3. Kitchen receives a burst of queued tickets — kitchen staff are trained to check `submittedAt` timestamp on each ticket

### Recovery Sequence

```
API restores
    │
    ├── WebSocket clients (KDS, admin) reconnect automatically (Socket.io reconnection)
    │
    ├── Kiosk syncs IndexedDB queue → POST orders → API creates PrinterJobs
    │
    ├── Printer Service receives queued commands over the connector API → dispatches to printers
    │
    └── IdealPOS Agent receives queued commands over the connector API → syncs orders to POS
```

Target recovery time from API restore to first kitchen ticket: < 30 seconds.

---

## O3 — POS Outage (IdealPOS offline)

Normal new-order acceptance stops if the connector cannot durably accept the POS command. If the connector already accepted a command and Idealpos then becomes unavailable, the command remains durable locally and the order becomes an explicit POS exception. Kitchen release follows the venue's approved policy; the default pilot policy permits it only after connector acceptance.

### During Outage

```
Order submitted
    │
    ├──► Connector unavailable before acceptance: BLOCK + staff recovery
    │
    └──► Connector accepted, Idealpos unavailable
             ├── durable local command retained
             ├── POS state = UNCERTAIN or FAILED
             ├── KDS/KOT follow approved post-acceptance policy
             └── reconcile before retry
```

The UI must never claim that Idealpos recorded the transaction until confirmation and a stable reference exist. A paid online order is not charged again; it is escalated for urgent POS reconciliation.

### Staff Procedure During POS Outage

1. Admin Dashboard shows "POS Sync Alert — N orders failed to sync"
2. Staff search Idealpos and connector history using the Verdura correlation/idempotency key before manually entering or retrying anything.
3. In-person payment proceeds only against one confirmed Idealpos transaction; paid-online orders are mapped to `PREPAID / ONLINE` and never charged again.
4. When Idealpos returns, staff resolve uncertain outcomes before using a scoped retry/reconcile action.

### Recovery

```
IdealPOS restored
    │
    ├── IdealPOS Agent health check passes
    ├── Admin manually triggers "Retry Failed Syncs" from dashboard
    │   OR automatic retry fires on next BullMQ scheduler tick (every 5 min)
    └── POSSyncRecord.status → 'pos_confirmed' only after reconciliation and a stable Idealpos reference
```

**Automatic retry schedule:** A BullMQ repeatable job runs every 5 minutes and re-enqueues any `POSSyncRecord` with `status: 'failed'` and `attemptCount < maxAttempts`. This covers the case where the agent was not running during the original retry window.

---

## O4 — Printer Outage

One or more printers offline. API and internet are healthy.

### During Outage

```
Order submitted
    │
    ├──► PrinterJob created for Kitchen printer → dispatched → FAILS
    │    Retried 3× with 3s fixed delay
    │    After 3 failures: PrinterJob.status = 'failed'
    │    Admin Dashboard alert: "Kitchen Printer offline — 1 order ticket not printed"
    │
    └──► Other printers unaffected (per-printer queues are independent)
```

Order is saved. POS sync proceeds. Only the specific printer's ticket is lost.

### Recovery

When the printer comes back online (detected by Printer Service health monitor within 30 seconds):
1. `Printer.isOnline` updated to `true`
2. Admin Dashboard shows printer as healthy
3. Failed jobs can be reprinted via "Reprint" button per order in Admin Dashboard
4. Automatic reprint is NOT triggered (avoids unexpected ticket bursts — staff manually decide what to reprint)

### Critical Path: Kitchen Printer

If the Kitchen printer goes offline, kitchen staff are not receiving tickets. Escalation:
- Admin Dashboard sends an alert email to the configured alert recipient
- KDS compensates: kitchen staff read orders from the KDS screen directly
- This is why KDS is a required feature, not optional — it is the fallback for printer failure

### Critical Path: POS Printer

If the POS printer goes offline, cashier does not receive tickets. Cashier uses IdealPOS UI directly to view orders that have been synced. If both POS printer and IdealPOS sync are failing simultaneously, manual order tracking is required.

---

## Outage Recovery Summary Matrix

| Outage | Orders saved? | Kitchen notified? | POS notified? | Auto-recovery? | Manual action needed? |
|--------|--------------|-------------------|--------------|----------------|-----------------------|
| O1 Internet | Yes (post-payment or counter fallback) | Queued (on restore) | Queued | Yes (on reconnect) | Reconcile counter payments; staff process manual cards if reader offline |
| O2 API down | Yes (post-payment or counter fallback) | Queued (on restore) | Queued | Yes (on reconnect) | Reconcile counter payments; staff process manual cards if reader offline |
| O3 POS offline | Yes | Yes ✅ | Yes ✅ | Yes (retry every 5min) | Dashboard retry if needed |
| O4 Kitchen printer | Yes | No ⚠️ → use KDS | Yes ✅ | No | Staff reprint from dashboard |
| O4 POS printer | Yes | Yes ✅ | No ⚠️ → use IdealPOS UI | No | Staff reprint from dashboard |

---

## Resilience Design Principles

1. **Restricted order capture.** Kiosk order capture is supported offline only via Pay-at-Counter fallback or post-payment sync retries. Under no circumstances are card details or tokens queued locally.
2. **Kitchen and POS printing are independent queues.** One printer failing does not delay the other.
3. **KDS is the fallback for kitchen printer failure.** The real-time order view allows kitchen operations to continue without any printed ticket.
4. **POS sync failure never affects the customer experience.** Payment is captured at kiosk or counter beforehand.
5. **No silent failures.** Every failed print job, failed sync, and offline printer surfaces a visible alert in the Admin Dashboard and optionally an email. Staff are never surprised.
6. **Recovery is automatic where possible.** Reconnection triggers drains. Retry schedules cover extended outages. Manual intervention (reprint button) exists for cases where automatic is wrong.
