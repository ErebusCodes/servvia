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
| `create-owner-staff.mjs` | nothing (**retired**) | Created the Dunedin owner in August 2026 with an operator-chosen password (`SEED_OWNER_PASSWORD`). Retired by Story 2.11: it now refuses to run. Its original body is in git history. |
| `bootstrap-first-owner.ts` | `Staff`, `VenueAccess`, `StaffCredentialToken`, `AuditLog` | The governed first-owner bootstrap (`npm run staff:bootstrap-owner`). See below. |
| `issue-credential-setup.ts` | `StaffCredentialToken`, `AuditLog` | Credential recovery for an existing owner or admin (`npm run staff:issue-setup-code`). See below. |
| `create-tables.mjs` | `Table` | Contains **verified reference data**: real `Caption`/`Seats` pairs read from `IPSTransaction.dbo.TableMapSetups` WHERE `Code=1 AND Type=3` on 2026-08-26. `posTableCode` is the exact Caption the Bridge matches on via `IdealposReadRepository.GetTables()` / `FindTableByCaption` — not guessed. This is the only surviving record of that mapping. |

## First owner of a real installation (Story 2.11)

A real installation's first owner is created once, by an operator with
database access on the host:

```
npm run staff:bootstrap-owner --workspace=apps/api -- <organization-slug> owner@example.com "Owner Name"
```

It refuses while the organization has any active owner, so it is not a way
back in; it creates the account with no usable password, grants it every venue
of the organization, and prints a single-use setup code once, to the terminal
only. Give it to that person in person; they set their own password at
`/setup-credential` within 24 hours. The account, its grants, the code and the
audit records (system actor `staff-owner-bootstrap`) commit together.

`prisma/seed.ts` (`npm run db:seed`) is for development and test databases
only: it resets the seeded owner's password, so it refuses `NODE_ENV=production`
and any database whose name looks like production, with no override.

## Admin Console access (Story 2.4)

The Admin Console has no shared PIN: every administrator signs in by name. If
no owner or admin can sign in (a new installation, or a forgotten password),
an operator with database access on the host issues a single-use setup code
for an existing, active owner or admin:

```
npm run staff:issue-setup-code --workspace=apps/api -- owner@example.com
```

The code is printed once, to the terminal only. Give it to that person in
person; they set their own password at `/setup-credential` within 24 hours,
which ends all their sessions, and then sign in with their email and password.
The command creates no account, changes no role or password, ends that
person's earlier unused codes, and is audited as the system actor
`staff-credential-bootstrap`. Other staff are then created from the Staff page.

## Safety

These write to whatever database `DATABASE_URL` points at. Per
`docs/source-of-truth-and-environments.md` §4, confirm the target before
running anything here, and do not re-run `create-tables.mjs` against
production without checking the current `Table` rows first.
