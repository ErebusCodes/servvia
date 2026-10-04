# Epic 12 Context: Operational readiness and release acceptance

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make Servvia operable and provably releasable. Operators must be able to detect, diagnose and recover from failures, using alerts, correlated logs, metrics, bounded timeouts, replayable dead letters and rehearsed runbooks. Legacy and unsafe paths (IdealPOS dispatch, the kiosk payment path, mock Admin pages, synthetic staff attribution) must not be able to act on, or misrepresent, pilot data. Go-live readiness is shown with evidence from the release-acceptance suite, failure drills, the security review, the load test and a venue dry run, not asserted. "Implemented" is not "production ready". Scope reductions for the first pilot do not lower any of these quality controls.

## Stories

- Story 12.1: Monitoring and alerting for outages, backups, dead letters and stuck orders
- Story 12.2: Request IDs, structured logs and Core metrics
- Story 12.3: Core database timeouts, device-route rate limits and dead-letter replay
- Story 12.4: Legacy decoupling for Servvia-native venues
- Story 12.5: Kiosk off in production until fixed
- Story 12.6: Hide or relabel mock Admin pages
- Story 12.7: Data-driven station routing
- Story 12.8: End-to-end acceptance and failure drills
- Story 12.9: Runbooks and operational rehearsal
- Story 12.10: Security review and penetration test
- Story 12.11: Performance and load smoke test
- Story 12.12: Real-device, LAN and venue validation dry run
- Story 12.13: Durable ingestion and retention of security and operational logs
- Story 12.14: Isolated queue infrastructure for Nest integration tests
- Story 12.15: Kitchen (KDS device) status changes fail on the audit actor foreign key
- Story 12.16: Device-originated orders without a synthetic staff creator

## Requirements & Constraints

- **Release acceptance (no venue go-live without all of these):** correct pricing and tax; no duplicate charges; no duplicate KOTs; ordered replay after a restart or outage; station routing; payment reconciliation; partial and full refunds; device revocation; audit correlation; staff-visible recovery for every failure state. Each needs explicit evidence (test reports, review records, rehearsal logs). Production cutover is a separately approved operational action and never follows from a calendar date.
- **Production-readiness gates:** architecture compliance, security review, passing tests, verified migrations (from zero, upgrade, drift), verified rollback and recovery, observability, operational docs, verified secrets and configuration, load acceptance, failure-mode testing, data-integrity validation, UX and accessibility acceptance, and no unresolved release-blocking defects.
- **Observability:** structured logs carry request and correlation IDs across Core, workers, realtime and Edge. Metrics cover per-endpoint latency and errors, realtime subscribers and slow-consumer closes, DB pool and query health, queue depth and oldest age, and worker success, retry and dead-letter rates. Liveness and readiness reflect real dependencies, and a platform-level backlog view is required. Telemetry carries no secrets, card data, credentials or unnecessary personal data.
- **Alerts** are required for stuck orders, Edge heartbeat, dead-letter age, payment reconciliation, API errors, service down and backup failure. Each alert links to a runbook. **Alert thresholds: OWNER TARGET REQUIRED.** Build the detection mechanics only.
- **Runbooks** for deploy, rollback, incident, restore, end of day and Edge installation must exist before production and be rehearsed in staging. The end-of-day runbook is blocked on O-6 (minimum service-day reports).
- **Reliability:** retries are bounded; dead-lettered work is visible and retryable by an authorized operator; a replay is idempotent and audited. Timeout values come from configuration and are never invented.
- **Audit:** every pilot-critical mutation is append-only, correlated and attributable (actor, action, before/after, time), searchable, and kept at least 90 days. Shipped security and operational logs are separate from the business AuditLog: a refusal must not write an AuditLog row, and no second transactional audit system may be created. The durable sink, its cost and retention beyond 90 days are owner decisions.
- **Never fake success / no mock data:** production-critical workflows contain no prototype or mock behaviour. Fabricated data must not be shown as real.
- **Kiosk:** NZ prices are GST-inclusive (GST = gross × 3/23, never an additive 15%). Payment amounts must equal the server total, and missing provider configuration fails closed in production.
- **Performance:** the inherited targets (API read P95 < 200 ms, order submit P95 < 500 ms, KDS < 3 s, 99.5% monthly availability, and others) are unconfirmed (O-19). Capacity, throughput, backlog and reconnect-storm targets are OWNER TARGET REQUIRED. The load test stays BLOCKED, and you must not choose numbers.
- **Security review** triage depends on the defect-severity and release-blocking policy: **OWNER DECISION REQUIRED**.
- **Tests** check behaviour and invariants, not coverage. They are deterministic and run on disposable infrastructure (PostgreSQL in UTC). Failure and recovery tests cover provider timeout, queue failure, Redis outage, reconnect, restart and dead letters. No test may be deleted or disabled to make a suite pass.

## Technical Decisions

- Go Core (`services/core-platform`) is the only owner of canonical transactional state, and PostgreSQL is authoritative. NestJS is transitional: it may issue credentials, but Core authorizes every transactional request. Prisma stays the migration authority, and published migrations are never renamed or rewritten. Deploy schema changes so that running code stays correct.
- IdealPOS is legacy only. A venue with `posAdapterType = none` is the Servvia-native path and must create no POS sync records. The legacy external-POS modules are retired only once their callers are safe (build before cleanup). Canonical order creation must not import the legacy POS modules.
- Audit actor model: actor identity, device identity and provenance are separate. `actorType` is staff, device or system. The Staff foreign key applies only to staff actors. No synthetic Staff row is created for a device. Model the order creator the same way, and leave existing rows unchanged.
- Order-origin values and the Staff Mode vs Guest Mode recording question stay open (O-21). Do not rename or redefine `OrderSource` or `DeviceKind` values.
- Kitchen routing is line-level, uses the station configuration in effect at submission, and may produce several station tickets per round. Multi-station routing is deferred until the venue's station set is known.
- Isolate integration-test queues with a unique BullMQ prefix per spec file (`QUEUE_PREFIX`, unset in production).
- First-pilot scope: settlement through the web Order Tablet in Staff Mode, integrated card through Venue Edge (provider blocked on O-3), and no Windows POS, Guest Mode or cash drawer. Monitoring, audit, backups, rollback and testing are not reduced.

## Cross-Story Dependencies

- 12.1, 12.9 and 12.11 depend on Story 4.2. 12.5 depends on 1.5. 12.7 depends on 6.1. 12.10 depends on Epic 2 (and Epic 1). 12.13 depends on 4.1, 4.2 and 12.2. 12.16 depends on 12.15.
- 12.8 builds incrementally on Epics 5 to 10. Its final pass needs Story 10.6, which is blocked on O-3 (card provider). 12.12 needs a passed 12.8 and venue-access authorization.
- 12.14 applies until the legacy POS sync is retired.
