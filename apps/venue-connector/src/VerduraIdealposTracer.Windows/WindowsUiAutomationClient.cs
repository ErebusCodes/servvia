using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Windows;

/// <summary>
/// The real Windows UI Automation implementation of
/// <see cref="IIdealposUiAutomationClient"/>. UNVERIFIED — this repository
/// was authored with no Windows machine or Idealpos installation
/// available; see this project's own .csproj doc comment. Every method
/// below is written against the documented System.Windows.Automation API
/// surface and idealpos.md §14.2's constraints (UI Automation first, never
/// arbitrary screen coordinates as the primary mechanism, fail closed on
/// anything unexpected), but has not been run against a real Idealpos
/// window. The <see cref="WindowsAutomationSettings"/> AutomationId
/// placeholders MUST be replaced with real, discovered values (checklist
/// item G) before this class can safely drive a real installation — using
/// it with the placeholder defaults against a real Idealpos window will
/// correctly fail closed (no matching control found) rather than silently
/// misbehave, by design.
/// </summary>
public sealed class WindowsUiAutomationClient(WindowsAutomationSettings settings) : IIdealposUiAutomationClient
{
    public Task<IdealposProcessSnapshot?> DetectIdealposProcessAsync(CancellationToken cancellationToken)
    {
        // Process enumeration itself needs no elevated privilege for
        // processes owned by the same user session; this can throw
        // Win32Exception/UnauthorizedAccessException if the Bridge's
        // least-privilege account (idealpos.md §14.2) cannot enumerate a
        // process owned by a different session — that is a real,
        // expected failure mode this method deliberately does not swallow.
        var candidates = Process.GetProcessesByName(settings.ExpectedProcessName);
        try
        {
            var process = candidates.FirstOrDefault(p => !p.HasExited && p.MainWindowHandle != IntPtr.Zero);
            if (process is null) return Task.FromResult<IdealposProcessSnapshot?>(null);

            // Environment.UserInteractive reflects whether THIS (the
            // Bridge's own) process is running in an interactive session —
            // a reasonable proxy given idealpos.md §14.2 requires the
            // Bridge itself to run in a dedicated interactive session, but
            // it does not independently confirm the DETECTED Idealpos
            // process is in that same session. A stronger check (comparing
            // WTSGetActiveConsoleSessionId against the target process's own
            // session id) is a documented follow-up, not implemented here
            // pending live discovery.
            return Task.FromResult<IdealposProcessSnapshot?>(new IdealposProcessSnapshot(
                ProcessName: process.ProcessName,
                ProcessId: process.Id,
                MainWindowTitle: process.MainWindowTitle,
                IsInteractiveSession: Environment.UserInteractive));
        }
        finally
        {
            foreach (var p in candidates) p.Dispose();
        }
    }

