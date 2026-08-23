# Verdura — Sprint Plan

> **Normative planning decision — 2026-08-15:** Re-plan delivery around the [Target Operating Model](./target-operating-model.md). POS handoff, KDS and printing are one atomic business capability with independent durable delivery—not isolated later sprints. Prove the existing Idealpos/EFTPOS flow first, then add provider-neutral online prepayment and `PREPAID / ONLINE` reconciliation.

> **Superseded schedule — re-baselined 2026-08-15:** The original nine-sprint plan is retained as history; it is not the active delivery forecast and several listed success criteria were never demonstrated. Current priority is P0: verified payment or checkout disablement, removal of fabricated provider success, idempotency/concurrency safety, staff venue grants, and an explicit edge command contract. P1 is one real provider adapter, availability fan-out, reconciliation/DLQ visibility, venue-edge printing, correlated audit and outage/replay testing. See [mvp.md](./mvp.md#10-prioritized-delivery-plan).

**Planning recommendation:** estimate from unresolved provider/hardware discovery, use evidence gates rather than elapsed sprints, and do not schedule later-phase inventory, finance, BI, CRM or workforce work ahead of Phase 1A validation.

**Phase 10 Output (Updated)**  
**Date:** 2026-06-18  
**Sprint length:** 2 weeks  
**Team assumption:** 2 full-stack engineers + 1 part-time DevOps/infra  

---

## Sprint Map Overview

| Sprint | Theme | Key Deliverable |
|--------|-------|----------------|
| 0 | Venue discovery | Confirm Idealpos build/licence, supported ingress, mappings, EFTPOS, KOT stations and hardware |
| 1 | Canonical order/outbox | Immutable version, idempotency, correlation and atomic POS/KDS/KOT commands |
| 2 | Venue connector | Pairing, durable local acceptance, Idealpos adapter, heartbeat, replay and revocation |
| 3 | Standard payment vertical | Verdura → Idealpos → KDS/KOT → existing EFTPOS, with payment reconciliation |
| 4 | Kitchen delivery | Station routing, KDS acknowledgement, real KOT printing and duplicate suppression |
| 5 | Online payment vertical | Provider-neutral verified payment → `PREPAID / ONLINE` → KDS/KOT |
| 6 | Exceptions and reconciliation | Uncertain POS outcomes, refunds, DLQ, reprint and operator recovery |
| 7 | Security and resilience | Tenant/venue isolation, audit, restart/outage/replay and secrets hardening |
| 8 | Venue UAT | Actual Idealpos/EFTPOS/printer evidence, staff training and controlled rollback |
| 9 | Supervised pilot | Restricted go-live with monitoring, support ownership and acceptance evidence |

---

## Sprint 1 — Foundation
* **Deliverables:**
  * Scaffold NestJS `verdura-api`. Configure Prisma client to connect to local PostgreSQL.
  * Scaffold `verdura-admin` (React/TS) and `verdura-kiosk` (React/TS).
  * Configure local Redis Docker container.
  * Set up CI/CD pipeline actions (linting, typechecking, tests).
* **Success Criteria:** `GET /health` returns `db: ok, redis: ok`. Docker starts all local services.

---

## Sprint 2 — Identity & Venues
* **Deliverables:**
  * Connect NestJS to Supabase Auth tables. Replicate profile rules.
  * Create administrative login forms on the Admin Dashboard.
  * Seed local Auckland tables and venues.
  * Kiosk table picker (consuming `/api/kiosk/tables`).
* **Success Criteria:** Administrative logins return secure JWT tokens. Deactivating a table in the admin panel hides it from the kiosk table picker.

---

## Sprint 3 — Menu API & Seeding
* **Deliverables:**
  * Configure PostgreSQL schema for categories and menu items (using `jsonb` for modifier options and nutritional allergens).
  * Write pricing float-to-cents migration script.
  * Implement public rate-limited `/api/kiosk/menu` endpoint.
* **Success Criteria:** All 66+ menu items are seeded into PostgreSQL; floating-point prices are successfully converted to NZD integer cents.

---

## Sprint 4 — Orders & KDS
* **Deliverables:**
  * Implement `POST /api/kiosk/orders` (captures item price snapshots).
  * Configure WebSockets via Socket.io on NestJS using the Redis adapter.
  * Implement kiosk cart, checkout, and IndexedDB local caching.
  * Build Kitchen Display System (`/kds`) showing active orders in real time.
* **Success Criteria:** Order submitted on the kiosk is written to the database and pops up on the KDS screen in less than 3 seconds.

---

## Sprint 5 — PM2 Printing Service
* **Deliverables:**
  * Build `verdura-printer-service` (Node/PM2 agent) polling Redis `print-jobs:{venueId}`.
  * Write ESC/POS ticket templates in NestJS.
  * Build SQLite local offline backup on the local gateway PC.
* **Success Criteria:** Order submissions successfully dispatch print commands to Auckland LAN printers over TCP/9100.

---

## Sprint 6 — PM2 IdealPOS Agent

> **Correction (2026-08-16):** this sprint's "Node/PM2 agent polling Redis" framing is superseded on two points, consistent with the rest of this superseded historical schedule: (1) the connector never polls a bare Redis queue directly — it uses the outbound-only mutually authenticated connector session per DL-054/target-operating-model.md §8; (2) if the API-less interim adapter (`docs/integrations/idealpos.md` §13–§18) is the path taken, the venue-side component is not a pure Node.js/PM2 process — it is a Windows Connector service (provisionally .NET 8) paired with a separate interactive Idealpos POS Bridge process, gated by live discovery and tracer bullet story `9-2`. PM2-managed Node.js remains applicable to the Printer Service and to any future cross-platform Api/Csv adapters, not to the Idealpos API-less path.

* **Deliverables:**
  * Build `verdura-pos-agent` (Node/PM2 agent) polling Redis `pos-sync:{venueId}`.
  * Implement POS sync retry loops using BullMQ.
  * Write CSV/SQL/API adapters based on restaurant audits.
* **Success Criteria:** Kiosk orders sync automatically to the local IdealPOS system with the correct table number.

---

## Sprint 7 — Reservations Integration & Emails
* **Deliverables:**
  * Remove `/admin/daily-email` from public site `App.jsx` (Frontend Freeze exception).
  * Configure Supabase PostgreSQL triggers/webhooks to notify NestJS of new reservation entries.
  * Integrate Resend email provider templates (confirmation/cancellation).
* **Success Criteria:** Reservation created on the customer website triggers an instant notification update on the Admin Dashboard.

---

## Sprint 8 — Offline Hardening & Security
* **Goal:** Hardening under local internet outages.
* **Deliverables:**
  * Setup CORS, Helmet.js headers, and DTO validations.
  * Stress-test offline queues: disconnect network, submit 20 kiosk orders, verify SQLite local logs, reconnect, and confirm correct queue drainage.
* **Success Criteria:** Offline order data drains and reconciles without duplication. `npm audit` lists zero vulnerabilities.

---

## Sprint 9 — UAT & Launch
* **Deliverables:**
  * Deploy production Docker containers.
  * Setup subdomains (`admin.`, `kiosk.`, `api.`).
  * Run staff training and final sign-off.
* **Success Criteria:** Complete print/sync transaction latency is under 3 seconds. System satisfies all performance SLAs.
