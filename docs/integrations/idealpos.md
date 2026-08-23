# Verdura — IdealPOS Integration Strategy

> **Normative integration decision — 2026-08-15:** This integration implements the [Target Operating Model](../target-operating-model.md). For the normal in-person journey, Verdura submits the order to Idealpos before payment and releases KDS/KOT after the connector durably accepts the same order version; payment then occurs through Idealpos and existing EFTPOS. For online payment, Verdura verifies payment, submits the transaction under the configured `PREPAID / ONLINE` tender and retains both provider references. Idealpos is the core POS transaction system, not Verdura's customer/CRM/analytics platform.

> **Provider appendix status — 2026-08-15:** This is a target strategy, not evidence of a working Idealpos integration. The current processor fabricates an `IDEAL-*` ID and marks synchronization successful; order creation does not enqueue the POS sync record to BullMQ; no paired edge installation, supported provider write contract, durable local queue, capability probe, mapping gate, acknowledgement/confirmation lifecycle, or offline replay evidence exists. Production must report the capability as `Unsupported` or `Manual` until those gaps are closed.

> **Local installation evidence and API-less adapter architecture — 2026-08-16 (see §12–§21 below):** A read-only, non-executed copy of the Idealpos Windows installation was safely inspected (filenames, PE headers, .NET assembly metadata strings, licence text — no execution, no decompilation, no database or credential access). It confirms Idealpos is Windows-based, ships legacy 32-bit and .NET Framework 4.6.1 components, and contains ecommerce/online-order/transaction/table code paths (§12). This is evidence of **internal capability only** — it does not prove a licensed, vendor-supported, documented integration contract, nor the installed version/build/entitlement at any real venue (§12). Because no supported API/ecommerce contract is confirmed, §13–§18 define a **proposed, unproven, Verdura-managed API-less interim adapter** — a Windows Connector service paired with a separate interactive "Idealpos POS Bridge" UI-automation process — as an alternative to the vendor-supported path, not a replacement for pursuing it. Nothing in §12–§21 unblocks DL-064; the tracer bullet story (§20) remains blocked until live discovery (§19) is complete.

