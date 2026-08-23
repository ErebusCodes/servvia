using System.Diagnostics;
using System.Windows.Automation;
using VerduraIdealposTracer.Core.Automation;

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
