# Review Validator — Adversarial Validation Protocol v1.0

Runs exactly once per review, after merge (after core's sole pass on PATH-1),
before output assembly. Its job is to disprove findings. It succeeds when
wrong findings die and right findings survive with correct severity.

## 1. Independence rule

The validator runs with fresh context. It receives findings as schema objects
ONLY — never the reviewing modules' reasoning, notes, or conversation. It
re-derives its judgment from the repository, the diff, and the memory slice.
A validator that inherits the reviewer's framing rubber-stamps it; the value
of this pass is a second framing.

Inputs: merged finding set, PR diff, repository tree access, memory slice
items 1–4 (sole consumer of FP priors, per memory §5), previous review
threads if available.

## 2. Procedure (per finding, in order; first failure decides)

1. CITATION — Locate `files[].path:lines`; verify `snippet` appears verbatim
   in post-change code. If the snippet exists nearby but lines drifted:
   correct the line numbers mechanically (the only edit power). If the
   snippet does not exist: REMOVE (reason: disproven).
2. REACHABILITY — For CRITICAL/HIGH: walk the `failure_scenario` step by
   step against visible code. Any step impossible as written → DEMOTE to
   Question. Missing scenario on CRITICAL/HIGH → DEMOTE (core §6 coupling).
3. COUNTER-EVIDENCE — Search for what the reviewer missed:
   a. Intentionality: PR description, code comments, tests asserting the
      flagged behavior.
   b. Existing handling: middleware, decorators, base classes, callers,
      config that already addresses it.
   c. Convention: the repository does this deliberately everywhere
      (requires ≥3 current citations — remembered conventions must be
      re-verified per memory §1).
   Found → REMOVE (reason: intentional or already-handled, with the citation).
4. FP PRIOR — Match against memory FP candidates (memory §5 rule): count ≥ 2
   in same category → DEMOTE to Question unless this finding's evidence
   differs from the recorded removal_reason. Priors lower, never raise.
5. CALIBRATION — Audit severity and confidence against core §6. Adjust
   downward only. A finding whose evidence is fully visible keeps HIGH
   confidence; one resting on a stated inference caps at MEDIUM.

After all findings are processed, apply output caps (orchestrator STEP 6).
Caps come last so validation, not truncation, decides what survives.

## 3. Powers and prohibitions

MAY: remove; demote to Question; lower severity or confidence; correct line
numbers when the snippet relocates; reclassify a finding to Verification
Request when its evidence turns out to depend on something not in the inputs.

MAY NOT: add findings; raise severity or confidence; rewrite `issue`, `fix`,
or `failure_scenario` content; remove a finding without a classified reason.

## 4. Removal log (feeds memory via the orchestrator)

Every removal/demotion records: finding id, reason class, one-line evidence.

Reason classes: `disproven` | `intentional` | `already-handled` |
`unverifiable` (→ Verification Requests, not deletion) |
`duplicate` (merge miss) | `cap-overflow`.

Per memory §6: only `disproven` and `intentional` count as FP signal;
`cap-overflow` and `duplicate` never do.

## 5. Zealotry guard

If the validator removes or demotes more than half of the merged findings in
a single review, that fact is recorded in the eval ledger and stated in one
line of the review Summary. It means either the reviewers are hallucinating
or the validator is over-aggressive — both are system faults to investigate,
never silent normal operation.

---
Changelog: v1.0 — initial.
