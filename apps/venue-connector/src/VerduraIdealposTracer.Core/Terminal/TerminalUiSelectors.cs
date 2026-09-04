using VerduraIdealposTracer.Core.Discovery;

namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// The concrete UI selectors a real driver needs before it may drive the
/// native sale screen.
///
/// <b>Re-based on Win32 identity, 2026-09-04.</b> The previous shape required
/// five <c>*AutomationId</c> strings. That model was incompatible with the
/// application: the Session-1 capture of <c>IPS.exe</c> walked 57 nodes and
/// found <b>zero non-empty AutomationIds</b> — the process is VB6/ThunderRT6,
/// UI Automation returns only window chrome, and the Win32
/// <c>EnumChildWindows</c> fallback is the only mechanism yielding content.
/// No capture of this application, however well targeted, could ever have
/// populated the old fields with genuine values; the only way to make that
/// model "ready" was to invent strings that match nothing.
///
/// Every field is still nullable and defaults to null precisely so an
/// unpopulated set is, by construction, not ready — there is no value that
/// both "looks configured" and "is a placeholder."
/// </summary>
public sealed record TerminalUiSelectors
{
    /// <summary>
    /// How to pick the sale window among the process's top-level windows.
    /// A criteria object rather than a bare title hint because a bare hint is
    /// what bound the back-office MDI frame instead of "POS Screen".
    /// </summary>
    public WindowSelectionCriteria? SaleScreenWindow { get; init; }

    /// <summary>The table-map / table-grid control inside the sale window.</summary>
    public Win32ControlSelector? TableMapControl { get; init; }

    /// <summary>
    /// Template naming a specific table cell, e.g. <c>"Table {code}"</c>. Must
    /// contain the <c>{code}</c> placeholder so a table code can be
    /// substituted; a template without it cannot address a specific table.
    /// </summary>
    public string? TableCellTemplate { get; init; }

    /// <summary>The PLU / item entry field.</summary>
    public Win32ControlSelector? PluEntryField { get; init; }

    /// <summary>The Save-to-Table / Send action control.</summary>
    public Win32ControlSelector? SaveToTableAction { get; init; }

    /// <summary>
    /// Control whose presence after the action PROVES the table was assigned.
    /// Without it the action layer cannot earn success and must fail closed —
    /// see <see cref="TerminalSelectorReadiness"/>.
    /// </summary>
    public Win32ControlSelector? TableAssignmentConfirmationControl { get; init; }

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
/// The gate was RE-EXPRESSED for the Win32 model, not relaxed: it still
/// demands a real profile version plus five populated required selectors, and
/// it now additionally demands that each one survive
/// <see cref="Win32SelectorValidation"/> and that a post-action verification
/// selector exist — so a profile can no longer be "ready" for an action whose
/// success could not be proven.
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
        "PENDING", "UNSET", "TBD", "PLACEHOLDER", "SESSION1", "DISCOVERY", "EXAMPLE", "CHANGEME",
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
            why = "no sale-screen window criteria supplied";
            return false;
        }

        var hasPositive =
            !LooksPlaceholder(criteria.TitleEquals)
            || !LooksPlaceholder(criteria.TitleContains)
            || criteria.PreferredClassNames.Any(c => !LooksPlaceholder(c));

        if (!hasPositive)
        {
            why = "sale-screen window criteria carry no real title or class discriminator";
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

        if (!IsUsableWindowCriteria(selectors.SaleScreenWindow, out var windowWhy))
        {
            reason = $"required selector '{nameof(TerminalUiSelectors.SaleScreenWindow)}' is unusable: {windowWhy}";
            return false;
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
            (nameof(TerminalUiSelectors.TableMapControl), selectors.TableMapControl),
            (nameof(TerminalUiSelectors.PluEntryField), selectors.PluEntryField),
            (nameof(TerminalUiSelectors.SaveToTableAction), selectors.SaveToTableAction),
            (nameof(TerminalUiSelectors.TableAssignmentConfirmationControl), selectors.TableAssignmentConfirmationControl),
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

        reason = "all required Win32 selectors are structurally valid and the profile version is real";
        return true;
    }
}
