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
/// Re-expressed for the workflow-shaped selector model on 2026-09-05. The
/// gate was TIGHTENED, not relaxed: it now also requires a Table Map window,
/// a Table Details window, a quantity control, a staged-line read-back
/// control, and a non-empty set of destructive controls to distinguish from
/// table cells.
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
        TableMapWindow = new WindowSelectionCriteria
        {
            TitleEquals = "Table Map",
            PreferredClassNames = new[] { "ThunderRT6FormDC" },
        },
        TableDetailsWindow = new WindowSelectionCriteria
        {
            TitleContains = "Table Details",
            PreferredClassNames = new[] { "ThunderRT6FormDC" },
        },
        TableCellTemplate = "Table {code}",
        TableCellControl = Sel("ThunderRT6CommandButton", 4101),
        PluEntryField = Sel("ThunderRT6TextBox", 4102),
        QuantityEntryField = Sel("ThunderRT6TextBox", 4103),
        StagedLinesControl = Sel("TrueOleDBGrid80.TDBGrid", 4104),
        TableMapCommand = new Win32ControlSelector { ClassName = "ThunderRT6CommandButton", TextEquals = "TABLE MAP" },
        DestructiveControls = new[]
        {
            new Win32ControlSelector { ClassName = "ThunderRT6CommandButton", TextEquals = "Pay" },
            new Win32ControlSelector { ClassName = "ThunderRT6CommandButton", TextEquals = "Finished" },
            new Win32ControlSelector { ClassName = "ThunderRT6CommandButton", TextEquals = "Transfer" },
        },
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

    /// <summary>
    /// The deployed connector profile carries ProfileVersion
    /// "DUNEDIN-CLOUD-MODE-UNUSED". It must be refused too.
    /// </summary>
    [Fact]
    public void UnusedMarkerInProfileVersion_IsNotReady()
    {
        var s = Full(version: "DUNEDIN-CLOUD-MODE-UNUSED");
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

    /// <summary>
    /// The Table Map is a separate top-level window (VB6 frmTables). A
    /// profile that only knows the sale screen cannot reach the send
    /// boundary, so it must not be ready.
    /// </summary>
    [Fact]
    public void MissingTableMapWindowCriteria_IsNotReady()
    {
        var s = Full() with { TableMapWindow = null };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.TableMapWindow), reason);
    }

    [Fact]
    public void MissingTableDetailsWindowCriteria_IsNotReady()
    {
        var s = Full() with { TableDetailsWindow = null };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.TableDetailsWindow), reason);
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
    public void MissingQuantityField_IsNotReady()
    {
        var s = Full() with { QuantityEntryField = null };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.QuantityEntryField), reason);
    }

    /// <summary>
    /// Without a staged-line read-back the driver cannot verify the item it
    /// entered before committing it — directive §7D.
    /// </summary>
    [Fact]
    public void MissingStagedLinesControl_IsNotReady()
    {
        var s = Full() with { StagedLinesControl = null };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.StagedLinesControl), reason);
    }

    [Fact]
    public void MissingTableMapCommand_IsNotReady()
    {
        var s = Full() with { TableMapCommand = null };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.TableMapCommand), reason);
    }

    [Fact]
    public void PlaceholderMarkerInsideSelector_IsNotReady()
    {
        var s = Full() with { TableMapCommand = new Win32ControlSelector { ClassName = "TBD-by-discovery" } };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.TableMapCommand), reason);
    }

    [Fact]
    public void PositionalOnlySelector_IsNotReady()
    {
        var s = Full() with { TableCellControl = new Win32ControlSelector { Ordinal = 3 } };
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
    /// The Table Map carries Pay/Finished/Transfer beside the table cells. A
    /// driver that cannot name them cannot prove the control it resolved is a
    /// table, so an empty destructive-control list must never be ready.
    /// </summary>
    [Fact]
    public void NoDestructiveControlsDeclared_IsNotReady()
    {
        var s = Full() with { DestructiveControls = Array.Empty<Win32ControlSelector>() };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.DestructiveControls), reason);
    }

    [Fact]
    public void InvalidDestructiveControlEntry_IsNotReady()
    {
        var s = Full() with
        {
            DestructiveControls = new[] { new Win32ControlSelector { Ordinal = 2 } },
        };
        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(s, out var reason));
        Assert.Contains(nameof(TerminalUiSelectors.DestructiveControls), reason);
    }

    [Fact]
    public void FullyPopulatedRealSelectors_AreReady()
    {
        Assert.True(TerminalSelectorReadiness.IsReadyForLiveExecution(Full(), out var reason));
        Assert.NotNull(reason);
    }
}
