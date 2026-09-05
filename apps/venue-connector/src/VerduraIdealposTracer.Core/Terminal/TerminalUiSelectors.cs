using VerduraIdealposTracer.Core.Discovery;

namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// The concrete UI selectors a real driver needs before it may drive the
/// native workflow.
///
/// <b>Remodelled 2026-09-05 against the proven workflow.</b> The previous
/// shape described a workflow IdealPOS does not have: a PLU field, a
/// "Save-to-Table" button, and a confirmation control. The 2026-09-05 Table 5
/// experiment proved the real sequence is
/// <c>enter items → TABLE MAP → select Table N</c>, where selecting the table
/// IS the send and there is no Save button at all. The fields below name the
/// screens and controls that sequence actually needs.
///
/// Every field is still nullable and defaults to null precisely so an
/// unpopulated set is, by construction, not ready — there is no value that
/// both "looks configured" and "is a placeholder". None of these can be
/// populated until a passive capture of the real native Table Map exists;
/// deriving them from any other machine's UI is explicitly out of bounds.
/// </summary>
public sealed record TerminalUiSelectors
{
    // --- screens ----------------------------------------------------------

    /// <summary>How to pick the native sale-entry window (VB6 <c>frmSale</c>, title "POS Screen").</summary>
    public WindowSelectionCriteria? SaleScreenWindow { get; init; }

    /// <summary>
    /// How to pick the native Table Map window (VB6 <c>frmTables</c>). This is
    /// a SEPARATE top-level window from the sale screen, which is why a single
    /// "sale screen" criteria set was never sufficient.
    /// </summary>
    public WindowSelectionCriteria? TableMapWindow { get; init; }

    /// <summary>
    /// How to pick the native Table Details window (VB6 <c>frmTableDetails</c>).
    /// Required for a second round, which reaches the POS screen through it.
    /// </summary>
    public WindowSelectionCriteria? TableDetailsWindow { get; init; }

    // --- table selection --------------------------------------------------

    /// <summary>
    /// Template naming a specific table cell, e.g. <c>"Table {code}"</c>. Must
    /// contain the <c>{code}</c> placeholder. Matching against a rendered
    /// template is token-exact via <see cref="TableIdentity"/> — never a
    /// substring test, so table 5 can never resolve table 15.
    /// </summary>
    public string? TableCellTemplate { get; init; }

    /// <summary>
    /// The class/shape of one table-map cell. Combined with
    /// <see cref="TableCellTemplate"/> to address a specific table.
    /// </summary>
    public Win32ControlSelector? TableCellControl { get; init; }

    /// <summary>
    /// The controls on the Table Map that are NOT tables and whose activation
    /// would be destructive — Pay, Finished, Transfer, Cancel. The static
    /// analysis showed these share the form with the table cells, so the
    /// driver must be able to positively assert that a resolved cell is none
    /// of them before acting (directive §29).
    /// </summary>
    public IReadOnlyList<Win32ControlSelector> DestructiveControls { get; init; } = Array.Empty<Win32ControlSelector>();

    // --- item entry -------------------------------------------------------

    /// <summary>The native PLU / stock-code entry control. NEVER receives a table code.</summary>
    public Win32ControlSelector? PluEntryField { get; init; }

    /// <summary>The native quantity control.</summary>
    public Win32ControlSelector? QuantityEntryField { get; init; }

    /// <summary>
    /// The staged sale-line control, read back before the send so the round's
    /// items can be verified against what IdealPOS actually staged.
    /// </summary>
    public Win32ControlSelector? StagedLinesControl { get; init; }

    /// <summary>The control that navigates from sale entry to the Table Map.</summary>
    public Win32ControlSelector? TableMapCommand { get; init; }

    // --- safety -----------------------------------------------------------

    /// <summary>Window class name pattern Idealpos uses for modal dialogs.</summary>
    public string? ModalDialogClassNamePattern { get; init; }

    /// <summary>The profile version these selectors were captured under. A stale/unset version fails readiness.</summary>
    public string ProfileVersion { get; init; } = "UNSET";

    /// <summary>An all-empty selector set — the safe default the Windows implementation ships with.</summary>
    public static TerminalUiSelectors Empty => new();
}

/// <summary>
/// The single, testable fail-closed gate. The Windows implementation MUST
/// call this before any UI interaction and MUST refuse when it returns
/// not-ready. Living in Core (not in the Windows-only project) means this
/// safety rule is exercised by cross-platform unit tests, not merely
/// asserted to hold on a machine nobody runs the tests on.
///
/// Re-expressed 2026-09-05 for the workflow-shaped selector set. It was
/// tightened, not relaxed: it now also demands a Table Map window, a
/// quantity control, a staged-line read-back control, and a non-empty list of
/// destructive controls to distinguish from table cells.
/// </summary>
public static class TerminalSelectorReadiness
{
    /// <summary>
    /// Markers that identify a value as an unverified placeholder rather
    /// than a real discovered selector. Case-insensitive substring match.
    /// The profile-correction ProfileVersion this project currently ships
    /// ("...PENDING-session1-discovery") deliberately trips this.
    /// </summary>
    private static readonly string[] PlaceholderMarkers =
    {
        "PENDING", "UNSET", "TBD", "PLACEHOLDER", "SESSION1", "DISCOVERY", "EXAMPLE", "CHANGEME", "UNUSED",
    };