> **Story 2-9/2-10 done; discovery-only tracer implemented; live Windows discovery remains the sole bottleneck — 2026-08-16 (session 2):** connector identity (story `2-9`) and the durable command/acceptance protocol (story `2-10`) are both **done**, real-Postgres and real-process-crash verified. Story `9-2` was rescoped from a demo-clone order-entry tracer to a real-environment **discovery-only** tracer (see the story file's "Scope correction" section) and its discovery-phase implementation (`windows-connector/`) is built and tested for every part achievable without live Windows/Idealpos access (§20). Additional safety-compliant static evidence was recorded (§12.4) and the integration route was formally selected from available evidence (DL-071). **No real Windows machine or Idealpos installation was available this session** — `REAL_WINDOWS_CONNECTOR`/`REAL_IDEALPOS_UI_DISCOVERY` evidence remains entirely unobtained, and story `9-2` stays `blocked` on exactly that gate. §21's delivery sequence is updated accordingly.

**Recommendation:** align this strategy with PRD v5.2 Appendix A; use outbound-only TLS and a revocable venue/provider-bound installation identity; validate mappings before offer; distinguish offer/claim/acknowledge/confirm/fail; retain Verdura quote and POS authoritative totals separately; and require duplicate, restart, outage, price-conflict and revocation acceptance tests before pilot enablement.

**Phase 5 Output**
**Date:** 2026-06-18

> **Critical preamble:** Phase 0 confirmed that zero IdealPOS integration code exists in the `verdura_v1.2` repository. The mechanism by which orders currently reach IdealPOS (if they do at all) is entirely `[UNKNOWN]`. This document therefore does two things:
>
> 1. Documents all plausible adapter options with their trade-offs so the right one can be selected once Q1 is answered.
> 2. Specifies the **adapter interface and surrounding infrastructure** in a way that does not lock in any assumption about the mechanism — so implementation can begin before Q1 is resolved.
>
> **Operating Instruction #3 applies throughout:** No IdealPOS API endpoint names, field names, table column names, or protocol specifics are invented here. Every vendor-specific placeholder is marked `VERIFY AGAINST VENDOR DOCS`.

---

## 1 — The Core Problem

When a customer submits an order on the Self-Ordering Kiosk, three things must happen atomically from the restaurant's operational perspective:

1. Kitchen printer receives the order ticket
2. POS printer receives the order ticket
3. IdealPOS has a record of the order with the correct table number

The printer path is addressed in Phase 6. This document addresses item 3 exclusively: getting the order into IdealPOS reliably, with the correct table number attached, and with full retry/failure visibility.

---

## 2 — What We Know About IdealPOS

`[CONFIRMED]` — IdealPOS is a Windows-based POS system. It is common in New Zealand and Australian hospitality. (`VERIFY AGAINST VENDOR DOCS` for all specifics below.)

`[UNKNOWN]` — Which version of IdealPOS is installed at Verdura.

`[UNKNOWN]` — Whether IdealPOS is configured to expose any API (REST, SOAP, or otherwise).

`[UNKNOWN]` — Whether IdealPOS uses a SQL Server backend, and if so, whether it is accessible on the LAN.

`[UNKNOWN]` — Whether any Windows-level middleware (COM automation, ODBC DSN, file-drop integration) is available.

`[UNKNOWN]` — Whether the current working integration (described in the brief) actually exists, and if so, which mechanism it uses.

**Implication for architecture:** The IdealPOS Agent (Phase 4) is designed as an on-premise Node.js process that can load any one of the adapters below based on venue configuration. The agent infrastructure is built first; the adapter is plugged in once Q1 is answered.

---

## 3 — Adapter Interface Contract

This TypeScript interface is the contract every adapter must satisfy. It is the only thing the IdealPOS Agent calls — it knows nothing about how any specific adapter works internally.

```typescript
// ─── Shared types ────────────────────────────────────────────────────────────

interface POSOrderPayload {
  /** Verdura-internal order identifier */
  verduraOrderId:   string;

  /** Human-readable table label from kiosk selection (e.g. "T1", "Bar 3") */
  tableNumber:      string;

  /** Line items */
  items:            POSOrderItem[];

  /** Total in cents */
  totalCents:       number;

  /** ISO timestamp of order submission */
  submittedAt:      string;

  /** Venue name for display on POS receipts */
  venueName:        string;
}

interface POSOrderItem {
  /** Name as displayed to customer — snapshot from MenuItem.title */
  name:             string;

  quantity:         number;

  /** Unit price in cents */
  unitPriceCents:   number;

  /** Selected modifier names, for inclusion in POS line-item notes */
  modifierNotes:    string[];

  /** Item-level special instruction */
  customerNote:     string | null;
}

interface POSSyncResult {
  success:          boolean;

  /**
   * The identifier assigned by IdealPOS to this order, if the adapter
   * can obtain one. Used to populate POSSyncRecord.posOrderId.
   * VERIFY AGAINST VENDOR DOCS — not all adapters will return this.
   */
  posOrderId:       string | null;

  /**
   * Raw response from the POS system for debugging.
   * Stored as-is in POSSyncRecord.responsePayload.
   */
  rawResponse:      Record<string, unknown> | null;

  /** Human-readable error message if success = false */
  error:            string | null;
}

// ─── The adapter interface ────────────────────────────────────────────────────

interface IdealPOSAdapter {
  /**
   * The adapter type identifier — must match POSAdapterType enum.
   * Used by the agent to log which adapter handled a sync attempt.
   */
  readonly adapterType: POSAdapterType;

  /**
   * Called once at agent startup to verify the POS connection is reachable.
   * Returns true if the integration target is available, false otherwise.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Submit an order to IdealPOS. The agent calls this and handles retries.
   * The adapter is responsible only for a single attempt.
   */
  submitOrder(payload: POSOrderPayload): Promise<POSSyncResult>;

  /**
   * Called by the agent on shutdown to release any persistent connections
   * (database connections, file handles, COM objects, etc.).
   */
  close(): Promise<void>;
}
```

---

## 4 — Adapter Registry and Configuration

The IdealPOS Agent loads the configured adapter at startup from the venue's configuration. No code changes are required to switch adapters — only a configuration change.

```typescript
// verdura-pos-agent/src/adapter-registry.ts

import { ApiAdapter }        from './adapters/api.adapter';
import { SqlAdapter }        from './adapters/sql.adapter';
import { OdbcAdapter }       from './adapters/odbc.adapter';
import { CsvAdapter }        from './adapters/csv.adapter';
import { LocalAgentAdapter } from './adapters/local-agent.adapter';
import { NullAdapter }       from './adapters/null.adapter';

export function createAdapter(config: VenueAgentConfig): IdealPOSAdapter {
  switch (config.posAdapterType) {
    case 'api':          return new ApiAdapter(config.posConfig);
    case 'sql':          return new SqlAdapter(config.posConfig);
    case 'odbc':         return new OdbcAdapter(config.posConfig);
    case 'csv':          return new CsvAdapter(config.posConfig);
    case 'local_agent':  return new LocalAgentAdapter(config.posConfig);
    case 'none':         return new NullAdapter();
    default:
      throw new Error(`Unknown POS adapter type: ${config.posAdapterType}`);
  }
}
```

The venue's `posConfig` is a `Record<string, string>` stored encrypted in the database (PostgreSQL `Venue.posConfig`). Each adapter reads only the keys it needs.

---

## 5 — The Five Adapters

### 5.1 — ApiAdapter

**Mechanism:** Calls an HTTP REST or SOAP endpoint exposed by IdealPOS (or a middleware in front of it).

```
Order submitted
    │
    ▼
IdealPOS Agent (on-premise)
    │ HTTP POST to IdealPOS API endpoint
    │ VERIFY AGAINST VENDOR DOCS — endpoint URL, method, auth scheme, body format
    ▼
IdealPOS REST/SOAP API
    │
    ▼
IdealPOS creates order, returns order ID
```

**Required config keys:**
```
IDEALPOS_API_BASE_URL   # e.g. http://localhost:8080/api  — VERIFY AGAINST VENDOR DOCS
IDEALPOS_API_KEY        # Auth token/key — VERIFY AGAINST VENDOR DOCS
IDEALPOS_SITE_ID        # Site identifier if multi-site — VERIFY AGAINST VENDOR DOCS
```

**Advantages:**
- Cleanest integration — purpose-built for machine-to-machine communication
- No database access required — no risk of corrupting POS data via direct writes
- Most portable: if the API is network-accessible, the agent could eventually move to the cloud
- Vendor-supported integration path (if IdealPOS documents it)

**Disadvantages:**
- Requires IdealPOS to have an active HTTP server component — not all versions or configurations expose one
- API availability depends on IdealPOS being running; if the POS is rebooted, the API goes down
- Auth scheme and payload format are entirely vendor-specific `VERIFY AGAINST VENDOR DOCS`
- Rate limiting or session management on the IdealPOS side is unknown

**Recommended if:** Phase 0 Q1 investigation reveals IdealPOS is running a documented REST or SOAP API on a known port. This is the most maintainable path long-term.

---

### 5.2 — SqlAdapter

**Mechanism:** Connects directly to the SQL Server database that IdealPOS uses as its backend, and writes order records directly into the appropriate tables.

```
Order submitted
    │
    ▼
IdealPOS Agent (on-premise)
    │ TCP connection to SQL Server (port 1433)
    │ INSERT INTO [idealpos_db].[dbo].[Orders] ...  — VERIFY AGAINST VENDOR DOCS
    │ INSERT INTO [idealpos_db].[dbo].[OrderItems] ... — VERIFY AGAINST VENDOR DOCS
    ▼
SQL Server (on restaurant LAN)
    │
    ▼
IdealPOS reads its own database — sees the new order
```

**Required config keys:**
```
IDEALPOS_SQL_SERVER     # e.g. 192.168.1.10\SQLEXPRESS or .\IDEALPOS
IDEALPOS_SQL_DATABASE   # Database name — VERIFY AGAINST VENDOR DOCS
IDEALPOS_SQL_USER       # SQL login — dedicated read/write user, not sa
IDEALPOS_SQL_PASSWORD   # Encrypted at rest in vault
```

**Node.js library:** `mssql` (Microsoft SQL Server client for Node.js)

**Advantages:**
- Does not require IdealPOS to expose any network service — works even when the IdealPOS UI is closed, as long as SQL Server is running
- High flexibility: can write exactly the data format IdealPOS expects
- Potentially the fastest path to a working integration if the schema is discoverable

**Disadvantages:**
- **Highest risk adapter.** Writing directly to a third-party application's database bypasses all application-layer validation. An incorrect INSERT can corrupt POS data, cause IdealPOS to behave unexpectedly, or trigger cascading errors in POS reporting.
- The schema is undocumented and proprietary `VERIFY AGAINST VENDOR DOCS`. Any IdealPOS version upgrade may change the schema silently.
- Requires SQL Server to be network-accessible (not always the case — SQL Server may be configured for local connections only, requiring a named pipe or local connection string).
- Requires a dedicated SQL login with write permissions — a security concern on a shared POS machine.
- Vendor may not support or warranty this usage pattern.

**Recommended if:** No API exists, SQL Server is confirmed accessible on LAN, and the schema is discoverable by examining the IdealPOS database directly. Treat as a last resort before CsvAdapter.

---

### 5.3 — OdbcAdapter

**Mechanism:** Connects to IdealPOS via an ODBC Data Source Name (DSN) configured on the Windows machine. ODBC is a Windows-native database abstraction layer that many older POS systems expose.

```
Order submitted
    │
    ▼
IdealPOS Agent (on-premise, must run on Windows)
    │ ODBC connection via DSN "IdealPOS" (or similar)
    │ SQL query via ODBC driver — VERIFY AGAINST VENDOR DOCS
    ▼
ODBC Driver Manager (Windows)
    │
    ▼
IdealPOS backend (SQL Server or proprietary DB)
```

**Required config keys:**
```
IDEALPOS_ODBC_DSN       # Windows DSN name — VERIFY AGAINST VENDOR DOCS
IDEALPOS_ODBC_USER      # ODBC login — VERIFY AGAINST VENDOR DOCS
IDEALPOS_ODBC_PASSWORD  # Encrypted at rest
```

**Node.js library:** `odbc` (Node.js ODBC bindings — requires Windows ODBC driver manager)

**Advantages:**
- ODBC is a well-established integration pattern for Windows-based POS systems
- The DSN abstracts the underlying database — the agent does not need to know whether IdealPOS uses SQL Server, Access, or a proprietary database engine
- If IdealPOS ships an ODBC driver, this is a vendor-supported integration path

**Disadvantages:**
- **Windows only.** The `odbc` Node.js module requires native Windows ODBC bindings. The IdealPOS Agent must run on the same Windows machine as IdealPOS (or at minimum a Windows machine on the LAN with the ODBC driver installed).
- Cannot run in a Docker container on Linux — the on-premise agent is locked to Windows.
- Same data-integrity risks as SqlAdapter if writing directly to the POS database via ODBC.
- DSN configuration is manual and fragile — any Windows re-image or driver update can break it silently.
- Less common in modern POS systems; IdealPOS may or may not ship an ODBC driver `VERIFY AGAINST VENDOR DOCS`.

**Recommended if:** IdealPOS documentation confirms an ODBC driver is available and the on-premise machine is Windows. Not recommended otherwise.

---

### 5.4 — CsvAdapter

**Mechanism:** Writes order data to a CSV or fixed-format text file in a folder that IdealPOS watches for import. Some POS systems support file-drop import as an integration mechanism.

```
Order submitted
    │
    ▼
IdealPOS Agent (on-premise)
    │ Writes order-{id}.csv to a watched import folder
    │ Format: VERIFY AGAINST VENDOR DOCS (column names, delimiters, encoding)
    ▼
Import folder (shared or local path)
    │
    ▼
IdealPOS import watcher (if it exists — VERIFY AGAINST VENDOR DOCS)
    │
    ▼
IdealPOS processes the file and imports the order
```

**Required config keys:**
```
IDEALPOS_IMPORT_FOLDER  # Local or UNC path — VERIFY AGAINST VENDOR DOCS
IDEALPOS_CSV_FORMAT     # Column order and format spec — VERIFY AGAINST VENDOR DOCS
```

**Advantages:**
- Requires no network connectivity to IdealPOS itself — file system access is sufficient
- The simplest possible integration to implement on the agent side
- Fully decoupled: the agent's only dependency is a writable file path
- Zero risk of corrupting the POS database — IdealPOS controls its own import

**Disadvantages:**
- Requires IdealPOS to have a configured file import/watch feature — not all POS systems have this, and it must be manually enabled `VERIFY AGAINST VENDOR DOCS`.
- No synchronous confirmation: the agent writes the file but cannot know if IdealPOS successfully imported it. `posOrderId` will always be `null`.
- Import latency depends on the POS polling interval (could be seconds or minutes).
- File format is highly version-sensitive `VERIFY AGAINST VENDOR DOCS`. Column changes in a POS update will silently break imports.
- The shared folder path requires correct Windows file permissions.

**Recommended if:** No API, no accessible SQL Server, and no ODBC driver — but IdealPOS is confirmed to support file-drop import. This is the lowest-risk database-integrity option even if it sacrifices sync confirmation.

---

### 5.5 — LocalAgentAdapter

> **2026-08-16 update:** §12–§21 below now specify a concrete, detailed realization of this adapter class for Idealpos specifically — the **Verdura Connector (Windows Service) + Idealpos POS Bridge (interactive UI-automation process)**. That specification supersedes the illustrative sketch in this subsection wherever the two conflict. No third-party bridge tool was found or assumed to exist at any venue; local installation inspection (§12) found no evidence of an existing Idealpos-side HTTP/IPC "bridge" component — if the API-less path is used, Verdura must build and operate both the Connector and the Bridge itself. This remains a proposed, unproven, Verdura-managed interim option, not a vendor-supported integration, and is gated by live discovery (§19) and a tracer bullet (§20) before any production use.

**Mechanism:** Communicates with a separate Windows-native integration program (a "middleware" or "bridge") running on the same machine as IdealPOS. This bridge translates the agent's requests into whatever format IdealPOS needs internally — Windows COM automation, named pipes, DLL calls, or a local HTTP server.

```
Order submitted
    │
    ▼
IdealPOS Agent (on-premise, Node.js)
    │ HTTP POST to http://localhost:PORT/orders
    │ (or named pipe, or IPC mechanism — VERIFY AGAINST VENDOR DOCS)
    ▼
Local Bridge Process (Windows, runs on same machine)
    │ Windows COM automation / DLL interop / WinAPI
    │ VERIFY AGAINST VENDOR DOCS
    ▼
IdealPOS (Windows application)
    │
    ▼
Order appears in IdealPOS
```

**Required config keys:**
```
IDEALPOS_BRIDGE_URL     # e.g. http://localhost:9000 — VERIFY AGAINST VENDOR DOCS
IDEALPOS_BRIDGE_KEY     # Auth key for local bridge — VERIFY AGAINST VENDOR DOCS
```

**Advantages:**
- The bridge process can use Windows-native automation that Node.js cannot (COM, SendMessage, WinAPI) — enables integration with POS systems that have no API, no accessible database, and no file import.
- If a third-party bridge (e.g. IdealPOS's own "API server" add-on, or a vendor tool) already exists at the restaurant, this adapter consumes it as-is.
- Clean separation: the Node.js agent only speaks HTTP to localhost; all Windows complexity is in the bridge.

**Disadvantages:**
- Requires a second process to be running and maintained on the Windows machine — doubles the operational surface.
- If the bridge is a third-party or bespoke tool, it may be unmaintained or unsupported.
- Local HTTP over `localhost` is unencrypted — acceptable for loopback but requires the bridge to bind to `127.0.0.1` only (never `0.0.0.0`).
- Highest complexity to set up and debug.

**Recommended if:** Investigation reveals that a local bridge/middleware already exists at the restaurant (consistent with the brief's claim that printing and POS sync "currently work" — there may already be a Windows application doing this that we haven't found yet). This adapter would consume that existing tool.

---

### 5.6 — NullAdapter (for development and venues without IdealPOS)

```typescript
class NullAdapter implements IdealPOSAdapter {
  readonly adapterType = 'none' as const;
  async healthCheck(): Promise<boolean> { return true; }
  async submitOrder(_: POSOrderPayload): Promise<POSSyncResult> {
    return { success: true, posOrderId: null, rawResponse: null, error: null };
  }
  async close(): Promise<void> {}
}
```

Used when `posAdapterType = 'none'` — in development, in venues that don't use IdealPOS, or when the integration is intentionally disabled. Orders proceed without POS sync. `POSSyncRecord.status` is set to `not_applicable`.

---

## 6 — Adapter Comparison Matrix

| Criterion | ApiAdapter | SqlAdapter | OdbcAdapter | CsvAdapter | LocalAgentAdapter |
|-----------|-----------|------------|-------------|------------|-------------------|
| Requires IdealPOS API | Yes | No | No | No | No |
| Requires DB access | No | Yes | Yes | No | No |
| Database corruption risk | None | High | High | None | None |
| Sync confirmation (posOrderId) | Yes | Yes | Yes | No | Depends |
| OS requirement | Any | Any | Windows only | Any | Any (bridge is Windows) |
| Vendor-supported path | Likely | No | Maybe | Maybe | Maybe |
| Complexity to implement | Low | Medium | Medium | Low | Medium |
| Fragility on POS upgrade | Low | High | High | High | Medium |
| Works if POS UI is closed | Depends | Yes | Yes | Yes | No |

---

## 7 — Recommended Default (Given [UNKNOWN] Q1)

> **2026-08-16 sequencing correction:** the authoritative delivery order for all Idealpos work — vendor-supported and API-less alike — is now: (1) record safe local installation evidence [done, §12] → (2) complete live Windows discovery [§19, not started] → (3) implement connector identity/durable transport (story 2-9) → (4) run the non-production UI-bridge tracer bullet [§20, blocked] → (5) decide adapter viability (vendor-supported / API-less-viable / API-less-blocked) → (6) implement production-grade mapping, recovery, observability, reconciliation → (7) real-venue UAT. See §21 for the full sequence and DL-068.

**Complete vendor/reseller discovery first; build the provider-neutral connector contract in parallel, but do not implement a speculative production adapter.**

The recommended approach given the current [UNKNOWN] state:

1. **Confirm the installed environment:** Idealpos version/build, perpetual-licence entitlements, optional modules/subscriptions, supported web-order ingress, item/table/modifier/tender mappings, payment observation and stable transaction reference.

2. **Implement the connector transport first:** outbound mutual TLS, revocable venue-bound identity, encrypted local queue, durable acceptance, heartbeat, idempotent command/result API and reconciliation. A NullAdapter is development-only and must report `not_applicable`/`unsupported`, never success.

3. **Select the supported ingress:** prefer Idealpos ecommerce/web-order functionality or an approved reseller module, then a documented API/import. Do not speculatively write to proprietary tables. Direct database writes require written vendor approval, backups and recovery/upgrade tests.

4. **Prove both journeys:** standard Verdura → Idealpos → KDS/KOT → existing EFTPOS, and verified online payment → Idealpos `PREPAID / ONLINE` → KDS/KOT. Retain both external references and test duplicate, restart, outage, uncertain-result, void and refund cases.

**If Q1 reveals an existing Windows middleware (consistent with the brief):** The LocalAgentAdapter is the immediate production path — the existing tool becomes the bridge. The agent calls it via localhost HTTP.

**If Q1 reveals nothing exists:** The current "working" integration described in the brief either doesn't exist in its described form, or the kiosk hardware/software running it is entirely separate from this codebase. In this case, build ApiAdapter (most future-proof) and request IdealPOS documentation from the vendor.

---

## 8 — Agent Infrastructure (adapter-independent)

> **Connector transport correction:** the illustrative worker below is drawn as a direct BullMQ `Worker` against `redisConnection` for readability. Per target-operating-model.md §8 and `docs/architecture.md`'s recommended correction, the on-premise agent must never hold a shared cloud Redis credential. In the real implementation, this worker consumes commands from the outbound-only, mutually authenticated connector session (a scoped command/event API), not a direct Redis connection; BullMQ may still back the dispatcher on the Verdura API side of that boundary. Treat `redisConnection` below as shorthand for "the connector's local command feed," not a literal Redis client on the venue LAN.

### Queue Worker

```typescript
// verdura-pos-agent/src/worker.ts

const posSyncWorker = new Worker(
  `pos-sync:${venueId}`,
  async (job: Job<POSSyncJobData>) => {
    const { orderId, payload } = job.data;

    const result = await adapter.submitOrder(payload);

    // The 'none'/NullAdapter case is NOT a success path — it must never be
    // reported as 'synced'. Only a real adapter's confirmed result may set
    // 'synced'. This mapping is explicit, not inferred from result.success,
    // because NullAdapter.submitOrder() intentionally returns success:true
    // for local-development convenience (see §5.6) — collapsing that into
    // the same 'synced' status as a real Idealpos confirmation is exactly
    // the fabricated-success pattern target-operating-model.md §7 forbids.
    const status =
      adapter.adapterType === 'none'
        ? 'not_applicable'
        : result.success
          ? 'synced'
          : 'failed';

    // Report result back to Verdura API
    await apiClient.patch(`/api/internal/orders/${orderId}/pos-sync`, {
      status,
      posOrderId:  result.posOrderId,
      rawResponse: result.rawResponse,
      errorMessage: result.error,
      attemptCount: job.attemptsMade + 1,
    });

    if (adapter.adapterType !== 'none' && !result.success) {
      throw new Error(result.error ?? 'POS sync failed');
      // BullMQ will retry based on job options
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,       // Serial processing per venue — no race conditions in POS
  }
);
```

### Retry Configuration (set when job is enqueued by Verdura API)

```typescript
const posSyncJobOptions: JobsOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000,          // 2s, 4s, 8s, 16s, 32s
  },
  removeOnComplete: { age: 60 * 60 * 24 },    // Keep completed jobs 24h for debugging
  removeOnFail: { age: 60 * 60 * 24 * 7 },    // Keep failed jobs 7 days
};
```

### Health Check

The agent exposes a local HTTP health endpoint (not internet-accessible — bound to `127.0.0.1` only):

```
GET http://127.0.0.1:3001/health

Response:
{
  "agent": "verdura-pos-agent",
  "venueId": "...",
  "adapterType": "api",
  "adapterHealthy": true,
  "redisConnected": true,
  "queueDepth": 0,
  "lastSyncAt": "2026-06-18T02:00:00.000Z",
  "uptime": 3600
}
```

The Verdura API periodically polls this endpoint (via a tunnel or internal network) to populate the Admin Dashboard's integration health status.

### Agent Startup Sequence

```
1. Load config from env (.env file on gateway PC)
2. Open the outbound-only, mutually authenticated connector session to Verdura
   (never a direct shared cloud Redis credential — target-operating-model.md §8)
3. Instantiate adapter from config.posAdapterType
4. Run adapter.healthCheck()
   → if false: log warning, continue (POS may come online later)
5. Subscribe to scoped pos-sync commands for this venue over the connector session
6. Start local health HTTP server on 127.0.0.1:3001
7. Begin processing the connector's command feed
```

---

## 9 — Verdura API Side — Enqueueing Sync Jobs

When an order is submitted via `POST /api/kiosk/orders`, the Orders Module:

1. Creates the `Order` and `OrderItem` records in PostgreSQL
2. Creates a `POSSyncRecord` with `status: 'not_synced'`
3. Enqueues a job on `pos-sync:{venueId}` in Redis:

```typescript
await posSyncQueue.add(
  'sync-order',
  {
    orderId: order.id,
    payload: buildPOSPayload(order, venue),
  } satisfies POSSyncJobData,
  posSyncJobOptions
);
```

4. Returns the order confirmation to the kiosk immediately — POS sync is asynchronous and does not block the customer-facing response.

---

## 10 — Admin Dashboard — POS Sync Visibility

The Verdura API exposes:

```
GET  /api/admin/orders?posSyncStatus=failed    → list orders with failed POS sync
POST /api/admin/orders/:id/pos-sync/retry      → manually re-enqueue a sync job
GET  /api/admin/venues/:id/pos-sync/health     → adapter health status
```

The Admin Dashboard renders a "POS Sync" widget in the Orders view showing:
- Count of unsynced orders
- Count of failed sync attempts
- Last successful sync timestamp
- Per-order retry button for failed syncs

---

## 11 — Open Items (all `BLOCKED ON: Q1`)

| Item | What needs confirming |
|------|-----------------------|
| Adapter selection | Which mechanism does IdealPOS support/expose? |
| `posOrderId` format | What identifier does IdealPOS assign to orders? `VERIFY AGAINST VENDOR DOCS` |
| `tableNumber` field | How does IdealPOS represent table numbers? Integer? String? Pre-configured list? `VERIFY AGAINST VENDOR DOCS` |
| Item mapping | Does IdealPOS require items to be pre-registered with PLU codes? Or can free-text names be submitted? `VERIFY AGAINST VENDOR DOCS` |
| Authentication | What auth mechanism does the chosen adapter require? `VERIFY AGAINST VENDOR DOCS` |
| Version | Which IdealPOS version is installed? Integration capabilities differ by version. `VERIFY AGAINST VENDOR DOCS` |
| Existing middleware | Is there already a Windows process doing this? If so, what does it expose? |

**2026-08-16 update:** local installation inspection (§12) found no evidence of an existing third-party or Idealpos-shipped bridge/middleware component. "Existing middleware" above should now be read as **not found in the local installation copy** — unconfirmed at any live venue either way. §19 supersedes this table with a fuller, bounded live-discovery checklist; this table is retained for historical continuity.

**2026-08-17 update:** the "Version" row above remains genuinely open — §12.5 found three distinct, non-equivalent version-shaped static artifacts ("Idealpos 7" edition name, `FrameworkVersion.txt`=`6.05.0001`, an unconfirmed `8.0.0.5` literal) rather than a single confirmed version. This does not resolve the row; it sharpens the question the vendor/live-discovery answer needs to disambiguate (§12.6 question 2).

---

## 12 — 2026-08-16 Local Installation Evidence (Idealpos Solutions copy)

**Source:** a read-only copy of an Idealpos Windows installation at a local path outside this repository, inspected under an explicit safety boundary: no execution, no service start/registration, no decompilation/disassembly, no database access (Access/SQLite/SQL Server), no opening of certificate/key/licence-key material, no secret values recorded. Only filenames, PE headers (via `file`), .NET assembly binding/config XML, and printable-string metadata scans (via `strings`, filtered to method/type-name patterns — not a decompile) were used, plus the plain-text licence agreement.

**This section records what was safely observed. It does not, and cannot, prove the installed version, build, licence entitlement, enabled modules, or runtime configuration of any real venue's Idealpos system.** Every line is evidence of *capability present in this installer copy*, not of a working, licensed, or vendor-supported integration.

### 12.1 — Confirmed (directly observed)

- The installation is Windows-based. `IPS.exe` is a **PE32 (32-bit, Intel 80386)** executable; `IPSClient.exe` and `IdealposService.exe` are **32-bit Mono/.NET assemblies**. Legacy 32-bit components are present throughout (numerous `.ocx`/`.tlb` COM components).
- `IdealposService.exe.config` declares `<supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.6.1" />` — the Idealpos Online/Ecommerce service component targets **.NET Framework 4.6.1**.
- Many `.tlb` (COM type library) files accompany the `.dll` files (e.g. `IdealposObjects.tlb`, `IdealposTransactions.tlb`, `idealPOS.NET.tlb`, `IdealPos.Webit.Core.tlb`, `CAAAffinity.tlb`, `IKM.API.tlb`) — confirming **COM-visible assemblies** are shipped, consistent with the task brief.
- The following files named in the task brief exist in the installation copy: `IdealposService.Ecommerce.dll`, `IdealposService.Online.dll`, `IdealPos.Webit.Core.dll`, `IdealposTransactions.dll`, `IdealposObjects.dll`, `idealPOS.NET.dll` (the last three under the main `Idealpos/` program directory; the first two under a separate `IdealposService/` directory representing a distinct online/ecommerce service process from the main POS UI).
- A narrow, pattern-restricted string scan (method/type-name-shaped tokens only, not a full dump) found these exact symbols:
  - `IdealPos.Webit.Core.dll`: `InsertOrders`, `ProcessOrders`, `RetrieveOrders`, `RetrievePendingOrders`, `GetPendingOrders`, `GetPendingOrdersCount`, `GetPendingStockItems`, `UpdateAllStocksAvailable`, `UpdateProducts`, `DeleteProducts`, `DeleteStockItems`.
  - `IdealposService.Ecommerce.dll`: `GetPendingSalesByRef`, `CancelTableTransaciton` (sic — vendor's own spelling), `ProcessDoshiiService`, `UpdatePosterminalOrderModel`.
  - `IdealposTransactions.dll`: `SendTransaction`.
  - `IdealposObjects.dll` and `idealPOS.NET.dll`: the exact strings `TableId`, `PendingSale`, `TransactionReference` and `SendTransaction` named in the task brief were **not** matched by this narrow scan of those two specific files. This is recorded as **not independently reconfirmed in this pass**, not as evidence of absence — the brief's naming may reflect a different build, a differently-scoped string, or a compound/namespaced symbol this scan's pattern did not match. Treat those two files' exact contribution as **inferred, not confirmed**.
- **New corroborating finding not in the original brief:** `IdealposService.Ecommerce.dll` contains `ProcessDoshiiService`, indicating the installed Ecommerce component has a Doshii-related code path. This is capability evidence only — it does not confirm Doshii is licensed, configured, or reachable at any venue, and does not by itself confirm "Doshii" as a viable preferred-adapter path without commercial/technical confirmation (DL-064).
- `IdealposService/` (the online/ecommerce service host) links Entity Framework 6, `System.Data.SQLite`, and `Microsoft.AspNetCore.SignalR.Client*` assemblies — indicating this service component is architected as a separate long-running process from the main POS UI, with its own local data layer and an outbound real-time client connection (SignalR), consistent with a cloud-connected online-ordering module. **Inferred**, not confirmed: whether this component is licensed/enabled, what it connects to, or whether it is the same thing as "Idealpos Online" referenced elsewhere.
- The installation ships `idealpos.pfx` (a certificate/private-key container) and multiple Access database files (`IPSDefault.MDB`, `ipsDemoRST.mdb`, `ipsNewDemo.mdb`, `IPSSynchDefault.MDB`, `IPSTerminalDefault.mdb`, `ibs.mdw`). **None of these were opened.** Their presence confirms certificate-based provisioning and an Access-based data layer for the main POS client exist in this installer copy; contents, validity, and applicability to any live venue are unknown and must never be recorded in any Verdura artifact. **This is a standing, forward-looking prohibition, not scoped to this inspection session only: these and equivalent files (any `.pfx`/certificate/key container, any `.mdb`/`.mdw`/database file found in any future Idealpos installation copy or live venue) must never be opened, decrypted, or queried by any future Verdura work — planning, discovery, or implementation — without separate, explicit written authorization and legal/vendor review. "Not opened in this pass" must never be read as license to open them later by default.**
- The licence agreement (`Idealpos Solutions Pty Ltd - Licence Agreement.rtf`, plain text) explicitly states: *"You may not alter, decompile or disassemble the Software"* and lists *"Reverse engineer, decompile or disassemble the Software, except and only to the extent that applicable law expressly permits"* as a prohibited use. **This confirms only that the licence text found in this local installation copy contains that restriction** — it does not confirm this is the operative text of any real venue's actual commercial agreement, which could differ by version or carry negotiated addenda. It is nonetheless sufficient basis for Verdura's own self-imposed conduct rule (never decompile, never invoke undocumented methods) applied throughout this document, independent of any specific venue's exact contract terms.
- `IdealposService/settingsoverride.json` exists and is **empty (0 bytes)** — no configuration or secret content was present to record.

### 12.2 — Explicitly not proven by this evidence

- The exact Idealpos version/build/edition installed at any real venue.
- Whether Idealpos Online, Ecommerce, or Doshii integration is licensed, enabled, or commercially available for this deployment.
- Whether any documented/supported API, SDK, or web-order ingress is reachable without additional purchase, module activation, or reseller involvement.
- Field names, formats, length limits, or searchability of any order/note/external-reference field.
- Whether kitchen-ticket printing can be suppressed for any terminal, clerk, or order source.
- Any runtime behaviour of the installed software (this copy was never executed).

### 12.3 — Safety compliance statement

No Idealpos binary was executed, installed, registered as a service, or dynamically loaded. No file was modified or copied into this repository. No certificate, key, licence key, database content, payment configuration, or other secret value was opened, recorded, or printed. No decompilation or disassembly was performed — only PE-header identification (`file`) and printable-string pattern matching (`strings`, filtered to short method/type-name-shaped tokens) against `.dll`/`.exe`/`.config` files, plus reading the plain-text licence RTF. This complies with the safety boundary given for this planning session.

### 12.4 — 2026-08-16 (session 2) additional static findings — story 9-2

Same source, same method, same safety boundary as §12.1–§12.3 (no execution, no decompilation, no database/credential/secret access) — extended this session in support of story `9-2`'s Discovery Matrix. Full context and story-facing framing: `_bmad-output/implementation-artifacts/9-2-idealpos-uibridge-tracer.md`.

- **`Idealpos/FrameworkVersion.txt`** is a plain-text file reading exactly `6.05.0001`. This is the strongest version-shaped evidence recorded to date for this installation copy. **`OBSERVED_NOT_PROVEN`**: this is the installer copy's own recorded version, not confirmed as the version running at the real Dunedin venue or any other real venue.
- **Three distinct service-shaped executables**, not two: `Idealpos/IPS.exe` (main POS client), `IdealposService/IdealposService.exe` (online/ecommerce — already known from §12.1), and `IdealposUpgradeService/IdealposUpgradeService.exe` (a separate upgrade/update service), each with its own `*.Update.exe` companion (`IPS.Update.exe`, `IdealposService.Update.exe`, `IdealposUpgradeService.Update.exe`). A narrow `strings` scan of `IdealposService.exe` found the plain internal name string `IdealposService`, consistent with (but not proof of) that being the registered Windows service name at any real venue — service *names* are configurable at install time and this is not independently confirmed.
- **`IdealposService/IdealposService.exe.config` declares an Entity Framework 6 `LocalDbConnectionFactory` targeting `mssqllocaldb`** as its default connection factory. This describes the online/ecommerce service component specifically — a different component from the main POS client's Access-file data layer already noted in §12.1 — and does not contradict that finding. **`OBSERVED_NOT_PROVEN`**: a default factory declaration is not proof of the actual configured connection at any real venue.
- **`IdealPos.Licensing.Service2.ClientApi.dll`** (present under `IdealposService/`) confirms a distinct licensing-service client component exists. A narrow `strings` scan of that file found the plain-text, non-secret WCF/SOAP namespace string `http://www.idealpos.com.au/LicensingManager/2015/01/IShopOwnerManagement/GetNumberOfOfflineLicnecesRequestsInLast12MonthsResponse` — confirming `idealpos.com.au` as the vendor's real domain (consistent with public knowledge) and an `IShopOwnerManagement` SOAP service contract exists in this capability surface. **`OBSERVED_NOT_PROVEN`**: a namespace URI is not proof of live network reachability, licensing state, or entitlement.
- **New named vendor-integration surface, not in §12.1's catalogue: `ResDiary.EposServiceConsumer.Helpers.dll` / `RD.EposServiceConsumer.Helpers.dll`** (present in the main `Idealpos/` directory). Idealpos ships pre-built integration helper components for ResDiary's EPOS consumer API (a restaurant reservations/booking platform, part of Access Group). Verdura has no relationship with ResDiary and none is implied by this finding — it is recorded only as evidence that Idealpos's vendor-integration surface is broader than §12.1 catalogued, worth naming in any future vendor/reseller conversation (discovery checklist item I) about supported integration mechanisms generally. **Capability evidence only.**
- **`IdealPos.Webit.Core.dll`'s embedded PDB debug paths** (`C:\Development\vsts\WebIt\Core\obj\Release\IdealPos.Webit.Core.pdb` and `C:\Projects\Idealpos\WebIt\Core\obj\Release\IdealPos.Webit.Core.pdb` — two path variants, likely from different build machines/eras) confirm Idealpos's web-ordering integration product is internally named **"WebIt"**, built via Azure DevOps (the `vsts` path segment is the product's former name, Visual Studio Team Services). A narrow `strings` scan also found `GetWebitIpsInfo` and `IdealPos_Webit_Manager` — a management/configuration surface shape, distinct from the already-known Doshii finding (`ProcessDoshiiService`, §12.1). **Capability evidence only** — confirms a product exists in this installer copy, not that it is licensed, configured, or reachable for any real venue.

**Net effect on §13's adapter-boundary decision: none.** These findings broaden the catalogue of named vendor-integration surfaces (Doshii, WebIt, Ecommerce/Online, and now ResDiary/Licensing-service) worth asking the vendor/reseller about (checklist item I) — they do not, individually or together, confirm licensed availability, commercial terms, or a documented contract for any of them at any real venue. §12.2's standing conclusion is unchanged and is restated here for emphasis: **no confirmed, licensed, vendor-supported, documented integration contract exists.**

### 12.5 — 2026-08-17 (session 3) additional static findings — deeper Doshii/WebIt/EFTPOS/import evidence

Same source, same method, same safety boundary as §12.1–§12.4 (no execution, no decompilation, no database/credential/secret access, no reverse engineering — the licence agreement's prohibition on decompiling/disassembling, §12.1, was checked again and respected throughout). This pass used a small number of additional `strings`-pattern samples and plain-text `.config` reads to go one level deeper on surfaces §12.4 had already named, plus searched explicitly for import/export and local-server-hosting evidence not previously checked.

**Evidence classification used in this subsection only** (distinct from the live-discovery checklist's per-item vocabulary used elsewhere in this document and in `idealpos-live-discovery-checklist.md`): `STATICALLY_CONFIRMED` (the copied material contains the identified component/declaration — never proof the feature works or is licensed), `OBSERVED_NOT_PROVEN`, `DOCUMENTED_BUT_NOT_TESTED`, `LICENCE_OR_ENTITLEMENT_UNKNOWN`, `REQUIRES_VENDOR_CONFIRMATION`, `REQUIRES_LIVE_WINDOWS`, `NOT_FOUND`, `NOT_APPLICABLE`. These two vocabularies describe different things (static-file classification vs. live-discovery-item status) and are not in conflict where both appear near each other in this document.

- **Doshii evidence is substantially deeper than §12.1's single `ProcessDoshiiService` method name.** `IdealposService.Ecommerce.dll` contains an internal namespace `IdealposService.Ecommerce.Ecommerces.Doshii` with a `DoshiiService` class (`GetAccessTokenAsync`, `GetTokenAsync`, `CheckPendingSalesAsync` — an OAuth token-acquisition and pending-sale-polling flow) and a `PosserverService` class (`GetTableAmountAsync`, `EmulatePaymentAsync`), plus configuration-shaped fields `_doshiiBaseUrl`, `ApiKey`, `LocationId`. **`STATICALLY_CONFIRMED`**: this is a real, compiled, first-party Doshii client implementation, not a stray method name — the strongest single piece of evidence for any vendor-supported route found to date. **`LICENCE_OR_ENTITLEMENT_UNKNOWN` / `REQUIRES_VENDOR_CONFIRMATION`**: whether this venue's Idealpos licence includes/activates the Doshii module, whether `ApiKey`/`LocationId` are currently configured, and whether it is enabled are all still unknown.
  - **Architecturally significant, not just "more of the same":** the method names (`CheckPendingSalesAsync`, `GetAccessTokenAsync`) and the `HttpClient`-only dependency (no `HttpListener`/Kestrel/named-pipe/bound-port string was found in a specific, targeted search of `IdealposService.Ecommerce.dll`, `IdealposService.Online.dll`, `IdealposOnline.Data.dll`, and `IdealposOnline.Data.Pos.dll`) indicate Idealpos's Doshii module is an **outbound-only client that polls Doshii's cloud for pending sales** — it does not host a locally-callable server Verdura's connector could push orders to directly. **`NOT_FOUND`** (local server-hosting evidence, in that specific four-file Ecommerce/Online search — **`IdealPos.Webit.Core.dll` was not part of this particular string search** and this finding should not be read as also covering WebIt; WebIt's local-server-hosting question remains open). Practical consequence for §13.1/DL-071's route evaluation: if Doshii is the confirmed vendor-supported path, the likely integration shape is **Verdura becoming a Doshii marketplace/partner app and submitting orders through Doshii's own API**, which Idealpos's service then polls down — not a direct local Verdura↔Idealpos call. This reclassifies what "vendor-supported ecommerce" (DL-071 route 1) would concretely mean if confirmed; it does not change that route 1 remains unconfirmed and unselectable today.
- **WebIt: additional WCF/DataContract evidence beyond §12.4's PDB-path finding.** `IdealPos.Webit.Core.dll` declares WCF/DataContract XML namespaces `http://idealpos.com.au/Webit/2014/03` and `http://wwww.idealpos.com.au/webit/2015/07` (the quadruple-`w` typo is the vendor's own, observed verbatim, not a transcription error here), with types `WebitWebOrder`, `WebitCustomer`, `WebitStockItem`, `WebitAddress`, and a string identifying it as being "for Webit 3". **`STATICALLY_CONFIRMED`**: a first-party, schema-defined order/customer/stock-item data contract exists for Idealpos's own "WebIt" online-ordering product, corroborating and extending §12.4's `GetWebitIpsInfo`/`IdealPos_Webit_Manager` finding. **`DOCUMENTED_BUT_NOT_TESTED`** whether it is currently reachable; **`REQUIRES_VENDOR_CONFIRMATION`** whether WebIt is still sold/supported as a current, purchasable product for this venue, and on what technical/commercial terms it would be reached (hosted-only vs. locally addressable).
- **ResDiary: concrete endpoint evidence, reconfirming §12.4's finding is booking-only.** Endpoint literals `http://au.resdiary.com/WebServices/Epos/v1` (SOAP-style) and `https://au.resdiary.com/OAuth/V10a` were found in plain-text `.config` files alongside `ResDiaryPOS.dll`/`ResDiary.EposServiceConsumer.Helpers.dll`. **`NOT_APPLICABLE`** to order-submission scope — ResDiary is a table-booking/reservations platform, not an ordering channel; do not conflate with `idealpos.order.submit.v1`. Recorded only for the same completeness reason as §12.4.
- **EFTPOS gateway clients (recorded for context only — no EFTPOS action is in scope for this or any discovery story):** `Idealpos/FirstAmericanEftpos.dll.config` declares a WCF `wsHttpBinding` client against `https://secure.1stpaygateway.net/secure/RestGW/RestGWSrv.svc`; `Syncro3Eftpos.dll`, `IdealposPAX.dll`, `IPS_Epay.dll`, `PayLinqI.dll`, and `Idealpos/Assembly/SPIClient.dll` (SPI — the common Australian "Simple Payment Integration" EFTPOS protocol, log-config only, no endpoint found) are also present. **`STATICALLY_CONFIRMED`** multiple named EFTPOS gateway client integrations are compiled into the main app. **`REQUIRES_LIVE_WINDOWS`**: which of these (if any) is this venue's actual configured provider is unknown from static files. This finding exists solely to inform the vendor question set (§12.6) about preserving the existing EFTPOS workflow — it changes nothing about this story's absolute EFTPOS prohibition.
- **A generic file-based import/export framework exists but is not evidenced as order-related.** `Idealpos/IPS.Data.ImporterExporter.dll` contains `ImportTask`, `importDirectory`, `exportDirectory`, `AsyncImport`, `DeleteImportFile`; a sibling `IPS.Imports.SupplierInvoice.dll` shows at least one concrete use (supplier invoices). **`STATICALLY_CONFIRMED`** a directory-driven import/export mechanism exists somewhere in the product. **`NOT_FOUND`** (evidence tying this specific framework to online-order ingestion) — do not assume it applies to orders without vendor confirmation; DL-071 route 2 ("vendor-supported file/import/local-service") remains unselectable and this finding does not newly support it.
- **Version evidence is three separate, non-equivalent artifacts — do not merge them into one "confirmed version."** (a) The licence agreement's own header text reads "Idealpos 7" — a product/edition name in what reads as generic licence-template boilerplate (copyright block "2000 – 2017"), not necessarily this specific venue's current edition. (b) `Idealpos/FrameworkVersion.txt` = `6.05.0001` (§12.4) — still the strongest single version-shaped artifact. (c) **New:** a bare numeric literal `8.0.0.5` was found via `strings` sampling of `Idealpos/IPSClient.exe`, positioned near `FileVersion`/`ProductVersion` accessor-name strings — but no PE version-resource extraction tool (`exiftool`, Python `pefile`) was available on this host, so this is **not** a confirmed authoritative version-resource read. **`OBSERVED_NOT_PROVEN`**, weaker confidence than (b). Recorded as an explicit open question for the vendor question set and live discovery: which of "Idealpos 7" (edition), `6.05.0001` (framework/build), and `8.0.0.5` (possible product/file version) — if any single one — is the actual installed, licensed version at the real venue.
- **No Firebird database driver was found anywhere in the tree** (searched explicitly — zero hits). Idealpos's database layer, as evidenced in this copy, is Access/Jet (main POS client, §12.1) and SQL Server/`mssqllocaldb` via Entity Framework 6 (the online/ecommerce service, §12.4) — not Firebird. Recorded because Firebird is a common assumption in the Australian/NZ hospitality POS market generally; this specific installation copy rules it out. This does not correct any existing claim in this document (none was made), only forecloses a plausible-sounding assumption before it could be made.
- **No "kitchen"/"KOT"-named files or config exist anywhere in the tree.** Only generic printer infrastructure was found: `Idealpos/IPSPrinterServer.exe` (a standalone print-routing/sharing service), `ZBRPrinter.dll`/`Zebra/` (Zebra label printers), and `OPOSPOSPrinter.ocx`/`OPOSPrinter.ocx` (the OPOS-standard POS-printer driver interface). **`NOT_FOUND`** — kitchen-ticket routing/suppression evidence is entirely absent from static files; this reinforces (does not newly resolve) checklist item F's existing `REQUIRES_LIVE_WINDOWS` gate. Kitchen routing most likely lives in Idealpos's own configured "printer groups"/product-category routing inside its database, which this assessment does not and must not query (§12.1's standing database prohibition).
- **All sampled executables remain legacy .NET Framework (4.0/4.6.1) and 32-bit PE32** (`IPSClient.exe`, `IPS.exe`, `IdealposService.exe`, `IdealposUpgradeService.exe` all confirmed via `file`) — consistent with, and adding no new information beyond, §12.1's existing finding. **Restated for emphasis, not as new evidence:** this has no bearing on Verdura's own connector, which remains on modern .NET per §14.1; the 32-bit finding only matters if the interactive Bridge (§14.2) ever needs true in-process COM interop against these specific processes, which external, out-of-process Windows UI Automation via the OS's UIA COM layer does not require.

**Net effect on §13's adapter-boundary decision: none, but the Doshii finding materially strengthens which vendor-supported route is most concrete to pursue.** Route 1 (vendor-supported ecommerce) now has one candidate — Doshii — with real, deep, first-party code evidence rather than a bare method name; the practical shape of that route (a Doshii marketplace/partner integration, not a local API call) is now better understood. This changes what to ask the vendor (§12.6), not the decision itself: routes 1–3 remain **not selectable** until entitlement/commercial/technical confirmation exists in writing (§13.1's standing requirement, unchanged), and DL-071's route 4 selection (discovery-phase-only UI Automation) is unaffected.

### 12.6 — Vendor/reseller question set (consolidated, static-evidence-informed)

Consolidates and supersedes-by-expansion the brief item-I sub-bullets in `idealpos-live-discovery-checklist.md` §I, which now points here rather than duplicating this list. Assembled from every static finding in §12.1–§12.5 that raises a question only Idealpos or its reseller can answer. No item here has been asked yet this session — this is preparation, not evidence of contact.

1. **Perpetual-licence entitlement**: what modules/features does this venue's actual perpetual licence cover today, and how would that be confirmed in writing (a licence summary document, reseller statement, or in-app entitlement screen)?
2. **Installed version**: what is the exact installed product version/build at the real venue — given static evidence shows three different version-shaped strings ("Idealpos 7" edition name, `FrameworkVersion.txt`=`6.05.0001`, an unconfirmed `8.0.0.5` file-version-shaped literal), which one (if any) is authoritative?
3. **Ecommerce/online-ordering capability**: is the Idealpos Ecommerce/Online service module (the one hosting the Doshii client, §12.1/§12.5) licensed and enabled for this venue?
4. **WebIt availability**: is "WebIt" (§12.4/§12.5) still sold/supported as a current product, and if so, is it hosted-only or does it expose any locally-addressable interface?
5. **Doshii availability and shape**: is Doshii activated for this venue? If so, is the integration path a Doshii marketplace/partner-app relationship (per §12.5's architectural finding that Idealpos's Doshii client polls outward, not a locally callable server) — and if that's correct, what would Verdura need to become a Doshii partner app (API key, location ID, approval process, cost)?
6. **Local order-injection capability**: does Idealpos expose *any* mechanism (API, local service, message queue) that accepts an order pushed in from a local process, as opposed to a cloud-mediated poll — distinct from and in addition to question 5?
7. **Supported file/import mechanisms**: is `IPS.Data.ImporterExporter.dll`'s generic import/export framework (§12.5) usable for order ingestion, or is it scoped only to supplier invoices and similar back-office data as observed?
8. **Supported APIs or SDKs**: does Idealpos publish any API/SDK documentation for third-party order submission, beyond what this static assessment could observe from compiled binaries alone?
9. **Transaction reference retrieval**: does Idealpos issue a stable, retrievable transaction reference at time of sale save, and can it be looked up later via a supplied external reference (mirrors checklist item E, asked here as a vendor-facing framing)?
10. **PREPAID/ONLINE tender mapping**: does this venue have an `ONLINE` or `PREPAID / ONLINE` tender (or equivalent) configured, and what is its exact name/code?
11. **Existing EFTPOS workflow preservation**: which of the EFTPOS gateway clients found statically (First American, PAX, SPI, Syncro3 — §12.5) is this venue's actual configured provider, and what must be preserved unchanged in that workflow?
12. **KOT routing behaviour**: can kitchen-ticket printing be suppressed per terminal, clerk, or order source (mirrors checklist item F)? No static evidence exists either way (§12.5).
13. **Test/training environment availability**: does Idealpos or the reseller offer a demo/sandbox/training environment usable for a tracer bullet, so a real production database is never touched for validation?
14. **Support implications of Verdura integration**: does building any integration against Idealpos (UI Automation or otherwise) affect Idealpos support/warranty terms for this venue?
15. **Whether UI Automation is permitted**: does Idealpos or the reseller approve, object to, or have no position on UI-Automation-based order entry (mirrors checklist item I's own first sub-bullet — restated here as part of the consolidated list, not a duplicate source of truth for the answer itself, which is still recorded only in the checklist)?
16. **Upgrade compatibility**: if Idealpos is upgraded (version, build, or module changes) after any integration is built, what compatibility/notification process exists so Verdura isn't silently broken by a vendor-side update?

---

## 13 — Adapter Boundary Decision: Preferred vs. API-less Interim

**Decision (see DL-066):** Idealpos integration is architected behind a single, replaceable adapter boundary with two potential implementations. Neither is available today; both are gated.

### 13.1 — Preferred future adapter (vendor-supported)

A documented, licensed, vendor-supported Idealpos Online/ecommerce interface, Doshii integration, or other approved Idealpos SDK/API. This **remains the preferred option** whenever it is commercially and technically available, and stays preferred even after an API-less interim adapter is built and proven — the interim adapter does not change this preference order.

**Not available until all of the following are confirmed in writing:** the installed Idealpos version/build; module/licence entitlement covering the relevant interface; commercial terms (cost, contract, reseller involvement); sandbox/test access; the exact acknowledgement/transaction-reference contract. §12's finding of `ProcessDoshiiService` and an Online/Ecommerce service architecture is *capability evidence only* and must not be read as availability.

### 13.2 — API-less interim adapter (proposed, Verdura-managed, unproven)

A controlled Windows UI integration consisting of two separate local processes — the **Verdura Connector** and the **Idealpos POS Bridge** — specified in §14. This is a **Verdura-managed interim adapter requiring controlled validation and operational acceptance**, not a vendor-supported integration. It must never be described as vendor-supported or vendor-endorsed unless Idealpos (or its reseller) provides written approval for UI-automation-based order entry. Absent that approval, this path is Verdura's own engineering risk to accept, disclosed as such to the venue operator before any pilot.

Both options remain `BLOCKED ON: DL-064` for anything beyond the truthfulness fix already shipped in story 9-1. The API-less path additionally requires the live discovery evidence in §19 and a successful tracer bullet (§20, story `9-2`) before any production commitment.

---

## 14 — API-less Interim Adapter Architecture (Verdura Connector + Idealpos POS Bridge)

Two separate Windows processes, because a Windows Service cannot safely automate an interactive desktop session:

### 14.1 — Verdura Connector

A modern Windows Service — provisionally **.NET 8**, subject to revision if live discovery (§19) or implementation identifies a better-supported runtime for the target venue's Windows version. Responsibilities:

- Outbound-only, mutually authenticated communication to Verdura (no public inbound exposure of Idealpos; no shared cloud Redis credential — consistent with target-operating-model.md §8 and story 2-9).
- Venue-bound, revocable installation identity (implements story 2-9's identity/pairing/revocation contract; §2-9's file has a forward-reference note — see below).
- Encrypted, durable local command queue; **persist the command locally before reporting durable acceptance**.
- Idempotent command handling, keyed by the identifiers in §16.
- Restart recovery and ordered replay where safe (never blind replay across an uncertain crash window — §16).
- Signed or otherwise controlled update mechanism.
- Health and capability reporting (Idealpos/Bridge reachability, queue depth, oldest command age — mirrors story 2-9 AC8).
- Audit correlation for every command and result.
- Communication with the interactive Bridge over a secured local IPC mechanism — **mandatory, not illustrative**: the channel (e.g. a named pipe) must have an explicit deny-by-default security descriptor/DACL restricting connection to the specific Connector and Bridge service accounts, must perform peer-process/session identity validation on every connection (not just at first handshake), and must protect message integrity against replay by a different local process. A named pipe created with default/permissive permissions, or peer validation treated as optional, does not satisfy this requirement. Never an unauthenticated localhost socket open to any process.

### 14.2 — Idealpos POS Bridge

A separate **interactive** Windows desktop process, running in a dedicated logged-in Windows session, responsible for driving the installed Idealpos UI through supported OS interaction. The dedicated session must run under a **non-administrator, least-privilege local account** scoped to only the Bridge application and Idealpos; it must not have remote-desktop (RDP) or other remote-interactive-logon rights, and must not double as a general-purpose staff or admin workstation session — an always-logged-in interactive session is a standing local attack surface if over-privileged or remotely reachable, and this constraint is normative, not optional. It:

- Is built and tested for compatibility with the installed **32-bit** Idealpos client (`IPSClient.exe`, confirmed 32-bit in §12.1).
- Uses **Windows UI Automation / accessibility identifiers first** to locate and drive Idealpos UI elements.
- May fall back to deterministic Win32 control handles and keyboard navigation only where accessibility support is inadequate — never as the first choice.
- Avoids fixed screen coordinates and image matching wherever possible; where unavoidable, treats them as the lowest-confidence, most drift-prone mechanism available.
- Serializes order entry — one in-flight order-entry operation at a time; no concurrent UI manipulation.
- Detects locked sessions, unexpected dialogs/pop-ups, application restarts, focus loss, and UI-version drift, and **fails closed** (reports `UNCERTAIN` or a blocking error) rather than guessing or retrying blindly into an unknown UI state.
- **Must not** directly access any Idealpos database (Access, SQLite, or SQL Server) under any circumstance.
- **Must not** invoke undocumented DLL/COM methods (including any of the method names recorded in §12.1) without written vendor approval — those names are recorded here as evidence of what exists, not as an approved integration surface.
- Reports `POS_CONFIRMED` (§16) only after obtaining and validating **authoritative, visible evidence from Idealpos itself** — e.g. an on-screen, Idealpos-issued transaction reference — never from its own UI-input success.

The Connector and the Bridge are architecturally separate for one reason: a Windows Service normally runs in Session 0 (no desktop), and Windows deliberately prevents non-interactive services from safely automating an interactive user session. The Bridge must run as an interactive process in a real logged-in session; the Connector must not.

---

## 15 — API-less Workflow

### 15.1 — In-person order (standard journey)

1. Verdura persists the order, its immutable commercial snapshot, the idempotency result, and the outbox POS command in one transaction (story 6-1's mechanism).
2. The Windows Connector durably persists the command locally.
3. The Connector reports durable acceptance (`CONNECTOR_ACCEPTED`) to Verdura.
4. Verdura releases independent KDS/KOT commands per the approved release rule (target-operating-model.md §5) — this does not wait for Idealpos confirmation.
5. The Bridge validates all venue, table, item, modifier, tender and terminal mappings (§17) against the command; a missing or invalid required mapping blocks submission (fails closed, never a fuzzy/description-based fallback).
6. The Bridge searches Idealpos for the existing Verdura external reference (§16) before doing anything else, to make retries idempotent.
7. If absent, the Bridge selects the mapped table and enters mapped items, modifiers, quantities and notes.
8. It stores the unique Verdura reference in a supported, searchable Idealpos field (field TBD — §19).
9. It saves the order as an **open/unpaid** Idealpos transaction.
10. It obtains and validates the Idealpos-issued/displayed transaction reference.
11. Verdura records `POS_CONFIRMED` only once steps 9–10 both succeed with visible Idealpos evidence.
12. Staff completes EFTPOS or cash payment through Idealpos as today.
13. Payment truth is later imported or reconciled from Idealpos — never inferred from kitchen-preparation state or connector/Bridge state (target-operating-model.md §7).

### 15.2 — Online/prepaid order

1. Verdura verifies the online payment provider result server-side.
2. Verdura and the Connector durably persist the order/command (as in §15.1 steps 1–3).
3. The Bridge searches for the external reference before creating anything.
4. The Bridge creates the mapped Idealpos order (as in §15.1 steps 5–9).
5. It applies the configured `ONLINE` or `PREPAID / ONLINE` tender mapping (§17).
6. It verifies amount, tender, transaction completion and the Idealpos reference.
7. Verdura stores both external references (provider reference and Idealpos transaction reference).
8. KDS/KOT release follows the documented paid-order rule (target-operating-model.md §4).
9. Reconciliation compares provider, Verdura and Idealpos amounts and states.

---

## 16 — Idempotency, Crash-Window and Uncertain-Outcome Rules (normative)

- Every command carries an immutable command ID, Verdura order ID, order version, venue ID, connector installation ID, and a searchable external reference.
- The external reference uses a provisional format similar to `VERDURA-{venue}-{orderNumber}-V{version}`, **subject to whatever field-length and permitted-character restrictions live discovery (§19) proves** — the exact field and its constraints are a discovery item, not assumed.
- **Search-before-create is mandatory on every single attempt at the Idealpos UI, with no exception** — the first attempt, any retry after a proven-pre-submission failure, and any retry after `UNCERTAIN` reconciliation clearance (below) each independently re-run the full search step before touching table/item entry. No code path may skip the search because "this is a retry" or "we already searched once this session."
- The search step itself (read-only against Idealpos) is treated the same as any other pre-entry step for crash-window purposes: a crash/timeout/disconnect **during** the search, before any table/item entry has begun, is a proven-pre-submission failure and is retryable (which itself re-runs the search).
- **Crash-window boundary (normative, no undefined middle state):** the boundary between "retryable" and "`UNCERTAIN`" is the **first UI action that mutates Idealpos state** — selecting/opening the table or entering the first line item — not the later Save/Finalise click. Any crash, timeout, focus loss, or disconnect **at or after** that first mutating action, through and including Save/Finalise, **must become `UNCERTAIN`**. Only a crash/timeout/disconnect strictly **before** any mutating action (i.e. during search, mapping validation, or Bridge idle/connection-setup) is retryable. This is deliberately conservative — the Idealpos UI's actual partial-entry/autosave behaviour is unverified (§12.2), so nothing between "no mutation attempted" and "Save reached" may be assumed safe to blindly retry.
- A duplicate or replayed command returns the stored result rather than creating a second Idealpos transaction.
- `UNCERTAIN` is **never automatically resubmitted** without reconciliation first.
- Reconciliation of an `UNCERTAIN` outcome first searches Idealpos using the external reference. Exactly one of three outcomes follows: (1) **found and validated** — the Idealpos reference is stored and the order transitions truthfully to `POS_CONFIRMED`; (2) **confirmed absent** — a staff member with reconciliation authority has affirmatively checked and the transaction does not exist in Idealpos under the external reference or any plausible near-match; this clears the record for exactly one fresh, fully re-executed attempt (new attempt, same idempotency key, full search-before-create workflow re-run from the top) rather than leaving the order permanently stuck; (3) **not determinable** (neither found nor confirmed absent, e.g. Idealpos itself is unreachable or the search is inconclusive) — requires manual review with no further automated action until a human resolves it to outcome (1) or (2).
- Any Connector–Bridge local IPC failure (dropped connection, timeout, no acknowledgement) after a command was dispatched to the Bridge but before the Bridge returns a terminal result (confirmed, proven-pre-submission failure, or `UNCERTAIN`) is itself treated as `UNCERTAIN` for that command — the Connector must not assume non-delivery just because it stopped hearing from the Bridge.
- **Concurrency (queue-level, not just UI-level):** "the Bridge serializes order entry" (§14.2) means the Connector must not dispatch a second command to the Bridge until the Bridge has returned a **terminal** result for the command currently in flight (confirmed, failed, or `UNCERTAIN`) — never merely "until Save was clicked." This closes the gap where a second command's search-before-create step could run before the first command's transaction is actually searchable in Idealpos (an unverified index/commit-visibility lag — §12.2). Two concurrent command submissions to the Connector are queued and processed one-at-a-time by the Bridge under this rule; the Connector's own queue ordering, not client-side timing, is what guarantees at most one Idealpos transaction per external reference.
- No Idealpos reference is ever fabricated, under any circumstance.
- Successful UI input (a field was typed, a button was clicked without visible error) is **never** treated as proof that Idealpos saved the transaction — only an obtained, validated, Idealpos-issued/displayed transaction reference is.
- Story 9.1's current truthful `unsupported` behaviour is preserved as-is until a real adapter (vendor-supported or API-less) is implemented and proven; nothing in this section makes `synced`/`pos_confirmed` reachable in the current codebase. The richer future POS state model (`queued`/`connector_accepted`/`pos_submitted`/`pos_confirmed`/`failed`/`uncertain`/`manual`/`not_applicable`) already documented in `docs/domain-model.md` and `docs/target-operating-model.md` §6 is sufficient to express this workflow — no new enum values are introduced by this section.

---

## 17 — Mapping Contract (versioned, venue-scoped)

Every one of the following must be an explicit, versioned, venue-scoped mapping row before it can be used — never inferred, never description-matched:

- Verdura venue → Idealpos site and terminal
- Verdura table → Idealpos table / table-map entry
- Menu item → Idealpos stock item code
- Modifier and instruction → Idealpos modifier/instruction code
- Quantity and price rules
- Tax treatment
- Sale type
- Dedicated automation clerk/user (the Idealpos user account the Bridge operates as)
- In-person unpaid-transaction behaviour (which tender/state represents "open/unpaid")
- Online/prepaid tender (`ONLINE` or `PREPAID / ONLINE`, per §19 confirmation of which is configured)
- External reference field (§16, §19)
- Order source
- Kitchen/KOT ownership (§18)

**A missing or invalid required mapping blocks submission safely** — the Bridge must not substitute a similarly-named item, a default table, or a best-guess tender. Mapping changes are audited and versioned so historical orders remain explainable against the mapping version effective at submission time (mirrors the existing preparation-station routing versioning pattern in target-operating-model.md §5).

---

## 18 — KDS/KOT Duplicate-Print Blocking Decision

Verdura is the intended owner of KDS and physical KOT routing for Verdura-originated orders (target-operating-model.md §5, DL-063). This is unchanged by the API-less adapter architecture.

**Blocking discovery requirement (§19):** whether Idealpos kitchen printing can be suppressed for Verdura-originated orders, scoped to one or more of: the dedicated automation terminal, the dedicated automation clerk, a sale/order source, or the chosen order-entry workflow. **No production pilot may allow both Verdura and Idealpos to independently print the same KOT.**

If selective Idealpos suppression proves impossible, the operating model does not change silently. A formal decision is required between:

1. **Verdura owns KDS and physical KOT; Idealpos printing is disabled for Verdura-originated orders** (default — consistent with DL-063 as already written).
2. **Verdura owns KDS while Idealpos owns physical KOT for API-less orders; Verdura suppresses its own corresponding physical print commands for those orders.**

Option 2 requires an explicit architecture/TOM decision plus end-to-end duplicate-prevention evidence before it may be adopted — it is not selectable by default and is not selected by this planning session. See DL-067.

---

## 19 — Live Discovery Work Package

The full, bounded checklist lives in [`../discovery/idealpos-live-discovery-checklist.md`](../discovery/idealpos-live-discovery-checklist.md) — created 2026-08-16, expanded 2026-08-16 (session 2, story `9-2`) with additional items, status **not started** (no item has live-observation evidence; every answer to date is either static-file evidence per §12/§12.4 or a `BLOCKED` placeholder). It is a prerequisite for: unblocking DL-064 beyond the truthfulness fix, unblocking story `9-2`'s remaining (post-discovery-tracer) scope (§20), and any KDS/KOT suppression decision (§18). No secret values (licence keys, credentials, certificate contents) may be recorded by that discovery work — only whether a capability/setting exists.

---

## 20 — Tracer Bullet Story (pointer)

`_bmad-output/implementation-artifacts/9-2-idealpos-uibridge-tracer.md` — **status `blocked`**, gate `REAL_WINDOWS_CONNECTOR + REAL_IDEALPOS_UI_DISCOVERY evidence required`. Rescoped 2026-08-16 (session 2) from a demo/clone-environment order-entry tracer to a real-environment discovery-only tracer, per that session's governing brief — see the story file's own "Scope correction" section for the full reasoning; this pointer is not restated here to avoid drift between the two documents. A minimal, modern .NET discovery tracer (`windows-connector/`, DL-071) was implemented and tested this session for every part achievable without live Windows/Idealpos access; the integration route (§13.2's API-less interim adapter, discovery phase only) was selected from real static evidence. Live discovery itself, and the original order-entry frozen intent, remain outstanding — see the story file's Blocking Gate.

---

## 21 — Delivery Sequence (authoritative, Idealpos work)

1. Record safe local installation evidence — **done** (§12/§12.4, this document, 2026-08-16).
2. Complete live Windows discovery — **not started** (§19) — **the current bottleneck**, blocking everything below.
3. Resolve connector identity and durable command transport — story `2-9` (identity) **done**, story `2-10` (command/acceptance protocol) **done**, both 2026-08-16.
4. Execute the non-production UI-bridge tracer — story `9-2`, **discovery phase implemented and tested 2026-08-16** (§20); **blocked** on step 2 for its remaining (live-discovery-dependent) scope.
5. Decide whether the API-less adapter is viable, manual-assisted, or blocked, based on tracer evidence — not yet reached; requires step 2.
6. Implement production-grade mapping, recovery, observability and reconciliation — only after step 5 confirms viability.
7. Execute real-venue UAT with Idealpos/EFTPOS/KDS/KOT evidence.

No step may be skipped or reordered; in particular, full adapter implementation (E9-S3–S7) is not scheduled ahead of steps 2 and 4. See DL-068. Step 3 is now fully satisfied — step 2 (live Windows discovery) is the sole remaining bottleneck for steps 4 (rest), 5, 6 and 7.
