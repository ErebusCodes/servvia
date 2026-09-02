# Production provisioning scripts

One-off bootstrap scripts that created the real DUNEDIN organisation, venue,
owner account and table set. They are **idempotent upserts**, not migrations —
running one again reconciles the row rather than duplicating it.

Recovered 2026-09-02 from an untracked `_preserved-from-VerduraServer/`
directory that survived the 2026-08-27 checkout consolidation. Before that
recovery these existed only as untracked files in two locations and were one
`git clean` away from being lost permanently.

| Script | Writes | Notes |
| --- | --- | --- |
| `create-dunedin-venue.mjs` | `Organization`, `Venue` | Address and operating hours are **structurally-required placeholders**, not real trading data — Verdura's schema needs non-null JSON there. They are not derived from IdealPOS (which has no such fields). Correct them with real values before this venue is publicly relied on. |
| `create-owner-staff.mjs` | `Staff`, `VenueAccess` | Requires `SEED_OWNER_PASSWORD` in the environment and throws without it; optional `SEED_OWNER_EMAIL` defaults to `owner@verdura.co.nz`. Hashes with argon2id. No secret is stored in this file. |
| `create-tables.mjs` | `Table` | Contains **verified reference data**: real `Caption`/`Seats` pairs read from `IPSTransaction.dbo.TableMapSetups` WHERE `Code=1 AND Type=3` on 2026-08-26. `posTableCode` is the exact Caption the Bridge matches on via `IdealposReadRepository.GetTables()` / `FindTableByCaption` — not guessed. This is the only surviving record of that mapping. |

## Safety

These write to whatever database `DATABASE_URL` points at. Per
`docs/source-of-truth-and-environments.md` §4, confirm the target before
running anything here, and do not re-run `create-tables.mjs` against
production without checking the current `Table` rows first.
