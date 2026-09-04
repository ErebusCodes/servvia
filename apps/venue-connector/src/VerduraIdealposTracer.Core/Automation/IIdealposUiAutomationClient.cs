using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Core.Automation;

/// <summary>Non-sensitive facts about a running Idealpos process — never a credential, licence key, or payment field.</summary>
public sealed record IdealposProcessSnapshot(
    string ProcessName,
    int ProcessId,
    string MainWindowTitle,
    bool IsInteractiveSession);

/// <summary>Result of comparing an observed process/window against the operator-supplied verified profile (see docs/discovery-profile.sample.json).</summary>
public sealed record IdealposUiProfileMatchResult(
    bool Matched,
    string? ObservedVersionHint,
    string? MismatchReason);

/// <summary>
/// The minimum non-sensitive UI state needed to decide whether it is safe
/// to proceed — never reads order/payment content.
/// </summary>
public sealed record IdealposUiState(
    bool HasModalDialogOpen,
    bool IsSessionLocked,
    bool IsBusy,
    string MainWindowTitle);

public sealed record HarmlessNavigationResult(
    bool Completed,
    bool Verified,
    string Description);

/// <summary>
/// Thrown when a required UI control cannot be located within the
/// expected profile — mapped by the tracer's state machine to a fail-
/// closed or `Uncertain` outcome depending on when it occurs, never
/// silently retried.
/// </summary>
public sealed class IdealposControlNotFoundException(string controlDescription)
    : Exception($"Idealpos control not found: {controlDescription}");

/// <summary>Thrown when more than one control matches an identifier that should be unique.</summary>
public sealed class IdealposControlAmbiguousException(string controlDescription, int matchCount)
    : Exception($"Idealpos control ambiguous ({matchCount} matches): {controlDescription}");

/// <summary>
/// The abstraction boundary between this story's platform-agnostic
/// discovery state machine and the actual UI Automation calls, which are
/// Windows-only. The real implementation
/// (VerduraIdealposTracer.Windows.WindowsUiAutomationClient) uses
/// System.Windows.Automation and can only run on Windows against a real
/// Idealpos installation. Unit tests use a fake implementation
/// (VerduraIdealposTracer.Tests's FakeIdealposUiAutomationClient) — a
/// clearly-labelled test fixture, never presented as real Windows/Idealpos
/// evidence.
/// </summary>
public interface IIdealposUiAutomationClient
{
    Task<IdealposProcessSnapshot?> DetectIdealposProcessAsync(CancellationToken cancellationToken);

    Task<IdealposUiProfileMatchResult> MatchUiProfileAsync(
        IdealposProcessSnapshot process, IdealposVerifiedProfile expectedProfile, CancellationToken cancellationToken);

