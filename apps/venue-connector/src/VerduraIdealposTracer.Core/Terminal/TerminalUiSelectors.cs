namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// The concrete Session-1 UI selectors a real driver needs before it may
/// drive the native sale screen. Every field is nullable and defaults to
/// null precisely so an unpopulated selector set is, by construction, not
/// ready — there is no value that both "looks configured" and "is a
/// placeholder." Real values are populated by the authorised Session-1
/// passive discovery run; until then this stays empty and
/// <see cref="TerminalSelectorReadiness"/> refuses live execution.
/// </summary>
public sealed record TerminalUiSelectors
{
    public string? SaleScreenWindowAutomationId { get; init; }
    public string? TableMapControlAutomationId { get; init; }
    public string? TableCellTemplate { get; init; }
    public string? PluEntryFieldAutomationId { get; init; }
    public string? SaveToTableActionAutomationId { get; init; }
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
    /// Returns true only when every required selector is a real, non-blank,
    /// non-placeholder value AND the profile version is itself not a
    /// placeholder. Otherwise returns false with a human-readable reason
    /// naming the first offending field.
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

        var required = new (string Field, string? Value)[]
        {
            (nameof(TerminalUiSelectors.SaleScreenWindowAutomationId), selectors.SaleScreenWindowAutomationId),
            (nameof(TerminalUiSelectors.TableMapControlAutomationId), selectors.TableMapControlAutomationId),
            (nameof(TerminalUiSelectors.TableCellTemplate), selectors.TableCellTemplate),
            (nameof(TerminalUiSelectors.PluEntryFieldAutomationId), selectors.PluEntryFieldAutomationId),
            (nameof(TerminalUiSelectors.SaveToTableActionAutomationId), selectors.SaveToTableActionAutomationId),
        };

        foreach (var (field, value) in required)
        {
            if (LooksPlaceholder(value))
            {
                reason = $"required selector '{field}' is empty/placeholder ('{value ?? "null"}')";
                return false;
            }
        }

        reason = "all required selectors present and profile version is real";
        return true;
    }
}
