using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// UNIT_OR_MOCK evidence for the passive control-tree capture: shape,
/// menu capture, and — most importantly — that accessible names are
/// sanitized before they are ever stored. Fake-backed; no real IPS.
/// </summary>
public sealed class ControlTreeCaptureTests
{
    private static IEnumerable<ControlNodeSnapshot> Flatten(ControlNodeSnapshot? node)
    {
        if (node is null) yield break;
        yield return node;
        foreach (var child in node.Children)
            foreach (var n in Flatten(child))
                yield return n;
    }

    [Fact]
    public async Task FakeCapture_ExposesSelectorRelevantMetadata()
    {
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath);
        var snapshot = await ui.CaptureControlTreeAsync(ControlTreeCaptureOptions.Default, CancellationToken.None);

        Assert.True(snapshot.HasRoot);
        var all = Flatten(snapshot.Root).ToList();
        Assert.Contains(all, n => n.AutomationId == "table_5" && n.ControlType == "Button");
        Assert.Contains(all, n => n.AutomationId == "pluEntry" && n.ControlType == "Edit");
        Assert.Contains(all, n => n.AutomationId == "saveToTable");
        // Win32 class metadata is captured too.
        Assert.Contains(all, n => n.ClassName == "ThunderRT6CommandButton");
        Assert.Equal(all.Count, snapshot.NodeCount);
    }

    [Fact]
    public async Task FakeCapture_CapturesMenuMetadata()
    {
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath);
        var snapshot = await ui.CaptureControlTreeAsync(ControlTreeCaptureOptions.Default, CancellationToken.None);

        Assert.Contains("Functions", snapshot.MenuItems);
        Assert.NotEmpty(snapshot.MenuItems);
    }

    [Fact]
    public async Task FakeCapture_SanitizesSensitiveNames()
    {
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath);
        var snapshot = await ui.CaptureControlTreeAsync(ControlTreeCaptureOptions.Default, CancellationToken.None);

        var all = Flatten(snapshot.Root).ToList();
        // The seeded card-like number must never survive into the snapshot.
        Assert.DoesNotContain(all, n => n.Name is not null && n.Name.Contains("1234567890123456"));
        Assert.Contains(all, n => n.Name is not null && n.Name.Contains("[REDACTED-DIGITS]"));
        Assert.Contains(snapshot.MenuItems, m => m.Contains("[REDACTED-DIGITS]"));
    }

    [Fact]
    public async Task FakeCapture_WhenIpsNotRunning_IsFailClosedEmpty()
    {
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.IdealposNotRunning);
        var snapshot = await ui.CaptureControlTreeAsync(ControlTreeCaptureOptions.Default, CancellationToken.None);

        Assert.False(snapshot.HasRoot);
        Assert.Equal(0, snapshot.NodeCount);
        Assert.NotEmpty(snapshot.Diagnostics);
    }

    [Theory]
    [InlineData("Chicken Ballista Pizza", "Chicken Ballista Pizza")]
    [InlineData("Table 5", "Table 5")]
    [InlineData("Card 4111111111111111", "Card [REDACTED-DIGITS]")]
    [InlineData("Total $23.00", "Total [REDACTED-AMOUNT]")]
    [InlineData("cust jane@example.com", "cust [REDACTED-EMAIL]")]
    public void Sanitizer_RedactsSensitive_KeepsBenign(string input, string expected)
    {
        Assert.Equal(expected, ControlTreeSanitizer.Sanitize(input));
    }

    [Fact]
    public void Sanitizer_NullPassesThrough()
    {
        Assert.Null(ControlTreeSanitizer.Sanitize(null));
    }

    [Fact]
    public void CaptureOptions_HaveBoundedDefaults()
    {
        var o = ControlTreeCaptureOptions.Default;
        Assert.True(o.MaxDepth > 0 && o.MaxDepth <= 64);
        Assert.True(o.MaxNodes > 0);
        Assert.True(o.TimeoutMs > 0);
    }

    [Fact]
    public async Task FakeCapture_ReportsMechanism_SessionDiagnostics_AndTopLevelWindows()
    {
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath);
        var s = await ui.CaptureControlTreeAsync(ControlTreeCaptureOptions.Default, CancellationToken.None);

        Assert.Equal(CaptureMechanism.UiaFromHandle, s.Mechanism);
        Assert.False(s.SessionMismatch);
        Assert.Equal(s.TracerSessionId, s.TargetSessionId);
        Assert.NotEmpty(s.TopLevelWindows);
        Assert.Contains(s.TopLevelWindows, w => w.ClassName == "ThunderRT6FormDC" && w.Visible);
    }
}
