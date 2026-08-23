# Verdura — Printer Architecture

> **Normative routing decision — 2026-08-15:** Printing implements the [Target Operating Model](./target-operating-model.md). Verdura owns station-level KDS/KOT routing for Verdura-originated orders after durable connector acceptance. Idealpos must not print duplicate kitchen tickets for imported Verdura orders. Idealpos-originated orders may retain existing Idealpos printing. `Printed` requires device-path acknowledgement and is independent from POS submission, payment and KDS delivery.

> **Implementation status — 2026-08-15:** This is a target architecture and remains blocked on real hardware. The current backend creates `PrinterJob` database rows but does not enqueue print jobs to BullMQ. Its registered worker runs in the cloud process, attempts direct TCP access to venue printers, and logs mock success for unsupported connection types. The separate `verdura-printer-service`, ESC/POS byte generation, local SQLite queue, health API and durable retry path described below are not implemented.

**Recommendation:** move printer execution to the outbound-only venue edge connector, deliver scoped commands over the connector API, persist locally before cloud acknowledgement, distinguish `Delivered` from `Printed`, verify the actual printer model/protocol, and run power-loss, paper-out, duplicate and reconnect tests on venue hardware.

**Phase 6 Output**
**Date:** 2026-06-18
**BLOCKED ON: Q2 — Printer hardware and protocol unconfirmed. All specifics below marked accordingly.**

---

## 1 — Printer Roles

| Printer | Purpose | Who reads it | Priority |
|---------|---------|-------------|----------|
| Kitchen | Order tickets for cooking staff | Kitchen | CRITICAL — must never be missed |
| POS | Customer-facing receipt / order record for cashier | Cashier / IdealPOS area | CRITICAL |
| Bar | Drinks orders for bar staff | Bar | HIGH |
| Dessert | Dessert orders routed separately | Kitchen (dessert section) | MEDIUM |

Every order submitted via the Self-Ordering Kiosk dispatches a print job to the Kitchen printer and the POS printer. Bar and Dessert printers receive jobs only for items in their respective categories (configured per `MenuItem.category`). Category-to-printer mapping is configurable per venue from the Admin Dashboard.

---

## 2 — Printer Connection Types

`BLOCKED ON: Q2` — the following three connection types are all supported by the Printer Service. The active type is configured per printer in the database.

### 2.1 — Network / TCP (default assumption)
Most modern thermal receipt printers are network-accessible via TCP on port 9100 (ESC/POS raw mode).

```
Printer Service ──TCP:9100──► Network Printer (IP: 192.168.1.x)
```

Config keys: `host` (IP or hostname), `port` (default: 9100)

### 2.2 — USB (local to gateway PC)
Printer connected directly to the gateway PC via USB. Accessed via device path.

```
Printer Service ──USB──► /dev/usb/lp0  (Linux)
                      or  \\.\USB001    (Windows)  — VERIFY AGAINST VENDOR DOCS
```

Config keys: `devicePath`

### 2.3 — Windows Shared Printer
Printer shared via Windows Print Spooler on a machine on the LAN.

```
Printer Service ──SMB/WinAPI──► \\SERVER\KitchenPrinter  — VERIFY AGAINST VENDOR DOCS
```

Config keys: `sharePath`
Constraint: Printer Service must run on Windows if this type is used.

---

## 3 — Print Protocol

### ESC/POS (default)
The de-facto standard for thermal receipt printers. Binary command sequences control formatting, line feeds, bold, cut, and cash drawer.

**Node.js library:** `escpos` + `escpos-network` / `escpos-usb`
`VERIFY AGAINST VENDOR DOCS` — confirm printer model supports ESC/POS before finalising.

### Raw Text
For printers that accept plain text over TCP without ESC/POS interpretation. Fallback when ESC/POS is unavailable.

### PDF (future)
For laser or inkjet printers requiring a rendered document. Not in MVP scope.

---

## 4 — Print Payload Format

