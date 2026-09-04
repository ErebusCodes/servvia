using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The fail-closed selector gate that the real Windows implementation
/// delegates to. Live execution must be refused whenever ANY required
/// selector is placeholder, empty, structurally invalid, or the profile
/// version is unset/stale.
///
/// Re-expressed for the Win32 selector model on 2026-09-04. The gate was NOT
/// relaxed: it still demands a real profile version plus a full set of
/// required selectors, and it now additionally demands that each survive
/// structural validation and that a post-action verification selector exist.
/// </summary>
public sealed class TerminalSelectorSafetyTests
{
    private static Win32ControlSelector Sel(string className, int id) =>
        new() { ClassName = className, ControlId = id };

    private static TerminalUiSelectors Full(string version = "profile-verified-2026-09-02") => new()
    {
        SaleScreenWindow = new WindowSelectionCriteria
        {
            TitleEquals = "POS Screen",
            PreferredClassNames = new[] { "ThunderRT6FormDC" },
            TitleExcludes = new[] { "BACKOFFICE" },
        },
        TableMapControl = Sel("MSFlexGridWndClass", 4101),
        TableCellTemplate = "Table {code}",
        PluEntryField = Sel("ThunderRT6TextBox", 4102),
        SaveToTableAction = new Win32ControlSelector { ClassName = "ThunderRT6CommandButton", TextEquals = "Save to Table" },
        TableAssignmentConfirmationControl = Sel("ThunderRT6Label", 4110),
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
    public void MissingSaleScreenWindowCriteria_IsNotReady()
    {
        var s = Full() with { SaleScreenWindow = null };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.SaleScreenWindow), reason);
    }

    [Fact]
    public void SaleScreenCriteriaWithNoDiscriminator_IsNotReady()
    {
        var s = Full() with { SaleScreenWindow = new WindowSelectionCriteria { TitleExcludes = new[] { "BACKOFFICE" } } };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains("discriminator", reason);
    }

    [Fact]
    public void MissingRequiredSelector_IsNotReady()
    {
        var s = Full() with { PluEntryField = null };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.PluEntryField), reason);
    }

    [Fact]
    public void PlaceholderMarkerInsideSelector_IsNotReady()
    {
        var s = Full() with { SaveToTableAction = new Win32ControlSelector { ClassName = "TBD-by-discovery" } };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.SaveToTableAction), reason);
    }

    [Fact]
    public void PositionalOnlySelector_IsNotReady()
    {
        var s = Full() with { TableMapControl = new Win32ControlSelector { Ordinal = 3 } };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains("positional", reason);
    }

    [Fact]
    public void BlankTableCellTemplate_IsNotReady()
    {
        var s = Full() with { TableCellTemplate = "  " };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.TableCellTemplate), reason);
    }

    [Fact]
    public void TableCellTemplateWithoutCodePlaceholder_IsNotReady()
    {
        var s = Full() with { TableCellTemplate = "Table" };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains("{code}", reason);
    }

    /// <summary>
    /// The action layer cannot claim success without being able to verify it,
    /// so a profile with no confirmation control must never be ready.
    /// </summary>
    [Fact]
    public void NoVerificationSelector_IsNotReady()
    {
        var s = Full() with { TableAssignmentConfirmationControl = null };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.TableAssignmentConfirmationControl), reason);
    }

    [Fact]
    public void FullyPopulatedRealSelectors_AreReady()
    {
        Assert.True(TerminalSelectorReadiness.IsReadyForLiveExecution(Full(), out var reason));
        Assert.NotNull(reason);
    }
}
