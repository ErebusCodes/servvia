# Servvia release-gate register

> **BMAD PLANNING / EVIDENCE REGISTER, NOT REQUIREMENTS AUTHORITY.** Gate definitions: `release-readiness-program.md` §5. Requirements: SPRD §11, §24, §25 and `PRD/00` §00.8–§00.9. This register records gate decisions and their evidence; it never infers a gate from story status.
>
> Created 2026-10-06 (RR-8). **No gate has been passed.**

## How a gate record is made

- One record per gate decision. It contains:
  - the gate (G2–G5) and its scope (subsystem, release-candidate artifact, pilot or production release);
  - the date;
  - the evidence for each acceptance item of `release-readiness-program.md` §5: links to evaluator records, CI runs, test reports, review records and rehearsal logs;
  - open defects with their DEF-25 classification;
  - residual risks with the owner's acceptance (`PRD/00` §00.8 item 5);
  - the orchestrator's decision, and the owner's decision where the gate names one.
- **G1 (story complete)** is recorded per story in `sprint-status.yaml` and the story's Status line (governed stories: frozen objective, evaluator record, ledger, integration commit). It is not repeated here.
- A record is append-only. A later failure is a new record; earlier ones are never edited.

## Current state

| Gate | Scope | State | Record |
|---|---|---|---|
| G2 — Subsystem integration ready | any subsystem | NOT PASSED | — |
| G3 — Release candidate ready | pilot candidate | NOT PASSED | — |
| G4 — Pilot ready | first pilot | NOT PASSED | — |
| G3 — Release candidate ready | production-complete candidate | NOT PASSED | — |
| G5 — Servvia production ready | production release | NOT PASSED | — |

## Records

(none)
