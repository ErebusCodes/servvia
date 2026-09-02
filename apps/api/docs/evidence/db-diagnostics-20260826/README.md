# Database diagnostics — 2026-08-26 order-flow investigation

Read-only scripts written during the Table 19 validation run to answer
"did the order actually land, and where did it stop?" across the
`Order` → `POSSyncRecord` → `ConnectorCommand` → `KdsDeliveryRecord` chain.

Kept as a **record of how that investigation was conducted**, not as
maintained tooling. None of them writes: every statement is a `SELECT` or
`COUNT`, and the `$queryRawUnsafe` calls all use literal single-quoted SQL
with no interpolation, so there is no injection surface.

| Script | Answers |
| --- | --- |
| `baseline.mjs` | Row counts across all four tables, plus `NOW()` — run before a test submission |
| `post_check.mjs` | The same counts after submission, plus the 5 most recent orders and KDS records |
| `urgent_check.mjs` | Counts plus 5 recent orders (narrower than `post_check`) |
| `raw_count.mjs` | `Order` count plus 5 recent orders |
| `check_sync.mjs` | `POSSyncRecord` / `ConnectorCommand` counts and 5 recent commands |
| `seq_check.mjs` | State of the `Order_ORD6_seq` sequence against the live `Order` count |

## Why five sibling scripts are not here

Five further scripts from the same investigation were **archived outside this
repository** rather than committed, at
`C:\Users\Posmate\Documents\VerduraArchive\diagnostics-20260826\`:

- `item_check.mjs`, `item_recheck.mjs`, `table_check.mjs`, `trace_order.mjs` —
  each embeds a hardcoded production UUID (organization, venue or item), which
  makes them environment-specific and a poor fit for shared source control.
- `watch_order.mjs` — performs an unselected `prisma.order.findMany()` and
  pretty-prints whole `Order` rows, which include the `notes` free-text field
  and `paymentProviderTransactionId`. The script contains no personal data
  itself but can emit it at runtime.

Recovered 2026-09-02 from an untracked `_preserved-from-VerduraServer/`
directory. Screened against credentials, connection strings, hardcoded IDs,
absolute machine paths, personal data and destructive Prisma operations
before being committed here.
