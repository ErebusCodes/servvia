namespace VerduraIdealposTracer.Windows;

/// <summary>
/// Windows/Idealpos-specific UI Automation identifiers — deliberately kept
/// separate from Core's platform-agnostic <c>IdealposVerifiedProfile</c>.
/// Every value here is a placeholder pending live discovery (checklist
/// item G: "Accessibility/UI Automation support... do the relevant
/// screens... expose usable Automation IDs/accessible names, or would the
/// Bridge need to fall back to control handles/coordinates?"). This class
/// must be populated from a real discovery session before
/// <see cref="WindowsUiAutomationClient"/> is used against a real
/// installation — see docs/operator-runbook.md's evidence-capture step.
/// </summary>
public sealed record WindowsAutomationSettings(
    string ExpectedProcessName,
    string ExpectedMainWindowTitleContains,
    /// <summary>AutomationId of a control whose presence confirms "no modal dialog is blocking the main window" — TBD by live discovery.</summary>
    string? MainWindowStatusControlAutomationId = null,
    /// <summary>Window class name pattern Idealpos uses for modal dialogs, if consistent — TBD by live discovery.</summary>
    string? ModalDialogWindowClassNamePattern = null,
    /// <summary>Timeout for any single UI Automation operation.</summary>
    int OperationTimeoutMs = 5000)
{
    public static WindowsAutomationSettings Placeholder => new(
        ExpectedProcessName: "IPSClient",
        ExpectedMainWindowTitleContains: "Idealpos");
}
