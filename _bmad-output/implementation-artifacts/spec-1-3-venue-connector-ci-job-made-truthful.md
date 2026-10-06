---
title: 'Story 1.3: Venue Connector CI job made truthful (fix path)'
type: 'bugfix'
created: '2026-10-04'
status: 'done'
baseline_revision: '1b2000d794885f2f3e25bd141fa21c26f01f7b05'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Venue Connector .NET suite fails 3 of 502 tests on non-Windows hosts, so its CI job (ubuntu-latest) is red. All 3 are in `NativeTerminalBindingEvidenceTests`: the analyser reports a Windows executable path such as `C:\x\IPS.exe` as the owner's file name instead of `IPS.exe`, so the expected executable is never recognised and the report is wrong. The defect is in the analyser, not in the tests: the result depends on the host OS, while the inventories it analyses always come from Windows.

**Approach:** Fix the analyser so it derives an owner's executable file name from a Windows executable path the same way on every host. The 3 failing tests stay unchanged and pass. One new regression test protects the contradiction report's owner name on non-Windows hosts.

## Boundaries & Constraints

**Always:**
- The 3 failing tests pass unchanged: `WhenTheExpectedExecutableOwnsTheVb6Windows_TheEvidenceIsConsistent`, `NonVb6Windows_AreNotCountedAsNativeTerminalOwners`, `MultipleOwners_AreAllReported_MostWindowsFirst`.
- All 502 existing tests still run and pass.
- The analyser keeps its current results on Windows. It stays a pure report: it chooses no window and fills no selector.

**Never:**
- Retire the connector or its job. That path is BLOCKED until the external-POS cleanup checkpoint is approved.
- Skip, filter, weaken or edit an existing test, set `continue-on-error`, or add a lint or warning suppression.
- Change `.github/workflows/ci.yml` or any `.csproj`, `.slnx`, `Directory.Build.*`, `global.json`, NuGet or runsettings file. Nothing shows that the CI or the build is at fault.
- Touch the Windows-only projects (`VerduraIdealposTracer.Windows`, `VerduraIdealposTracer.Cli`), any other app, or any governance path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Backslash path, any host | owner path `C:\Program Files\Idealpos\IPS.exe`, expected `IPS.exe` | file name `IPS.exe`; expected executable present; verdict `CONSISTENT` | No error expected |
| Different owner, any host | owner path `C:\Idealpos Solutions\Idealpos 8\IPSClient.exe`, expected `IPS.exe` | file name `IPSClient.exe`; verdict `CONTRADICTION` naming `IPSClient.exe` | No error expected |
| Owner path unchanged | any owner | `ExecutablePath` stays the full path as given | No error expected |
| Bare file name | owner path `IPS.exe` | file name `IPS.exe` | No error expected |

</intent-contract>

## Code Map

- `apps/venue-connector/src/VerduraIdealposTracer.Core/Discovery/NativeTerminalBindingEvidence.cs` -- the defect. `FileNameOf` (lines 131-135) calls `Path.GetFileName`, which splits only on `/` outside Windows. Its result feeds `ExecutableFileName` (line 101), the comparison with the expected executable (line 112), ordering (line 108) and the verdict text (line 153). Leave `ExecutablePath` (line 100) as given.
- `apps/venue-connector/tests/VerduraIdealposTracer.Tests/NativeTerminalBindingEvidenceTests.cs` -- the 3 failing tests (assertions at lines 52, 126 and 142). Read-only. The contradiction test (lines 60-78) passes on non-Windows hosts only by substring luck: the full path contains `IPSClient.exe`.
- `apps/venue-connector/src/VerduraIdealposTracer.Windows/WindowsUiAutomationClient.cs:341` -- the only production caller (Windows-only). Read-only.
- `.github/workflows/ci.yml:333-352` -- the `venue-connector` job: build the `.slnx`, then test the test project. Read-only. The `venue-connector-windows` job only builds; it runs no tests.
- Evidence. TEST-PROVEN on 2026-10-04 (macOS, SDK 10.0.302, net8.0 runtime, a `git archive` export of `00e64ad`): `dotnet test VerduraIdealposTracer.slnx -c Release` gave 3 failed, 499 passed, 0 skipped, 502 total, with the 3 tests named above. That these are the same 3 tests that fail in CI is an INFERENCE (same count, same non-Windows path handling); the CI log names were not re-read.

## Tasks & Acceptance

