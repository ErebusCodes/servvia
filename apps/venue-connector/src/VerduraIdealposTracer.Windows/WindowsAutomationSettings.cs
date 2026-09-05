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

    /// <summary>
    /// The executable the driver is permitted to drive, matched against the
    /// bound process's real module path. A process NAME is not identity —
    /// IPSClient, a renamed build, or an unrelated process could satisfy a
    /// name check — so the driver verifies this and refuses when the path is
    /// unreadable. Directive §6 fixes the target as IPS.exe.
    /// </summary>
    public string ExpectedExecutableFileName { get; init; } = "IPS.exe";

    public WindowSelectionCriteria? TableMapWindow { get; init; }
    public WindowSelectionCriteria? TableDetailsWindow { get; init; }
    public string? TableCellTemplate { get; init; }
    public Win32ControlSelector? TableCellControl { get; init; }
    public Win32ControlSelector? PluEntryField { get; init; }
    public Win32ControlSelector? QuantityEntryField { get; init; }
    public Win32ControlSelector? StagedLinesControl { get; init; }
    public Win32ControlSelector? TableMapCommand { get; init; }
    public IReadOnlyList<Win32ControlSelector> DestructiveControls { get; init; } = Array.Empty<Win32ControlSelector>();

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
        TableMapWindow = profile.TableMapWindow,
        TableDetailsWindow = profile.TableDetailsWindow,
        TableCellTemplate = profile.TableCellTemplate,
        TableCellControl = profile.TableCellControl,
        PluEntryField = profile.PluEntryField,
        QuantityEntryField = profile.QuantityEntryField,
        StagedLinesControl = profile.StagedLinesControl,
        TableMapCommand = profile.TableMapCommand,
        DestructiveControls = profile.DestructiveControls,
    };

    /// <summary>Projects the terminal-driving selectors into the Core, testable shape.</summary>
    public TerminalUiSelectors BuildTerminalSelectors() => new()
    {
        SaleScreenWindow = SaleScreenWindow,
        TableMapWindow = TableMapWindow,
        TableDetailsWindow = TableDetailsWindow,
        TableCellTemplate = TableCellTemplate,
        TableCellControl = TableCellControl,
        PluEntryField = PluEntryField,
        QuantityEntryField = QuantityEntryField,
        StagedLinesControl = StagedLinesControl,
        TableMapCommand = TableMapCommand,
        DestructiveControls = DestructiveControls,
        ModalDialogClassNamePattern = ModalDialogWindowClassNamePattern,
        ProfileVersion = TerminalProfileVersion,
    };
}