    Task<IdealposUiState> ReadCurrentUiStateAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Performs exactly one harmless, reversible, non-mutating navigation
    /// (e.g. re-reading the title bar / a status control) — never table
    /// selection, item entry, or anything idealpos.md §16 would classify
    /// as a state-mutating action.
    /// </summary>
    Task<HarmlessNavigationResult> PerformHarmlessNavigationAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Attempts one native "Save to Table" round — the whole first-round (or
    /// second-round append) action — through the terminal's own licensed
    /// sale screen, exactly as a clerk would. This is a MUTATING contract,
    /// but the production (Windows) implementation is fail-closed: it
    /// verifies process/window/no-modal, requires a fully populated,
    /// non-placeholder Session-1 selector set, and returns a fail-closed
    /// <see cref="TerminalSaveToTableResult"/> WITHOUT touching a single
    /// control until those real selectors exist. It never clicks, sets a
    /// value, selects, sends input, foregrounds a window, or posts a
    /// message while selectors are unproven.
    ///
    /// Pricing is out of scope by construction: <see cref="TerminalRoundItem"/>
    /// carries no price. Any price on the result is an observation read back
    /// FROM IdealPOS, never an input — IdealPOS remains the pricing
    /// authority.
    /// </summary>
    Task<TerminalSaveToTableResult> AttemptSaveToTableAsync(TerminalRoundRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// PASSIVE, read-only capture of the current UI Automation control tree.
    /// This is a pure observation: it reads AutomationId / ControlType /
    /// accessible Name / Win32 ClassName and structural flags, bounded by
    /// <see cref="ControlTreeCaptureOptions"/> (depth, node count, wall
    /// clock). It never invokes a control, sets a value, selects, sends
    /// input, foregrounds a window, or posts a message. Its whole purpose is
    /// to turn the Session-1 sale screen into evidence a human can use to
    /// populate real selectors — it cannot itself act on any of them.
    /// </summary>
    Task<IdealposControlTreeSnapshot> CaptureControlTreeAsync(ControlTreeCaptureOptions options, CancellationToken cancellationToken);
}

/// <summary>
/// The operator-supplied, versioned profile this tracer refuses to proceed
/// without matching — see docs/discovery-profile.sample.json and the
/// operator runbook. Intentionally minimal: this story is discovery-only,
/// so the profile only needs enough to positively identify "this is the
/// expected Idealpos installation in the expected state," not a full
/// mapping contract (idealpos.md §17, a later story's concern).
/// </summary>
public sealed record IdealposVerifiedProfile(
    string ExpectedProcessName,
    string ExpectedMainWindowTitleContains,
    string ProfileVersion)
{
    // --- Sale-screen window selection -------------------------------------
    // Added 2026-09-04. The three positional fields above cannot express
    // "the POS Screen, NOT the back-office MDI frame", which is why the
    // 13:07:59 capture bound the wrong window: the hint "Idealpos" is
    // contained in "...DUNEDIN - BACKOFFICE(1)" but not in "POS Screen".

    /// <summary>Exact title of the sale window, e.g. <c>"POS Screen"</c>. Outranks every other signal.</summary>
    public string? SaleScreenWindowTitleEquals { get; init; }

    /// <summary>Title substrings that DISQUALIFY a window outright, e.g. <c>["BACKOFFICE"]</c>.</summary>
    public IReadOnlyList<string> SaleScreenWindowTitleExcludes { get; init; } = Array.Empty<string>();

    /// <summary>Window classes that indicate the sale window, e.g. <c>["ThunderRT6FormDC"]</c>.</summary>
    public IReadOnlyList<string> SaleScreenWindowPreferredClassNames { get; init; } = Array.Empty<string>();

    /// <summary>Window classes that disqualify outright, e.g. <c>["ThunderRT6MDIForm"]</c>.</summary>
    public IReadOnlyList<string> SaleScreenWindowExcludedClassNames { get; init; } = Array.Empty<string>();

    /// <summary>Refuse to bind an invisible sale window (a chrome-only tree is what the failed capture produced).</summary>
    public bool SaleScreenRequireVisible { get; init; } = true;

    // --- Win32 control selectors ------------------------------------------
    // These replace the previous five AutomationId fields, which this
    // VB6/ThunderRT6 application cannot supply (zero AutomationIds across
    // 57 captured nodes).

    public Win32ControlSelector? TableMapControl { get; init; }
    public string? TableCellTemplate { get; init; }
    public Win32ControlSelector? PluEntryField { get; init; }
    public Win32ControlSelector? SaveToTableAction { get; init; }

    /// <summary>Control whose post-action presence PROVES the table assignment. Without it, success cannot be earned.</summary>
    public Win32ControlSelector? TableAssignmentConfirmationControl { get; init; }

    public string? ModalDialogWindowClassNamePattern { get; init; }

    /// <summary>Projects the profile's window rules into the selection criteria the discovery layer consumes.</summary>
    public WindowSelectionCriteria BuildSaleScreenCriteria() => new()
    {
        TitleEquals = SaleScreenWindowTitleEquals,
        TitleContains = ExpectedMainWindowTitleContains,
        TitleExcludes = SaleScreenWindowTitleExcludes,
        PreferredClassNames = SaleScreenWindowPreferredClassNames,
        ExcludedClassNames = SaleScreenWindowExcludedClassNames,
        RequireVisible = SaleScreenRequireVisible,
    };

    /// <summary>
    /// Projects the profile into the Core, testable selector shape. With the
    /// shipped placeholder profile every control selector is null and the
    /// version is a placeholder, so <see cref="TerminalSelectorReadiness"/>
    /// refuses live execution — by design.
    /// </summary>
    public TerminalUiSelectors BuildTerminalSelectors() => new()
    {
        SaleScreenWindow = BuildSaleScreenCriteria(),
        TableMapControl = TableMapControl,
        TableCellTemplate = TableCellTemplate,
        PluEntryField = PluEntryField,
        SaveToTableAction = SaveToTableAction,
        TableAssignmentConfirmationControl = TableAssignmentConfirmationControl,
        ModalDialogClassNamePattern = ModalDialogWindowClassNamePattern,
        ProfileVersion = ProfileVersion,
    };
}