    public Task<IdealposUiProfileMatchResult> MatchUiProfileAsync(
        IdealposProcessSnapshot process, IdealposVerifiedProfile expectedProfile, CancellationToken cancellationToken)
    {
        if (!string.Equals(process.ProcessName, expectedProfile.ExpectedProcessName, StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(new IdealposUiProfileMatchResult(
                false, process.ProcessName, $"process name '{process.ProcessName}' did not match expected '{expectedProfile.ExpectedProcessName}'"));
        }
        if (!process.MainWindowTitle.Contains(expectedProfile.ExpectedMainWindowTitleContains, StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(new IdealposUiProfileMatchResult(
                false, process.MainWindowTitle, $"main window title '{process.MainWindowTitle}' did not contain expected '{expectedProfile.ExpectedMainWindowTitleContains}'"));
        }

        // Locate the main window via UI Automation, from the desktop root —
        // fails closed (IdealposControlNotFoundException) rather than
        // guessing if it cannot be found within the timeout.
        var mainWindow = FindMainWindowElement(process.ProcessId);
        if (mainWindow is null)
        {
            throw new IdealposControlNotFoundException($"main window for process id {process.ProcessId}");
        }

        return Task.FromResult(new IdealposUiProfileMatchResult(true, expectedProfile.ProfileVersion, null));
    }

    public Task<IdealposUiState> ReadCurrentUiStateAsync(CancellationToken cancellationToken)
    {
        var candidates = Process.GetProcessesByName(settings.ExpectedProcessName);
        try
        {
            var process = candidates.FirstOrDefault(p => !p.HasExited && p.MainWindowHandle != IntPtr.Zero);
            if (process is null)
            {
                // Should not normally be reachable here (caller already
                // confirmed detection), but never assume — fail closed.
                return Task.FromResult(new IdealposUiState(false, false, false, string.Empty));
            }

            var mainWindow = FindMainWindowElement(process.Id);
            if (mainWindow is null)
            {
                throw new IdealposControlNotFoundException($"main window for process id {process.Id}");
            }

            var hasModal = HasModalChildWindow(mainWindow);
            var isLocked = IsSessionLocked();
            var title = process.MainWindowTitle;

            return Task.FromResult(new IdealposUiState(
                HasModalDialogOpen: hasModal,
                IsSessionLocked: isLocked,
                // Unlike IsSessionLocked, deliberately does not throw: no
                // busy-state control has been discovered yet to check
                // against (checklist item G), and a modal progress dialog
                // (if Idealpos shows one) is still caught by
                // HasModalChildWindow above. This is a known, disclosed gap
                // — not a verified "not busy" fact — and must be replaced
                // with a real check once discovery identifies one, not left
                // as a permanent false-negative-prone default.
                IsBusy: false,
                MainWindowTitle: title));
        }
        finally
        {
            foreach (var p in candidates) p.Dispose();
        }
    }

    public Task<HarmlessNavigationResult> PerformHarmlessNavigationAsync(CancellationToken cancellationToken)
    {
        // The ONLY UI-touching action this tracer performs: re-read the
        // main window's title/name via UI Automation. Never selects a
        // table, never enters an item, never clicks Save — idealpos.md
        // §14.2/§16's "no state-mutating action" boundary for a discovery
        // run.
        var candidates = Process.GetProcessesByName(settings.ExpectedProcessName);
        try
        {
            var process = candidates.FirstOrDefault(p => !p.HasExited && p.MainWindowHandle != IntPtr.Zero);
            if (process is null)
            {
                return Task.FromResult(new HarmlessNavigationResult(false, false, "Idealpos process no longer detected."));
            }

            var mainWindow = FindMainWindowElement(process.Id);
            if (mainWindow is null)
            {
                return Task.FromResult(new HarmlessNavigationResult(false, false, "Main window no longer found."));
            }

            var name = mainWindow.Current.Name;
            var verified = !string.IsNullOrEmpty(name);
            return Task.FromResult(new HarmlessNavigationResult(
                Completed: true,
                Verified: verified,
                Description: verified
                    ? $"Re-read main window Name property: \"{name}\"."
                    : "Main window Name property was empty — cannot verify."));
        }
        finally
        {
            foreach (var p in candidates) p.Dispose();
        }
    }

    /// <summary>
    /// Fail-closed native round driver.
    ///
    /// <b>Rewritten 2026-09-05 against the proven workflow.</b> The previous
    /// implementation is described in the Phase 1 audit; three of its defects
    /// are structurally impossible here:
    ///
    /// <list type="bullet">
    /// <item><b>D1</b> — it wrote <c>request.TableCode</c> into the PLU field.
    /// The plan model keeps the two on different step kinds and
    /// <see cref="NativeRoundPlan.Validate"/> rejects a plan that mixes
    /// them.</item>
    /// <item><b>D2</b> — it never read <c>request.Items</c> at all, so it
    /// could not have produced a native round. The plan is now BUILT from the
    /// items, and a plan missing any requested item fails validation before
    /// anything is bound.</item>
    /// <item><b>D5</b> — it treated "the table already shows this code" as
    /// success and returned without sending, which would have silently
    /// no-opped every second round against an open table. That short-circuit
    /// is gone: an already-active table is a precondition observation, never
    /// a confirmation.</item>
    /// </list>
    ///
    /// What remains is a real gate, not a stub: it validates the request,
    /// validates the plan, binds and verifies the process INCLUDING its
    /// executable, binds the window, refuses on a modal, and then refuses at
    /// the selector-readiness gate. It performs NO mutating action, and it
    /// cannot: the action layer was deleted from this assembly (see
    /// <c>Win32ReadOnlyObservation</c>) and will not return until a passive
    /// capture of the real native Table Map proves which input mechanism the
    /// VB6 <c>cmd</c> control array actually honours.
    ///
    /// Every exit below leaves <c>SendBoundaryCrossed = false</c>, which is
    /// true by construction rather than by assertion.
    /// </summary>
    public Task<TerminalSaveToTableResult> AttemptSaveToTableAsync(TerminalRoundRequest request, CancellationToken cancellationToken)
    {
        // Build the plan FIRST, from the round's items. Everything downstream
        // is driven by these steps rather than by ad-hoc field access, which
        // is what makes "the items are ignored" a test failure instead of a
        // silent behaviour.
        var steps = NativeRoundPlan.Build(request);
        var plan = NativeRoundPlan.Describe(steps);

        var validationErrors = request.Validate();
        if (validationErrors.Count > 0)
        {
            return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                TerminalExecutionOutcome.UnexpectedScreen, request.RoundId, request.TableCode,
                "invalid request: " + string.Join("; ", validationErrors), plan));
        }

        // Structural invariants of the plan itself: every requested item is
        // present, no table code rides on an item step, exactly one send
        // boundary, nothing mutating after it.
        var planErrors = NativeRoundPlan.Validate(request, steps);
        if (planErrors.Count > 0)
        {
            return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                TerminalExecutionOutcome.UnexpectedScreen, request.RoundId, request.TableCode,
                "the native round plan is not well-formed, refusing to drive it: " + string.Join("; ", planErrors), plan));
        }

        // 1. verify the IPS process (read-only)
        var candidates = Process.GetProcessesByName(settings.ExpectedProcessName);
        try
        {
            var process = candidates.FirstOrDefault(p => !p.HasExited && p.MainWindowHandle != IntPtr.Zero);
            if (process is null)
            {
                return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.UnexpectedScreen, request.RoundId, request.TableCode,
                    $"IPS process '{settings.ExpectedProcessName}' with a visible main window was not found (are you in the interactive session?)", plan));
            }

            // 1b. verify the EXECUTABLE, not merely the process name.
            //     A process name is not identity: IPSClient, a renamed build,
            //     or an unrelated process could satisfy it. Directive §7A
            //     requires the executable path be verified, and an unreadable
            //     path is a refusal rather than a shrug.
            string? executablePath;
            try
            {
                executablePath = process.MainModule?.FileName;
            }
            catch (Exception ex)
            {
                return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.UnexpectedScreen, request.RoundId, request.TableCode,
                    $"could not read the executable path of pid {process.Id} ({ex.GetType().Name}) — refusing to drive a process whose identity is unverified", plan));
            }

            if (string.IsNullOrWhiteSpace(executablePath)
                || !executablePath.EndsWith(settings.ExpectedExecutableFileName, StringComparison.OrdinalIgnoreCase))
            {
                return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.UnexpectedScreen, request.RoundId, request.TableCode,
                    $"bound process pid {process.Id} runs '{executablePath ?? "(unreadable)"}', which is not the expected "
                    + $"'{settings.ExpectedExecutableFileName}' — refusing", plan));
            }

            // 2. verify expected window (read-only)
            var mainWindow = FindMainWindowElement(process.Id);
            if (mainWindow is null)
            {
                return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.ControlNotFound, request.RoundId, request.TableCode,
                    $"main window for process id {process.Id} not found via UI Automation", plan));
            }

            // 3. verify no unexpected modal (read-only). Never dismissed.
            if (HasModalChildWindow(mainWindow))
            {
                return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.ModalDetected, request.RoundId, request.TableCode,
                    "a modal dialog is blocking the main window", plan));
            }

            // 4. require real, non-placeholder selectors — the fail-closed
            //    gate. With the workflow-shaped selector set these cannot be
            //    populated from anything but a capture of the real native
            //    Table Map, so this is where execution stops today.
            var selectors = settings.BuildTerminalSelectors();
            if (!TerminalSelectorReadiness.IsReadyForLiveExecution(selectors, out var reason))
            {
                return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.ControlNotFound, request.RoundId, request.TableCode,
                    $"terminal selectors not ready for live execution: {reason}. "
                    + "Live execution is intentionally not enabled until a passive capture of the real native "
                    + "Table Map populates them.", plan));
            }

            // 5. Past the readiness gate there is deliberately no executor.
            //    The step mechanics — whether a table cell honours a posted
            //    message at all, and whether MouseDown rather than Click is
            //    required — are unproven, and inventing them would be exactly
            //    the guess directive §29 forbids. Refuse, explicitly, without
            //    having touched anything.
            return Task.FromResult(TerminalSaveToTableResult.FailClosed(
                TerminalExecutionOutcome.SendNotReached, request.RoundId, request.TableCode,
                "selectors are ready but no native step executor exists yet: the input mechanism for the Table Map "
                + "cell array is unproven (IPS.exe exposes frmTables.cmd_MouseDown with no cmd_Click handler). "
                + "Refusing to guess an input mechanism. Nothing was sent and no round was started.", plan));
        }
        finally
        {
            foreach (var p in candidates) p.Dispose();
        }
    }

    /// <summary>
    /// Passive, read-only control-tree capture. Reads only metadata
    /// (AutomationId / ControlType / accessible Name / Win32 ClassName /
    /// enabled / offscreen) via the ControlView walker, bounded by depth,
    /// node count, and a wall-clock stopwatch. There is deliberately NO
    /// Invoke/SetValue/Select/SendInput/SetForegroundWindow/WM_COMMAND call
    /// anywhere in this method or WalkControl — it cannot mutate the UI.
    /// Every accessible Name is sanitized before it is stored.
    /// </summary>
    public Task<IdealposControlTreeSnapshot> CaptureControlTreeAsync(ControlTreeCaptureOptions options, CancellationToken cancellationToken)
    {
        int tracerSession = SafeSessionId(Process.GetCurrentProcess());
        var diagnostics = new List<string>();

        // The unfiltered desktop inventory is taken FIRST, before any
        // "is the expected process running?" short-circuit. That ordering is
        // the point: the case worth capturing is precisely the one where the
        // expected executable is absent and something else owns the native
        // terminal, and a short-circuit above this line would discard exactly
        // that evidence.
        var desktopInventory = EnumerateDesktopWindowInventory();
        var binding = NativeTerminalBindingEvidence.Summarize(desktopInventory, settings.ExpectedExecutableFileName);
        diagnostics.Add($"Desktop window inventory: {desktopInventory.Count} visible top-level window(s).");
        diagnostics.Add("Native terminal binding evidence: " + binding.Verdict);
        if (binding.ContradictsExpectedExecutable)
        {
            diagnostics.Add(
                "ACTION REQUIRED: this capture contradicts the configured executable binding. Do NOT force the "
                + $"implementation back to '{settings.ExpectedExecutableFileName}' — re-decide the binding from the "
                + "owners listed above before any selector work proceeds.");
        }

        // Probe the configured terminal AND IPSClient, so the capture never
        // silently depends on which one owns the sale-screen window.
        var probeNames = new[] { settings.ExpectedProcessName, "IPS", "IPSClient" }
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var procs = new List<Process>();
        foreach (var n in probeNames) procs.AddRange(Process.GetProcessesByName(n));
        try
        {
            var live = procs.Where(p => { try { return !p.HasExited; } catch { return false; } }).ToList();
            if (live.Count == 0)
            {
                diagnostics.Add("No IPS/IPSClient process is running.");
                return Task.FromResult(EmptySnapshot(tracerSession, null, false, diagnostics) with
                {
                    DesktopWindowInventory = desktopInventory,
                });
            }

            var primary = live.FirstOrDefault(p => string.Equals(p.ProcessName, settings.ExpectedProcessName, StringComparison.OrdinalIgnoreCase)) ?? live[0];
            int? targetSession = SafeSessionId(primary);
            bool mismatch = targetSession.HasValue && targetSession.Value != tracerSession;

            // EnumWindows over EVERY top-level window owned by a candidate —
            // does NOT rely on MainWindowHandle (which is 0 cross-session and
            // can be 0 for windowless-main processes).
            var pidToProc = live.GroupBy(p => p.Id).ToDictionary(g => g.Key, g => g.First());
            var topWindows = EnumerateTopLevelWindows(pidToProc);
            diagnostics.Add($"EnumWindows found {topWindows.Count} top-level window(s) for candidate process(es) on this desktop.");

            // Criteria-based, so a profile can disqualify the back-office MDI
            // frame by title and class. With a bare "Idealpos" hint the
            // 13:07:59 capture bound "...DUNEDIN - BACKOFFICE(1)" — whose
            // title contains the hint — while the visible sale window
            // "POS Screen" (class ThunderRT6FormDC), enumerated in the same
            // pass, does not contain it and could never win.
            var saleScreenCriteria = settings.SaleScreenWindow with
            {
                TitleContains = string.IsNullOrWhiteSpace(settings.SaleScreenWindow.TitleContains)
                    ? settings.ExpectedMainWindowTitleContains
                    : settings.SaleScreenWindow.TitleContains,
            };
            var strictChoice = WindowSelection.Select(topWindows, saleScreenCriteria, primary.Id);
            diagnostics.Add($"Window selection: {strictChoice.Status} — {strictChoice.Reason}");
            var chosen = WindowSelection.Choose(topWindows, saleScreenCriteria, primary.Id);

            if (chosen is null)
            {
                diagnostics.Add(mismatch
                    ? $"SESSION MISMATCH PROVEN: tracer session {tracerSession} != target session {targetSession}; no window of the target is on this desktop. Run inside the target's session."
                    : $"No top-level window found for {primary.ProcessName} (pid {primary.Id}) in session {tracerSession}.");
                return new IdealposControlTreeSnapshot
                {
                    CapturedAtUtc = DateTimeOffset.UtcNow,
                    ProcessName = primary.ProcessName,
                    ProcessId = primary.Id,
                    TracerSessionId = tracerSession,
                    TargetSessionId = targetSession,
                    SessionMismatch = mismatch,
                    Mechanism = CaptureMechanism.None,
                    TopLevelWindows = topWindows,
                    DesktopWindowInventory = desktopInventory,
                    NodeCount = 0,
                    Root = null,
                    Diagnostics = diagnostics,
                }.AsCompleted();
            }

            var hwnd = new IntPtr(Convert.ToInt64(chosen.Handle, 16));
            var state = new CaptureState();
            var menus = new List<string>();
            var sw = Stopwatch.StartNew();
            ControlNodeSnapshot? root = null;
            var mechanism = CaptureMechanism.None;

            // The bound window's own visibility is the single most useful
            // fact when a capture comes back empty, so state it up front
            // rather than leaving the operator to infer it from a node count.
            if (!chosen.Visible)
            {
                diagnostics.Add(
                    $"WARNING: the bound window '{chosen.Title}' ({chosen.Handle}) reports IsWindowVisible=false. "
                    + "A window without WS_VISIBLE does not render its client area, so no sale-screen control "
                    + "can be walked out of it no matter which mechanism is used.");
            }

            // 1) UIA bound to the exact HWND (not RootElement.FindFirst).
            //    Accepted ONLY if it yields client-area content. A tree of
            //    pure window chrome (TitleBar/Minimize/Maximize/Close) is a
            //    FAILED capture that must fall through to the fallbacks —
            //    the second live capture returned exactly seven such nodes
            //    and the old NodeCount > 1 test wrongly called it a success.
            ControlNodeSnapshot? uiaRoot = null;
            try
            {
                var element = AutomationElement.FromHandle(hwnd);
                if (element is not null)
                {
                    uiaRoot = WalkControl(element, 0, options, state, sw, menus, cancellationToken);
                    if (uiaRoot is not null && !ControlTreeQuality.IsChromeOnly(uiaRoot))
                    {
                        root = uiaRoot;
                        mechanism = CaptureMechanism.UiaFromHandle;
                    }
                    else if (uiaRoot is not null)
                    {
                        diagnostics.Add(ControlTreeQuality.ChromeOnlyDiagnostic("UIA FromHandle", state.NodeCount));
                    }
                }
            }
            catch (Exception ex) { diagnostics.Add($"UIA FromHandle failed: {ex.GetType().Name}: {ex.Message}"); }

            // 2) Win32 fallback (crucial for VB6 apps whose UIA tree is sparse).
            //    Requires real child windows: state.NodeCount is cumulative
            //    across attempts, so testing it here would accept a childless
            //    root purely because step 1 had already counted nodes.
            if (mechanism == CaptureMechanism.None)
            {
                var win32 = BuildWin32Node(hwnd, 0, options, state, sw);
                if (win32 is not null && win32.Children.Count > 0)
                {
                    root = win32;
                    mechanism = CaptureMechanism.Win32;
                    diagnostics.Add("UIA yielded no client-area content; used Win32 EnumChildWindows fallback.");
                }
                else
                {
                    diagnostics.Add("Win32 EnumChildWindows fallback found no child windows either.");
                }
            }

            // 3) MSAA (oleacc) fallback probe.
            if (mechanism == CaptureMechanism.None)
            {
                var msaa = BuildMsaaProbe(hwnd, state, diagnostics);
                if (msaa is not null)
                {
                    root = msaa;
                    mechanism = CaptureMechanism.Msaa;
                    diagnostics.Add("UIA+Win32 empty; used MSAA (oleacc) fallback probe.");
                }
            }

            // 3b) ALWAYS enumerate the Win32 child-window tree, whatever UIA
            //     produced. This is read-only: EnumChildWindows + GetClassName
            //     + GetDlgCtrlID + WM_GETTEXT observe state and mutate nothing.
            //
            //     Unconditional because the either/or fallback provably misses
            //     this application. In the 14:10:32 POS Screen capture, UIA
            //     returned the ThunderRT6FormDC root, a TitleBar, and one EMPTY
            //     ThunderRT6PictureBoxDC pane. That pane is not a TitleBar, so
            //     IsChromeOnly said "not chrome-only", mechanism became
            //     UiaFromHandle, and step 2 — gated on mechanism == None — never
            //     ran. The real VB6 sale controls are native children beneath
            //     that pane and went unseen. A lone empty container pane is
            //     indistinguishable from real content by shape alone, so this
            //     cannot be fixed by tightening the quality test.
            IReadOnlyList<Win32ControlNode> win32Controls = Array.Empty<Win32ControlNode>();
            try
            {
                win32Controls = Win32ControlDiscovery
                    .Enumerate(hwnd)
                    .Select(n => n with { Text = ControlTreeSanitizer.Sanitize(n.Text) })
                    .ToList();

                var visibleCount = win32Controls.Count(n => n.Visible);
                diagnostics.Add(
                    $"Win32 child enumeration (unconditional, read-only): {win32Controls.Count} control(s), "
                    + $"{visibleCount} visible, "
                    + $"{win32Controls.Select(n => n.ClassName).Distinct(StringComparer.OrdinalIgnoreCase).Count()} distinct class(es).");

                if (win32Controls.Count == 0)
                {
                    diagnostics.Add(
                        "WARNING: the bound window reports ZERO Win32 child windows. For a VB6 sale screen this is "
                        + "not credible — either the window is not the rendered sale form, or it draws its controls "
                        + "without child HWNDs (owner-drawn), in which case no Win32 selector can address them.");
                }
            }
            catch (Exception ex)
            {
                diagnostics.Add($"Win32 child enumeration failed: {ex.GetType().Name}: {ex.Message}");
            }

            // 3c) MSAA probes, UNCONDITIONAL and deep. Read-only: only
            //     IAccessible GETTERS are called — never accDoDefaultAction,
            //     accSelect or put_accValue.
            //
            //     The previous MSAA step was gated on mechanism == None, so on
            //     the POS Screen it never ran at all; and even when it did it
            //     read only the root's name and child count, never enumerating
            //     children. That is the gap this closes.
            //
            //     Probed: the bound window (CLIENT and WINDOW objects), every
            //     Win32 child of it, and the process's other VISIBLE windows —
            //     because the sale controls need not be parented beneath the
            //     POS Screen HWND.
            var msaaProbes = new List<MsaaProbeResult>();
            try
            {
                msaaProbes.Add(MsaaDiscovery.Probe(hwnd, chosen.ClassName, chosen.Title));
                msaaProbes.Add(MsaaDiscovery.Probe(hwnd, chosen.ClassName, chosen.Title, useWindowObject: true));

                foreach (var child in win32Controls)
                {
                    var childHandle = ParseHandle(child.Handle);
                    if (childHandle != IntPtr.Zero)
                        msaaProbes.Add(MsaaDiscovery.Probe(childHandle, child.ClassName, child.Text));
                }

                foreach (var other in topWindows.Where(w =>
                             w.Visible && w.ProcessId == primary.Id && !string.Equals(w.Handle, chosen.Handle, StringComparison.OrdinalIgnoreCase)))
                {
                    var otherHandle = ParseHandle(other.Handle);
                    if (otherHandle != IntPtr.Zero)
                        msaaProbes.Add(MsaaDiscovery.Probe(otherHandle, other.ClassName, other.Title));
                }

                foreach (var probe in msaaProbes)
                {
                    diagnostics.Add(probe.Reachable
                        ? $"MSAA {probe.ObjectId} {probe.Handle} ({probe.WindowClassName}): {probe.TotalNodes} node(s), "
                          + $"{probe.AddressableNodes} addressable."
                        : $"MSAA {probe.ObjectId} {probe.Handle} ({probe.WindowClassName}): unreachable — {probe.FailureReason}");
                }
            }
            catch (Exception ex)
            {
                diagnostics.Add($"MSAA probing failed: {ex.GetType().Name}: {ex.Message}");
            }

            var addressableAccessible = msaaProbes.Sum(p => p.AddressableNodes);
            diagnostics.Add(
                $"TOTAL addressable accessible nodes across {msaaProbes.Count} probe(s): {addressableAccessible}. "
                + "A profile can only be populated if this is greater than zero AND the nodes correspond to real "
                + "sale controls (table map, entry field, Save action, confirmation).");

            // 4) Win32 menu-bar enumeration.
            EnumerateWin32Menus(hwnd, menus);

            // Nothing usable anywhere: still PRESERVE the chrome-only tree as
            // evidence (it proves which window was bound and that the frame
            // was reachable), but leave Mechanism = None so the snapshot
            // never claims a capture it did not achieve.
            if (mechanism == CaptureMechanism.None && root is null && uiaRoot is not null)
            {
                root = uiaRoot;
                diagnostics.Add(
                    "No mechanism produced client-area content. Retaining the chrome-only UIA tree as evidence "
                    + "of which window was bound; Mechanism stays None and ClientNodeCount stays 0.");
            }

            var clientNodeCount = ControlTreeQuality.CountClientNodes(root);

            diagnostics.Add($"mechanism={mechanism}, nodes={state.NodeCount}, clientNodes={clientNodeCount}, hwnd={chosen.Handle}, tracerSession={tracerSession}, targetSession={targetSession}, mismatch={mismatch}.");

            return new IdealposControlTreeSnapshot
            {
                CapturedAtUtc = DateTimeOffset.UtcNow,
                ProcessName = primary.ProcessName,
                ProcessId = primary.Id,
                RootWindowTitle = ControlTreeSanitizer.Sanitize(chosen.Title),
                NodeCount = state.NodeCount,
                Truncated = state.Truncated,
                TruncationReason = state.TruncationReason,
                Root = root,
                MenuItems = menus.Distinct().ToList(),
                TracerSessionId = tracerSession,
                TargetSessionId = targetSession,
                SessionMismatch = mismatch,
                Mechanism = mechanism,
                ClientNodeCount = clientNodeCount,
                Win32Controls = win32Controls,
                MsaaProbes = msaaProbes,
                AddressableAccessibleNodes = addressableAccessible,
                TopLevelWindows = topWindows,
                DesktopWindowInventory = desktopInventory,
                Diagnostics = diagnostics,
            }.AsCompleted();
        }
        finally
        {
            foreach (var p in procs) { try { p.Dispose(); } catch { } }
        }
    }

    private static IdealposControlTreeSnapshot EmptySnapshot(
        int tracerSession, int? targetSession, bool mismatch, IReadOnlyList<string> diagnostics) => new()
    {
        CapturedAtUtc = DateTimeOffset.UtcNow,
        NodeCount = 0,
        Root = null,
        TracerSessionId = tracerSession,
        TargetSessionId = targetSession,
        SessionMismatch = mismatch,
        Mechanism = CaptureMechanism.None,
        Diagnostics = diagnostics,
    };

    private static int SafeSessionId(Process p)
    {
        try { return p.SessionId; } catch { return -1; }
    }

    private static string? SafeName(AutomationElement element)
    {
        try { return element.Current.Name; } catch { return null; }
    }

    // ── Win32 / MSAA / EnumWindows helpers (all read-only) ──

    /// <summary>
    /// Turns the "0x1405F6" runtime handle string back into an HWND. Handles
    /// are re-issued on every form load, so they are parsed here for immediate
    /// use and never round-tripped into a persisted selector.
    /// </summary>
    private static IntPtr ParseHandle(string? handle)
    {
        if (string.IsNullOrWhiteSpace(handle)) return IntPtr.Zero;
        var text = handle.Trim();
        if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) text = text[2..];
        return long.TryParse(text, System.Globalization.NumberStyles.HexNumber,
            System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? new IntPtr(value)
            : IntPtr.Zero;
    }

    private static List<TopLevelWindowInfo> EnumerateTopLevelWindows(Dictionary<int, Process> pidToProc)
    {
        var results = new List<TopLevelWindowInfo>();
        Native.EnumWindows((h, l) =>
        {
            Native.GetWindowThreadProcessId(h, out uint pid);
            if (pidToProc.TryGetValue((int)pid, out var proc))
            {
                results.Add(DescribeWindow(h, proc.ProcessName, proc.Id, proc));
            }
            return true;
        }, IntPtr.Zero);
        return results;
    }

    /// <summary>
    /// EVERY visible top-level window on this desktop, regardless of which
    /// process owns it. Read-only: EnumWindows + GetWindowText/GetClassName/
    /// GetWindowRect/IsWindowVisible and a process lookup — no message is
    /// posted, nothing is focused, nothing is changed.
    ///
    /// <see cref="EnumerateTopLevelWindows"/> is filtered to the process
    /// names we already expect, which is correct for choosing a window and
    /// useless for discovering one: if the native Table Map is owned by
    /// something other than the configured executable, the filtered pass
    /// reports an absence rather than the owner. This pass is what makes the
    /// Front-desk binding question answerable.
    /// </summary>
    private static List<TopLevelWindowInfo> EnumerateDesktopWindowInventory()
    {
        var results = new List<TopLevelWindowInfo>();
        var processCache = new Dictionary<int, Process?>();

        Native.EnumWindows((h, l) =>
        {
            if (!Native.IsWindowVisible(h)) return true; // an invisible window owns no visible native UI

            Native.GetWindowThreadProcessId(h, out uint rawPid);
            var pid = (int)rawPid;

            if (!processCache.TryGetValue(pid, out var proc))
            {
                try { proc = Process.GetProcessById(pid); }
                catch { proc = null; } // exited, or not ours to inspect
                processCache[pid] = proc;
            }

            results.Add(DescribeWindow(h, proc?.ProcessName, pid, proc));
            return true;
        }, IntPtr.Zero);

        foreach (var p in processCache.Values) p?.Dispose();
        return results;
    }

    /// <summary>
    /// Builds one window's evidence row. Every field is read-only, and each
    /// unreadable field becomes null rather than an assumption — an
    /// unreadable executable path is a stated gap in the evidence, not a
    /// licence to fall back on the process name.
    /// </summary>
    private static TopLevelWindowInfo DescribeWindow(IntPtr h, string? processName, int processId, Process? proc)
    {
        // Geometry decides whether a visible sibling window could
        // plausibly be hosting the sale UI, or is a 0x0 helper.
        var rect = new ActionNative.RECT();
        var haveRect = ActionNative.GetWindowRect(h, ref rect);

        string? executablePath = null;
        int? sessionId = null;
        if (proc is not null)
        {
            try { executablePath = proc.MainModule?.FileName; }
            catch { executablePath = null; }

            var session = SafeSessionId(proc);
            if (session >= 0) sessionId = session;
        }

        return new TopLevelWindowInfo
        {
            Handle = "0x" + h.ToInt64().ToString("X"),
            Title = ControlTreeSanitizer.Sanitize(GetWinText(h)),
            ClassName = GetWinClass(h),
            Visible = Native.IsWindowVisible(h),
            ProcessName = processName,
            ProcessId = processId,
            ExecutablePath = executablePath,
            SessionId = sessionId,
            Left = haveRect ? rect.Left : 0,
            Top = haveRect ? rect.Top : 0,
            Width = haveRect ? rect.Right - rect.Left : 0,
            Height = haveRect ? rect.Bottom - rect.Top : 0,
        };
    }

    private static string GetWinText(IntPtr h)
    {
        var sb = new StringBuilder(512);
        Native.GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    private static string GetWinClass(IntPtr h)
    {
        var sb = new StringBuilder(256);
        Native.GetClassName(h, sb, sb.Capacity);
        return sb.ToString();
    }

    private static ControlNodeSnapshot? BuildWin32Node(IntPtr hwnd, int depth, ControlTreeCaptureOptions options, CaptureState state, Stopwatch sw)
    {
        if (hwnd == IntPtr.Zero) return null;
        if (state.NodeCount >= options.MaxNodes) { state.Stop("max nodes"); return null; }
        if (sw.ElapsedMilliseconds > options.TimeoutMs) { state.Stop("timeout"); return null; }
        state.NodeCount++;

        var children = new List<ControlNodeSnapshot>();
        if (depth < options.MaxDepth)
        {
            var directChildren = new List<IntPtr>();
            Native.EnumChildWindows(hwnd, (h, l) =>
            {
                if (Native.GetParent(h) == hwnd) directChildren.Add(h);
                return true;
            }, IntPtr.Zero);

            foreach (var c in directChildren)
            {
                if (state.NodeCount >= options.MaxNodes) { state.Stop("max nodes"); break; }
                if (sw.ElapsedMilliseconds > options.TimeoutMs) { state.Stop("timeout"); break; }
                var childNode = BuildWin32Node(c, depth + 1, options, state, sw);
                if (childNode is not null) children.Add(childNode);
            }
        }
        else
        {
            state.Stop("max depth");
        }

        return new ControlNodeSnapshot
        {
            ControlType = "Win32",
            AutomationId = null, // Win32 has no AutomationId; the class name is the identifier here
            Name = ControlTreeSanitizer.Sanitize(GetWinText(hwnd)),
            ClassName = GetWinClass(hwnd),
            IsEnabled = Native.IsWindowEnabled(hwnd),
            IsOffscreen = !Native.IsWindowVisible(hwnd),
            Depth = depth,
            Children = children,
        };
    }

    private static ControlNodeSnapshot? BuildMsaaProbe(IntPtr hwnd, CaptureState state, List<string> diagnostics)
    {
        try
        {
            var iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71"); // IID_IAccessible
            const uint OBJID_CLIENT = 0xFFFFFFFC;
            int hr = Native.AccessibleObjectFromWindow(hwnd, OBJID_CLIENT, ref iid, out object acc);
            if (hr != 0 || acc is null) { diagnostics.Add($"MSAA AccessibleObjectFromWindow hr=0x{hr:X}"); return null; }

            state.NodeCount++;
            string? name = null; int childCount = 0;
            try { name = acc.GetType().InvokeMember("accName", System.Reflection.BindingFlags.GetProperty, null, acc, new object[] { 0 }) as string; } catch { }
            try { childCount = Convert.ToInt32(acc.GetType().InvokeMember("accChildCount", System.Reflection.BindingFlags.GetProperty, null, acc, null)); } catch { }
            diagnostics.Add($"MSAA root reachable: accChildCount={childCount}");

            return new ControlNodeSnapshot
            {
                ControlType = "MSAA-Accessible",
                AutomationId = null,
                Name = ControlTreeSanitizer.Sanitize(name),
                ClassName = GetWinClass(hwnd),
                IsEnabled = Native.IsWindowEnabled(hwnd),
                IsOffscreen = !Native.IsWindowVisible(hwnd),
                Depth = 0,
                Children = Array.Empty<ControlNodeSnapshot>(),
            };
        }
        catch (Exception ex)
        {
            diagnostics.Add($"MSAA probe threw {ex.GetType().Name}");
            return null;
        }
    }

    private static void EnumerateWin32Menus(IntPtr hwnd, List<string> menus)
    {
        try
        {
            var menu = Native.GetMenu(hwnd);
            if (menu == IntPtr.Zero) return;
            int count = Native.GetMenuItemCount(menu);
            for (int i = 0; i < count && i < 128; i++)
            {
                var sb = new StringBuilder(256);
                int n = Native.GetMenuString(menu, (uint)i, sb, sb.Capacity, 0x00000400 /*MF_BYPOSITION*/);
                if (n > 0)
                {
                    var text = ControlTreeSanitizer.Sanitize(sb.ToString().Replace("&", string.Empty));
                    if (!string.IsNullOrWhiteSpace(text)) menus.Add(text!);
                }
            }
        }
        catch { /* no menu / not reachable — leave menus as-is */ }
    }

    private static ControlNodeSnapshot? WalkControl(
        AutomationElement element, int depth, ControlTreeCaptureOptions options,
        CaptureState state, Stopwatch sw, List<string> menus, CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested) { state.Stop("cancelled"); return null; }
        if (sw.ElapsedMilliseconds > options.TimeoutMs) { state.Stop("timeout"); return null; }
        if (state.NodeCount >= options.MaxNodes) { state.Stop("max nodes"); return null; }

        string controlType, className;
        string? automationId, name;
        bool isEnabled, isOffscreen;
        try
        {
            var info = element.Current;
            controlType = info.ControlType?.ProgrammaticName?.Replace("ControlType.", string.Empty) ?? "Unknown";
            automationId = string.IsNullOrEmpty(info.AutomationId) ? null : info.AutomationId;
            name = info.Name;
            className = info.ClassName;
            isEnabled = info.IsEnabled;
            isOffscreen = info.IsOffscreen;
        }
        catch
        {
            // Stale / unavailable element — skip this node rather than fail
            // the whole capture.
            return null;
        }

        state.NodeCount++;
        var sanitizedName = ControlTreeSanitizer.Sanitize(name);
        if (options.IncludeMenus && (controlType == "Menu" || controlType == "MenuItem")
            && !string.IsNullOrWhiteSpace(sanitizedName))
        {
            menus.Add(sanitizedName!);
        }

        var children = new List<ControlNodeSnapshot>();
        if (depth < options.MaxDepth)
        {
            try
            {
                var walker = TreeWalker.ControlViewWalker;
                var child = walker.GetFirstChild(element);
                while (child is not null)
                {
                    if (sw.ElapsedMilliseconds > options.TimeoutMs) { state.Stop("timeout"); break; }
                    if (state.NodeCount >= options.MaxNodes) { state.Stop("max nodes"); break; }
                    var childSnapshot = WalkControl(child, depth + 1, options, state, sw, menus, cancellationToken);
                    if (childSnapshot is not null) children.Add(childSnapshot);
                    child = walker.GetNextSibling(child);
                }
            }
            catch
            {
                // A subtree became unavailable mid-walk — keep what we have.
            }
        }
        else
        {
            state.Stop("max depth");
        }

        return new ControlNodeSnapshot
        {
            ControlType = controlType,
            AutomationId = automationId,
            Name = sanitizedName,
            ClassName = string.IsNullOrEmpty(className) ? null : className,
            IsEnabled = isEnabled,
            IsOffscreen = isOffscreen,
            Depth = depth,
            Children = children,
        };
    }

    private sealed class CaptureState
    {
        public int NodeCount;
        public bool Truncated;
        public string? TruncationReason;

        public void Stop(string reason)
        {
            if (Truncated) return;
            Truncated = true;
            TruncationReason = reason;
        }
    }

    private static AutomationElement? FindMainWindowElement(int processId)
    {
        var condition = new PropertyCondition(AutomationElement.ProcessIdProperty, processId);
        return AutomationElement.RootElement.FindFirst(TreeScope.Children, condition);
    }

    private static bool HasModalChildWindow(AutomationElement mainWindow)
    {
        // A window whose WindowPattern reports IsModal is treated as a
        // blocking dialog. This is a documented, standard UIA pattern
        // property — not an assumption specific to Idealpos — but the
        // exact dialogs Idealpos raises (and whether they all expose
        // WindowPattern correctly) are unverified; see checklist item G.
        var windowCondition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window);
        var children = mainWindow.FindAll(TreeScope.Children, windowCondition);
        foreach (AutomationElement child in children)
        {
            if (child.TryGetCurrentPattern(WindowPattern.Pattern, out var patternObj)
                && patternObj is WindowPattern windowPattern
                && windowPattern.Current.IsModal)
            {
                return true;
            }
        }
        return false;
    }

    private static bool IsSessionLocked()
    {
        // Session-lock detection via WTSGetActiveConsoleSessionId /
        // WTSQuerySessionInformation is the standard supported approach but
        // requires a P/Invoke declaration this class deliberately does not
        // include without a real Windows machine to verify the marshalling
        // against. Deliberately throws rather than returning a guessed
        // `false` (not-locked) — a silently-wrong "not locked" default
        // would be the one failure mode this whole tracer exists to avoid
        // (proceeding into an unsafe state instead of failing closed).
        // ReadCurrentUiStateAsync's caller (DiscoveryTracerService) already
        // catches any exception here and reports FailedClosed, so throwing
        // is itself the fail-closed behaviour, not a gap in it. Replace
        // with a verified WTS-based check once implemented and tested
        // against a real Windows session (see the operator runbook).
        throw new NotImplementedException(
            "Session-lock detection is not yet implemented — see this method's own remarks. " +
            "This intentionally causes the caller to fail closed rather than assume the session is unlocked.");
    }
}

/// <summary>Wraps a completed snapshot as a Task without an async state machine.</summary>
internal static class SnapshotTaskExtensions
{
    public static Task<IdealposControlTreeSnapshot> AsCompleted(this IdealposControlTreeSnapshot snapshot)
        => Task.FromResult(snapshot);
}

/// <summary>
/// Read-only Win32 / oleacc interop for the capture. Every entry point here
/// observes window/menu/accessibility state — none sends input, posts a
/// message, or changes any window.
/// </summary>
internal static class Native
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr hMenu);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetMenuString(IntPtr hMenu, uint uIDItem, StringBuilder lpString, int nMaxCount, uint uFlag);

    [DllImport("oleacc.dll")]
    public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object ppvObject);
}
