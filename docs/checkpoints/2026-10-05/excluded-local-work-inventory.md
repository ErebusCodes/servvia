# Excluded local work — inventory (2026-10-05)

> **PLANNING / EXECUTION-STATE EVIDENCE — NOT REQUIREMENTS AUTHORITY.** This lists, by group, the uncommitted work in the original development checkout (based on `main` `a005642`) that this checkpoint deliberately does **not** publish. Nothing here was committed, discarded or modified. File contents are not reproduced. A per-file classification and a patch backup are kept locally by the maintainer.

**How it was classified.** Each of the checkout's 1,501 status entries was compared with the checkpoint tip (`5ee6474`):

| Result | Entries | Meaning |
|---|---|---|
| Already represented | 1,045 | Absent at the tip too (700), or byte-identical at the tip (345), including the normative `PRD/` corpus |
| Deleted locally, present at the tip | 316 | Local removals not adopted by the accepted lineage |
| Differs from the tip | 113 | Local edits that differ from the accepted versions |
| Not in the tip | 27 | Local-only files |

## Excluded groups

| Group (paths) | Classification | Represented elsewhere? | Why excluded | Future reconciliation |
|---|---|---|---|---|
| Local deletion of legacy external-POS projects: `apps/venue-connector` (107), `apps/idealpos-bridge` (60), `apps/idealpos-harness`, `apps/idealpos-bridge-ci`, related scripts | Owner work in progress | No. The lineage still contains them (TRANSITIONAL, retire only through an approved legacy-retirement checkpoint, SPRD §34) | Retiring them needs its own approved checkpoint | Separate owner-approved legacy-retirement story |
| Local deletion of `.claude/skills` (83) and `_bmad/*` (BMAD installation) | Owner work in progress / superseded tooling question | No. The lineage keeps the accepted BMAD installation | BMAD changes belong to Story 14.2 or a later decision | Decide with Story 14.2 |
| `services/core-platform` (22), `services/venue-edge` (4), `contracts/*` (11), `apps/api` (5), `apps/web` (7 incl. local-only `AdminPinGate`), `apps/windows` (6), `apps/android` (4), `docker-compose.yml`, `docker/`, `package.json`, `.github/workflows`, `windows-deploy/*`, `.gitignore` | Superseded by the accepted lineage or unclear older work in progress | Largely superseded (for example pre-commit Core D13 work later committed in the lineage) | Not reviewed against the accepted versions; publishing could regress accepted work | Path-by-path review against the tip, then a separate patch for owner review |
| `docs/*` edits (about 30 files: ADR README, decisions log, architecture, audits, migration, runbooks, offline/printers/ux and similar) and local archive moves (`docs/integrations`, `docs/discovery`, `docs/superpowers` into `docs/archive/*`) | Owner documentation work | No | Owner-authored and not reviewed for this checkpoint | Owner review |
| `docs/planning/*` (6, local-only) | Obsolete planning output | — | Never requirements authority (SPRD and `PRD/00` §00.1.1) | Regenerate from SPRD only if ever needed |
| `docs/audit/*` (3), `TechnologyStack_n_SystemAreas.csv`, `scratchpad/idealpos-audit.md`, `scripts/no-external-pos.test.mjs` | Owner notes and work in progress | No | Owner-only, not reviewed | Owner review |
| `.env.example` changes | Configuration templates (no secrets) | The tip has its own accepted versions | Part of the unreviewed local changes | Review with the code group |

**Never published:** real `.env` files, private backups and credentials. None are part of this repository's history from this checkpoint.