**Execution:**
- `apps/venue-connector/src/VerduraIdealposTracer.Core/Discovery/NativeTerminalBindingEvidence.cs` -- derive the owner's file name from a Windows executable path the same way on every host -- this fixes the 3 failing tests without changing them.
- `apps/venue-connector/tests/VerduraIdealposTracer.Tests/NativeTerminalBindingEvidencePortabilityTests.cs` (new) -- add one xUnit fact, `WhenADifferentExecutableOwnsTheNativeUi_TheOwnerIsNamedByItsFileNameOnEveryHost`. Owner path `C:\Idealpos Solutions\Idealpos 8\IPSClient.exe` (2 windows), expected `IPS.exe`. Assert the single candidate's `ExecutableFileName` is `IPSClient.exe` and its `ExecutablePath` is the full path -- this closes the gap the existing contradiction test leaves on non-Windows hosts.

**Acceptance Criteria:**
- Given the connector solution on a non-Windows host, when its test suite runs, then all tests pass with none skipped: at least the 502 existing tests, plus the new regression test.
- Given the 3 named tests, when they run against the code before the fix on a non-Windows host, then they fail. When they run against the fixed code, then they pass, with their source unchanged.
- Given the fixed code, when the CI definition, the project and solution files and the existing test files are compared with the baseline, then they are unchanged.

## Design Notes

Windows treats both `\` and `/` as path separators. The analyser should produce the result Windows would produce, whatever the host. On Windows this is the current behaviour, so Windows results do not change.

## Verification

**Commands:** (run in a `git archive` export outside the clone, with `DOTNET_CLI_HOME` and `NUGET_PACKAGES` scratch directories, from `apps/venue-connector`)
- `dotnet test VerduraIdealposTracer.slnx -c Release --disable-build-servers` -- expected: 0 failed, 0 skipped, at least 503 passed.

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 17 findings — high 0, medium 0, low 6, false 11, maybe-false 0
- findings:
  - `[false]` `[reject]` (blind-hunter) A null `ExecutablePath` now crashes `FileNameOf` — `Summarize` filters `string.IsNullOrWhiteSpace(w.ExecutablePath)` before `FileNameOf` is called, and the unchanged test `Vb6WindowsWhoseExecutableCannotBeRead_AreReportedAsInconclusive_NotAsAbsent` passes a null path and passes.
  - `[false]` `[reject]` (blind-hunter) A path ending in a separator, or a bare drive `C:`, yields an empty file name — this is exactly what Windows `Path.GetFileName` returns for those inputs, so it is the intended Windows-equivalent result; an executable path from a process never ends in a separator.
  - `[low]` `[reject]` (blind-hunter) Forward-slash, mixed, drive-relative, UNC and device-path forms are untested, so the `rootLength` branch could be deleted unnoticed — process executable paths are full drive or UNC paths, which split correctly on the last separator; drive-relative paths do not occur in inventories, and the fix is extra tests beyond the frozen matrix.
  - `[false]` `[reject]` (blind-hunter) Executable name case could flip the verdict — the expected-executable comparison is `StringComparison.OrdinalIgnoreCase` (NativeTerminalBindingEvidence.cs line 112), unchanged by this story.
  - `[low]` `[reject]` (blind-hunter) The portability test helper hard-codes `ProcessName = "IPSClient"`, including for the bare `IPS.exe` window — the analyser never reads `ProcessName`, so no assertion depends on it; the fix adds a helper parameter for cosmetic data consistency.
  - `[false]` `[reject]` (blind-hunter) No CI workflow change, so the job is not made truthful — the intent forbids CI changes; the job is red because 3 tests fail, and the analyser fix makes them pass, which is the truthful-green path the intent prescribes.
  - `[false]` `[reject]` (blind-hunter) The "on every host" claim is never checked on Windows — for executable paths the new split equals Windows `GetFileName` (slice after max(last `\`/`/` + 1, root length); a UNC root always ends in a separator before a file name), so Windows results do not change; the only divergence, a bare `\\server\share` with no file, cannot be an executable path.
  - `[false]` `[reject]` (blind-hunter) `char.IsAsciiLetter` and dropping the `ArgumentException` fallback need a stated .NET target; static field placement — Core and Tests target `net8.0` (csproj line 14 / line 4), where both are safe; the field placement names no harm.
  - `[false]` `[reject]` (edge-case-hunter) Trailing whitespace or separator gives `IPS.exe ` or empty and a false CONTRADICTION — Windows `GetFileName` returns the same values, so this is pre-existing Windows behaviour; trimming would change Windows results, which the intent forbids.
  - `[low]` `[reject]` (edge-case-hunter) Two `[Fact]`s were added where Tasks name one — the second fact covers matrix row "Bare file name", which step-03's Matrix Test Audit requires to be covered; removing it fails that audit, and the only other fix is editing this build's spec.
  - `[low]` `[reject]` (verification-gap, other) `## Auto Run Result` still showed the planning run's `ready-for-dev` text — the fix is an edit of this build's spec; Finalize rewrites that section.
  - `[low]` `[patch]` (intent-alignment) The contradiction verdict text was not asserted to name the owner by its bare file name (the existing `Contains("IPSClient.exe")` is satisfied by the full path) — patched: the portability test now asserts the verdict contains `IPSClient.exe (2 window(s)` and does not contain the full owner path.
  - `[false]` `[reject]` (intent-alignment) "Windows results unchanged" is argued, not shown — same as the blind-hunter cross-host row: equivalence holds for every executable path.
  - `[false]` `[reject]` (intent-alignment) The tests are host-agnostic rather than non-Windows-specific — they fail on the non-Windows baseline (the new fact failed with the 3 originals before the fix) and pass after, which is the protection the intent asks for.
  - `[low]` `[reject]` (intent-alignment) Test count is two new facts, not one — same root cause and reasoning as the edge-case-hunter row.
  - `[false]` `[reject]` (intent-alignment) The diff edits a `_bmad-output` spec file — the workflow requires the status and baseline frontmatter, and an objective's own story spec is an allowed surface; it is not a governance path.
  - `[false]` `[reject]` (intent-alignment) Matrix rows 1 and 3 are not shown to pass — the orchestrator's full run shows all 14 NativeTerminalBindingEvidence tests passed, including `WhenTheExpectedExecutableOwnsTheVb6Windows_TheEvidenceIsConsistent` and both portability facts.

