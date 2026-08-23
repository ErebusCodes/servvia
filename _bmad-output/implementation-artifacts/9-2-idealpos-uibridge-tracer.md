---
baseline_commit: HEAD@2026-08-16 (continues stories 2-9/2-10's connector work in the same overall session)
epic: E9
blocked_on: "REAL_WINDOWS_CONNECTOR + REAL_IDEALPOS_UI_DISCOVERY evidence — a real Windows machine with Idealpos installed, made available to an authorised operator, per docs/discovery/idealpos-live-discovery-checklist.md"
tracer_bullet: true
production_story: false
supersedes: this story's own 2026-08-16 (a) planning-session version — see "Scope correction" below
---

# Story 9.2: Idealpos UI-Bridge Tracer / Live Idealpos Discovery

Status: blocked

## Story

As the platform and venue operator needing the safest viable mechanism to submit an order to the perpetually-licensed, locally-installed Idealpos system where no supported public API is currently confirmed available,
I want real Windows and real Idealpos evidence — not a demo/clone assumption — establishing which integration route is safe and viable, and a minimal .NET tracer proving that route's discovery phase end-to-end,
so that the real `idealpos.order.submit.v1` command story can be scoped from real evidence rather than assumption, and so Epic 15's E15-S5/S6/S7 have a proven discovery foundation to build on.

## Scope correction (2026-08-16, this session) — read before the rest of this file

This story's original 2026-08-16 (a) version scoped a full order-entry tracer bullet against a **demo/cloned Idealpos environment**, gated on seven blocking conditions that were never satisfied (no demo/clone environment was ever confirmed available). This session's governing brief reframes the story around the **real production-path Idealpos installation** directly, discovery-first, with an explicit legal/safety boundary on permitted discovery techniques (operator-visible interfaces only — no reverse engineering, no undocumented DLL/COM calls, no database access, no EFTPOS/payment automation) and an explicit "if the Windows machine is unavailable" contingency. That contingency applies: **this session had no live Windows machine or Idealpos installation available** (confirmed: this repository was developed on macOS, `uname -a` → Darwin). This version replaces the demo-clone framing entirely — not layered on top of it — per this session's explicit brief.

The original story's full order-entry frozen intent (search → select table → enter item → save → retrieve reference, with replay/crash/concurrency proofs) is **preserved as the target for a later, real-order-entry-capable version of this story or a follow-on**, not discarded — see "Original frozen intent (deferred, not abandoned)" below. This session narrows scope to what is achievable and safe without live access: static evidence expansion, integration-route selection from that evidence, and a real, tested (where testable) discovery-only tracer.

## Dependencies — verified this session, not assumed

- Story `2-9` (Enterprise Venue Connector Identity) — **done**. Verified: `backend/src/connector/connector.service.ts` and its real-Postgres integration suite exist and pass.
- Story `2-10` (Connector Command & Acceptance Protocol) — **done**. Verified: `backend/src/connector/connector-command.service.ts` and its real-Postgres + `DURABLE_CONNECTOR_HARNESS` suites exist and pass. This story's own tracer reuses Story 2-10's `connector.self_test.v1` command as its cloud-mode delivery vehicle (see Tracer Architecture) rather than inventing a new backend command type — that remains a later story's scope (`idealpos.order.submit.v1`).
- Story `9-1` (truthful POS-sync states) — done, unaffected by this story.
- Story `9-3` (POS-sync outbox dispatch) — done, unaffected by this story (cloud-internal only, no connector dependency).
- `docs/discovery/idealpos-live-discovery-checklist.md` — expanded this session with new items (see below); still requires live-environment answers for its gating items.
- DL-064 (Idealpos vendor discovery) — still `BLOCKED`, unaffected by this session's static-evidence work.

## Legal and safety boundary (governs every action in this story)

Permitted discovery techniques: Idealpos configuration screens, installed documentation, Windows Services/Event Viewer, documented command-line options, normal file metadata, Windows UI Automation/accessibility interfaces, normal printer queues, network endpoints the installed software itself exposes/documents, vendor-provided ecommerce/online-ordering/Doshii/integration modules that are visibly installed or licensed, and vendor confirmation.

Prohibited absolutely: reverse-engineering/decompiling Idealpos binaries, bypassing licensing/security controls, invoking undocumented DLL/COM interfaces as if supported, writing directly to the Idealpos database, modifying Idealpos data files, intercepting cardholder data, automating EFTPOS PIN entry, reading/storing sensitive payment data, claiming vendor support without written evidence, and performing any sale/payment/refund/void/kitchen print in production without explicit operator approval and a controlled test plan.

This session's own static-evidence work (see Discovery Matrix) complied throughout: no execution, no decompilation, no database/credential/secret access — file listings, `file`(1) PE-header identification, narrow `strings`(1) pattern scans (method/type-name-shaped tokens and plain-text config/txt files only, never a full binary dump), and reading plain-text licence/config files. Identical method and boundary to the prior session's own `idealpos.md` §12 evidence.

## Discovery Matrix

Full detail lives in `docs/discovery/idealpos-live-discovery-checklist.md` (expanded this session — see its own change history) and `docs/integrations/idealpos.md` §12 (expanded this session with new static findings — see §12.4). Summary by state:

| State | Count (of the live-discovery checklist's ~35 items) | Notes |
| --- | --- | --- |
| `VERIFIED` | 0 | Nothing in this story can be `VERIFIED` without live Windows/Idealpos access — none was available this session. |
| `OBSERVED_NOT_PROVEN` | ~14 | New static findings this session (see §12.4) — real, but capability evidence only, never proof of live configuration. |
| `NOT_AVAILABLE` | 0 | — |
| `BLOCKED_REQUIRES_VENDOR` | ~6 | Licence/module entitlement, commercial terms, vendor position on UI automation (checklist §A, §I). |
| `BLOCKED_REQUIRES_LIVE_WINDOWS` | ~15 | Everything requiring a running Idealpos instance — table/order entry workflow, EFTPOS topology, modal-dialog behaviour, Automation ID stability, etc. |
| `NOT_APPLICABLE` | 0 | — |

### New static findings this session (2026-08-16), safety-compliant per the boundary above — full detail in `idealpos.md` §12.4

1. **`FrameworkVersion.txt` = `6.05.0001`** (plain-text file in the installation copy's `Idealpos/` directory) — the strongest version-shaped evidence found to date. `OBSERVED_NOT_PROVEN`: this is the installer copy's own recorded version, not confirmed as the version running at the real Dunedin venue.
2. **Three distinct service-shaped executables confirmed**, not just the two the prior session recorded: `IPS.exe` (main POS), `IdealposService.exe` (online/ecommerce — already known), and `IdealposUpgradeService.exe` (a separate upgrade/update service), each paired with its own `*.Update.exe` companion. `OBSERVED_NOT_PROVEN` — actual Windows service registration (names, startup type) at any real venue is unconfirmed; checklist item A still requires live confirmation.
3. **`IdealposService.exe.config` declares an Entity Framework `LocalDbConnectionFactory` targeting `mssqllocaldb`** for the online/ecommerce service component — nuances (does not contradict) the prior session's Access-file finding, which was about the main POS client's own data files, a different component. `OBSERVED_NOT_PROVEN`.
4. **New capability evidence: `IdealPos.Licensing.Service2.ClientApi.dll`** confirms a distinct licensing-service client component exists, and a narrow `strings` scan of `IdealPos.Licensing.Service2.ClientApi.dll` found the plain, non-secret WCF/SOAP namespace string `http://www.idealpos.com.au/LicensingManager/2015/01/IShopOwnerManagement/...` — confirms `idealpos.com.au` as the vendor's real domain and an `IShopOwnerManagement` SOAP contract exists in this capability surface. `OBSERVED_NOT_PROVEN` — no live network reachability, licensing state, or entitlement is confirmed by a namespace string alone.
5. **New capability evidence, not in the prior session's findings: `ResDiary.EposServiceConsumer.Helpers.dll` / `RD.EposServiceConsumer.Helpers.dll`** — Idealpos ships pre-built integration helper components for ResDiary's EPOS consumer API (a reservations/booking platform, part of Access Group). This is a **third** named vendor-integration surface (alongside the already-known Doshii and Webit/WebIt findings) worth including in any future vendor conversation (checklist item I) about supported integration mechanisms — Verdura does not use ResDiary today, but its presence is evidence that Idealpos's vendor-integration surface is broader than previously catalogued. `OBSERVED_NOT_PROVEN` — capability evidence only, no relevance to Verdura confirmed or claimed.
6. **New capability evidence: `IdealPos.Webit.Core.dll`'s embedded PDB debug paths** (`...\WebIt\Core\obj\Release\IdealPos.Webit.Core.pdb`, both a `vsts` and a `Projects` path variant) confirm Idealpos's web-ordering integration product is internally named **"WebIt"** (built via Azure DevOps, formerly VSTS) and exposes a `GetWebitIpsInfo`/`IdealPos_Webit_Manager`-shaped management surface distinct from the already-known Doshii finding. `OBSERVED_NOT_PROVEN` — confirms a product exists in this installer copy, not that it is licensed, configured, or reachable for any real venue.

None of these findings change §12.2's standing conclusion: **no confirmed, licensed, vendor-supported, documented integration contract exists for this or any real venue** — they broaden the catalogue of *what to ask the vendor/reseller about* (checklist item I), not the confirmed-available set.

## Selected Integration Route (from available evidence) and Rejected Alternatives

Evaluated in the mandated priority order:

1. **A vendor-supported installed ecommerce/online-ordering/integration mechanism** — **not selectable.** Three real, distinct candidate surfaces now exist in the static evidence (Doshii via `ProcessDoshiiService`; the "WebIt" web-ordering product; the Ecommerce/Online service architecture itself), plus a licensing-service SOAP contract. None has confirmed licence entitlement, commercial availability, or a documented contract for any real venue — `idealpos.md` §13.1's standing requirement ("all of the following confirmed in writing") remains unmet. This route stays preferred once available; it is not available now.
2. **A vendor-supported file/import or local service mechanism** — **not selectable**, same reason (no confirmed, documented, licensed mechanism).
3. **A vendor-approved UI automation mechanism** — **not selectable**: no written vendor/reseller position on UI-automation-based order entry has been obtained (checklist item I remains `BLOCKED_REQUIRES_VENDOR` — no live discovery session occurred this session to even ask).
4. **A carefully bounded Windows UI Automation bridge as an interim route** — **selected, discovery-phase only.** This is the same API-less interim adapter architecture `idealpos.md` §13.2/§14 already specifies (Verdura Connector + interactive Idealpos POS Bridge, `System.Windows.Automation`-first, never database writes or undocumented DLL/COM calls). This session implements and proves only its **discovery** phase (process detection, UI-profile matching, safe-state checking, one harmless reversible navigation) — never order entry, per the legal/safety boundary and the "no live Windows machine" contingency.

**Rejected outright, not merely deprioritised:** undocumented database writes, binary injection/decompilation, screen-coordinate-only clicking, and any undocumented DLL/COM invocation — consistent with `idealpos.md` §14.2's existing, unchanged prohibitions.

## Tracer Architecture

A minimal, modern **.NET 8** solution at `windows-connector/` (repository root — see its own `README.md`), split so every part provable without live Windows/Idealpos access is real, executable, and verified in this session, and every part that genuinely requires live access is clearly isolated and honestly marked unverified:

- **`VerduraIdealposTracer.Core`** (`net8.0`, cross-platform): the discovery state machine (`DiscoveryTracerService`), independent per-dimension result model (`DiscoveryTraceResult` — see Required State/Result Separation below), the Story 2-10 command-protocol client (poll/accept/report, reusing the exact `Authorization: Bearer {installationId}.{secret}` credential Story 2-9 issues), and durable local persistence (`DurableLocalLog` — an fsync'd append-only NDJSON log, the same design as Story 2-10's own proof harness).
- **`VerduraIdealposTracer.Fixtures`** (`net8.0`): a clearly-labelled fake `IIdealposUiAutomationClient` covering every required failure scenario (Idealpos not running, wrong profile, insufficient permissions, session locked, modal dialog, busy, control-not-found, control-ambiguous, UI-changed-before-action, timeout, unexpected error, unverifiable completion, operator cancellation).
- **`VerduraIdealposTracer.DryRunCli`** (`net8.0`, cross-platform): the operator's pre-flight dry-run entry point, and this story's own crash/replay test subject (see Evidence).
- **`VerduraIdealposTracer.Windows`** (`net8.0-windows`): the real `System.Windows.Automation` implementation. **Written, not built or run this session** — no Windows Desktop SDK available on this machine; the exact, reproducible build error is recorded in the project's own `.csproj` and in this story's Dev Agent Record.
- **`VerduraIdealposTracer.Cli`** (`net8.0-windows`): the real operator-facing entry point wiring `Windows` + `Core` together, supporting both a fully local/isolated mode (per the mission's "clearly isolated local tracer mode where cloud credentials are intentionally out of scope") and a cloud mode authenticating as a real Story 2-9 connector identity.

### Why this reuses Story 2-10's `connector.self_test.v1` rather than a new command type

Story 2-10 explicitly scoped its command envelope/state machine to be reusable by a future real command type without protocol changes, and explicitly deferred defining that real type. Inventing `idealpos.order.submit.v1` in this discovery-only story would both violate this story's own scope (discovery, not order submission) and pre-empt the real command-contract design this story's own evidence is supposed to inform. The tracer's cloud mode therefore claims/accepts/reports the existing synthetic self-test command, with its `resultPayload` carrying this story's discovery findings (`resultType: "IDEALPOS_UI_DISCOVERY_V1"`) instead of the self-test's normal echo-hash payload — a legitimate reuse of an already-proven, already-idempotent protocol, not a new backend change.

### Required state and result separation

`DiscoveryTraceResult` (in Core) carries every dimension the governing brief requires as an independent field — connector command delivery, connector durable acceptance, Idealpos process detected, Idealpos UI profile matched, Idealpos interaction attempted, Idealpos order accepted, Idealpos transaction reference, EFTPOS initiated, EFTPOS result, KDS accepted, KOT result — each defaulting to `NotAttempted` and populated independently. A structural backstop (`AssertDiscoveryOnlyInvariant()`, called by every code path that produces a final result and asserted in tests) throws if any out-of-scope dimension (order/EFTPOS/KDS/KOT) is ever populated — this story's own scope is enforced in code, not only in prose.

## Original frozen intent (deferred, not abandoned)

The prior version's full order-entry proof (search-before-create, one mapped item/table, replay/crash/concurrency against a real or demo Idealpos, retrieving an authoritative transaction reference) remains the target for whichever later story defines and proves `idealpos.order.submit.v1` — it is not achievable or attempted in this discovery-only session and must not be claimed as done. `idealpos.md` §16's idempotency/crash-window/uncertain-outcome rules remain the normative contract that future story must satisfy; this story's own crash-window handling (see Evidence) is a compatible, smaller-scope precedent for it, not a substitute.

## Acceptance Criteria (this session's actual, discovery-only scope)

1. The discovery matrix (checklist + `idealpos.md` §12) is expanded with genuinely new static findings, safety-boundary-compliant, distinguishing observed fact from inference throughout.
2. An integration route is selected using the mandated priority order and real evidence, with rejected alternatives and their reasons recorded.
3. A minimal .NET tracer exists, split so its platform-agnostic parts (state machine, protocol client, persistence) are real, buildable, and testable without live Windows access.
4. The tracer authenticates as the real Story 2-9 connector identity in cloud mode, or runs in an explicitly isolated local mode with no cloud credential — both implemented.
5. The tracer never reports Idealpos order, EFTPOS, KDS, or KOT success under any circumstance — enforced structurally, not just documented, and proven by tests across every failure scenario.
6. Every required failure case achievable without live Windows access is implemented and tested: Idealpos not running, wrong version/profile, insufficient permissions, session locked, unexpected modal dialog, busy, control not found, control ambiguous, UI changed before action, action timeout, unexpected error, unverifiable completion, operator cancellation.
7. Persist-before-ack is proven via a real, separate OS process, unconditionally killed at each durability boundary, then safely resumed/inspected — the same rigor as Story 2-10's own harness.
8. No payment or printing success is fabricated anywhere in code, tests, or documentation.
9. Documentation and sprint status are truthful: nothing claims real Windows or real Idealpos evidence that was not actually obtained.
10. The evidence produced (architecture, state model, failure-case coverage, static findings) is sufficient to scope the real `idealpos.order.submit.v1` command story once live discovery closes the remaining gates.

## Definition of Done (this session)

Met when: the discovery matrix is genuinely expanded and honestly stated; the integration route is selected from real evidence with alternatives recorded; the cross-platform tracer parts build and pass real tests in this environment; every achievable-without-Windows failure case is proven; persist-before-ack is proven via a real process kill; the Windows-only parts exist as reviewed source with an honestly-recorded, reproducible build failure; independent review is complete with no unresolved P0/P1; and the story's status and blocking gate are stated exactly, not softened.

**Not met, and not claimed:** any real Windows or real Idealpos evidence. Story 9-2 stays `blocked` — see Blocking Gate below. This is a correct, expected, honestly-reported outcome for a session with no live Windows/Idealpos access, per the governing brief's own contingency plan — not a shortfall to be hidden.

## Blocking Gate

**`REAL_WINDOWS_CONNECTOR + REAL_IDEALPOS_UI_DISCOVERY evidence required`** — a real Windows machine with the target Idealpos installation (ideally the actual Dunedin venue installation, or a machine confirmed by the operator to be representative of it) must be made available to an authorised operator, who must:

1. Follow `windows-connector/docs/operator-runbook.md` exactly.
2. Build and run `VerduraIdealposTracer.Windows`/`VerduraIdealposTracer.Cli` for the first time, resolving whatever real build/runtime issues arise (unverified in this session — expect at least the `System.Windows.Automation`/UI Automation assembly references to need environment-specific resolution).
3. Complete the discovery profile (`windows-connector/docs/discovery-profile.sample.json`) with real, observed values.
4. Return evidence via `windows-connector/docs/evidence-capture-template.md`.
5. Answer the live-discovery checklist's remaining gating items (§A, §C, §E, §F, §G, §I) from direct observation.

Only after that evidence returns may this story be re-evaluated for `done`, and only for its own discovery-only scope — a real order-entry proof remains a separate, later story regardless.

## Dev Agent Record

### Implementation summary (2026-08-16)

- **Static evidence expansion**: `docs/integrations/idealpos.md` §12.4 (new), safety-boundary-compliant, using the identical method (`file`, narrow `strings` pattern scans, plain-text reads) as the prior session's §12.1–§12.3.
- **Discovery checklist**: `docs/discovery/idealpos-live-discovery-checklist.md` expanded with items from this session's governing brief not previously covered explicitly (duplicate-submission detection, operator cancellation/recovery, payment-secret-free automation confirmation) — see that file's own change history.
- **Transport/route decision**: `docs/decisions-log.md` DL-071 records the integration-route selection (§ above) as a formal decision, evaluated against the mandated priority order.
- **Tracer**: `windows-connector/` — see Tracer Architecture above and that directory's own `README.md`.

### Evidence

- `STATIC_ANALYSIS`: `dotnet build` on `windows-connector/VerduraIdealposTracer.slnx` (the four cross-platform projects) — clean, 0 warnings, 0 errors, verified from a clean `bin`/`obj` state.
- `UNIT_OR_MOCK`: `dotnet test` — **28/28 passing** (22 state-machine tests covering every required failure scenario achievable without live Windows access, using `VerduraIdealposTracer.Fixtures`'s fake automation client; 2 connector-protocol wire-contract tests, added during independent review; 4 real-process crash/replay tests — see `DURABLE_CONNECTOR_HARNESS` below). Re-run repeatedly across this session, zero flakiness.
- `REAL_POSTGRES`: not separately applicable — this story adds no new backend/database code; it reuses Story 2-10's already-proven real-Postgres command protocol as-is, unmodified.
- `DURABLE_CONNECTOR_HARNESS`: `CrashReplayTests.cs` spawns `VerduraIdealposTracer.DryRunCli` as a genuinely separate OS process and forces an unconditional `Environment.FailFast` crash at each persist-before-ack boundary (`local_persist`, `terminal_persist`), then verifies the durable log survived and a subsequent independent run appends cleanly without corruption — the same rigor as Story 2-10's own TypeScript harness, ported to this story's .NET tracer. **This tier proves the platform-agnostic persistence/state-machine layer only** — it uses the fake automation client, not real Idealpos, and must not be read as `REAL_WINDOWS_CONNECTOR` or `REAL_IDEALPOS_UI_DISCOVERY` evidence.
- `REAL_WINDOWS_CONNECTOR`: **not attempted, not available this session.** `VerduraIdealposTracer.Windows`/`.Cli` (net8.0-windows) were written but not built — attempting `dotnet build` on `VerduraIdealposTracer.Windows.csproj` in this session produced the exact, reproducible error `CS0234: The type or namespace name 'Automation' does not exist in the namespace 'System.Windows'` (missing `UIAutomationClient`/`UIAutomationTypes` reference assemblies, part of the Windows Desktop SDK, unavailable on macOS) — recorded verbatim in the project's own `.csproj` doc comment.
- `REAL_IDEALPOS_UI_DISCOVERY`: **not attempted, not available this session.** No Idealpos process was ever run.
- `REAL_IDEALPOS_ORDER` / `REAL_EFTPOS` / `REAL_KDS` / `REAL_KOT_PRINTER`: **not attempted, not in scope for this story regardless of environment availability** — see Required State and Result Separation; the tracer's own structural invariant (`AssertDiscoveryOnlyInvariant`) prevents any of these from ever being populated by this story's code.

### Independent review

A fresh review pass (2026-08-16, same session) covered licence/safety boundaries, UI Automation stability, side-effect/duplicate-order risk, crash/replay behaviour, unknown-result handling, connector credential handling, sensitive-data exposure, Story 2-10 compatibility, future-Windows-service compatibility, documentation overclaims, and Epic 15 dependency accuracy. One correction loop was applied (of three permitted); no second loop was needed.

**Investigated as a suspected P1, confirmed NOT a bug (recorded for traceability, since the investigation itself is worth showing):** `ConnectorCommandProtocolClient`'s JSON handling was flagged as a suspected serialization-casing bug — plain `System.Text.Json` defaults to case-sensitive PascalCase matching, which would mismatch Story 2-10's real camelCase NestJS DTOs. **Verified empirically, not assumed**: reverted the explicit `JsonSerializerOptions` and re-ran `ConnectorCommandProtocolClientTests` — both tests still passed. `System.Net.Http.Json`'s `JsonContent.Create(T)`/`ReadFromJsonAsync<T>()` convenience methods default to `JsonSerializerDefaults.Web` (camelCase, case-insensitive) when no options are supplied, which this class already relied on implicitly. **No bug existed.** The explicit options block and its two regression tests were kept anyway — not as a fix, but so the wire contract is asserted rather than silently inherited from a library default a future refactor could lose. This is recorded in detail (rather than quietly reverted) because catching your own false-positive via actual test execution, not assumption, is exactly the discipline this whole session was built on.

**Found and fixed:**

1. **P2 — unhandled exceptions in both CLI entry points (`DryRunCli`, `Cli`) would crash without a clear, sanitized message.** An unexpected exception (e.g. a network failure mid-`AcceptAsync` in cloud mode) was only partially caught (`OperationCanceledException` only), risking an unclear stack-trace-only crash for an operator. **Fix**: added a broad `catch (Exception ex)` in both entry points that prints a clear, bounded message (`{ExceptionType}: {Message}`, never a full stack trace) and exits non-zero — deliberately still does **not** attempt to synthesize or force a report of any outcome to the cloud, since Story 2-10's own lease-expiry-based reclaim already handles an unresponsive connector safely (see the comment added at each catch site). Verified: `dotnet test` still 28/28 after the change.

**Considered and explicitly not fixed (deferred, with reasoning):**

- **P2/P3 — window titles read during UI-profile matching and the harmless-navigation step are included verbatim in `DiscoveryTraceResult.Diagnostics` and the local durable log, with no redaction.** For the expected profile (Idealpos's table-selection screen), a window title is not expected to contain customer/order/payment content — but this is not independently verified against a real Idealpos installation (no live access this session), and no redaction/allowlist is implemented as a defense-in-depth backstop. This tracer never reaches a payment or order-detail screen by design (the discovery-only scope itself is the primary control), but the residual risk is real and worth naming rather than silently assuming safe. Owner: whoever implements the real order-entry tracer, which will need a more deliberate diagnostic-sanitization policy regardless (order/item content will legitimately need to flow through that tracer's own logs). Priority: P2 for that future story; not fixed here because this story's own scope structurally cannot reach the screens where it would matter, and building a speculative redaction heuristic without real window-title samples to validate it against would risk hiding genuinely useful diagnostic information for no proven benefit.
- **P3 — `WindowsUiAutomationClient.IsBusy` always returns `false`** (no discovered busy-state control to check yet — checklist item G). Documented in the source itself as a known, disclosed gap, not a verified fact. Owner: whoever completes live discovery and implements the real check. Priority: P3 (a modal progress dialog, if Idealpos shows one, is still caught by the separate `HasModalChildWindow` check).
- **P3 — `WindowsUiAutomationClient.IsSessionLocked` throws `NotImplementedException`** rather than a guessed value — this is the deliberate fail-closed choice (see the method's own doc comment), not a gap being silently carried forward, but it does mean the tracer cannot currently distinguish "session locked" from "any other UI-state-read failure" until a real WTS-based check is implemented and verified on a real Windows session. Owner: same as above. Priority: P3.

No unresolved P0 or P1 finding remains in scope for this story. **Epic 15 dependency accuracy**: independently re-checked `docs/epics.md`'s E15-S5/S6/S7 and `sprint-status.yaml`'s `15-5`/`15-6`/`15-7` entries against this story's actual (unchanged) blocked status — all found already accurate, none required correction.

### Session 3 (2026-08-17) — static-only reassessment, still no live Windows access

**Environment check performed and recorded before any other action this session**: `hostname` → a macOS machine (machine name redacted); `uname -a`/`sw_vers` → Darwin/macOS 26.6.1, arm64; `pwsh` not found; no live Idealpos process or Windows service can exist on this host. A local, non-repository directory on this host contains **copied Idealpos program files** (not a running installation) — explicitly treated as static evidence only, never as live-environment evidence, consistent with this story's own standing distinction (§12.2 of `idealpos.md`: "static filenames or strings alone cannot produce `VERIFIED`"). This session performed a read-only static assessment of that copy (method identical to §12.1–§12.4: `file`, narrow `strings` pattern sampling, plain-text config reads — no execution, no decompilation, no database/credential access) and found materially deeper evidence for the Doshii and WebIt surfaces, plus new EFTPOS-gateway, import/export-framework, and version-ambiguity findings — full detail: `idealpos.md` §12.5, consolidated vendor questions: §12.6. Decision-log addendum: DL-071 (2026-08-17).

**No change to this story's status, blocking gate, or evidence tiers.** `REAL_WINDOWS_CONNECTOR` and `REAL_IDEALPOS_UI_DISCOVERY` remain not attempted/not available — this was a documentation-and-evidence session only, no code was built or run, no Idealpos process was started, and no live discovery checklist item moved past static-evidence status. Story `9-2` stays `blocked` on the same gate as session 2.

No unresolved P0 or P1 finding from this session's independent review (see below).

**Independent review (session 3):** reviewed the new §12.5/§12.6 content and the checklist/decision-log edits for: overstatement (checked each new claim carries an explicit classification tag and no sentence asserts licensing/entitlement/reachability from a static finding); licence-boundary compliance (no decompilation/disassembly was performed; the licence's prohibition was re-checked, not just cited from a prior session); duplicate documentation (the vendor-question list lives in one place, `idealpos.md` §12.6, with the checklist and story pointing to it rather than restating it); and whether the evidence could be mistaken for satisfying Story 9-2's blocking gate (it cannot and does not — every new finding is explicitly `OBSERVED_NOT_PROVEN`/`STATICALLY_CONFIRMED`(-of-code-only)/`REQUIRES_VENDOR_CONFIRMATION`/`REQUIRES_LIVE_WINDOWS`, never `VERIFIED`). No P0/P1 finding identified; no code exists in scope of this session to regression-test.

## File List

- `windows-connector/VerduraIdealposTracer.slnx` (new)
- `windows-connector/README.md` (new)
- `windows-connector/src/VerduraIdealposTracer.Core/**` (new)
- `windows-connector/src/VerduraIdealposTracer.Fixtures/**` (new)
- `windows-connector/src/VerduraIdealposTracer.DryRunCli/**` (new)
- `windows-connector/src/VerduraIdealposTracer.Windows/**` (new — unbuilt/unverified this session)
- `windows-connector/src/VerduraIdealposTracer.Cli/**` (new — unbuilt/unverified this session)
- `windows-connector/tests/VerduraIdealposTracer.Tests/**` (new)
- `windows-connector/docs/operator-runbook.md` (new)
- `windows-connector/docs/evidence-capture-template.md` (new)
- `windows-connector/docs/discovery-profile.sample.json` (new)
- `docs/integrations/idealpos.md` (modified — §12.4, §19–§21 updates; §12.5/§12.6 new, 2026-08-17)
- `docs/discovery/idealpos-live-discovery-checklist.md` (modified — new items; item I/J updated 2026-08-17)
- `docs/decisions-log.md` (modified — DL-071; addendum 2026-08-17)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)
- `_bmad-output/implementation-artifacts/9-2-idealpos-uibridge-tracer.md` (this file — rewritten; Session 3 subsection added 2026-08-17)

## Change Log

- 2026-08-16 (a): Story created during the Idealpos API-less integration planning session, scoped around a demo/cloned Idealpos environment. Independent review round 1 completed. Not implemented.
- 2026-08-16 (b, this session): Story rescoped at its source per this session's governing brief — real-environment discovery-first framing, explicit legal/safety boundary, discovery-only tracer implemented and tested for every failure case achievable without live Windows access. Static evidence expanded (`idealpos.md` §12.4). Integration route selected from evidence (DL-071). Real Windows/Idealpos evidence remains unavailable this session — status stays `blocked`, gate: `REAL_WINDOWS_CONNECTOR + REAL_IDEALPOS_UI_DISCOVERY evidence required`.
- 2026-08-16 (independent review, same session): fresh review pass completed. One suspected P1 (connector-protocol JSON casing) investigated and empirically disproven via actual test reversion, not assumption — recorded in detail rather than silently dropped; regression tests kept as an explicit contract guard. One real P2 fixed (unhandled-exception handling in both CLI entry points, now fails closed with a clear, sanitized message). Two P3 items considered and deferred with reasoning (window-title diagnostic redaction; `IsBusy`'s disclosed-gap default). No unresolved P0/P1 remains. Full test suite re-confirmed 28/28 after all changes. Epic 15 dependency accuracy independently re-checked, no correction needed. Status remains `blocked` — gate unchanged, this review found no evidence that would change it.
- 2026-08-17 (session 3): environment boundary explicitly re-checked and confirmed still non-Windows (macOS/Darwin) before any action. Performed a static-only, read-only reassessment of the copied Idealpos installation materials found in a local, non-repository directory on this host, going deeper than session 2 on Doshii (now a full OAuth client, not one method name), WebIt, EFTPOS gateways, and a generic import/export framework; found and recorded a version-evidence ambiguity (three non-equivalent version-shaped strings) and an architecturally significant finding that Idealpos's core Ecommerce/Online service DLLs show no local server-hosting evidence in a targeted search (outbound-only cloud-polling clients; WebIt was not part of that specific search and remains open). Consolidated a 16-question vendor question set (`idealpos.md` §12.6). No code changed, no Windows/Idealpos access occurred, no checklist item moved past static-evidence status. Status remains `blocked` — gate unchanged. Independent review completed, no P0/P1 found.
