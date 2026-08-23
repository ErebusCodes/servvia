# Story 9-2 — Evidence Capture Template

Copy this file, fill in every field, and return it alongside the raw JSON output described in `operator-runbook.md`'s "Evidence to return" section. Leave a field explicitly blank (do not delete it) if it does not apply — an omitted field is not the same as an answered one.

## Environment

- Windows version and architecture (Settings → System → About): ______
- Machine name / asset tag: ______
- Date and local time of this run: ______
- Idealpos version/build (Idealpos → Help → About — type it, do not screenshot the licence screen): ______
- Run performed by (name/role): ______
- Explicit approval for this run given by (name/role, and how — verbal/written): ______

## Run type

- [ ] Dry run (Step 1 — no real Idealpos, fake automation client)
- [ ] Real discovery run (Step 3 — real Idealpos, approved)

## Result

- Exit code: ______
- Full JSON output (paste below):

```json

```

## Post-run verification (real discovery run only)

- [ ] No new order/table transaction appeared in Idealpos that was not already there before the run.
- [ ] No kitchen ticket was printed (physical or on-screen).
- [ ] No payment/EFTPOS action occurred.
- [ ] Idealpos is in the same state (screen, open transactions) as before the run, aside from the harmless navigation the tool itself describes in its own JSON output.

If any of the above is unchecked, stop and describe exactly what changed:

______

## Anomalies / unexpected behaviour

Describe in your own words anything that looked wrong, even if the tool reported success. Attach a cropped screenshot of only the specific problem area if needed — never a full-desktop screenshot.

______

## Discovery matrix items this run answers

List which items from `docs/discovery/idealpos-live-discovery-checklist.md` this run provides direct observational evidence for (e.g. "A — Idealpos version/build", "G — accessibility/UI Automation support for the main window"). Do not mark an item `VERIFIED` in that checklist from this template alone — transfer the finding there separately, citing this evidence capture by date.