## Auto Run Result

Status: done (CANDIDATE PRODUCED; technical completion is the evaluator's decision only)

Earlier planning run: halted at ready-for-dev waiting for objective approval; the objective was frozen at anchor 1b2000d794885f2f3e25bd141fa21c26f01f7b05 (sha256 d7a67148d6a358d68d5a68a9882f1559e8635983657ee0db59ee795d0a991c63).

**Summary.** `FileNameOf` in the native-terminal binding analyser no longer uses the host's `Path.GetFileName`. It derives the file name from a Windows executable path the way Windows does on every host: it splits on both `\` and `/`, and treats a drive prefix as part of the root. `ExecutablePath` is unchanged. The 3 baseline-failing tests pass unchanged.

**Files changed**
- `apps/venue-connector/src/VerduraIdealposTracer.Core/Discovery/NativeTerminalBindingEvidence.cs`: host-independent Windows file-name derivation.
- `apps/venue-connector/tests/VerduraIdealposTracer.Tests/NativeTerminalBindingEvidencePortabilityTests.cs` (new):
  - `WhenADifferentExecutableOwnsTheNativeUi_TheOwnerIsNamedByItsFileNameOnEveryHost` (the regression test);
  - `WhenTheOwnerPathIsABareFileName_TheFileNameIsThePathItself` (covers the matrix's bare-file-name row).
- This spec: status, baseline, triage log, result.

**Review findings:** 17 findings.
- 1 patch applied (low): the regression test now asserts that the verdict names the owner by its bare file name.
- 0 deferred.
- 16 rejected; each reason is recorded in the Review Triage Log.

**Follow-up review recommended:** false. Patched entries by verdict: high 0, medium 0, low 1.

**Verification.** Command: `dotnet test VerduraIdealposTracer.slnx -c Release --disable-build-servers` (macOS, net8.0, run on a working-tree copy under the scratchpad).
- Baseline as given (implementer's run): 3 failed, 499 passed, 0 skipped, 502 total. The 3 failures are the named tests.
- Baseline plus the new regression test: 4 failed.
- Candidate: 0 failed, 504 passed, 0 skipped, 504 total. All 14 NativeTerminalBindingEvidence tests passed.

The matrix audit covered all 4 rows, with tests that ran and passed.

**Residual risks**
- Not run on Windows or in GitHub CI. Windows equivalence is reasoned from how Windows splits paths.
- That CI shows the same 3 failures is still an inference.
