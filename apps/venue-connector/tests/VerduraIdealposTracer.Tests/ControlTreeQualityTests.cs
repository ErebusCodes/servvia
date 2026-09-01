using VerduraIdealposTracer.Core.Discovery;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Regression cover for the second live Session-1 capture, which bound the
/// correct window ("IPS Client - Terminal 1", hwnd 0x104E4) and still
/// produced nothing usable: seven nodes of pure window chrome. The old
/// <c>NodeCount &gt; 1</c> success test accepted that tree, marked the
/// mechanism UiaFromHandle, skipped the Win32/MSAA fallbacks, and exited 0 —
/// a failed capture reported as a passing run. These tests pin the rule that
/// replaced it.
/// </summary>
public sealed class ControlTreeQualityTests
{
    private static ControlNodeSnapshot Node(
        string controlType, string? automationId = null, string? name = null, int depth = 0,
        params ControlNodeSnapshot[] children) =>
        new()
        {
            ControlType = controlType,
            AutomationId = automationId,
            Name = name,
            IsEnabled = true,
            Depth = depth,
            Children = children,
        };

    /// <summary>
    /// The EXACT shape of the 2026-09-01T13:03:04Z live capture — seven
    /// nodes, every one of them non-client furniture.
    /// </summary>
    private static ControlNodeSnapshot LiveChromeOnlyCapture() =>
        Node("Window", "MainForm", "IPS Client - Terminal 1", 0,
            Node("TitleBar", "TitleBar", "IPS Client - Terminal 1", 1,
                Node("MenuBar", "MainForm", "System Menu Bar", 2,
                    Node("MenuItem", "Item 1", "System", 3)),
                Node("Button", "Minimize", "Minimize", 2),
                Node("Button", "Maximize", "Maximize", 2),
                Node("Button", "Close", "Close", 2)));

    [Fact]
    public void TheLiveSevenNodeChromeCapture_IsChromeOnly_AndHasZeroClientNodes()
    {
        var root = LiveChromeOnlyCapture();

        Assert.True(ControlTreeQuality.IsChromeOnly(root));
        Assert.Equal(0, ControlTreeQuality.CountClientNodes(root));
    }

    [Fact]
    public void ANodeCountAboveOne_DoesNotMakeACaptureUsable()
    {
        // The precise regression: the old gate was `NodeCount > 1`, and this
        // tree has seven. Node count and usability are independent facts.
        var root = LiveChromeOnlyCapture();
        var totalNodes = 1 + CountAll(root);

        Assert.Equal(7, totalNodes);
        Assert.True(totalNodes > 1);
        Assert.True(ControlTreeQuality.IsChromeOnly(root));
    }

    [Fact]
    public void APopulatedSaleScreen_IsNotChromeOnly_EvenWithTheSameTitleBar()
    {
        // Same chrome, plus the client content a real sale screen exposes.
        var root = Node("Window", "MainForm", "IPS Client - Terminal 1", 0,
            Node("TitleBar", "TitleBar", "IPS Client - Terminal 1", 1,
                Node("Button", "Close", "Close", 2)),
            Node("Pane", "TableMap", "Table Map", 1,
                Node("Button", "table_5", "Table 5", 2)),
            Node("Edit", "PluEntry", "PLU", 1));

        // TableMap pane + its Table 5 button + the PLU edit = 3; the
        // TitleBar subtree and the root window itself are excluded.
        Assert.False(ControlTreeQuality.IsChromeOnly(root));
        Assert.Equal(3, ControlTreeQuality.CountClientNodes(root));
    }

    [Fact]
    public void AWindowWithNoChildrenAtAll_IsChromeOnly()
    {
        Assert.True(ControlTreeQuality.IsChromeOnly(Node("Window", "MainForm", "IPS Client - Terminal 1")));
    }

    [Fact]
    public void ANullRoot_IsNotReportedAsChromeOnly_AndCountsZero()
    {
        // A null root is "no capture at all", a distinct outcome from
        // "a capture that reached only chrome" — callers must not conflate
        // them, so IsChromeOnly stays false here.
        Assert.False(ControlTreeQuality.IsChromeOnly(null));
        Assert.Equal(0, ControlTreeQuality.CountClientNodes(null));
    }

    [Fact]
    public void MultipleTitleBarSubtrees_AreAllExcluded()
    {
        var root = Node("Window", "MainForm", null, 0,
            Node("TitleBar", null, null, 1, Node("Button", "Close", "Close", 2)),
            Node("TitleBar", null, null, 1, Node("Button", "Help", "Help", 2)));

        Assert.True(ControlTreeQuality.IsChromeOnly(root));
    }

    [Fact]
    public void ClientContentNestedDeeply_IsStillCounted()
    {
        var root = Node("Window", "MainForm", null, 0,
            Node("Pane", "Outer", null, 1,
                Node("Pane", "Inner", null, 2,
                    Node("Button", "table_5", "Table 5", 3))));

        Assert.False(ControlTreeQuality.IsChromeOnly(root));
        Assert.Equal(3, ControlTreeQuality.CountClientNodes(root));
    }

    [Fact]
    public void ChromeOnlyDiagnostic_TellsTheOperatorWhatToChange()
    {
        var message = ControlTreeQuality.ChromeOnlyDiagnostic("UIA FromHandle", 7);

        Assert.Contains("7 node(s)", message);
        Assert.Contains("ZERO client-area content", message);
        Assert.Contains("FAILED capture", message);
    }

    [Fact]
    public void ASnapshotWithAChromeOnlyRoot_HasARootButNoClientContent()
    {
        // HasRoot and HasClientContent must disagree here — that disagreement
        // is exactly what the live capture needed and did not have.
        var snapshot = new IdealposControlTreeSnapshot
        {
            CapturedAtUtc = DateTimeOffset.UtcNow,
            Root = LiveChromeOnlyCapture(),
            NodeCount = 7,
            ClientNodeCount = 0,
            Mechanism = CaptureMechanism.None,
        };

        Assert.True(snapshot.HasRoot);
        Assert.False(snapshot.HasClientContent);
    }

    private static int CountAll(ControlNodeSnapshot node)
    {
        var count = 0;
        foreach (var child in node.Children) count += 1 + CountAll(child);
        return count;
    }
}