The Verdura API generates a versioned logical ticket and station routing when creating the transactional outbox. The venue connector durably receives it, renders the validated device-specific payload and dispatches it. This keeps business content centrally auditable while allowing hardware-specific rendering to remain at the edge.

```typescript
interface PrintPayload {
  format:     'escpos' | 'raw_text';
  encoding:   'base64';              // ESC/POS bytes encoded as base64 string
  content:    string;                // The base64-encoded print data
  paperWidthMm: number;              // Used to validate payload fits the printer
}
```

**Order ticket content (kitchen / POS):**
```
================================
  VERDURA — TABLE T3
  Order #VK-00142
  18 Jun 2026  7:43 PM
================================
1x  Ali Nazik
    [Choice of: Koobideh]
1x  Chicken Shish
    [On Plate]
    Note: No onion please
2x  Fries
--------------------------------
  TOTAL: $67.00
================================
         *** CUT ***
```

The API generates the logical, immutable ticket content. The edge renderer converts it to the confirmed printer protocol so device/firmware differences can be handled without changing the commercial order snapshot.

---

## 5 — Print Queue Architecture

```
Verdura transactional outbox
    │ one command per preparation station and order version
    ▼
Outbound-only venue connector session
    │ connector persists locally before acknowledgement
    ▼
Encrypted local durable queue
    ├── serial stream for Kitchen Station A ──► Kitchen Printer
    ├── serial stream for Bar Station ───────► Bar Printer
    └── serial stream for Dessert Station ──► Dessert Printer

Different printers may run concurrently. Jobs for one printer are ordered and
processed serially. Re-delivery of the same job ID returns the stored outcome
and never prints a second ticket unless a staff-authorized reprint creates a
new, audited reprint command.
```

**Command scope:** organization, venue, connector installation, printer, order, order version and job ID are mandatory and server-authorized. The edge service receives no shared Redis credential.

---

## 6 — Retry Logic

```typescript
const printJobOptions: JobsOptions = {
  attempts:   3,
  backoff: {
    type:   'fixed',
    delay:  3000,     // 3 seconds between retries for printers
                      // (fixed, not exponential — printer issues are usually transient hardware blips)
  },
  removeOnComplete: { age: 60 * 60 * 24 },      // 24 hours
  removeOnFail:     { age: 60 * 60 * 24 * 30 }, // 30 days (for audit)
};
```

**Retry rationale — fixed vs exponential:** Printer failures are typically brief (paper jam cleared, printer waking from sleep, TCP timeout). A 3-second fixed delay with 3 attempts covers most transient failures within 9 seconds. Exponential backoff is appropriate for rate-limited APIs (IdealPOS) but adds unnecessary delay for local hardware.

**After max retries:**
1. `PrinterJob.status` → `'failed'`
2. `PrinterJob.errorMessage` set with last error
3. API updates `Printer.isOnline = false`
4. Admin Dashboard displays alert with printer name and order ID
5. Manual reprint available from dashboard

---

## 7 — Offline Queue

When the Printer Service cannot reach the outbound-only venue connector session (internet outage) or cannot connect to the printer (printer offline), it uses a local SQLite database as a durable offline queue. The Printer Service never holds a shared cloud Redis credential (target-operating-model.md §8) — cloud-side, BullMQ may back the outbox dispatcher that feeds the connector API, but the edge process only ever speaks the scoped connector command/event protocol.

```
Internet up, printer up:    Connector command API ──► Printer Service ──► Printer
Internet down:              Printer Service saves to local SQLite ──► Printer (direct)
Printer down:               Printer Service saves to local SQLite
Both restored:              Printer Service drains SQLite ──► Printer, reports over connector API
```

**Local queue implementation:**
```typescript
// verdura-printer-service/src/local-queue.ts
// SQLite via better-sqlite3 (synchronous, no external process dependency)

interface LocalPrintJob {
  id:          string;   // Same as PrinterJob.id from API
  printerId:   string;
  orderId:     string | null;
  payload:     string;   // base64
  format:      string;
  queuedAt:    string;   // ISO timestamp
  attemptCount: number;
  lastError:   string | null;
}
```

