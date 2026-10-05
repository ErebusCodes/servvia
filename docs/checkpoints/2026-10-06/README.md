# Servvia checkpoint — 2026-10-06 (project paused after Story 15.1 objective preparation)

> **EXECUTION / RECOVERY EVIDENCE — NOT REQUIREMENTS AUTHORITY.** This file records where the project stands so that a fresh session can recover it without chat history. It defines no requirement.
>
> Requirements authority is [`PRD/product-requirements.md`](../../../PRD/product-requirements.md) (SPRD) and the normative volumes [`PRD/00`](../../../PRD/00-overview-and-conventions.md)–`PRD/09`. Conflicts are resolved by the precedence in `PRD/00` §00.1.1: an accepted ADR or controlled decision governs unless explicitly superseded; ambiguity means STOP and escalate. BMAD (`_bmad-output/`) is planning, not authority.
>
> **SERVVIA IS PAUSED. NO NEW TASK IS AUTHORIZED UNTIL THE OWNER RETURNS AND EXPLICITLY RESUMES WORK.**

The previous checkpoint, [`../2026-10-05/README.md`](../2026-10-05/README.md), is a historical record of the 2026-10-05 pause. Its "next step" (Story 14.2) has since been done.

## 1. Project state

| Item | State |
|---|---|
| Integration branch | `integration/normative-prd-baseline` on `origin` (`https://github.com/ErebusCodes/servvia`); tip = the commit that adds this file (its parent is `69f4123`) |
| Pull request | [#1](https://github.com/ErebusCodes/servvia/pull/1) → `main`: **open, not merged, no auto-merge** |
| `main` | `a005642` (local and remote), **not moved** |
| Deployment / production | **None.** No deployment, production database or infrastructure action has taken place. Core D1–D13 are implemented, not in production. |
| Original local checkout | Mixed, dirty working copy. Preserved as is (fingerprinted, never staged, cleaned, reset or committed). It is not part of the published lineage. |

## 2. Accepted lineage (recovery hashes)

On `integration/normative-prd-baseline`, oldest first:

- **Core D1–D13:** the canonical Go Core (`services/core-platform`) over PostgreSQL. D13 (durable domain events and workers) is `862605f`, on this branch only; D12 (`d2857f1`) and earlier are also on `main`.
- **Accepted Batch 1:** `integration/accepted-batch-1` @ `e575658`, Stories 1.3, 12.3a and 12.5.
- **Accepted Batch 2:** `integration/accepted-batch-2` @ `38bea30`, Stories 1.7 and 1.8.
- **Legacy-app retirement and reconciliation:** `354ea1b` retires the legacy kitchen-display, order-tablet and window-display directories.
- **Normative PRD baseline and Wave A:** `5ee6474`. `fileRestructure.md` is retired into SPRD Part C. This step includes the KitchenOS assimilation (target capability, future delivery) and the O-20/O-21 decisions (`PRD/00` §00.10.6).
- **Story 14.2 (BMAD re-anchoring):** `0d1e334`, with governance closure `e42edeb` (O-10 and O-13 decided; ADR conflict rule in `PRD/00` §00.1.1).
- **Story 1.9 (test-harness loopback binding):**
  - preparation: `e983faa` and `e6b30e7`;
  - frozen anchor `fc064b5`, objective sha256 `dd4483c8…af77704`;
  - candidate `f9110b7`, governed PASS;
  - integration merge `963bd4c`, freeze record `dff753a`;
  - **DONE, accepted 2026-10-06** (`6526159`).
- **Epic 15 sequencing:** `6526159` reconciles Epic 15 against the code. The plan is a split into 15.1, 15.3, 15.2a–d, 15.4a/b, 15.5 and 15.7, with Story 15.1 recommended first.
- **Story 15.1 planning correction:** `5d5772d8ad172a6374beb5892a22a389ac34c8af`. It removes the false 15.1 → 15.2c edge, replaces the payment-adapter AuditLog criterion with the FIN-36 boundary, and adds `epic-15-context.md`.
- **Story 15.1 freeze-candidate packet:** `69f4123`.
- **This pause checkpoint:** the commit adding this file.

## 3. Current work: Story 15.1 objective preparation (complete, NOT FROZEN)

| Item | Value |
|---|---|
| Story | 15.1, Core audit records the real actor class, and the device a staff action was taken on |
| Draft objective | `_bmad-output/implementation-artifacts/objective-drafts/story-15-1-core-audit-actor-attribution/v1.objective.json` |
| Objective sha256 | `06db19c272182923b07a7c7816a7554693e962a9855ca70eadd463956ba86934` |
| Objective baseline | `5d5772d8ad172a6374beb5892a22a389ac34c8af` |
| Preparation tip | `69f4123` |
| Story spec | `_bmad-output/implementation-artifacts/spec-15-1-core-audit-actor-attribution.md` (intent-contract sha256 `ed8b6d40…`) |
| Epic context | `_bmad-output/implementation-artifacts/epic-15-context.md` (sha256 `3692db6f…`) |
| Preparation result | `POSITIVE CONTROL PASSED — STORY 15.1 OBJECTIVE READY FOR FREEZE` |
| Freeze state | **NOT FROZEN** |
| Implementation | **NOT AUTHORIZED** |
| Ledger | None: `~/.servvia` holds no Story 15.1 state |

"Ready for freeze" is a technical readiness result. **It is not approval.** Only the orchestrator freezes an objective (`_bmad-output/implementation-artifacts/objectives/README.md`).

Detailed evidence is in the packet: [`evidence/EVIDENCE.md`](../../../_bmad-output/implementation-artifacts/objective-drafts/story-15-1-core-audit-actor-attribution/evidence/EVIDENCE.md), together with `control-negative.txt`, `control-positive.txt`, `adversarial-probes.out` and `baseline-measure.txt`.

### Preparation conclusions

- Core has **eight** AuditLog writers:
  - six tablet-reachable: tables, orders, checks, payments, refunds (`payments/pgstore/adjustments.go`) and shifts;
  - two staff-session-only: devices and promotions.
- The six tablet-reachable writers currently **lose the verified tablet-device context** of `tablet_staff` and `tablet_manager` callers. Devices and promotions remain staff-session-only and record staff only.
- No current Core AuditLog writer is genuinely device- or system-initiated.
- The existing schema (migration `20261010000000_audit_actor_types`: `AuditActorType`, `AuditLog_actor_shape_check`, `AuditLog_immutable`) already supports the required actor shape. **No Story 15.1 migration is required.**
- Payment-adapter results are already recorded in append-only transition histories with device attribution, as FIN-36 requires. They are **outside Story 15.1**.
- **`15.2c DOES NOT DEPEND ON 15.1`.** Nest is outside Story 15.1.

### Validation (test evidence, disposable environments)

- **Environment:** Node 22.23.3, Go 1.27.1 (offline), PostgreSQL 18.4, Redis 8.10.1, UTC.
- **Baseline:** gofmt clean, vet clean. The race-enabled Core suite produced **438** evaluator-counted test events (306 top-level), with 0 failures and 0 skips. Measured at `6526159`, whose code is identical to `5d5772d`.
- **Negative control** on the exact bytes `06db19c2…`: **FAIL**, for Story 15.1-specific reasons only.
  - The generic gates pass.
  - The writer-coverage, routes and model checks fail, and RT-1 to RT-5 are missing.
  - The routes check shows tablet rows with a NULL device kind and id.
- **Positive control** on the same bytes (a disposable implementation in a scratch clone, never published, since deleted): **PASS**, with all six checks green and 443 tests.
- **Adversarial:** 27 variants, 27 rejected, **0 masked**.
- **Determinism:**
  - generator `--check` is byte-identical;
  - fresh-clone regeneration is byte-identical;
  - evaluator self-tests pass 115/115;
  - `loop.mjs validate` reports READY;
  - there is no Story 15.1 ledger.
- **TAP residual:** remains **open**. No correction cycle has occurred and none was fabricated.

## 4. Pending decisions (unresolved; do not decide without the orchestrator or owner)

### Story 15.1 — orchestrator review required before any freeze

- **Decision A:** whether to accept the two-commit preparation structure (`5d5772d` planning correction + Epic 15 context; `69f4123` packet) instead of the originally requested single preparation commit. Two commits were used because the epic context must exist on the objective baseline.
- **Decision B:** whether to accept `_bmad-output/implementation-artifacts/epic-15-context.md` as the required hash-bound Epic 15 context added to the preparation baseline.
- **Decision C:** whether to accept the freeze candidate's pinned Core audit API (`Device`, `DeviceOf`, `Actor`, `Staff`, `ByDevice`, `System`, `ErrInvalidActor`, `Validate`, `Entry`, `Write`, in `internal/audit`) and its compatibility rule. Under that rule, existing staff-email semantics are preserved: a staff email is recorded exactly as the verified credential carries it and is never NULL. Staff id and role are required.

### Existing owner, policy and release gates (unchanged; none approved)

- **DL-117 (11 October 2026 milestone): NOT approved.**
- **P5** (compliance) and **P10** (allergen list and acknowledgement): production gates.
- **P6** (financial-control values) and **P2** (session, PIN and lockout values): policy values.
- **O-19:** release confirmation of the inherited targets is still required before release acceptance.
- **Pilot owner portions:** O-1 (native Waiter Tablet at the pilot); O-3 (card provider, terminal, terms); O-4 (pilot hardware, kitchen printing); O-5 (receipt and NZ tax-invoice content); O-6 (pilot close reports); P13 (pilot readiness and timing; pilot venue).
- **Windows POS authentication:** PENDING USER POS ANALYSIS REPORT.
- Merging PR #1 into `main` is a separate, unmade decision.

## 5. Deferred and not started

- **Story 1.10** (CI asserts that the native-round-recovery suite executes): **DEFERRED**. It does not follow Story 1.9 automatically.
- **Story 15.1 implementation:** not started and not authorized.
- **Later Epic 15 stories** (15.3, 15.2a–d, 15.4a/b, 15.5, 15.7): not started.
- **Android/native work** (Epics 17–19): not started. The four apps are README scaffolds.
- **TAP residual:** open.

## 6. Restart instruction

When the owner returns and explicitly resumes work, **the first action is: orchestrator review of the Story 15.1 freeze candidate (`06db19c2…`) and its three pending decisions (A, B, C).**

- Do **not** freeze Story 15.1 automatically, and do **not** implement it, until the orchestrator decides.
- A freeze, if approved, is a commit whose first parent is exactly `5d5772d8ad172a6374beb5892a22a389ac34c8af`. It contains only the draft objective (byte-identical) and the story spec. See the packet's `README.md` and `provisioning/README.md`.
- If the orchestrator changes the objective, the controls, the adversarial probes and the determinism checks must all be rerun on the new bytes.

Recovery steps for a fresh session:

1. Fetch `origin`.
2. Verify `integration/normative-prd-baseline` is at the checkpoint commit and its parent is `69f4123`.
3. Verify PR #1 is open and unmerged, and `main` is at `a005642`.
4. Read this file.
5. Read the Story 15.1 packet README.

The original local checkout must remain untouched.
