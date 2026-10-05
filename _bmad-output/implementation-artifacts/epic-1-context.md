# Epic 1 Context: Trustworthy build, CI and production start

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->
<!-- Recompiled 2026-10-05 (Story 14.2) from the re-anchored epics.md; architecture authority is PRD/product-requirements.md Part C. -->

## Goal

Make the build and release line trustworthy so every later epic stands on firm ground: what passes CI is what actually runs, the Go Core is built and tested against real PostgreSQL and Redis on every change, CI is green without hiding failures, test verdicts cannot be corrupted by the test harness itself, the transitional NestJS API starts in production from the artifact the build emits, production refuses unsafe or development-default configuration, and `main` accepts only changes that pass the required checks. This epic is an enabler for all product work. Every later story relies on CI and evaluator verdicts being honest, and nothing reaches production on development defaults.

## Stories

- Story 1.1: API lint passes so the API CI job runs to completion
- Story 1.2: Go Core CI job with real PostgreSQL and Redis
- Story 1.3: Venue Connector CI job made truthful
- Story 1.4: Nest production start runs the built entry point
- Story 1.5: Production configuration fails closed
- Story 1.6: Protect the main branch
- Story 1.7: Native-round-recovery integration tests run truthfully in CI
- Story 1.8: Native-round-recovery tests refuse a DATABASE_URL host query override
- Story 1.9: Test-harness loopback binding
- Story 1.10: CI asserts the native-round-recovery suite executes

## Requirements & Constraints

- **Green honestly.** No lint rule may be disabled or relaxed, no test assertion weakened or skipped, and no job set to continue on error to get green. Tests validate behaviour and invariants. No coverage percentage is set or approved.
- **Real, disposable dependencies; deterministic tests.** Database and integration tests run on disposable environments. Go Core uses disposable PostgreSQL in UTC. Tests are deterministic where practical: an intermittent failure caused by the harness is a defect, not noise. The Go race detector is required for concurrency. Concurrency safety must be proven with tests on real PostgreSQL.
- **Supply chain.** Dependencies are pinned through lockfiles and module checksums (Go builds verify checksums read-only). The Node version is pinned. Vulnerability remediation timelines are OWNER DECISION REQUIRED and stay unresolved: do not invent them.
- **Configuration and secrets.** Each service has one documented configuration contract. Production refuses development defaults. A missing or invalid environment fails at startup with a clear error and never defaults to development. Secrets are managed externally and never committed, logged or returned in error responses. Development settings (for example in Docker Compose) stay explicit and development-only.
- **Each refused production default needs its own test.** These include default JWT and service secrets, the default admin PIN and 3-digit PINs, fixture routes, simulated printers and the Table-19 mode.
- **Deployment safety.** Every release is reversible or has a documented forward-fix path. A clean build followed by a production start must boot and answer the health endpoint. A check must fail if the start path and the build output diverge again.
- **Release evidence.** "Implemented" is not "production ready". The gates need explicit evidence such as test reports and run logs, not informal confidence. A story is not done just because code exists. The Enterprise Quality Bar is the Definition of Done for every story.
- **No invented requirements.** Leave every OWNER TARGET or OWNER DECISION item unresolved.

## Technical Decisions

- **CI** lives in `.github/workflows/ci.yml` (GitHub Actions). The Go Core job uses the toolchain version from the module and runs vet, build and race-enabled tests against PostgreSQL and Redis service containers, through the Core test database and Redis environment variables.
- **Migrations.** Prisma (`apps/api/prisma`) remains the only migration authority. CI applies its migrations before the Core suites run. Published migrations are never renamed or rewritten. Do not create a competing Go migration system.
- **PostgreSQL version.** CI targets the production PostgreSQL major version (18). Record any mismatch between jobs as a finding and never change it silently.
- **Optional suites.** The optional Core-to-Nest parity suite runs only when its Nest URL is configured. Otherwise it is skipped explicitly.
- **Ownership.** Go Core (`services/core-platform`) owns canonical transactional state. NestJS (`apps/api`) is transitional but still serves current clients, so its production start must work. Code stays in its owner path as fixed by the PRD's architecture and repository-structure part, and architecture guard tests stay green.
- **Venue Connector.** This legacy external-POS project is classified RETIRE. "Build before cleanup" applies: it is retired only through an approved legacy-retirement checkpoint, never by skipping its tests.
- **Evaluation.** Story work is evaluated against a frozen objective bound to its story spec and this committed epic context; the native-round-recovery suite and its host-safety guard (Stories 1.7 and 1.8) are protected behaviour that later stories must leave passing unchanged.

## Cross-Story Dependencies

- Story 1.5 depends on Story 1.4.
- Story 1.6 depends on Stories 1.1 to 1.3, because their CI jobs become the required checks. It needs authorization for remote GitHub repository administration and is sequenced after the baseline-integration wave (Epic 14).
- Story 1.8 builds on Story 1.7.
- Story 1.9 depends on the integrated baseline and the re-anchored planning (Stories 14.1 and 14.2). Its objective is regenerated and frozen on that baseline before any implementation, and it precedes the identity and provenance work (Epic 15) because that work relies on integration-test verdicts.
- Story 1.10 depends on Story 1.9 and is deferred to the first Epic 1 slot after Epic 15 starts.
- Validating CI changes on GitHub needs an authorized push, so validate locally first with the same commands against disposable containers.
- Downstream: every later epic relies on this CI, and Epic 3 relies on the Prisma migration path being exercised.
