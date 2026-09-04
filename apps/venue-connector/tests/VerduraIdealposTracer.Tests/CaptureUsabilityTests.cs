using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Regression cover for three successive capture gates that each passed a
/// capture carrying nothing a selector could be built from. Every fixture
/// below is a real capture taken on 2026-09-04 against IPS.exe pid 20912.
/// </summary>
public sealed class CaptureUsabilityTests
{
    private static IdealposControlTreeSnapshot Snapshot(
        bool hasRoot = true,
        int clientNodeCount = 1,
        IReadOnlyList<Win32ControlNode>? win32 = null,
        int addressable = 0,
        string title = "POS Screen") => new()
    {
        CapturedAtUtc = DateTimeOffset.UtcNow,
        ProcessName = "IPS",
        ProcessId = 20912,
        RootWindowTitle = title,
        Root = hasRoot
            ? new ControlNodeSnapshot { ControlType = "Window", Name = title, ClassName = "ThunderRT6FormDC" }
            : null,
        ClientNodeCount = clientNodeCount,
        Win32Controls = win32 ?? Array.Empty<Win32ControlNode>(),
        AddressableAccessibleNodes = addressable,
    };

    /// <summary>The exact single node from the 14:19:52 capture.</summary>
    private static Win32ControlNode TheContainer => new()
    {
        Handle = "0x14E13B0",
        ClassName = "ThunderRT6PictureBoxDC",
        Text = "",
        ControlId = 1,
        ClassPath = new[] { "ThunderRT6PictureBoxDC" },
        OrdinalAmongSameClassSiblings = 0,
        Visible = true,
        Enabled = true,
    };

    /// <summary>
    /// The 14:19:52 capture: correct window, one Win32 child, and that child
    /// is the empty container. It must NOT be judged usable.
    /// </summary>
    [Fact]
    public void TheRealContainerOnlyCapture_IsNotUsable()
    {
        var snapshot = Snapshot(clientNodeCount: 1, win32: new[] { TheContainer }, addressable: 0);

        Assert.False(CaptureUsability.IsUsableForSelectorDerivation(snapshot, out var reason));
        Assert.Contains("ThunderRT6PictureBoxDC", reason);
        Assert.Contains("container, not a control", reason);
    }

    /// <summary>The old gate would have passed it — that is the defect being locked out.</summary>
    [Fact]
    public void TheRealContainerOnlyCapture_WouldHavePassedTheOldCountGates()
    {
        var snapshot = Snapshot(clientNodeCount: 1, win32: new[] { TheContainer });

        Assert.True(snapshot.ClientNodeCount > 0);
        Assert.True(snapshot.Win32Controls.Count > 0);
        Assert.False(CaptureUsability.IsUsableForSelectorDerivation(snapshot, out _));
    }

    /// <summary>The 14:10:32 capture: no Win32 enumeration at all.</summary>
    [Fact]
    public void CaptureWithNoWin32ControlsAtAll_IsNotUsable()
    {
        var snapshot = Snapshot(clientNodeCount: 1, win32: Array.Empty<Win32ControlNode>());

        Assert.False(CaptureUsability.IsUsableForSelectorDerivation(snapshot, out var reason));
        Assert.Contains("zero Win32 controls", reason);
    }

    [Fact]
    public void NoRootBound_IsNotUsable()
    {
        Assert.False(CaptureUsability.IsUsableForSelectorDerivation(Snapshot(hasRoot: false), out var reason));
        Assert.Contains("no root window", reason);
    }

    // ---- what SHOULD pass, once the sale controls are actually observed ----

    /// <summary>
    /// Windowless VB6 controls surface only through MSAA, so an addressable
    /// accessible node is sufficient even with a single container HWND.
    /// </summary>
    [Fact]
    public void AddressableAccessibleNodes_MakeACaptureUsable()
    {
        var snapshot = Snapshot(win32: new[] { TheContainer }, addressable: 42);

        Assert.True(CaptureUsability.IsUsableForSelectorDerivation(snapshot, out var reason));
        Assert.Contains("42", reason);
    }

    [Fact]
    public void CaptionedWin32Control_MakesACaptureUsable()
    {
        var save = TheContainer with { Handle = "0x2", ClassName = "ThunderRT6CommandButton", Text = "Save to Table" };
        var snapshot = Snapshot(win32: new[] { save });

        Assert.True(CaptureUsability.IsUsableForSelectorDerivation(snapshot, out var reason));
        Assert.Contains("caption", reason);
    }

    /// <summary>Real structure, even uncaptioned, is not the degenerate container case.</summary>
    [Fact]
    public void TwoOrMoreWin32Children_MakeACaptureUsable()
    {
        var grid = TheContainer with { Handle = "0x2", ClassName = "MSFlexGridWndClass", ControlId = 7 };
        var snapshot = Snapshot(win32: new[] { TheContainer, grid });

        Assert.True(CaptureUsability.IsUsableForSelectorDerivation(snapshot, out var reason));
        Assert.Contains("structure", reason);
    }

    // ---- the addressability rule itself ------------------------------------

    [Fact]
    public void AccessibleNode_WithNoNameOrValue_IsNotAddressable()
    {
        var node = new MsaaAccessibleNode { Name = null, Value = null, Width = 100, Height = 40 };
        Assert.False(node.IsAddressable);
    }

    [Fact]
    public void AccessibleNode_WithZeroArea_IsNotAddressable()
    {
        var node = new MsaaAccessibleNode { Name = "Table 12", Width = 0, Height = 0 };
        Assert.False(node.IsAddressable);
    }

    [Fact]
    public void AccessibleNode_MarkedInvisible_IsNotAddressable()
    {
        var node = new MsaaAccessibleNode
        {
            Name = "Table 12", Width = 100, Height = 40, StateText = new[] { "invisible" },
        };
        Assert.False(node.IsAddressable);
    }

    /// <summary>A named, sized, visible windowless child is exactly what we are looking for.</summary>
    [Fact]
    public void NamedVisibleSizedNode_IsAddressable()
    {
        var node = new MsaaAccessibleNode
        {
            ChildId = 12, Name = "Table 12", RoleText = "push button",
            Width = 100, Height = 40, StateText = new[] { "focusable" },
        };

        Assert.True(node.IsAddressable);
        Assert.NotEqual(0, node.ChildId);
    }
}
