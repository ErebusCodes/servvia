# Servvia PRD — Volume 01: Home

> **Authority / status:** Normative Servvia domain volume under [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict, and under the conventions and invariants of [`00-overview-and-conventions.md`](00-overview-and-conventions.md). Version label **v5.1 (Servvia)**. Last updated 2026-10-05.
> **Provenance:** Servvia baseline (SPRD §4, §7 ADM-1, §10 NFR-PERF/NFR-REL/NFR-A11Y, §15 rows F/N/AG, §16, §18.11, §20, §22, §23) plus enterprise hardening (basis `E`). Home mechanisms (exception lifecycle, notification delivery state, system follow-ups, freshness indicators) were adapted from the Verdura v5.2 Home volume as non-authoritative source material (00.3). Verdura's integration "sync health" thesis, POS-handoff widgets and phase gates are superseded and are not carried. Owner-approved KitchenOS capabilities (basis `K`, owner decision 2026-10-05, DEC-X-1) add AI insight display and finance-summary and cross-domain tiles as `TARGET CAPABILITY — FUTURE DELIVERY`; KitchenOS realtime KPI displays, drill-down and staff notifications are already covered by HOME-5, HOME-10, HOME-12 and HOME-14.
> **Scope in one line:** the Admin Console's operational landing view: what needs attention now, for the venues the signed-in user is responsible for, with a truthful statement of how current each fact is and a route to the record that owns it.
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 01.1 Purpose, scope and state

Home is an **operational home**, not a vanity dashboard. It answers one question for the signed-in staff member: *which exceptions, health signals and follow-ups in my scope need action, and how current is that information?* Home owns no business facts. It projects facts owned by other domains (orders, kitchen, payments, devices, Venue Edge, events and workers, reservations, reporting), filtered by the user's verified scope and permissions, and links every item to its owning record. The only state Home introduces is attention state: notification delivery and read/acknowledgement state, exception acknowledgement and ownership claim, and follow-up tasks.

| Capability | State | Basis |
|---|---|---|
| Admin Console shell, navigation and venue switcher | CURRENT (Admin Console, Nest-backed) | S (SPRD §4, VEN-1) |
| Live orders and reservations views (ADM-1) | TRANSITIONAL (served from Nest; moves to Core with each domain, §34.2) | S |
| Operational home view (exception queue, health summary, KPI summary, freshness) | TARGET | S+E (NFR-REL, §18.11, §20.8, row AG) |
| Exception items with acknowledgement and ownership claim | TARGET | S+E (§17.10, §18.5, row AG) |
| In-app notifications with per-recipient delivery state | TARGET | S+E (NFR-REL "admin alerting", PRT-2) |
| Email delivery of staff notifications | CURRENT (Nest email) for existing mails; TARGET for alert mail | S (00.7) |
| Push and SMS channels | OWNER DECISION REQUIRED (DEC-X-15) | D |
| System follow-up tasks bound to a source exception | TARGET | E |
| Manual tasks, due dates, escalation chains | FUTURE (DEC-HOME-5) | V(01 §3.4)+D |
| KPI summary tiles using volume 08 metric definitions | TARGET for RPT-1 metrics, including the P11 Net Sales (incl. GST) headline (SHOULD); TARGET CAPABILITY — FUTURE DELIVERY for finance-summary and cross-domain tiles (HOME-28) | S (RPT-1)+K(L219, L418–422) |
| AI insight display (labelled predictions and recommendations with evidence, as-of and confidence; INV-21) | TARGET CAPABILITY — FUTURE DELIVERY (HOME-27) | K(L239, L621)+E |
| Data freshness indicators per tile and per item | TARGET | S+E (PR-4, INV-14) |
| Platform operator health view (cross-organization) | TARGET | S (§20.4 "platform-level operator view is required") |
| Personal layout customization | FUTURE (DEC-HOME-10) | V(01 §3.2) |
| Command search and command execution palette | FUTURE | V(01 §5.4)+S (00.7 Search FUTURE) |
| Widgets for owner-approved future domains (stock, recipes and production, labour, CRM and loyalty, finance summary) | TARGET CAPABILITY — FUTURE DELIVERY, available only as each source domain is delivered (DEC-X-17; HOME-28) | S (SPRD §13 long-term scope)+K(L219, L418–422) |
| Approval widgets | FUTURE with the shared approvals capability (00.7) | V(01 §3.4) |
| Integration "sync health" and POS-handoff widgets (Verdura) | SUPERSEDED (Servvia is the POS) | S (ADR 0001) |
| Legacy external-POS status shown in the Admin Console today | TRANSITIONAL, retire with the Nest external-POS surfaces (§34.2); no new Home content is built on it | S |

## 01.2 Actors and surfaces

| Actor | Home use | Notes |
|---|---|---|
| Owner | Exceptions, health and KPIs for all venues of the organization; follow-ups | SPRD §3 |
| Admin (platform administrator of the organization) | Configuration and device health exceptions in addition to operational ones | SPRD §3 "Platform administrator" |
| Manager | Venue-level exceptions during service; acknowledgement and claim | SPRD §3 |
| Cashier | Exceptions that a cashier may resolve (for example an uncertain payment on a check they can access), if granted Admin Console access | Role-to-content mapping DEC-HOME-2 |
| Kitchen | Kitchen delivery exceptions only, if granted Admin Console access | DEC-HOME-2 |
| Viewer | Read-only Home; no acknowledgement or claim. Has no Core realtime grant (contracts/realtime), so its Home refreshes over HTTP | DEC-X-2 |
| Servvia platform operator (support) | Cross-organization health (worker backlog, dead letters, Edge heartbeat) under authorized, audited support access | Row AG; volume 09 (ADMIN support access); DEC-ADMIN-19 |
| System (workers, monitors) | Raises exceptions and notifications; auto-resolves items when the source resolves | INV-3 system identity |

**Surfaces.** Home is an **Admin Console** view only (`apps/web/admin-console/`). It is not a view of the Waiter Tablet, KDS, Kiosk or Window Display, and nothing in this volume defines Windows POS behaviour (frozen, SPRD §12). Device identities (D8 credentials, tablet and KDS tokens) never reach Home (NFR-SEC-1, INV-3).

## 01.3 Domain model and ownership

```text
StaffAccount (verified credential: organization, role, venue grants)
  └─ HomeView (projection, not stored) ── composed of:
       ├─ ExceptionItem (attention record) ──> SourceCondition (owned by the source domain)
       ├─ HealthSignal (projection of §20 signals, scoped)
       ├─ KpiTile (projection of a volume 08 metric) ── FreshnessStamp
       ├─ InsightCard (projection of an AI output from `data/`, INV-21) ── FreshnessStamp   [TARGET CAPABILITY — FUTURE DELIVERY]
       ├─ NotificationDelivery (per recipient × channel) ──> Notification ──> SourceEvent
       └─ FollowUpTask ──> ExceptionItem or source record (optional for manual tasks)
StaffAccount ── NotificationPreference (category × venue set × channel), bounded by mandatory categories
```

| Object | Canonical owner (target) | Current |
|---|---|---|
| SourceCondition (uncertain payment, reconciliation item, failed print job, KDS delivery failure, stuck order, Edge heartbeat loss, dead letter, worker backlog, availability recovery action, shift variance, reservation awaiting confirmation) | The owning domain (Core `payments`, `kitchen`, `orders`, `events`/`workers`, `devices`, `shifts`; Venue Edge for hardware; reservations per O-7) | Mixed: Nest for live clients; Core D4, D6, D7, D13 implemented, not in production |
| ExceptionItem (attention state over a SourceCondition) | Core `notifications` (target package named in SPRD §30.3, not created) | Not created |
| Notification, NotificationDelivery, NotificationPreference | Core `notifications` | Nest sends email; no in-app notification record |
| FollowUpTask | No Core package in Part C; ownership is DEC-X-13 | Not created |
| HealthSignal | Core `health` and observability (§20) and Venue Edge diagnostics (EDGE-3) | Core health and organization-scoped worker backlog implemented, not in production |
| KpiTile | Reporting (volume 08); metric semantics are volume 08's | Nest reporting (basic) |
| InsightCard | AI output owned by `data/` (Python, outside the transaction path; SPRD §4, §29); insight semantics and catalogue are volume 08's; never canonical (INV-21) | Not created |
| HomeView, FreshnessStamp | Projection; not persisted | — |

Home never copies a source record into its own store. An ExceptionItem holds a reference (source type, source identifier, venue, organization), a summary safe for the item's audience, severity, and attention state.

## 01.4 Business objects and lifecycles

### 01.4.1 ExceptionItem

Fields that matter: `id`; `organizationId`; `venueId` (null only for platform-level items visible to platform operators); `exceptionClass` (catalogue 01.4.5); `sourceRef` (type and identifier); `severity` (taxonomy DEC-HOME-3); `dedupeKey`; `occurrenceCount`; `firstSeenAt`, `lastSeenAt`; `state`; `claimedBy` (staff identity, optional); `acknowledgedBy`, `acknowledgedAt`; `resolvedAt`, `resolution` (`source_resolved` or `superseded`); `version`.

```text
open ──acknowledge──> acknowledged ──(source resolves)──> resolved
  │                         │
  └──────(source resolves)──┴──> resolved
resolved ──(same dedupeKey recurs)──> open   (new occurrence, history kept)
```

Invariants:
- **Resolution is derived from the source, never declared on Home.** A user cannot mark an ExceptionItem resolved while its SourceCondition is unresolved (INV-14). Resolution happens in the owning surface (for example reconciling an uncertain payment per PAY-6, retrying a print job per ADM-2).
- Claim and acknowledgement are attention facts. They change nothing in the source domain and never imply recovery.
- Transitions use version compare-and-set (INV-10); a stale acknowledgement or claim is refused with a stable error.
- Repeated occurrences with the same `dedupeKey` while the item is not resolved increment `occurrenceCount` and update `lastSeenAt`; they never create a parallel item.

### 01.4.2 Notification and NotificationDelivery

A Notification is an immutable message derived from a SourceEvent or ExceptionItem (category, severity, venue, title, safe summary, `sourceRef`). A NotificationDelivery exists per recipient and channel:

```text
pending ──> delivered ──> read ──> acknowledged (only for categories requiring acknowledgement)
pending ──> failed_retrying ──> delivered
failed_retrying ──(attempt limit)──> failed
```

Invariants: a delivery records attempts, last error class and timestamps; `delivered` means the channel confirmed acceptance, never that the person saw it (INV-14); a `failed` delivery is visible to the recipient's administrators and in monitoring (§18.5). In-app read and acknowledgement state is per recipient and consistent across that user's sessions.

### 01.4.3 FollowUpTask

```text
open ──claim──> in_progress ──complete──> done
open / in_progress ──cancel (reason)──> cancelled
```

- A **system follow-up** is bound to an ExceptionItem. It closes automatically when the item resolves and cannot be completed manually while the source is unresolved; cancellation requires a reason and is audited.
- `overdue` is derived from `dueAt` (FUTURE, DEC-HOME-5), never stored.
- Manual tasks (no source) are FUTURE (DEC-HOME-5).

### 01.4.4 FreshnessStamp

Each tile and each list carries `asOf` (the source's data time, not the render time) and a freshness state: `live` (realtime subscription healthy and data refetched after `subscribed`), `delayed`, `stale`, `unavailable` (source error). The thresholds separating `live`, `delayed` and `stale` are DEC-HOME-4.

### 01.4.5 Exception catalogue (mechanism; thresholds and severities are decisions)

| Exception class | Source owner | Raised when | Resolved when | Basis |
|---|---|---|---|---|
| Uncertain payment outcome | Core `payments` (CARD3 adapter path) | A terminal or provider result is held as uncertain | Reconciled per PAY-6 | S (PAY-6, §17.12) |
| Payment reconciliation item | Core `payments`; volume 07 | A failed, stuck or mismatched item enters the reconciliation queue | Item closed in the reconciliation surface | S (§17.10, §18.11) |
| Print job failed | Venue Edge / printer domain | A job enters `failed` after its retries | Job retried successfully, reprinted or cancelled with reason | S (PRT-2, ADM-2) |
| KDS delivery failure | Core `kitchen` | A ticket's KDS delivery state is not confirmed within the threshold | Delivery confirmed or ticket resolved | S (KIT-2) + D (threshold) |
| Stuck order | Core `orders` / `kitchen` | An order or ticket remains in a non-terminal state beyond the threshold | It advances or is resolved | S (§18.11) + D |
| Venue Edge heartbeat missing | Venue Edge | Heartbeat absent beyond the threshold | Heartbeat resumes | S (EDGE-3, §18.11) + D |
| Dead letter | Core `events`/`workers` | A consumer dead-letters an event | An authorized operator retries it successfully or discards it with reason | S (§18.5, §18.11) |
| Worker backlog | Core `workers` | Oldest pending age or depth exceeds threshold | Backlog drains below threshold | S (§20.4) + D |
| Availability propagation failure | Menu/availability (volume 02) | A channel fails to apply an "86" change | Recovery action completed | S (AVL-1) |
| Shift cash variance | Core `shifts` | A shift closes with a non-zero variance | Variance reviewed in the shift surface (policy volume 07) | S (D7) + D |
| Reservation awaiting confirmation | Reservations (O-7) | A pending reservation exists | Confirmed, cancelled or marked no-show (ADM-1) | S (RES-1, ADM-1) |
| API error rate | Platform observability | Error rate exceeds threshold | Rate recovers | S (§18.11) + D; platform operator audience only |

Alert thresholds are **OWNER TARGET REQUIRED** (SPRD §20.7); Home consumes them and invents none.

## 01.5 Requirements

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| HOME-1 | Home is the Admin Console's default landing view after sign-in for every role granted Admin Console access. Its content is composed server-side from the verified credential's organization, role and venue grants; the client never supplies scope (INV-2). | MUST | TARGET | S+E (NFR-SEC-1, §16.3) |
| HOME-2 | Home shows the context it is scoped to (organization name and either one selected venue or "all venues I can access") and changes it only through the VEN-1 venue switcher. A switch refetches every tile. | MUST | TARGET | S (VEN-1) |
| HOME-3 | Every Home element (tile, count, list row, notification, search result) is authorized with the same permission as its source record. Home never widens access: a count includes only records the user could open, and an element the user may not see is omitted, not masked. | MUST | TARGET | S (§16.2, INV-4) |
| HOME-4 | Home presents an exception queue drawn from the catalogue in 01.4.5, ordered by severity then age, filtered to the user's scope and to the classes their role may act on or view (DEC-HOME-2). | MUST | TARGET | S+E (§18.11, row AG) |
| HOME-5 | Every exception item, health signal and KPI tile links to the owning record or surface (drill-down). The drill-down re-authorizes; if the record is no longer accessible or no longer exists, the user sees a permission-denied or not-found state, never stale data presented as current. | MUST | TARGET | S+E (§22)+K(L419) |
| HOME-6 | An exception item is resolved only by the resolution of its source condition (01.4.1). Home offers no "resolve", "dismiss" or "hide" action that suppresses an unresolved source. | MUST | TARGET | S (PR-4, INV-14) |
| HOME-7 | Authorized users can acknowledge and claim an exception item. Acknowledgement and claim are attributed, version-checked, audited and visible to other users in scope; they do not alter the source. | MUST | TARGET | E (INV-10, INV-15) |
| HOME-8 | Recurrences of the same condition are coalesced by `dedupeKey` into one open item with an occurrence count and first/last seen times. | MUST | TARGET | V(01 §3.3)+E |
| HOME-9 | Every tile and list shows its `asOf` time in the venue time zone (INV-8) and its freshness state (01.4.4). A source failure renders the tile as `unavailable` with the last good value and its `asOf`, or with no value if none exists; it never renders a blank, zero or fabricated value as current. | MUST | TARGET | S (PR-4, INV-14) + E |
| HOME-10 | Home uses Core realtime notifications to refetch over HTTP (NFR-RT). When the realtime connection is lost, Home shows that live updates are paused, keeps the last data with its `asOf`, reconnects, and refetches after `subscribed`. Roles without a realtime grant (viewer) refresh over HTTP and see `asOf`. | MUST | TARGET | S (NFR-RT, contracts/realtime)+K(L376–378, L418) |
| HOME-11 | A health summary shows, for the user's scope: Venue Edge heartbeat, version, queue depth and oldest queued age per venue (EDGE-3); device revocation or credential-failure counts (volume 09); worker backlog and dead letters for the organization (§20.4). Platform-wide signals are visible only to platform operators under support access. | MUST | TARGET | S (EDGE-3, §20.4–20.5) |
| HOME-12 | KPI tiles display only metrics defined in volume 08, cite the metric definition, state the business-date basis (INV-8, DEC-X-3) and mark values for an open business day as provisional. Home defines no metric. | SHOULD | TARGET | S (RPT-1) |
| HOME-13 | A multi-venue rollup aggregates only metrics whose volume 08 definition is additive across venues, and refuses to sum amounts in different currencies (INV-6, DEC-X-11). | SHOULD | TARGET | S+E |
| HOME-14 | In-app notifications are created for exception items and configured events, with per-recipient delivery state (01.4.2). The notification centre lists them with category, severity, venue, age, occurrence count and drill-down. | MUST | TARGET | S+E (NFR-REL, PRT-2)+K(L376, L414) |
| HOME-15 | Categories designated mandatory (DEC-HOME-6) cannot be muted or disabled by a recipient; other categories are configurable per recipient by category, venue and channel within those floors. | MUST | OWNER DECISION REQUIRED (category list) | V(01 §3.3)+D |
| HOME-16 | Categories requiring acknowledgement record who acknowledged and when. Escalation of an unacknowledged notification to another recipient, and its timing, follow DEC-HOME-6. | SHOULD | FUTURE | V(01 WF-H2)+D |
| HOME-17 | Notification delivery over email or other channels retries with bounded backoff (§18.3); a final failure is recorded on the delivery, visible to the organization's administrators, and counted in monitoring. A delivery failure never blocks the source transaction. | MUST | TARGET | S (§18.3, §18.5) |
| HOME-18 | Notification content carries only what the audience needs: no secrets, credentials, card data, provider references or unnecessary personal data (§20.9, INV-18). Guest personal data appears only to roles permitted to see it at the source. | MUST | TARGET | S (row C, §20.9) |
| HOME-19 | A system follow-up task is created when an exception class is configured to require an owner. It references the exception item, auto-closes on resolution, and cannot be completed while the source is unresolved; cancellation requires a reason and is audited. | SHOULD | TARGET | V(01 WF-H3)+E |
| HOME-20 | Manual tasks, due dates, checklists, recurring tasks and escalation chains are not committed (DEC-HOME-5). | MAY | FUTURE | V(01 §3.4) |
| HOME-21 | Every Home screen element provides the SPRD §22 states (loading, empty, error, retry, offline or degraded, permission denied) at tile level, so one failing source never blocks the rest of Home. | MUST | TARGET | S (§22) |
| HOME-22 | During the transition Home sources each fact from the system that is the system of record for that venue and capability at that time (Nest or Core), labels nothing as live that comes from a system not serving the venue, and adds no new content built on legacy external-POS surfaces. | MUST | TARGET (mechanism approved 2026-10-05: DEC-BI-8, which consolidates DEC-HOME-1) | S (PR-7, §34.2) |
| HOME-23 | Home's initial render meets the Admin Console initial-load target (under 2 s on 10 Mbps, NFR-PERF; O-19); tiles may complete progressively after first render, each showing its loading state. | MUST | TARGET | S (NFR-PERF, §19) |
| HOME-24 | Acknowledgement, claim, task cancellation, preference changes to mandatory-adjacent categories and support-operator views of Home emit audit records (INV-15). Reading Home is not audited except under support access. | MUST | TARGET | S (NFR-AUD, row AG) |
| HOME-25 | Command search (scoped search over records, pages and actions) and command execution from a palette are not committed. If committed, a command executes through the same API, authorization, idempotency and audit path as the native page. | MAY | FUTURE | V(01 §5.4, WF-H4)+S (00.7) |
| HOME-26 | Personal layout customization is not committed (DEC-HOME-10); until decided, Home layout is defined per role by configuration. | MAY | FUTURE | V(01 §3.2) |
| HOME-27 | Home displays AI output only as labelled insights. An insight is a prediction or recommendation produced in `data/` under INV-21 and catalogued in volume 08; each insight on Home shows the AI label, its class (prediction or recommendation), the evidence or metrics it rests on, its as-of time basis (INV-8), its confidence or known limitations, and a drill-down to its source metric or record. An insight is never rendered as a fact, a KPI value or an exception item; it never raises, acknowledges or resolves an exception; and no action executes from the insight on Home. A recommended action is carried out, if at all, in the owning surface by an authorized person through the normal authorized path, attributed to that person and to the AI source (assisted action, INV-21, INV-5). An insight is shown only to users permitted to read every source it rests on (HOME-3). When the insight source is unavailable or older than its freshness threshold (DEC-HOME-4), the insight shows `unavailable` or `stale` with its as-of time (HOME-9) and is never presented as current. Autonomous action from Home is not permitted (DEC-X-19). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | K(L239, L621)+E (INV-21) |
| HOME-28 | Finance-summary tiles and cross-domain tiles (for example sales against labour, food cost, stock or loyalty measures) appear on Home only for metrics defined in volume 08's metric catalogue (08.12), cite that definition, and appear only once every source domain the metric depends on is delivered (DEC-X-17); until then the tile is absent, never shown as zero or estimated. The sales headline on any tile is the P11 Net Sales (incl. GST) measure, labelled as an operational measure and not as tender, settlement or accounting revenue (00.10.5, DEC-FIN-2). Financial-class tiles are shown only to roles permitted to read the underlying financial data (HOME-3, DEC-HOME-2), and follow HOME-9 (freshness), HOME-12 (provisional open business day) and HOME-13 (additive, single-currency rollup). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY (the P11 headline tile for RPT-1 metrics is TARGET under HOME-12) | S (RPT-1, P11)+K(L219, L418–422) |

## 01.6 Workflows and failure paths

**WF-HOME-1 Service-time triage (manager).**
1. The manager signs in to the Admin Console (server-side authentication before the bundle loads, NFR-SEC-1). Home renders for the last selected venue they still have access to; if that grant was removed, Home falls back to "all venues I can access" or an empty state.
2. The exception queue shows, for example, one uncertain card outcome and two failed print jobs. Each row shows class, venue, age, occurrence count, claim state and freshness.
3. The manager claims the uncertain payment (HOME-7) and drills down to the check (HOME-5). Reconciliation happens in the payment surface under PAY-6; on resolution the item moves to `resolved` and any follow-up closes (HOME-19).
4. The failed print jobs drill down to the printer job queue (ADM-2) where the job is retried or reprinted (attributed, PRT-1).
- **Concurrency:** two managers claim the same item; the second claim fails the version check and shows the current claimant. Neither action affects the source.
- **Authorization failure:** a cashier without access to the check sees no such item; a direct drill-down link returns permission denied.

**WF-HOME-2 Notification lifecycle.**
1. A source domain commits a change with its domain event (INV-13). The notification consumer (at-least-once, idempotent by event id) evaluates rules and preferences.
2. One Notification is created per dedupe window (HOME-8); deliveries fan out per recipient and channel.
3. Channel failure retries with bounded backoff, then `failed` (HOME-17). The consumer dead-letters on non-retryable errors, which itself appears as a dead-letter exception for operators.
4. The recipient reads and, where required, acknowledges; read state is consistent across their sessions.
- **Duplicate event delivery:** the same event id produces no second notification.
- **Recipient lost access** between creation and delivery: the delivery is cancelled at send time after re-checking authorization; content is never sent to a recipient no longer in scope.

**WF-HOME-3 Degraded Home.**
1. A tile's source returns an error or times out: that tile shows `unavailable` with its last good value and `asOf` (HOME-9); other tiles render.
2. The realtime connection closes (expiry, slow consumer, server drain): Home shows "live updates paused", reconnects with backoff, and refetches after `subscribed` (HOME-10). A revoked or expired credential ends the session per volume 09.
3. Core or Nest unavailable: Home shows which sources are unavailable; no counts from those sources are shown as zero.
4. Browser offline: the last rendered state stays visible with an explicit offline banner and no actions are accepted.

**WF-HOME-4 Platform operator health view.** A Servvia platform operator, under authorized and audited support access (volume 09), views cross-organization signals (worker backlog, dead-letter age, Edge heartbeat). Access, its scope and its duration are recorded; the customer organization's administrators can see that support access is active (volume 09).

## 01.7 Security, authorization and audit

- **Principle:** Home is a lens, not a permission. Each element is authorized by the source permission (HOME-3), evaluated server-side per request and per realtime subscription (§16.2, INV-4). Aggregates are computed only over records the requester could read; Home exposes no count that would reveal the existence of out-of-scope records.
- **Identity classes:** only named staff sessions reach Home (INV-3). Tablet, KDS and D8 device credentials are refused (StaffSessionOnly behaviour, volume 09).
- **Authorization matrix (Home actions).** Per-role defaults are policy (INV-20, DEC-X-2, DEC-HOME-2); the table states mechanisms and the minimum boundaries.

| Action | Mechanism | Boundary |
|---|---|---|
| View Home | Staff session with Admin Console access | Scope from credential |
| View an exception class | Read permission on the source record class | Omitted if not permitted |
| View an AI insight (HOME-27) | Read permission on every source metric or record the insight rests on | Omitted if not permitted; no action executes from the insight |
| Acknowledge or claim | Permission to act on the source record class | Viewer never |
| Cancel a system follow-up | Same as acknowledge, plus reason | Audited |
| Change own notification preferences | Own account only | Mandatory categories immutable (HOME-15) |
| Configure mandatory categories, role layouts | Organization administration permission (volume 09) | Audited configuration change (INV-17) |
| View platform-wide health | Platform operator under support access | Audited, visible to the organization (volume 09) |

- **Audit:** HOME-24. Audit records carry actor, action, item, before and after state, correlation id (INV-15).

## 01.8 Data governance

| Data | Class (INV-18) | Owner | Retention |
|---|---|---|---|
| ExceptionItem attention history | Internal | Core `notifications` | DEC-HOME-7 |
| Notification content | Internal; Personal where it names a guest or staff member | Core `notifications` | DEC-HOME-7 (personal data per DEC-X-4) |
| Delivery records (channel, attempts, error class) | Internal | Core `notifications` | DEC-HOME-7 |
| Recipient email and push addresses | Personal (employee) | Staff account (volume 09) | With the account (DEC-X-4) |
| KPI values | Financial or Internal per metric (volume 08) | Reporting | Not stored by Home |
| AI insights (HOME-27) | Class of the most sensitive source they rest on (INV-18) | `data/` per volume 08 | Not stored by Home |

- Home stores no copy of source records. Correcting a source fact is done in the source domain by its compensating mechanism (INV-11); Home reflects the correction on refetch.
- Notifications that name a person are excluded from exports unless the exporter is permitted to see that personal data at source.

## 01.9 Reliability, scalability and observability

- **Isolation of failure:** each tile fetches independently with its own timeout; a slow source never blocks first render (HOME-21, HOME-23).
- **Delivery semantics:** notification consumers are at-least-once and idempotent by event id (INV-13); realtime is a refetch hint, at most once per connection (NFR-RT).
- **Capacity:** concurrent Home users, notification volume and fan-out are capacity dimensions under DEC-X-8. No number is set here.
- **Performance:** NFR-PERF Admin initial load applies (HOME-23). Verdura's "attention within five seconds of login" and "dashboard load" figures are **proposed (Verdura evidence) — OWNER TARGET REQUIRED (DEC-HOME-8)**.
- **Observability signals (§20):** tile source error rate and latency per source; notification creation, delivery success, retry and final-failure counts per channel; oldest unacknowledged item of each mandatory category; exception items open by class and age; realtime reconnect counts for Admin Console sessions. Alert thresholds: §20.7 (OWNER TARGET REQUIRED).

## 01.10 UX and accessibility

- WCAG 2.1 AA including screen-reader support (NFR-A11Y, §23). Severity is conveyed by text and icon as well as colour; age and freshness are announced as text ("as of 14:02, delayed").
- §22 states at tile level (HOME-21); destructive or financially significant actions are never executed from Home itself in TARGET scope: Home routes to the owning surface where confirmations apply.
- Times are shown in the venue's time zone with the zone indicated when the scope spans several zones (INV-8).
- Keyboard: every tile, row and drill-down is reachable and operable by keyboard with visible focus.
- Empty states distinguish "no exceptions" from "source unavailable" (HOME-9).

## 01.11 Acceptance criteria

| ID | Scenario | Expected result |
|---|---|---|
| AC-HOME-1 | Happy path: a manager with grants to venues A and B signs in; venue A has one failed print job | Home renders scoped to the last selected accessible venue; the failed job appears with class, age, `asOf` and a drill-down to the ADM-2 job queue |
| AC-HOME-2 | Scope isolation: venue C (same organization, no grant) and organization Y each have an uncertain payment | Neither appears; exception counts exclude them; API responses contain no reference to them (tested on REST and realtime) |
| AC-HOME-3 | Client-supplied scope: the request names venue C explicitly | Refused (forbidden or not found per contract); nothing from venue C is returned |
| AC-HOME-4 | Authorization failure: a viewer attempts to acknowledge an item | Refused with a stable error code; item unchanged; no audit record of a state change |
| AC-HOME-5 | Concurrency: two managers claim the same item simultaneously | Exactly one claim succeeds; the other receives a version conflict and sees the current claimant |
| AC-HOME-6 | No false resolution: a user tries to resolve or dismiss an open uncertain-payment item from Home | No such action exists in UI or API; the item stays open until PAY-6 reconciliation resolves the source |
| AC-HOME-7 | Auto-resolution: the failed print job is retried successfully in ADM-2 | The item becomes `resolved` with `source_resolved`; any linked follow-up closes; both are audited |
| AC-HOME-8 | Duplicate/retry: the same domain event is delivered twice to the notification consumer | One notification exists; no duplicate deliveries |
| AC-HOME-9 | Storm: the same Edge heartbeat condition recurs 20 times while open | One open item with `occurrenceCount` 20 and correct first/last seen times |
| AC-HOME-10 | Dependency failure: the payments source times out | The payments tile shows `unavailable` with last good value and `asOf` (or no value); other tiles render; no zero is shown as current |
| AC-HOME-11 | Recovery: realtime connection closes with slow-consumer or expiry | Banner "live updates paused"; reconnect with backoff; refetch after `subscribed`; banner clears; no event-derived state is applied before the refetch |
| AC-HOME-12 | Viewer refresh: a viewer opens Home | No realtime subscription is attempted; tiles show `asOf`; manual and periodic HTTP refresh work |
| AC-HOME-13 | Delivery failure: the email channel rejects a notification permanently | Delivery reaches `failed` after the configured attempts; the organization's administrators see it; monitoring counts it; the source transaction was unaffected |
| AC-HOME-14 | Mandatory category: a recipient tries to mute a mandatory category | Refused; preference unchanged |
| AC-HOME-15 | Revoked access mid-session: the manager's grant to venue A is removed | The next Home request and the realtime connection stop returning venue A data; pending notifications for venue A are not delivered to the manager |
| AC-HOME-16 | Audit: acknowledgement, claim and follow-up cancellation | Each produces an append-only audit record with actor, before and after, correlation id; searchable per NFR-AUD |
| AC-HOME-17 | Performance: Home first render on a 10 Mbps profile | Under 2 s to first meaningful render (NFR-PERF; O-19), measured in the performance suite; remaining tiles show loading states |
| AC-HOME-18 | Accessibility: Home audited with keyboard and screen reader | WCAG 2.1 AA pass; severity and freshness are available as text |
| AC-HOME-19 | Observability: a tile source fails repeatedly | Per-source error counts and latency are visible in monitoring with correlation ids |
| AC-HOME-20 | Transitional sourcing: a venue still served by Nest for orders | Home's order-related exceptions come from Nest and are not labelled as Core; no Core-only signal for that venue is presented as live production state (DEC-HOME-1) |
| AC-HOME-21 | AI insight: a recommendation (for example a staffing or stock recommendation) is available for venue A and the manager can read all its sources | The insight is labelled AI, shows class, evidence, as-of time and confidence or limitations, and drills down to its source; it is not counted as an exception or KPI; no action control executes from Home; a user lacking read permission on any source sees no insight; when the source is stale the insight shows `stale` with its as-of time |
| AC-HOME-22 | Cross-domain tile: a labour-percentage tile is configured while the workforce domain is not delivered, and a sales tile is configured for a user without financial read permission | The labour tile is absent (not zero); the sales tile is omitted for that user; for a permitted user the sales tile shows P11 Net Sales (incl. GST), cites its 08.12 definition and is marked provisional for the open business day |

## 01.12 KPIs and metric definitions

Home displays business KPIs whose semantics belong to volume 08. The metrics below measure Home itself.

| Metric | Definition | Target |
|---|---|---|
| Time to acknowledge (by category) | Median and p95 of `acknowledgedAt − firstSeenAt` for items in mandatory categories, per venue, during the venue's operating hours (VEN-1) | OWNER TARGET REQUIRED (DEC-HOME-8). Verdura evidence "CRITICAL acknowledged < 5 min" is proposed only |
| Open exception age | Age of the oldest unresolved item per class and venue at a point in time | OWNER TARGET REQUIRED (DEC-HOME-8; thresholds §20.7) |
| Source-resolution share | Resolved items with `source_resolved` ÷ all resolved items, per class, per period | Informational |
| Notification delivery failure rate | Deliveries ending `failed` ÷ deliveries created, per channel, per period | OWNER TARGET REQUIRED (DEC-HOME-8) |
| Notification action rate | Notifications whose drill-down was opened ÷ notifications delivered, per category | Informational (signal-to-noise) |
| Stale tile minutes | Sum over tiles of minutes spent in `stale` or `unavailable`, per day | OWNER TARGET REQUIRED (DEC-HOME-8) |
| Time to first action | Median time from sign-in to the first drill-down, acknowledgement or claim, per role | OWNER TARGET REQUIRED (DEC-HOME-8). Verdura evidence "< 60 s for operational roles" is proposed only |

## 01.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-HOME-1 | Which system sources each Home fact per venue during the Nest-to-Core transition, and how Home knows which system is the venue's system of record | Home must not present Core state for venues still on Nest, or vice versa (PR-4) | Per-capability cutover flag per venue; Home reads only Core after cutover; dual reading with labels | HOME-22, AC-HOME-20 | Consolidated into DEC-BI-8 — **APPROVED — TIER 2** (2026-10-05; see 00.10.4) |
| DEC-HOME-2 | Which exception classes, tiles and actions each role sees on Home; whether cashier and kitchen roles get Admin Console access at all | Least privilege and noise | Current roles owner, admin, manager, cashier, kitchen, viewer; DEC-X-2 extension | HOME-4 role defaults | 3 |
| DEC-HOME-3 | Severity taxonomy for exceptions and notifications and the mapping of each exception class to a severity | Ordering, mandatory categories and escalation depend on it | Verdura evidence: INFO, WARNING, OPERATIONAL, FINANCIAL, CRITICAL | HOME-4 ordering, HOME-15 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-HOME-4 | Freshness thresholds (`live` / `delayed` / `stale`) per tile class | Truthful freshness labelling | Verdura evidence: refresh classes realtime, 1 min, 15 min (proposed only) | HOME-9 thresholds | 3 |
| DEC-HOME-5 | Whether manual tasks, due dates, checklists, recurring tasks and escalation are committed scope, and the owning Core package (DEC-X-13) | Tasks beyond system follow-ups are not in SPRD | Verdura task model; none | HOME-20 | 3 |
| DEC-HOME-6 | Mandatory (non-mutable) notification categories, acknowledgement requirement, escalation recipients and timing | Ensures critical conditions reach a responsible person | Verdura evidence: CRITICAL never muted, escalation after configured minutes | HOME-15, HOME-16 | 3 |
| DEC-HOME-7 | Retention of notifications, deliveries, exception attention history and tasks | Storage and personal data exposure | DEC-X-4 for personal data; NFR-AUD 90-day minimum applies to the audit records only | Retention jobs | 3 |
| DEC-HOME-8 | Targets for the Home metrics in 01.12 | No unapproved numbers | Verdura evidence: < 60 s first action, < 5 min critical acknowledgement, 5 s attention at login | Release acceptance of those metrics | 3 |
| DEC-HOME-9 | Organization-level rollup ownership while Core `organizations` does not exist | Owner and multi-venue Home need an organization scope in Core | Core `organizations` package (Part C, not created); Nest organization today | HOME-13 on Core | 2 |
| DEC-HOME-10 | Whether users may customize Home layout, and limits (pinned tiles that cannot be removed) | Consistency versus personalization | Verdura evidence: per-user grid with role templates and non-removable tiles | HOME-26 | 3 |
| DEC-X-15 | Notification channels and providers (referenced) | Push and SMS delivery | — | Push/SMS | 2 |
| DEC-X-2 | Role model (referenced) | Role defaults | — | DEC-HOME-2 | 3 |

## 01.14 Future and deferred capabilities

| Capability | State | Condition |
|---|---|---|
| Command search and action palette (records, pages, actions; recent history) | FUTURE | Scope decision; Core search (00.7); every action through native API path (HOME-25) |
| Manual tasks, checklists, recurring tasks, task dependencies, escalation chains | FUTURE | DEC-HOME-5 |
| Personal layout customization and widget catalogue | FUTURE | DEC-HOME-10 |
| Widgets for materials and stock, recipes and production, labour, CRM and loyalty, finance summary (HOME-28) | TARGET CAPABILITY — FUTURE DELIVERY | Inclusion resolved (DEC-X-1, owner 2026-10-05); each widget becomes available when its source domain is delivered (DEC-X-17) and only for metrics defined in volume 08 |
| Widgets for approvals | FUTURE | Shared approvals capability (00.7, DEC-X-13) |
| Widgets for a finance ledger (sub-ledger, GL, AP/AR) | DEFERRED | SPRD §13 (finance sub-ledger stays deferred) |
| AI insight display: labelled predictions and recommendations with evidence, as-of and confidence (HOME-27) | TARGET CAPABILITY — FUTURE DELIVERY | INV-21; insight catalogue in volume 08; `data/` outside the transaction path; phasing DEC-X-17; any autonomous action DEC-X-19 |
| Push-first mobile mode for shift leads | FUTURE | DEC-X-15; no mobile Admin surface is defined |
| Natural-language questions answered from BI; generated daily brief | FUTURE | Not described by KitchenOS; volume 08 semantics; `data/` outside the transaction path (SPRD §4, §29); no AI output presented as a fact without source (HOME-27 rules apply if committed) |
| Integration sync-health scorecards and POS-handoff tiles | SUPERSEDED | Servvia is the POS (ADR 0001) |
