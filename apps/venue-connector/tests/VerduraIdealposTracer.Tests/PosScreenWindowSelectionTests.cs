using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Regression cover for the 2026-09-04 13:07:59 Session-1 capture, which was
/// genuine and correctly executed but bound the wrong window.
///
/// Both windows below are the real ones that capture enumerated from IPS.exe
/// pid 20912. The back-office MDI frame's title CONTAINS the profile hint
/// "Idealpos"; the sale window's title "POS Screen" does not. A title-hint
/// rule therefore selects exactly the wrong window every time — deterministically,
/// and through no fault of the operator or of IdealPOS.
/// </summary>
public sealed class PosScreenWindowSelectionTests
{
    private const int Pid = 20912;

    private static TopLevelWindowInfo BackOffice => new()
    {
        Handle = "0x1D077E",
        Title = "Idealpos v7.1 Build 33    Sila Restaurant    DUNEDIN - BACKOFFICE(1)",
        ClassName = "ThunderRT6MDIForm",
        Visible = false,
        ProcessName = "IPS",
        ProcessId = Pid,
    };

    private static TopLevelWindowInfo PosScreen => new()
    {
        Handle = "0x1405F6",
        Title = "POS Screen",
        ClassName = "ThunderRT6FormDC",
        Visible = true,
        ProcessName = "IPS",
        ProcessId = Pid,
    };

    private static IReadOnlyList<TopLevelWindowInfo> RealWindows => new[] { BackOffice, PosScreen };

    /// <summary>Documents the defect: the old rule really does pick the back office.</summary>
    [Fact]
    public void BareTitleHint_SelectsTheBackOffice_WhichIsTheBug()
    {
        var chosen = WindowSelection.Choose(RealWindows, "Idealpos", Pid);

        Assert.NotNull(chosen);
        Assert.Equal("0x1D077E", chosen!.Handle);
        Assert.Contains("BACKOFFICE", chosen.Title);
    }

    [Fact]
    public void ExactTitle_SelectsThePosScreen()
    {
        var result = WindowSelection.Select(
            RealWindows, new WindowSelectionCriteria { TitleEquals = "POS Screen" }, Pid);

        Assert.True(result.IsSelected, result.Reason);
        Assert.Equal("0x1405F6", result.Window!.Handle);
    }

    /// <summary>
    /// The decisive case: even when the weaker "Idealpos" hint is still
    /// present — as it is in the real profile — the exact title must win.
    /// </summary>
    [Fact]
    public void ExactTitle_OutranksTheContainsHintThatMatchesTheBackOffice()
    {
        var result = WindowSelection.Select(RealWindows, new WindowSelectionCriteria
        {
            TitleEquals = "POS Screen",
            TitleContains = "Idealpos",
        }, Pid);

        Assert.True(result.IsSelected, result.Reason);
        Assert.Equal("POS Screen", result.Window!.Title);
    }

    [Fact]
    public void TitleExclusion_DisqualifiesTheBackOfficeOutright()
    {
        var result = WindowSelection.Select(RealWindows, new WindowSelectionCriteria
        {
            TitleContains = "Idealpos",
            TitleExcludes = new[] { "BACKOFFICE" },
        }, Pid);

        Assert.False(result.IsSelected);
        Assert.Equal(WindowSelectionStatus.NoCandidate, result.Status);
    }

    [Fact]
    public void ClassPreference_SelectsTheSaleFormOverTheMdiFrame()
    {
        var result = WindowSelection.Select(RealWindows, new WindowSelectionCriteria
        {
            PreferredClassNames = new[] { "ThunderRT6FormDC" },
            ExcludedClassNames = new[] { "ThunderRT6MDIForm" },
        }, Pid);

        Assert.True(result.IsSelected, result.Reason);
        Assert.Equal("ThunderRT6FormDC", result.Window!.ClassName);
    }

    /// <summary>
    /// Acting on an invisible window is what produced a chrome-only tree with
    /// zero client content in the failed capture.
    /// </summary>
    [Fact]
    public void RequireVisible_RejectsTheInvisibleBackOfficeFrame()
    {
        var result = WindowSelection.Select(new[] { BackOffice }, new WindowSelectionCriteria
        {
            TitleContains = "Idealpos",
            RequireVisible = true,
        }, Pid);

        Assert.Equal(WindowSelectionStatus.NoCandidate, result.Status);
    }

    [Fact]
    public void TwoEquallyGoodCandidates_FailClosedAsAmbiguous()
    {
        var twin = PosScreen with { Handle = "0x999999" };
        var result = WindowSelection.Select(
            new[] { PosScreen, twin }, new WindowSelectionCriteria { TitleEquals = "POS Screen" }, Pid);

        Assert.Equal(WindowSelectionStatus.Ambiguous, result.Status);
        Assert.Null(result.Window);
    }

    [Fact]
    public void NothingMatches_FailsClosedRatherThanFallingBack()
    {
        var result = WindowSelection.Select(
            RealWindows, new WindowSelectionCriteria { TitleEquals = "Nonexistent Window" }, Pid);

        Assert.Equal(WindowSelectionStatus.NoCandidate, result.Status);
        Assert.Null(result.Window);
    }

    /// <summary>
    /// The lenient capture path keeps its best-effort fallback — a read-only
    /// capture of *something* is still evidence — but must never bind a window
    /// the profile explicitly disqualified.
    /// </summary>
    [Fact]
    public void LenientChoose_StillHonoursExclusions()
    {
        var chosen = WindowSelection.Choose(RealWindows, new WindowSelectionCriteria
        {
            TitleContains = "Idealpos",
            TitleExcludes = new[] { "BACKOFFICE" },
        }, Pid);

        Assert.NotNull(chosen);
        Assert.Equal("POS Screen", chosen!.Title);
    }

    // ---- the profile is what feeds these criteria -------------------------

    [Fact]
    public void ProfileProjectsItsWindowRulesIntoCriteria()
    {
        var profile = new IdealposVerifiedProfile("IPS", "Idealpos", "verified-2026-09-04")
        {
            SaleScreenWindowTitleEquals = "POS Screen",
            SaleScreenWindowTitleExcludes = new[] { "BACKOFFICE" },
            SaleScreenWindowPreferredClassNames = new[] { "ThunderRT6FormDC" },
            SaleScreenWindowExcludedClassNames = new[] { "ThunderRT6MDIForm" },
        };

        var result = WindowSelection.Select(RealWindows, profile.BuildSaleScreenCriteria(), Pid);

        Assert.True(result.IsSelected, result.Reason);
        Assert.Equal("POS Screen", result.Window!.Title);
    }

    /// <summary>
    /// Program.cs used to build WindowsAutomationSettings with two arguments,
    /// discarding the profile's own ProfileVersion and every selector — which
    /// made readiness unreachable by configuration.
    /// </summary>
    [Fact]
    public void ProfileVersionIsThreadedIntoTheSelectors_NotDiscarded()
    {
        var profile = new IdealposVerifiedProfile("IPS", "Idealpos", "verified-2026-09-04");

        Assert.Equal("verified-2026-09-04", profile.BuildTerminalSelectors().ProfileVersion);
    }
}
