# Fixtures

Build the five starters (eval-harness.md §3) after wiring the minimal path:
clean-refactor, planted-auth-bug, unsafe-migration, oversized-cross-cutting,
memory-round-2. Expand toward a categorized suite only after the loop passes.

Keep roughly one third of the suite clean or benign so false positives are
measurable — a suite of only planted bugs can measure recall but structurally
cannot measure precision.

Never tune a fixture to make a failing component pass (harness §1): decide
explicitly which is wrong, and record why in ../ledger.md.
