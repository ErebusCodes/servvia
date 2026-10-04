---
title: 'Story 1.3: Venue Connector CI job made truthful (fix path)'
type: 'bugfix'
created: '2026-10-04'
status: 'ready-for-dev'
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

## Auto Run Result

Status: ready-for-dev
Blocking condition: waiting-for-objective-approval: draft _bmad-output/implementation-artifacts/objective-drafts/story-1-3-venue-connector-ci-job-made-truthful/v1.objective.json sha256 d7a67148d6a358d68d5a68a9882f1559e8635983657ee0db59ee795d0a991c63

Planning run without an objective_anchor: nothing was implemented or committed. The objective draft was validated with `loop.mjs validate`, which reported OBJECTIVE READY FOR FREEZE. Freezing it is the orchestrator's decision alone.
