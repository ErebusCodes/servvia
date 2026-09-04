using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Windows;

/// <summary>
/// Windows/Idealpos-specific automation settings — deliberately kept separate
/// from Core's platform-agnostic <c>IdealposVerifiedProfile</c>.
///
/// <b>Re-based on Win32 identity, 2026-09-04.</b> The five <c>*AutomationId</c>
/// fields this record used to carry were unpopulatable: the application is
/// VB6/ThunderRT6 and exposes zero AutomationIds. They are replaced by
/// <see cref="Win32ControlSelector"/> values and a
/// <see cref="WindowSelectionCriteria"/> for the sale window.
///
/// Every selector still defaults to null and the version still defaults to a
/// placeholder, so an unconfigured instance is refused by
/// <see cref="TerminalSelectorReadiness"/> — see <see cref="FromProfile"/> for
/// the only path that populates real values.
/// </summary>
public sealed record WindowsAutomationSettings(
    string ExpectedProcessName,
    string ExpectedMainWindowTitleContains,
    /// <summary>AutomationId of a control whose presence confirms "no modal dialog is blocking the main window".</summary>
    string? MainWindowStatusControlAutomationId = null,
    /// <summary>Window class name pattern Idealpos uses for modal dialogs, if consistent.</summary>
    string? ModalDialogWindowClassNamePattern = null,
    /// <summary>Timeout for any single UI Automation operation.</summary>
    int OperationTimeoutMs = 5000,
    /// <summary>The profile version the terminal selectors were captured under.</summary>
    string TerminalProfileVersion = "UNSET-PENDING-session1-discovery")
{
    /// <summary>How to pick the sale window among the process's top-level windows.</summary>
    public WindowSelectionCriteria SaleScreenWindow { get; init; } = new();

    public Win32ControlSelector? TableMapControl { get; init; }
    public string? TableCellTemplate { get; init; }
    public Win32ControlSelector? PluEntryField { get; init; }
    public Win32ControlSelector? SaveToTableAction { get; init; }
    public Win32ControlSelector? TableAssignmentConfirmationControl { get; init; }

    public static WindowsAutomationSettings Placeholder => new(
        ExpectedProcessName: "IPS",
        ExpectedMainWindowTitleContains: "Idealpos");

    /// <summary>
    /// The single wiring point from the operator-supplied profile. Every
    /// selector field AND the profile version are threaded through here.
    ///
    /// Before 2026-09-04 <c>Cli/Program.cs</c> built this record with two
    /// arguments only, so every selector defaulted to null and
    /// <c>TerminalProfileVersion</c> kept its placeholder default — meaning
    /// the profile's own <c>ProfileVersion</c> was silently discarded and no
    /// edit to any JSON file could ever have made readiness pass.
    /// </summary>
    public static WindowsAutomationSettings FromProfile(IdealposVerifiedProfile profile) => new(
        ExpectedProcessName: profile.ExpectedProcessName,
        ExpectedMainWindowTitleContains: profile.ExpectedMainWindowTitleContains,
        ModalDialogWindowClassNamePattern: profile.ModalDialogWindowClassNamePattern,
        TerminalProfileVersion: profile.ProfileVersion)
    {
        SaleScreenWindow = profile.BuildSaleScreenCriteria(),
        TableMapControl = profile.TableMapControl,
        TableCellTemplate = profile.TableCellTemplate,
        PluEntryField = profile.PluEntryField,
        SaveToTableAction = profile.SaveToTableAction,
        TableAssignmentConfirmationControl = profile.TableAssignmentConfirmationControl,
    };

    /// <summary>Projects the terminal-driving selectors into the Core, testable shape.</summary>
    public TerminalUiSelectors BuildTerminalSelectors() => new()
    {
        SaleScreenWindow = SaleScreenWindow,
        TableMapControl = TableMapControl,
        TableCellTemplate = TableCellTemplate,
        PluEntryField = PluEntryField,
        SaveToTableAction = SaveToTableAction,
        TableAssignmentConfirmationControl = TableAssignmentConfirmationControl,
        ModalDialogClassNamePattern = ModalDialogWindowClassNamePattern,
        ProfileVersion = TerminalProfileVersion,
    };
}
