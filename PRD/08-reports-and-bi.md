# Servvia PRD — Volume 08: Reports and BI

> **Status:** Normative Servvia domain volume, version label **v5.1 (Servvia)**, last updated 2026-10-05.
> **Authority:** subordinate to [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict, and to the conventions, invariants (INV-n) and cross-cutting decisions (DEC-X-n) of [`00-overview-and-conventions.md`](00-overview-and-conventions.md).
> **Provenance:** Servvia baseline (RPT-1, RPT-2, ADM-3, RES-5, AVL-1, KIT-3, SPRD §13, §19, §20, §29), verified Core money semantics (`docs/migration/` D5, D6, D7, D9, D11) and enterprise hardening (Part B). The semantic-model, drill-path, measure-versioning and scheduled-delivery mechanisms were mined from the Verdura v5.2 PRD Volume 08 as **non-authoritative source material**; classification is in the 2026-10-05 handoff evidence (`matrix-08-reports-and-bi.md`).
> **Committed scope is narrow:** RPT-1 (SHOULD; venue scope MUST), RPT-2 (pilot MUST, content open O-6), ADM-3 daily email (MUST), RES-5 reservation summary (SHOULD), and the operational signals of SPRD §20.
> **Owner-approved long-term scope (2026-10-05, DEC-X-1; SPRD §13):** the analytics capabilities KitchenOS describes (custom reports with scheduled exports, multi-location benchmarking, cross-domain and business KPIs, demand forecasting, AI insights and recommendations, pricing recommendations, inventory, workforce and customer-behaviour analytics, operational P&L) are labelled `TARGET CAPABILITY — FUTURE DELIVERY`; delivery phase is DEC-X-17 and AI capabilities follow INV-21. KitchenOS numeric targets are not adopted. Remaining items that KitchenOS does not describe stay FUTURE or DEFERRED as labelled.
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 08.1 Purpose, scope and state

Reporting turns Core's canonical records into figures people act on. Its contract in Servvia:

1. **One definition per figure.** Every reported number references a catalogued metric definition (08.12). Two reports showing the same metric compute it the same way.
2. **Every financial figure is drillable to the records that produced it,** within the viewer's scope.
3. **Reports are reproducible** despite corrections, because financial history is immutable and corrected only by compensating records (INV-11, PR-9).
4. **Reporting never degrades the transaction path** and never writes canonical state (SPRD §29: analytics outside the transaction path).

| Capability | State | Basis |
|---|---|---|
| Basic reporting views and daily email in the Nest API and Admin Console | TRANSITIONAL (Nest; retires as Core reporting replaces it) | S (SPRD §34.2) |
| Mock report rows and filters in Admin Console report and audit pages ("Happy Hour 10%" etc.) | TRANSITIONAL; must not ship as real data (BI-34) | S [REPO, D11 audit] |
| RPT-1 daily sales, reservation report, weekly and monthly summaries, CSV export, venue-scoped | TARGET (on Core records) | S (RPT-1) |
| RPT-2 service-day report minimum for the pilot | OWNER DECISION REQUIRED (O-6) | S (RPT-2) |
| ADM-3 daily-email settings (recipient, schedule, manual send) | TRANSITIONAL in Nest; TARGET delivery tracking | S (ADM-3) |
| RES-5 daily reservation summary email | TARGET | S (RES-5) |
| Operational metrics: KDS timing and propagation, "86" propagation, payment and reconciliation backlog | TARGET | S (KIT-3, AVL-1, §20) |
| Metric catalogue, versioning and drill-down | TARGET (mechanism implied by RPT-1 correctness and §17.11 traceability) | S+E+V(08 §3.1) |
| Analytical data separation | TARGET (principle approved 2026-10-05: DEC-X-16; topology is a Tier-1 default) | S+A |
| Custom report builder, saved views and shares (BI-28) | TARGET CAPABILITY — FUTURE DELIVERY | V(08 §3.2)+K(L238) |
| Generalised scheduled reports (BI-27), report certification | Scheduled reports: TARGET CAPABILITY — FUTURE DELIVERY (K(L238)); report certification: FUTURE | V(08 §3.2–3.3)+K(L238) |
| Multi-venue executive dashboard and benchmarking (BI-29) | TARGET CAPABILITY — FUTURE DELIVERY; consolidation and currency DEC-BI-13 | V(08 §5.1)+K(L237, L345) |
| Cross-domain composites (prime cost, food and labour %, waste value) and inventory and workforce analytics (BI-30, BI-37) | TARGET CAPABILITY — FUTURE DELIVERY (depend on volumes 03, 04, 06) | V(08 §5)+K(L205, L223, L514–515) |
| Business KPIs: revenue per location, order processing efficiency, staff productivity, inventory turnover, customer satisfaction (08.12.6) | TARGET CAPABILITY — FUTURE DELIVERY (definitions; no targets) | K(L510–516) |
| Operational P&L view (BI-38, with FIN-53) | TARGET CAPABILITY — FUTURE DELIVERY | K(L219, L325) |
| Customer behaviour analytics (BI-39, with volume 05) | TARGET CAPABILITY — FUTURE DELIVERY; consent and basis P4/P5 | K(L227, L598) |
| Budgets and budget-versus-actual (BI-31) | FUTURE | V(08 §3.6) |
| Demand forecasting (BI-32; prediction under INV-21) | TARGET CAPABILITY — FUTURE DELIVERY | S (§13)+K(L236, L332, L594) |
| AI insights and recommendations: anomaly and performance insights (BI-35), pricing recommendations (BI-36) | TARGET CAPABILITY — FUTURE DELIVERY; autonomous action DEC-X-19 | K(L239, L332, L597, L621) |
| Anomaly detection and AI narratives (BI-33, with BI-35) | TARGET CAPABILITY — FUTURE DELIVERY (owner decision 2026-10-05; INV-21; autonomous action DEC-X-19) | S+K(L239, L332) |

## 08.2 Actors and surfaces

| Actor | Reporting need | Basis |
|---|---|---|
| Owner | All financial and operational reports for granted venues; daily email | S (SPRD §3) |
| Admin | Configure reports and email; operational health | S |
| Manager | Venue service-day and operational reports for granted venues | S |
| Cashier | Own shift figures only (no venue financial reports unless DEC-BI-10 grants) | S [REPO]+D |
| Viewer | Read-only reports as DEC-BI-10 grants | S+D |
| Kitchen | Kitchen operational figures on the KDS only if decided (DEC-BI-10) | D |
| System worker | Generates scheduled reports and emails; no human authority (INV-3) | S |
| Email recipient (possibly external) | Receives the content of a scheduled email; holds no Servvia access | S (ADM-3)+D |

**Surfaces:** Admin Console (all report views, exports, email settings; WCAG 2.1 AA). Email (daily and reservation summaries). `data/` analytics (Python, outside the transaction path; not created). No reporting on Guest Mode, Kiosk, Window Display or Customer Website. Windows POS reporting (X/Z reads, shift reports on the terminal): **PENDING USER POS ANALYSIS REPORT**.

## 08.3 Domain model and ownership

```text
MetricDefinition (key, name, definition text, formula over Core records, basis, time basis, version, effective-from)
  └─ DrillPath (aggregate → contributing records → owning domain view)
ReportDefinition (metrics × dimensions × filters × layout; state draft → published)  [RPT-1 reports are predefined]
ReportRun (definition, parameters, scope, data watermark, metric versions, generated-at, requested-by)
Schedule (report or email × recipients × cadence × format × venue scope)  [ADM-3, RES-5]
  └─ DeliveryRecord (per send, per recipient: queued → sent → accepted / failed with reason)
ExportJob (report run × format; state queued → running → ready / failed / expired)
Insight  [TARGET CAPABILITY — FUTURE DELIVERY; AI output, never canonical (INV-21)]
  (class prediction / recommendation, subject metric and scope, evidence references, time basis,
   confidence or limitations, model/source version, generated-at; viewer state new → acknowledged / dismissed /
   acted, where "acted" links to the human action taken through its normal authorized path)
Dimensions: organization, venue, business date, hour, channel/source, station, menu item, category, tender type, staff, shift, terminal
Sources (read only): Core orders, rounds, checks, payments, adjustments, settlements, shifts, kitchen tickets,
                     availability changes, reservations (Nest until O-7), audit
```

| Object | Canonical owner | State |
|---|---|---|
| MetricDefinition, DrillPath | Core reporting (no package; DEC-X-13); catalogue content owner-approved (DEC-BI-2) | TARGET (not created) |
| Predefined RPT-1 / RPT-2 reports | Core reporting | TARGET; Nest TRANSITIONAL |
| Schedule, DeliveryRecord | Core reporting and `notifications` (not created; DEC-X-15); email via Nest today | TRANSITIONAL (Nest email); TARGET (records) |
| ExportJob | Core reporting | TARGET |
| Analytical store | DEC-X-16 (approved principle; topology Tier 1) | TARGET when measured scale requires |
| Source records | Their owning Core domains (volumes 02, 07) | Read only |
| Insight (BI-32, BI-35, BI-36) | Produced by `data/` (Python, outside the transaction path) from Core facts; storage within DEC-X-16 and DEC-X-13; never canonical | TARGET CAPABILITY — FUTURE DELIVERY |

## 08.4 Business objects and lifecycles

- **MetricDefinition:** immutable per version; a change creates a new version with an effective-from date; the old version stays resolvable for reproducing earlier reports (no silent restatement).
- **ReportRun:** records parameters (venue set, business-date range, basis, attribution mode), the viewer's resolved scope, metric versions and a **data watermark** (the latest committed record instant included). Two runs with the same parameters and watermark return the same figures.
- **Schedule:** `active` → `paused` → `active`; `deleted` is a deactivation, not removal, while delivery records reference it. Changes are audited (INV-17).
- **DeliveryRecord:** per recipient `queued` → `sent` (accepted by the mail provider) → `failed` (reason, retryable flag). "Sent" never means "read" or "delivered to the inbox" (INV-14).
- **ExportJob:** `queued` → `running` → `ready` (file available until expiry) / `failed`; `ready` → `expired` after the retention of DEC-BI-6.

## 08.5 Requirements

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| BI-1 | Every reported figure references a catalogued metric definition (08.12) with name, plain-language definition, formula over Core records, basis, time basis, inclusions and exclusions, and version. The definition is viewable wherever the figure is shown. | MUST | TARGET | V(08 §3.1)+E |
| BI-2 | A metric definition change creates a new effective-dated version; a report spanning the change labels it; no figure is silently restated. | MUST | TARGET | V(08 §3.1, WF-B6)+E |
| BI-3 | Revenue is never shown unqualified: every revenue or sales figure states its basis (ordered, billed, settled or collected), whether it is GST-inclusive or GST-exclusive, and whether discounts and refunds are deducted, using the 08.12 variants. The headline operational sales measure ("sales"/"revenue" in RPT-1 and the daily email) is **Net Sales (incl. GST)** per P11 (00.10.5). | MUST | TARGET (headline decided by owner, P11, 2026-10-05) | S (RPT-1)+E |
| BI-4 | Figures are computed from canonical records only, never from client-reported totals. Tax figures sum the tax amounts Core stored; reporting never recomputes tax, prices or discounts. | MUST | TARGET | S (PR-3, ORD-2) |
| BI-5 | During the transition, every report states its source system (Nest legacy path or Core). Figures from both paths are never summed into one total without a labelled breakdown, and no order or payment is counted on both paths. | MUST | TRANSITIONAL; source-attribution mechanism approved 2026-10-05 (DEC-BI-8) | S (PR-7)+E |
| BI-6 | Every financial aggregate is drillable to the contributing records (orders, round lines, checks, payments, adjustments, shifts), filtered to the viewer's scope; the drilled records sum to the aggregate. Operational aggregates SHOULD be drillable. | MUST (financial); SHOULD (operational) | TARGET | V(08 §1, §3.1)+S (§17.11) |
| BI-7 | Reports support two views of the past: **as reported** (records committed up to a stated watermark) and **as corrected** (including later compensating records). Each report states which view and which correction attribution (DEC-BI-3) it uses. A figure already issued (email, export, frozen day summary) is reproducible from its stored run parameters and watermark, or from its retained snapshot. | MUST | TARGET (refunds and returns are attributed to their own business date, P11; attribution of other corrections: DEC-BI-2) | S (INV-11)+E |
| BI-8 | Periods are venue business dates under the owner P3 rule (00.10.5; DEC-X-3 resolved), evaluated in the venue's time zone (VEN-1); instants are stored in UTC (INV-8). Multi-venue totals combine each venue's own business dates. Days with a daylight-saving change are reported as their actual length. Every report states its time basis. | MUST | TARGET (boundary rule decided by owner, P3, 2026-10-05) | S (INV-8)+E |
| BI-9 | Every report shows its data freshness (as-of instant). Each report belongs to a freshness class (live operational, near-real-time, end of day) whose target is owner-set. | MUST (display) | TARGET; targets OWNER TARGET REQUIRED (DEC-BI-5) | E |
| BI-10 | Report access is deny-by-default and combines role permission with venue grants from the verified credential (INV-2, INV-4). A multi-venue figure covers only granted venues and is labelled as such; a total clipped by scope is never presented as the organization total. | MUST | TARGET (Nest venue guard CURRENT, TRANSITIONAL) | S (NFR-SEC-3, §16.3)+V(08 §3.2) |
| BI-11 | Tenant and venue isolation applies to report queries, drill-downs, exports, scheduled runs and emails; cross-tenant tests cover each. A scheduled run executes with the scope of the schedule owner at run time; if the owner loses access, the schedule stops and alerts. | MUST | TARGET | S (NFR-SEC-3, Part B row D)+V(08 WF-B3) |
| BI-12 | Exports (CSV for RPT-1; other formats per DEC-BI-6) are scope-enforced, audited (actor, report, parameters, row count, time), state currency and units explicitly, and neutralise spreadsheet formula injection in text cells. | MUST | TARGET | S (RPT-1, NFR-AUD)+E |
| BI-13 | Exports and emails contain the minimum data needed: no card data, secrets or provider references; guest personal data (names, contact details) excluded by default and included only with an explicit permission and audit (DEC-BI-7). | MUST | TARGET; personal-data policy OWNER DECISION REQUIRED (DEC-BI-7, DEC-X-4) | S (Part B row C, PAY-5)+E |
| BI-14 | Report queries never breach the transactional targets of SPRD §19 (order submission P95 under 500 ms, API read P95 under 200 ms). Report queries are bounded (date range, row limit, statement timeout) and their load is measured in performance tests. | MUST | TARGET (mechanism approved 2026-10-05: DEC-X-16; topology is a Tier-1 default) | S (NFR-PERF, §19)+E |
| BI-15 | Report and export endpoints paginate; ranges and row limits are bounded; an export beyond the synchronous limit runs as an asynchronous job with visible state. Limits are owner-set. | MUST | TARGET; limits OWNER TARGET REQUIRED (DEC-BI-6) | E |
| BI-16 | Daily email (ADM-3): configurable recipients, schedule and manual send; each send creates delivery records per recipient; failure is retried with bounded backoff, then shown to the owner and admin with the reason. A send never reports success the mail provider did not accept. | MUST | TRANSITIONAL settings in Nest; delivery records TARGET | S (ADM-3, PR-4, §18.3–18.5) |
| BI-17 | Daily reservation summary email at a configured time (RES-5), under BI-16 delivery rules and BI-13 minimisation. | SHOULD | TARGET | S (RES-5) |
| BI-18 | Daily sales report (RPT-1): Net Sales (incl. GST) per P11 as the headline, with its components (08.12), order count, average order value and top items per venue and business date, with the definitions of 08.12. | SHOULD (venue scope MUST) | TARGET | S (RPT-1) |
| BI-19 | Reservation report (RPT-1): covers, no-show rate and lead time per venue and date, with the definitions of 08.12. | SHOULD (venue scope MUST) | TARGET; reservations owner in Core O-7 | S (RPT-1) |
| BI-20 | Weekly and monthly summaries (RPT-1) aggregate business dates; a week's start day is a venue setting (DEC-BI-2). | SHOULD | TARGET | S (RPT-1)+D |
| BI-21 | Service-day report for day close (RPT-2): the minimum content is decided in O-6. On day close (FIN-32) the report is frozen; later corrections appear as post-close adjustments, not edits. | MUST (pilot) | TARGET (mechanism); minimum content and close rules OWNER DECISION REQUIRED (O-6, DEC-FIN-10); business date per P3 | S (RPT-2) |
| BI-22 | Operational metrics are available to authorised staff and operators: KDS acknowledgement and preparation times, ticket propagation latency, "86" propagation per channel, pending and uncertain payment age, reconciliation backlog, dead-letter age (08.12). | MUST (signals named in SPRD §18.11, §20); SHOULD (others) | TARGET | S (KIT-3, AVL-1, §20) |
| BI-23 | Reporting and analytics are read-only: no report, export, schedule or `data/` workload writes canonical state; analytics never sits in the transaction path. | MUST | TARGET | S (SPRD §29, PR-1) |
| BI-24 | Money in reports uses the venue currency with ISO 4217 code; one total never mixes currencies (DEC-X-11). Quantities state their unit. | MUST | TARGET | S (INV-6, INV-7) |
| BI-25 | No production report contains mock, sample or hard-coded data; transitional mock rows are removed or labelled as samples before production. | MUST | TARGET (mock rows TRANSITIONAL) | S (SPRD §22)+E |
| BI-26 | Email subject and header values are validated (no control characters or header injection) before send; invalid configuration is refused at save time. | MUST | TARGET | V(08 §3.3)+E (§16.8) |
| BI-27 | Generalised scheduled reports (any report, cadence, recipients, format) with the BI-16 delivery mechanism. | MAY | TARGET CAPABILITY — FUTURE DELIVERY | V(08 §3.3, WF-B3)+K(L238) |
| BI-28 | Custom reports, saved views and sharing: a share widens audience, never access (each viewer sees their own scope); custom formulas are labelled custom and never reuse a catalogued metric's name. | MAY | TARGET CAPABILITY — FUTURE DELIVERY | V(08 §3.2, WF-B2)+K(L238) |
| BI-29 | Multi-venue executive dashboard and venue comparison over catalogued metrics. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; consolidation and currency DEC-BI-13 | V(08 §5.1)+K(L237, L345) |
| BI-30 | Cross-domain composites (food cost %, labour %, prime cost, waste value, sales per labour hour) once their source domains exist. | MAY | TARGET CAPABILITY — FUTURE DELIVERY (depends on volumes 03, 04, 06) | V(08 §3.1, §5.2–5.6)+K(L205, L223, L514–515) |
| BI-31 | Budgets and budget-versus-actual. | MAY | FUTURE | V(08 §3.6) |
| BI-32 | Demand forecasting. If ever built, every forecast carries its measured accuracy where consumed. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; prediction under INV-21 | S+V(08 §3.4)+K(L236, L332, L594) |
| BI-33 | Anomaly detection and AI narratives: every claim cites the records it rests on and unexplained residue is stated; no uncited commentary (with BI-35 and INV-21). | MAY | TARGET CAPABILITY — FUTURE DELIVERY | S+V(08 §3.5)+K(L239, L332) |
| BI-34 | Report views that show financial data, every export and every schedule change are audited (INV-15). Whether plain report viewing is audited is a decision. | MUST (exports, schedules); viewing per DEC-BI-10 | TARGET | S (NFR-AUD)+D |
| BI-35 | AI insights: anomaly and performance insights (predictions) and improvement suggestions (recommendations), classified per INV-21, are shown to permitted roles within their venue scope (BI-10). Each insight is labelled as AI output and states its evidence (linked to the catalogued metrics and drillable records it rests on, BI-1, BI-6), time basis, as-of instant and confidence or known limitations; claims without evidence are not shown. An insight never becomes transactional or financial truth, writes no canonical state (BI-23) and does not alter any report figure. Acting on a recommendation happens only through the normal authorized path of the owning domain, attributed to the confirming human and to the AI source (INV-5, INV-21); autonomous action is not authorized (DEC-X-19). Insight generation runs in `data/` outside the transaction path, receives only the minimum data needed (INV-18), and its failure or staleness is shown explicitly (INV-14), never as "no insights". | MAY | TARGET CAPABILITY — FUTURE DELIVERY; autonomous action DEC-X-19 | K(L239, L332, L621)+S (INV-21, §29)+E |
| BI-36 | Pricing recommendations: Servvia may recommend menu price changes (recommendation per INV-21) showing the item and venue, the proposed change, the expected effect with its evidence and time basis, and confidence or limitations. A price change remains a human action through menu administration (effective-dated, DEC-ADMIN-9; MENU requirements of SPRD §7), attributed to the confirming human and the AI source. No recommendation changes a price, promotion or recorded amount by itself (DEC-X-19). | MAY | TARGET CAPABILITY — FUTURE DELIVERY; autonomous pricing DEC-X-19 | K(L597)+S (INV-21, PR-3) |
| BI-37 | Inventory and workforce analytics: inventory turnover, waste value, labour cost percentage and sales per labour hour per venue and period, computed from the canonical records of volumes 03, 04 and 06 and the P11 sales measure, with definitions catalogued in 08.12 (BI-1). A metric whose source domain is not live, or whose policy decision is open (for example valuation, DEC-MAT-3), is shown as unavailable with the reason, never as zero. Staff-level labour figures are Personal (employee) data visible per DEC-BI-10. | MAY | TARGET CAPABILITY — FUTURE DELIVERY (depends on volumes 03, 04, 06) | K(L514–515)+S (BI-1, INV-18)+D |
| BI-38 | Operational P&L view (with FIN-53): per venue and business date, and for granted venue groups, the P11 sales measure less recipe cost of items sold (volume 03) and labour cost (volume 06), with each component's definition, basis, time basis and as-of instant stated. It is labelled **operational**, distinct from any accounting P&L (DEC-FIN-2), and drillable to its component sources within scope (BI-6). Which GST basis the view uses is a catalogue decision (DEC-BI-2, with DEC-FIN-4). | MAY | TARGET CAPABILITY — FUTURE DELIVERY (depends on volumes 03, 06) | K(L219, L325)+S (P11)+D |
| BI-39 | Customer behaviour analytics (with volume 05): visit frequency, spend and preference patterns and segmentation are computed only from customers linked to Core orders by an explicit identity link, and any analysis that profiles individuals uses only customers for whom the consent or other basis decided under P4/P5 is recorded. Results are aggregated by default; individual-level views and exports require explicit permission and audit (BI-13, BI-34). Erasure (DEC-X-4) removes the person from future analyses without changing financial totals. AI-derived segments are predictions under INV-21. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; consent and basis P4/P5; retention DEC-X-4 | K(L227, L598)+S (Part B row C)+D |

## 08.6 Workflows and failure paths

**WF-BI-1 View a report.** (1) A user opens a report for venues and a business-date range. (2) The server resolves scope from the credential, intersects requested venues with grants, and runs the bounded query. (3) The result shows figures, basis, time basis, as-of instant, metric versions and any scope clipping. **Failures:** range above limit → refused with the limit; timeout → explicit error, never partial totals presented as complete; source unavailable → error state with retry (SPRD §22).

**WF-BI-2 Drill down.** A user selects a figure; the server returns the contributing records within scope, paginated; the sum of drilled records equals the figure for the same watermark. Records outside scope are counted as "outside your scope" only when the figure itself includes them (it never should, BI-10).

**WF-BI-3 Daily email.** (1) At the configured time (after day close, if DEC-BI-11 so decides) a worker renders the report for the prior business date with a stored run record. (2) Each recipient gets a delivery record. (3) Provider rejection or timeout → bounded retry → `failed` with reason → alert to owner and admin. **Failures:** worker down → the send is late, not lost (D13 at-least-once, idempotent by schedule, business date and recipient, so a redelivery never sends twice); recipient invalid → refused at configuration time.

**WF-BI-4 Export.** (1) A user requests CSV. (2) Small exports return synchronously; larger ones create an export job. (3) The file is scope-enforced, formula-safe, and audited; it expires per DEC-BI-6. **Failure:** job failure is visible with reason and retryable.

**WF-BI-5 Correction after reporting.** A refund on business date D+2 for a sale on D: as-reported view of D is unchanged; as-corrected view attributes the refund per DEC-BI-3; a frozen day summary for D is never altered, and the correction appears in D+2's post-close adjustments.

**WF-BI-6 Metric change.** A new version of a definition is proposed with an impact preview on recent periods, approved (DEC-BI-2 authority), and activated from an effective date; reports spanning the date carry a version marker.

## 08.7 Security, authorization and audit

| Capability | Owner | Admin | Manager | Cashier | Viewer | Kitchen | Worker |
|---|---|---|---|---|---|---|---|
| Venue financial reports (RPT-1, RPT-2) | Granted venues | Granted venues | Granted venues | D (DEC-BI-10) | D | No | Runs schedules with owner scope |
| Reservation report | Yes | Yes | Yes | D | D | No | Yes |
| Own shift figures | Yes | Yes | Yes | Own only | No | No | — |
| Operational metrics | Yes | Yes | Yes | D | D | Kitchen figures D | — |
| Export | Yes | Yes | D | No | D | No | — |
| Daily-email settings (ADM-3) | Yes | Yes | D | No | No | No | — |
| Metric definition approval | D (DEC-BI-2) | D | No | No | No | No | — |
| AI insights, pricing recommendations, operational P&L, customer behaviour analytics (BI-35–BI-39; TARGET CAPABILITY — FUTURE DELIVERY) | Granted venues | Granted venues | D (DEC-BI-10) | No | D | No | Generates insights only; no human authority |

- Scope is always the intersection of the report definition and the viewer's grants (INV-2); a report never widens access.
- Audit (BI-34): exports, schedule and recipient changes, manual sends, metric version activations.
- Email is an egress channel: recipients outside the organization are allowed only per DEC-BI-7; content minimised (BI-13).
- Safe errors (INV-16): a scope refusal never reveals whether another venue's data exists.

## 08.8 Data governance

| Data | Class (INV-18) | Retention | Note |
|---|---|---|---|
| Financial aggregates, report runs | Financial | DEC-BI-6, not shorter than the source retention needed to reproduce them (DEC-FIN-14) | Recomputable from immutable sources |
| Generated export files, email snapshots | Financial or Personal (if guest data included) | DEC-BI-6 | Expire; access-controlled |
| Reservation figures with guest identity | Personal (customer) | DEC-X-4 | Excluded by default (BI-13) |
| Staff-level figures (per cashier, per shift) | Personal (employee) + Financial | DEC-X-4, DEC-FIN-14 | Visible per DEC-BI-10 |
| Delivery records (recipient addresses) | Personal | DEC-BI-6 | — |

Erasure of personal data (DEC-X-4) removes or pseudonymises identity in reports without changing financial totals.

## 08.9 Reliability, scalability and observability

- **Workload separation:** DEC-X-16 decides replica, warehouse or in-database reporting; until then BI-14 bounds apply and report load is part of the performance acceptance (§24 gate 9).
- **Freshness:** live operational figures read Core directly or via D12 notification-and-refetch; end-of-day figures read frozen summaries. Freshness targets: OWNER TARGET REQUIRED (DEC-BI-5).
- **History volume:** reports must remain within their freshness targets at the history volume of DEC-X-8; no figure is set here.
- **Signals:** report query latency and timeouts; export job backlog and failures; scheduled send success and failures per schedule; schedules that have not produced a delivery record when due ("silently dead" schedules); drill-integrity test failures. Alert thresholds: OWNER TARGET REQUIRED.
- **Scheduled work** runs on Core workers (D13): at-least-once, idempotent per (schedule, business date, recipient), dead-lettered and visible (SPRD §18.4–18.5).

## 08.10 UX and accessibility

- Every report screen provides loading, empty ("no trading on this date" distinct from "no data available"), error, permission-denied and stale states (SPRD §22).
- Figures show units, currency, GST basis and time basis; definitions are reachable from each figure (BI-1).
- Charts have a tabular equivalent and do not rely on colour alone; Admin Console meets WCAG 2.1 AA including screen-reader support (NFR-A11Y).
- Emails have a plain-text alternative and state the business date, venue and as-of instant.

## 08.11 Acceptance criteria

| ID | Scenario | Expected result |
|---|---|---|
| AC-BI-1 | Daily sales for a venue and business date with known fixtures (discounted round, voided check, refund) | Each 08.12 variant equals the hand-computed value; GST equals Σ stored tax, not a recomputation |
| AC-BI-2 | Same figure on two reports (daily sales and weekly summary for one day) | Identical value and metric version |
| AC-BI-3 | Drill into net sales | Contributing records listed; their sum equals the figure at the same watermark |
| AC-BI-4 | Manager with one venue grant requests an organization report | Only the granted venue; output labelled as clipped; no organization total |
| AC-BI-5 | Viewer of organization A requests venue of organization B (REST, export, drill, schedule) | Refused without revealing existence |
| AC-BI-6 | Refund recorded two days after the sale | As-reported figure for the sale date unchanged; as-corrected per DEC-BI-3; frozen day summary unchanged |
| AC-BI-7 | Venue in a time zone ahead of UTC; sale at 00:30 local | Assigned to the business date given by the DEC-X-3 rule, not the UTC date |
| AC-BI-8 | Business date with a daylight-saving change | Hourly breakdown shows the actual 23 or 25 hours; totals unaffected |
| AC-BI-9 | Report range above the configured maximum | Refused with the limit; no partial result |
| AC-BI-10 | Report query load during a peak-order performance test | Order submission P95 stays under 500 ms and API read P95 under 200 ms (O-19 gate) |
| AC-BI-11 | CSV export with a menu item titled "=HYPERLINK(...)" | Cell neutralised; export audited with row count |
| AC-BI-12 | Export of the reservation report by a user without personal-data permission | Guest names and contact details absent |
| AC-BI-13 | Daily email provider rejects a recipient | Delivery record `failed` with reason; retried within bounds; owner and admin alerted; other recipients unaffected |
| AC-BI-14 | Worker restarts during a daily email run | Each recipient receives exactly one email for the business date |
| AC-BI-15 | Schedule owner's access revoked | Schedule stops and raises an alert; no further sends with stale scope |
| AC-BI-16 | Metric definition updated mid-month | Monthly report shows the version boundary; earlier days reproducible with the old version |
| AC-BI-17 | Pilot report while both Nest and Core paths hold orders | Source system labelled; no order counted twice |
| AC-BI-18 | Uncertain payment open for longer than the configured age | Appears in the operational metric with its age and in the reconciliation backlog |
| AC-BI-19 | Availability change propagated to configured channels | Per-channel propagation recorded; p95 reported against the 30 s target (AVL-1) |
| AC-BI-20 | Any report endpoint called by a KDS device or Guest Mode tablet | Refused |
| AC-BI-21 | AI anomaly insight shown for a venue's net sales; the manager acts on a linked recommendation (BI-35) | Insight labelled AI with evidence links, time basis, as-of and confidence; drill reaches the underlying records; no canonical state or report figure changed by the insight; the resulting action is recorded through its normal path attributed to the manager and the AI source |
| AC-BI-22 | Pricing recommendation accepted by a manager (BI-36) | No price changes until the manager confirms a menu-administration change; the effective-dated price change is audited with the human actor and AI source; without confirmation nothing changes |
| AC-BI-23 | Labour % and operational P&L requested for a venue where volume 06 data is unavailable (BI-37, BI-38) | Labour components shown as unavailable with reason, not zero; view labelled operational; sales component equals the P11 measure for the same scope |
| AC-BI-24 | Revenue per location for one venue and business date (08.12.6) | Equals the P11 headline Net Sales (incl. GST) of BI-18 for the same scope, with the same metric version |
| AC-BI-25 | Customer behaviour segmentation over customers with and without the recorded consent or basis (BI-39) | Customers without the required basis are excluded from profiling analyses; individual-level export refused without the permission; financial report totals unchanged |

## 08.12 KPIs and metric definitions

### 08.12.1 Populations and bases

- **Core order line:** a line of an accepted round of a Servvia Core order that is not cancelled. Nest-path orders are reported separately during the transition (BI-5).
- **Standing check:** a check in `open` or `settled` status (not `voided`).
- **Bases:** *Ordered* (Core order lines, dated by round acceptance), *Billed* (lines on standing checks, dated by check creation), *Settled* (checks whose current settlement is `settled`, dated by the latest settled transition), *Collected* (succeeded payments minus succeeded adjustments, dated by resolution). Dates are venue business dates (BI-8).
- **Money fields (Core):** line and record `subtotal` is gross and GST-inclusive (NZ prices include GST); `discount` is the frozen promotion discount; `total` = subtotal − discount; `tax` is the GST contained in the total, computed by Core (currently 3/23 of the discounted total for the NZ profile).

### 08.12.2 Financial metrics

| Metric | Definition | Notes and decisions |
|---|---|---|
| Gross sales (GST-inclusive) | Σ subtotal of the basis population | Before discounts |
| Discounts | Σ discount of the basis population | Promotions only (manual discounts do not exist, FIN-26) |
| Net sales (GST-inclusive) | Gross sales − discounts = Σ total | Component; on the Billed basis it is the base of the headline (P11) |
| GST | Σ stored tax of the records in the basis (order or check level) | Never recomputed on the aggregate; per-item GST is not stored, so item reports use GST-inclusive values |
| Net sales (GST-exclusive) | Net sales (GST-inclusive) − GST | — |
| Refunds | Σ amount of succeeded adjustments of kind `refund`, by tender type, dated by the business date on which they occur (P11) | Pending and uncertain refunds reported separately, never deducted |
| Reversals | As refunds, kind `reversal` | Reported separately from refunds (FIN-20) |
| **Net Sales (incl. GST) — headline (P11)** | Billed-basis gross sales − discounts/comps − refunds/returns, where refunds/returns count on the business date on which they occur | The headline operational sales measure. It is not tender, settlement or accounting revenue. GST-exclusive variant: GST-exclusive attribution of refunds requires DEC-FIN-4 |
| Net sales after refunds and reversals (GST-inclusive) | Net sales (GST-inclusive) − refunds − reversals, same scope and attribution | Supplementary; reversals are reported separately (FIN-20) |
| Collected | Σ succeeded payments − Σ succeeded adjustments, by tender type | Card and cash shown separately |
| Order count | Count of distinct Core orders with at least one accepted round line, dated by first round acceptance | Cancelled orders excluded and counted separately |
| Average order value (AOV) | Net sales (GST-inclusive, Ordered basis) ÷ order count, same scope and dates | Shown as "—" when order count is 0; whether AOV follows the headline's Billed basis is DEC-BI-2 |
| Check count; average check | Count of standing checks (Billed basis); net sales (GST-inclusive, Billed) ÷ check count | — |
| Top items | Menu items ranked by quantity and, separately, by net sales (GST-inclusive) of their lines (Ordered basis); identity by menu item id, label from the latest snapshot title | Modifier prices included in line value; tie-break and N per DEC-BI-2 |
| Voided checks | Count and Σ total of checks voided, dated by void instant | Void releases lines, so voided value is not a sales deduction |
| Cancelled orders | Count of Core orders cancelled, dated by cancellation | Item-level voids are not modelled |
| Settlement revocations | Count of `revoked` settlement transitions | — |
| Cash variance | Σ variance (counted − expected) of shifts closed, dated by close; also Σ absolute variance and count of shifts with non-zero variance | Tolerance DEC-FIN-8 |
| Discount rate | Discounts ÷ gross sales | — |

### 08.12.3 Reservation and covers metrics

| Metric | Definition | Notes and decisions |
|---|---|---|
| Covers (reservations) | Σ party size of reservations in `seated` or `completed`, by reservation date | RPT-1 |
| Covers (dine-in visits) | Σ guest count of visits | No guest-count field is evidenced on the visit: DEC-BI-4 |
| Spend per cover | Net sales (GST-inclusive) ÷ covers, same scope | Only once covers are defined for the same population (DEC-BI-4) |
| No-show rate | Count `no_show` ÷ count of reservations in `seated`, `completed` or `no_show`, by reservation date | Excludes cancelled and pending; denominator confirmed in DEC-BI-2 |
| Lead time | Reservation start instant − creation instant; median and distribution, for reservations that reached `confirmed` | — |

### 08.12.4 Operational metrics

| Metric | Definition | Target |
|---|---|---|
| KDS propagation | Instant a ticket is shown on the KDS − commit instant of its round; p95 per venue and day | Under 3 s (KIT-3, SPRD §19; O-19). Requires a display acknowledgement timestamp |
| Time to acknowledge | First `acknowledged` instant − ticket creation; p50 and p95 per station | OWNER TARGET REQUIRED (DEC-BI-12) |
| Preparation time | First `ready` instant − ticket creation; p50 and p95 per station; recalled tickets measured to their final `ready` and counted separately | OWNER TARGET REQUIRED (DEC-BI-12) |
| "86" propagation | Per channel: instant the channel reflects an availability change − commit instant of the change; p95 | Under 30 s (AVL-1); channels per O-17 |
| Uncertain payment age | Age of each `uncertain` payment or adjustment; count and oldest | OWNER TARGET REQUIRED (DEC-FIN-12) |
| Reconciliation backlog | Open reconciliation items; oldest age | OWNER TARGET REQUIRED (DEC-FIN-12) |
| Dead-letter age | Oldest dead-lettered event per consumer | OWNER TARGET REQUIRED (SPRD §19) |

### 08.12.5 Reporting-service KPIs

| KPI | Definition | Target |
|---|---|---|
| Scheduled delivery success | Delivery records `sent` ÷ all delivery records due, per period | OWNER TARGET REQUIRED |
| Silent schedules | Active schedules with no delivery record for a due run | Zero (binary property of BI-16) |
| Drill integrity | Financial figures whose drill-down does not sum to the figure in automated tests | Zero (binary property of BI-6) |
| Report freshness lag | As-of instant age at view time, per freshness class | OWNER TARGET REQUIRED (DEC-BI-5) |
| Verdura evidence, not adopted | Executive "what needs attention" answer under 2 minutes; anomaly acted-on rate above 40 %; forecast MAPE thresholds | Proposed (Verdura evidence) — OWNER TARGET REQUIRED (DEC-BI-5); forecasting (BI-32) and AI insights (BI-35) are TARGET CAPABILITY — FUTURE DELIVERY, BI-33 DEFERRED |

### 08.12.6 Business KPIs (TARGET CAPABILITY — FUTURE DELIVERY)

Owner-approved KPI definitions (K(L510–516)). They are catalogued metrics under BI-1 and BI-2; **no targets are set** (KitchenOS sets none, and any target is an owner decision).

| KPI | Definition | Notes and decisions |
|---|---|---|
| Revenue per location | The P11 headline Net Sales (incl. GST) (08.12.2) per venue for the period | Same definition and version as BI-18; never a separate revenue measure. No target |
| Order processing efficiency | Per accepted round: the instant all its kitchen tickets have first reached `ready` − the round acceptance instant; p50 and p95 per venue, station group and business date | Rounds without kitchen tickets, recalled tickets and cancelled lines: population per DEC-BI-2. No target (KDS timing targets DEC-BI-12) |
| Staff productivity | P11 headline Net Sales (incl. GST) ÷ attended labour hours (volume 06 attendance), same venue and business dates | Available only once volume 06 attendance exists; individual-level figures are Personal (employee) per DEC-BI-10. No target |
| Inventory turnover | Candidate form (not decided): consumption value ÷ average stock value over the period, per venue or stock site | Definition depends on the valuation method (DEC-MAT-3) and volume 04, and is confirmed under DEC-BI-2; shown as unavailable until decided. No target |
| Customer satisfaction | Score derived from feedback recorded in volume 05, per venue and period | Scale, aggregation and response population: DEC-BI-2. No target |
| Operational P&L (BI-38) | P11 sales measure − recipe cost of items sold (volume 03) − labour cost (volume 06), same scope and business dates | Labelled operational, not accounting (DEC-FIN-2); GST basis DEC-BI-2 with DEC-FIN-4. No target |
| Labour cost % | Labour cost (volume 06) ÷ P11 sales measure, same scope | With BI-30, BI-37; GST basis DEC-BI-2. No target |
| Waste value | Σ value of waste movements (volume 04) at the valuation in force | DEC-MAT-3. No target |

## 08.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-BI-1 | Which variant RPT-1 "revenue" and AOV use: basis (ordered, billed, settled, collected), GST-inclusive or exclusive, before or after refunds | Two readers otherwise read different numbers | 08.12.2 variants; Nest today reports order totals | BI-3, BI-18 | **RESOLVED — owner decision P11, 2026-10-05** (00.10.5; was: 3) |
| DEC-BI-2 | Metric catalogue sign-off, including denominators (no-show, AOV), top-items N and tie-break, week start day, and who approves metric changes | Definitions are business semantics | 08.12 proposed definitions | BI-1, BI-2, BI-19, BI-20 | 3 — open under the pilot-reporting gate (headline decided by P11) |
| DEC-BI-3 | Correction attribution: refunds, reversals and voids dated by when they happen or attributed back to the original sale date; default view as reported or as corrected | Reproducibility and comparability | Both supported by immutable records (BI-7) | BI-7, BI-21 | Resolved for refunds and returns by P11 (own business date; original sale not rewritten). Other corrections fall under DEC-BI-2 |
| DEC-BI-4 | Covers for dine-in: capture a guest count on the visit (schema change) or report reservation covers only | RPT-1 covers and spend per cover | Reservation party size exists; visit guest count not evidenced | 08.12.3 | 3 (schema Tier 2) — open under the pilot-reporting gate |
| DEC-BI-5 | Freshness classes and targets; reporting-service targets | Users must know how current figures are | Verdura figures (proposed only) | BI-9 | 3 |
| DEC-BI-6 | Export formats beyond CSV, synchronous row limit, maximum range, file expiry, retention of email snapshots and report runs | Load, privacy and reproducibility | Verdura PDF/XLSX/link formats (evidence) | BI-12, BI-15 | 3 |
| DEC-BI-7 | Personal data in reports and exports; external email recipients (allowed or restricted domains) | Privacy (Part B row C) | — | BI-13, BI-16 | 3 |
| DEC-BI-8 | Pilot reporting during the transition: whether Nest-path orders and payments are included, and how labelled | Avoid double counting and confusion | BI-5 rule | BI-5, pilot reports | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-BI-9 | Reporting read model: direct queries on Core tables versus projections built from D13 events (within DEC-X-16 and DEC-X-13) | Performance and freshness | D13 at-least-once consumers exist | BI-14 | 2 |
| DEC-BI-10 | Report access by role (cashier, viewer, kitchen) and whether plain viewing of financial reports is audited | Least privilege (DEC-X-2) | Core financial RBAC today | 08.7 rows marked D | 3 |
| DEC-BI-11 | Daily email content and trigger (fixed time versus after day close) | Emails must not report an unclosed day as final | ADM-3 schedule exists | BI-16 | 3 — trigger timing open under the pilot-reporting gate; an unclosed business day is always labelled provisional (INV-14, P3) |
| DEC-BI-12 | KDS timing targets and which KDS metrics are reported | Kitchen performance management | KIT-5 configurable age threshold | 08.12.4 | 3 |
| DEC-BI-13 | Multi-venue and group reporting scope, consolidation and currency. **Note:** multi-venue reporting and benchmarking inclusion resolved by DEC-X-1 (owner 2026-10-05; BI-29); consolidation rules and currency treatment remain open | Multi-venue operators (SPRD §1) | KitchenOS cross-location analytics (K(L237, L345)) | BI-29 consolidation and currency | 3 — inclusion resolved; consolidation and currency open |

Inherited and referenced: O-6 (pilot day reports), O-7 (reservations in Core), O-17 (availability channels), O-19 (targets), DEC-X-1 (FUTURE scope), DEC-X-2 (roles), DEC-X-3 (business date), DEC-X-4 (personal data), DEC-X-8 (history volume), DEC-X-11 (currency), DEC-X-13 (reporting package), DEC-X-15 (email channel), DEC-X-16 (analytical separation), DEC-FIN-4 (GST on refunds), DEC-FIN-8 and DEC-FIN-12 (finance thresholds).

## 08.14 Future and deferred capabilities

| Capability | State | Gate |
|---|---|---|
| Custom reports, saved views, shares (BI-28) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17 |
| Generalised scheduled reports (BI-27); certification | Scheduled reports: TARGET CAPABILITY — FUTURE DELIVERY; certification FUTURE | DEC-X-17 delivery |
| Executive dashboard, multi-venue benchmarking and venue comparison (BI-29) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-BI-13 (consolidation, currency) |
| Budgets (BI-31) | FUTURE | DEC-X-1 scope decision |
| Cross-domain composites: food cost, labour, prime cost, waste, menu engineering with margin (BI-30); inventory and workforce analytics (BI-37); business KPIs (08.12.6) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; volumes 03, 04, 06 delivered; DEC-MAT-3, DEC-BI-2 |
| Operational P&L view (BI-38, FIN-53) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; volumes 03, 06; DEC-BI-2 |
| Customer behaviour analytics (BI-39) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; P4/P5; DEC-X-4 |
| Forecasting with accuracy records (BI-32; prediction, INV-21) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; `data/`; accuracy targets DEC-BI-5 |
| AI insights and recommendations (BI-35), pricing recommendations (BI-36) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; `data/`; any autonomous action DEC-X-19 |
| Anomaly detection and evidence-cited narratives (BI-33, BI-35) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17 delivery; DEC-X-19 for autonomy |
| Natural-language query, AI daily brief, cohort benchmarking, embedded analytics, what-if planning, external BI connector | FUTURE (Verdura roadmap evidence, not committed) | DEC-X-1; privacy DEC-X-4 for benchmarking |
| Windows POS X/Z and shift reports on the terminal | DEFERRED (PENDING USER POS ANALYSIS REPORT) | POS report |
