# IdealPOS menu de-duplication — evidence, 2026-08-28

The investigation that produced the `PosCandidateConfidenceTier` taxonomy in
migration `20260828133203_menu_management_pos_identity_and_channels`.

**These queries target the IdealPOS SQL Server database
(`IPSTransaction`, tables `dbo.StockItems` / `dbo.Departments`) — not
Verdura's PostgreSQL.** They are read-only `SELECT`s. Per
`docs/source-of-truth-and-environments.md` §4 the live DUNEDIN catalogue is
read-only from automation; nothing here modifies `StockItems` or `PLUs`.

## The question

The venue's POS catalogue contains apparent duplicate products: the same dish
listed once as a normal item and again under department 41 ("takeaway"). We
needed to know whether that was a handful of one-off mistakes or a systematic
pattern, because the answer determined whether Verdura's menu import needed a
classification step or just a de-duplication pass.

## The answer

It is systematic. `04-dept41-rule.sql` generalises the pattern into a rule —
a self-join matching descriptions normalised for case, spaces and apostrophes,
deliberately **excluding** the hand-picked candidates so the rule is tested
against items it was not derived from. That result is why the schema now
classifies POS candidates by confidence tier rather than silently merging
them, and why `PosProductIdentity` carries an `evidence` JSONB column.

The tiers it produced: `high_confidence_active`, `likely_active`,
`ambiguous`, `takeaway_duplicate`, `operational_non_menu`, `inactive`.

## Reading order

Two sittings on 2026-08-28. The first tested a hand-picked hypothesis; the
second generalised it. Files are renumbered into reading order; original
filenames are recorded so the audit trail stays intact.

| File | Was | Time | What it establishes |
| --- | --- | --- | --- |
| `01-exact-duplicates.sql` | `exact-dup-check.sql` | 14:37 | 11 exact-description lookups — confirms the duplicates are byte-identical, not merely similar |
| `02-twin-check.sql` | `twin-check.sql` | 14:37 | Chicken Ballista, department names for codes 1–41, and the count of active dept-41 items |
| `03-twin-variants-spelling.sql` | `twin-check2.sql` | 14:38 | Apostrophe and spelling variants (`ZAATAR` vs `ZA'ATAR`, `FALAFEL SALAD` vs `FALAFEL SALAD/ PLATE`) — shows exact matching alone is insufficient |
| `04-dept41-rule.sql` | `dept41-rule-check.sql` | 16:08 | **The generalised rule.** Normalised self-join, excluding the candidate batch |
| `05-batch-verification.sql` | `batch2-fresh-check.sql` | 16:09 | Superset re-check: three code batches plus seven near-duplicate `LIKE` searches |
| `stockitems-export-20260826.txt` | — | 26 Aug | The 829-line `StockItems` catalogue dump the investigation ran against |

## `intermediates/`

Kept as history, not maintained. Preserved rather than deleted because the
sequence shows how the search was widened, and one of them is not redundant:

- `batch2-fresh-check2.sql` — batches 2–3 re-run with codes quoted as strings
  (`'710'` rather than `710`). The retry itself is the finding:
  **`StockItems.Code` is a character column, not numeric.**
- `near-dup2.sql` — `%AVOCADO%`, `%PIDE%`
- `near-dup3.sql` — `%HALLOUMI%`, `%PESTO%`. **Not a strict subset** of
  `05-batch-verification.sql`, which searches the narrower `%HALLOUMI%LOAF%`.
- `near-dup4.sql` — `%SPICY%`, `%MOUSSAKA%`, `%ANGUS%`/`%BEEF BURGER%`

There is no `near-dup1.sql`; the numbering starts at 2. Either the first
iteration was renamed (`01-exact-duplicates.sql` is the likely candidate) or
it was discarded before this set was collected.

Recovered 2026-09-02 from the `Documents` root, where all nine files had been
left loose after the investigation.