    private static bool LooksPlaceholder(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        foreach (var marker in PlaceholderMarkers)
        {
            if (value.Contains(marker, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    /// <summary>
    /// A window criteria set is real only when it can positively identify a
    /// window: an exact title, a title substring, or a preferred class.
    /// </summary>
    private static bool IsUsableWindowCriteria(WindowSelectionCriteria? criteria, out string why)
    {
        if (criteria is null)
        {
            why = "no window criteria supplied";
            return false;
        }

        var hasPositive =
            !LooksPlaceholder(criteria.TitleEquals)
            || !LooksPlaceholder(criteria.TitleContains)
            || criteria.PreferredClassNames.Any(c => !LooksPlaceholder(c));

        if (!hasPositive)
        {
            why = "window criteria carry no real title or class discriminator";
            return false;
        }

        why = "ok";
        return true;
    }

    /// <summary>
    /// Returns true only when every required selector is a real, non-blank,
    /// non-placeholder, structurally valid value AND the profile version is
    /// itself not a placeholder. Otherwise returns false with a
    /// human-readable reason naming the first offending field.
    /// </summary>
    public static bool IsReadyForLiveExecution(TerminalUiSelectors selectors, out string reason)
    {
        if (selectors is null)
        {
            reason = "no terminal selectors supplied";
            return false;
        }

        if (LooksPlaceholder(selectors.ProfileVersion))
        {
            reason = $"profile version '{selectors.ProfileVersion}' is unset/placeholder/stale";
            return false;
        }

        var requiredWindows = new (string Field, WindowSelectionCriteria? Criteria)[]
        {
            (nameof(TerminalUiSelectors.SaleScreenWindow), selectors.SaleScreenWindow),
            (nameof(TerminalUiSelectors.TableMapWindow), selectors.TableMapWindow),
            (nameof(TerminalUiSelectors.TableDetailsWindow), selectors.TableDetailsWindow),
        };

        foreach (var (field, criteria) in requiredWindows)
        {
            if (!IsUsableWindowCriteria(criteria, out var windowWhy))
            {
                reason = $"required selector '{field}' is unusable: {windowWhy}";
                return false;
            }
        }

        if (LooksPlaceholder(selectors.TableCellTemplate))
        {
            reason = $"required selector '{nameof(TerminalUiSelectors.TableCellTemplate)}' is empty/placeholder "
                     + $"('{selectors.TableCellTemplate ?? "null"}')";
            return false;
        }

        if (!selectors.TableCellTemplate!.Contains("{code}", StringComparison.OrdinalIgnoreCase))
        {
            reason = $"'{nameof(TerminalUiSelectors.TableCellTemplate)}' must contain the '{{code}}' placeholder "
                     + $"(was '{selectors.TableCellTemplate}') or it cannot address a specific table";
            return false;
        }

        var required = new (string Field, Win32ControlSelector? Selector)[]
        {
            (nameof(TerminalUiSelectors.TableCellControl), selectors.TableCellControl),
            (nameof(TerminalUiSelectors.PluEntryField), selectors.PluEntryField),
            (nameof(TerminalUiSelectors.QuantityEntryField), selectors.QuantityEntryField),
            (nameof(TerminalUiSelectors.StagedLinesControl), selectors.StagedLinesControl),
            (nameof(TerminalUiSelectors.TableMapCommand), selectors.TableMapCommand),
        };

        foreach (var (field, selector) in required)
        {
            if (selector is null)
            {
                reason = $"required selector '{field}' is not populated";
                return false;
            }

            if (!Win32SelectorValidation.IsValid(selector, out var why))
            {
                reason = $"required selector '{field}' is invalid: {why}";
                return false;
            }
        }

        // Without a known set of destructive controls the driver cannot prove
        // that the thing it resolved as "Table 5" is not the Pay button.
        if (selectors.DestructiveControls.Count == 0)
        {
            reason = $"required selector '{nameof(TerminalUiSelectors.DestructiveControls)}' is empty — "
                     + "the driver cannot distinguish a table cell from Pay/Finished/Transfer without it";
            return false;
        }

        foreach (var destructive in selectors.DestructiveControls)
        {
            if (!Win32SelectorValidation.IsValid(destructive, out var why))
            {
                reason = $"a '{nameof(TerminalUiSelectors.DestructiveControls)}' entry is invalid: {why}";
                return false;
            }
        }

        reason = "all required Win32 selectors are structurally valid and the profile version is real";
        return true;
    }
}
