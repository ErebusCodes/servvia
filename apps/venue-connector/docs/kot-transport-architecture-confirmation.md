# KOT transport ownership — confirmed against DL-067, not re-decided here

**Status: confirmed architecture, transport implementation remains BLOCKED pending real discovery.**

## What was checked

Before touching (or declining to touch) `IKotPrintTransport`/`PrintKotCommandHandler.cs`, this reconciliation re-read `docs/decisions-log.md` DL-067 (`idealpos-kot-suppression-decision`) and `docs/target-operating-model.md`, per this branch's own working rule that a product-boundary question must be answered from the documented decision record, not invented from what a dirty working tree happened to contain.

## Finding

**DL-067 already answers the ownership question:** "Verdura remains the intended owner of KDS/KOT for Verdura-originated orders... under the API-less adapter as well." The default, no-further-approval-needed architecture is **(a) Verdura owns both KDS and KOT, with Idealpos's own kitchen printing disabled** — not the alternative (Idealpos owns physical KOT) this reconciliation's own planning had initially hedged toward before checking the record.

This confirms that keeping `apps/venue-connector/src/VerduraIdealposTracer.Core/Printing/` (`IKotPrintTransport`, `PrintKotCommandHandler.cs`, the cloud-side `printer-dispatcher.service.ts` KOT-dispatch producer) in this integration branch is the *correct* architecture, not scope creep — Verdura is supposed to own this leg.

## What remains genuinely blocked (not a code gap)

DL-067 itself is explicit that two things are still open, and neither is resolvable by writing more code:

1. **Whether Idealpos's own kitchen printing can actually be suppressed for API-less-originated orders** — an unresolved live-discovery item (`docs/integrations/idealpos.md` §18, discovery checklist §F). Until this is proven, there is a real risk of **both** systems printing the same ticket — DL-067's own text: "No production pilot may allow both systems to print the same KOT."
2. **A real physical print transport.** `IKotPrintTransport` today has exactly one implementation, `SimulatedKotPrintTransport`, which never claims a printed outcome by default. No real transport (network/USB/Windows-share) has been implemented, and none is added by this reconciliation — implementing one without a verified printer make/model and protocol would be exactly the kind of guessed, unverified network surface this branch's working rules prohibit. A Brother MFC-L2713DW was observed during the 2026-08-21 read-only Windows discovery session, but per that session's own scope this is **not confirmed** to be the kitchen printer this handler should target — do not assume it is.

## What would unblock this

Both gaps require the same kind of evidence: a real, authorized Windows/Idealpos discovery session (the same one DL-064/Table 19 already gates on) that (1) determines whether Idealpos kitchen printing can be disabled per-order or per-adapter, and (2) identifies the real kitchen printer's make/model/connection method so a real `IKotPrintTransport` implementation can be written against a confirmed protocol instead of a guess. Neither step is software work Verdura can complete unilaterally from this repository.
