# Verdura Idealpos Discovery Tracer (Story 9-2)

A minimal, modern .NET tracer proving the safest viable mechanism for a future Verdura Connector to observe (never mutate order/payment state in) a real Idealpos installation, where no supported public API is currently confirmed available. See `_bmad-output/implementation-artifacts/9-2-idealpos-uibridge-tracer.md` for the full story.

**This repository was authored on a machine with no Windows OS and no Idealpos installation available.** The projects below are split so that everything provable without live access is real, executable, verified evidence — and everything that genuinely requires a Windows machine is clearly isolated, unbuilt, and honestly labelled as such.

## Solution layout

| Project | Target | Builds/runs in this environment? | Purpose |
| --- | --- | --- | --- |
| `src/VerduraIdealposTracer.Core` | `net8.0` (cross-platform) | ✅ Yes | Discovery state machine, Story 2-10 command-protocol client, durable local persistence. No Windows-only API references. |
| `src/VerduraIdealposTracer.Fixtures` | `net8.0` | ✅ Yes | A clearly-labelled fake `IIdealposUiAutomationClient` — never real evidence. |
| `src/VerduraIdealposTracer.DryRunCli` | `net8.0` | ✅ Yes | Cross-platform dry-run entry point (uses the fake client). Doubles as this story's own crash/replay test subject. |
| `tests/VerduraIdealposTracer.Tests` | `net8.0` | ✅ Yes — real, run in this session | 22 unit tests + 4 real-process crash/replay tests, all against the fake client. `UNIT_OR_MOCK` evidence only. |
| `src/VerduraIdealposTracer.Windows` | `net8.0-windows` | ❌ No — requires the Windows Desktop SDK | The real `System.Windows.Automation` implementation. **Unverified.** |
| `src/VerduraIdealposTracer.Cli` | `net8.0-windows` | ❌ No | The real operator-facing entry point, wiring `Windows` + `Core` together. **Unverified.** |

`VerduraIdealposTracer.slnx` intentionally includes only the four cross-platform projects, so `dotnet build`/`dotnet test` at the solution root gives a clean, honest, fully-passing signal for what this session could actually verify. The two Windows-only projects are real source files on disk, reviewed and documented, but were never compiled — see each project's own `.csproj` doc comment for the exact, reproducible build error observed when attempting to build them on macOS.

## For the operator

Read `docs/operator-runbook.md` before doing anything on a real Windows machine. Read `docs/evidence-capture-template.md` for what to send back.

## Quickstart (this environment — dry run only)

```
cd apps/venue-connector
dotnet build
dotnet test
```