The local queue is drained in FIFO order when the printer comes back online. Each drained job is also reported back to the Verdura API so `PrinterJob.status` is updated.

**Ordering guarantee:** Kitchen and POS tickets are dispatched in order-submission order. Out-of-order printing (e.g. an older order printing after a newer one due to retry timing) is logged but not treated as an error — kitchen staff use the order timestamp on the ticket to sequence correctly.

---

## 8 — Printer Monitoring

The Printer Service actively monitors printer connectivity on a configurable interval (default: 30 seconds).

```typescript
async function checkPrinterHealth(printer: PrinterConfig): Promise<boolean> {
  try {
    // For TCP printers: attempt a TCP connection
    await tcpConnect(printer.host, printer.port, timeout: 2000);

    // Send a status request if the printer supports it
    // VERIFY AGAINST VENDOR DOCS — not all ESC/POS printers support DLE EOT status
    await sendStatusRequest(printer);

    return true;
  } catch {
    return false;
  }
}
```

Health status is reported to the Verdura API every poll cycle:
```
PATCH /api/internal/printers/:id/health
{ isOnline: boolean, lastSeenAt: string }
```

The Admin Dashboard displays printer status as a live indicator (green / red) with last-seen timestamp.

**Alert thresholds:**
- Printer offline > 2 minutes → Admin Dashboard warning
- Printer offline > 10 minutes → marked critical, email alert to configured recipient

---

## 9 — Audit Logs

Every print job is persisted as a `PrinterJob` record (PostgreSQL) — this is the audit log for printing.

Fields captured per job: `id`, `printerId`, `orderId`, `venueId`, `status`, `payload` (base64), `payloadFormat`, `attemptCount`, `maxAttempts`, `queuedAt`, `lastAttemptAt`, `printedAt`, `failedAt`, `errorMessage`.

**Retention:** PrinterJob records retained 30 days in PostgreSQL. Configurable.

**Admin Dashboard — Printer Log view:**
```
GET /api/admin/printers/:id/jobs?status=failed&limit=50
GET /api/admin/orders/:id/print-jobs
POST /api/admin/printers/:id/jobs/:jobId/reprint
POST /api/admin/printers/:id/test-print
```

---

## 10 — Test Print

A test print can be triggered from the Admin Dashboard for any printer. It sends a fixed-format test ticket:

```
================================
  VERDURA PRINTER TEST
  Printer: Kitchen Printer
  Venue: Verdura Auckland
  18 Jun 2026  7:43 PM
================================
  If you can read this, the
  printer is working correctly.
================================
         *** CUT ***
```

Test prints are logged as `PrinterJob` records with `orderId: null`.

---

## 11 — Category-to-Printer Routing

Configured per venue from Admin Dashboard. Example:

| Category | Printer |
|----------|---------|
| The Feast → Char-Grill | Kitchen |
| The Feast → Pizza / Kitchen | Kitchen |
| The Feast → Mains | Kitchen |
| Drinks | Bar |
| Temptations (starters) | Kitchen |
| Sides | Kitchen |
| All orders | POS (always receives full ticket) |

Stored as versioned `PreparationStation` and `ItemPreparationRoute` configuration. The effective routing version is captured on each order line. Missing or ambiguous routing blocks submission rather than silently sending a ticket to an arbitrary printer; an explicitly configured venue fallback station is permitted.

---

## 12 — Phase 0 Constraints

`BLOCKED ON: Q2` — the following specifics cannot be finalised without hardware confirmation:
- ESC/POS vs raw text vs PDF protocol per printer
- TCP port (9100 assumed but may differ)
- USB device path format (Linux vs Windows)
- Whether printers support DLE EOT status polling
- Paper width (80mm assumed — common for receipt printers)
- Characters per line at default font (42 assumed for 80mm)
