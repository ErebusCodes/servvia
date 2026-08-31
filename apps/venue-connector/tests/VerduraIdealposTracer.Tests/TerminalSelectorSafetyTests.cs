using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The fail-closed selector gate that the real Windows implementation
/// delegates to. Live execution must be refused whenever ANY required
/// selector is placeholder, empty, or the profile version is unset/stale.
/// </summary>
public sealed class TerminalSelectorSafetyTests
{
    private static TerminalUiSelectors Full(string version = "profile-verified-2026-09-02") => new()
    {
        SaleScreenWindowAutomationId = "saleWindow",
        TableMapControlAutomationId = "tableMap",
        TableCellTemplate = "table-{code}",
        PluEntryFieldAutomationId = "pluField",
        SaveToTableActionAutomationId = "saveToTable",
        ProfileVersion = version,
    };

    [Fact]
    public void EmptySelectors_AreNotReady()
    {
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(TerminalUiSelectors.Empty, out _));
    }

    [Fact]
    public void PlaceholderProfileVersion_IsNotReady()
    {
        var s = Full(version: "UNSET-PENDING-session1-discovery");
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains("version", reason);
    }

    [Fact]
    public void OneBlankSelector_IsNotReady()
    {
        var s = Full() with { PluEntryFieldAutomationId = "  " };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains("PluEntryFieldAutomationId", reason);
    }

    [Fact]
    public void OnePlaceholderMarkerSelector_IsNotReady()
    {
        var s = Full() with { SaveToTableActionAutomationId = "TBD-by-discovery" };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out _));
    }

    [Fact]
    public void FullyPopulatedRealSelectors_AreReady()
    {
        Assert.True(TerminalSelectorReadiness.IsReadyForLiveExecution(Full(), out var reason));
        Assert.NotNull(reason);
    }
}
