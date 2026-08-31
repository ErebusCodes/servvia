using VerduraIdealposTracer.Core.Terminal;

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
    int OperationTimeoutMs = 5000,
    /// <summary>AutomationId of the native sale screen window — TBD by Session-1 discovery.</summary>
    string? SaleScreenWindowAutomationId = null,
    /// <summary>AutomationId of the table-map control — TBD by Session-1 discovery.</summary>
    string? TableMapControlAutomationId = null,
    /// <summary>Template locating a specific table cell (e.g. by name) — TBD by Session-1 discovery.</summary>
    string? TableCellTemplate = null,
    /// <summary>AutomationId of the PLU entry field — TBD by Session-1 discovery.</summary>
    string? PluEntryFieldAutomationId = null,
    /// <summary>AutomationId of the Save-to-Table / Send action — TBD by Session-1 discovery.</summary>
    string? SaveToTableActionAutomationId = null,
    /// <summary>The profile version the terminal selectors were captured under.</summary>
    string TerminalProfileVersion = "UNSET-PENDING-session1-discovery")
{
    public static WindowsAutomationSettings Placeholder => new(
        ExpectedProcessName: "IPS",
        ExpectedMainWindowTitleContains: "Idealpos");

    /// <summary>
    /// Projects the terminal-driving selectors into the Core, testable
    /// <see cref="TerminalUiSelectors"/> shape. With the shipped
    /// placeholders every field is null and the version is a placeholder,
    /// so <see cref="TerminalSelectorReadiness"/> refuses live execution —
    /// by design, until Session-1 discovery populates real values.
    /// </summary>
    public TerminalUiSelectors BuildTerminalSelectors() => new()
    {
        SaleScreenWindowAutomationId = SaleScreenWindowAutomationId,
        TableMapControlAutomationId = TableMapControlAutomationId,
        TableCellTemplate = TableCellTemplate,
        PluEntryFieldAutomationId = PluEntryFieldAutomationId,
        SaveToTableActionAutomationId = SaveToTableActionAutomationId,
        ModalDialogClassNamePattern = ModalDialogWindowClassNamePattern,
        ProfileVersion = TerminalProfileVersion,
    };
}
