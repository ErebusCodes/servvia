using System.Reflection;
using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The Win32 selector model that replaced the five-AutomationId model on
/// 2026-09-04, after a Session-1 capture of IPS.exe walked 57 nodes and found
/// zero non-empty AutomationIds.
/// </summary>
public sealed class Win32SelectorModelTests
{
    private static Win32ControlNode Node(
        string handle, string className, string? text = null, int controlId = 0,
        int ordinal = 0, bool visible = true, bool enabled = true, params string[] path) => new()
    {
        Handle = handle,
        ClassName = className,
        Text = text,
        ControlId = controlId,
        OrdinalAmongSameClassSiblings = ordinal,
        Visible = visible,
        Enabled = enabled,
        ClassPath = path.Length == 0 ? new[] { className } : path,
    };

    // ---- the model must not let an HWND become a persisted selector -------

    /// <summary>
    /// An HWND is re-issued by the window manager on every form load, so a
    /// persisted selector that pinned one would silently bind the wrong
    /// control after a restart. The guarantee here is structural: the
    /// selector type has nowhere to put a handle.
    /// </summary>
    [Fact]
    public void Selector_HasNoHandleMember_SoAnHwndCannotBePersisted()
    {
        var offenders = typeof(Win32ControlSelector)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .Where(n => n.Contains("Handle", StringComparison.OrdinalIgnoreCase)
                        || n.Contains("Hwnd", StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.Empty(offenders);
    }

    [Fact]
    public void ObservedNode_DoesCarryARuntimeHandle()
    {
        // The observation side is where identity legitimately lives.
        Assert.NotNull(typeof(Win32ControlNode).GetProperty(nameof(Win32ControlNode.Handle)));
    }

    // ---- validation -------------------------------------------------------

    [Fact]
    public void EmptySelector_IsInvalid()
    {
        Assert.False(Win32SelectorValidation.IsValid(new Win32ControlSelector(), out var reason));
        Assert.Contains("no discriminator", reason);
    }

    [Fact]
    public void OrdinalOnlySelector_IsInvalid_BecauseItIsPositional()
    {
        Assert.False(Win32SelectorValidation.IsValid(new Win32ControlSelector { Ordinal = 2 }, out var reason));
        Assert.Contains("positional", reason);
    }

    [Fact]
    public void ClassPathOnlySelector_IsInvalid_BecauseItIsPositional()
    {
        var s = new Win32ControlSelector { ClassPath = new[] { "ThunderRT6FormDC", "ThunderRT6TextBox" } };
        Assert.False(Win32SelectorValidation.IsValid(s, out var reason));
        Assert.Contains("positional", reason);
    }

    [Fact]
    public void PlaceholderClassName_IsInvalid()
    {
        Assert.False(Win32SelectorValidation.IsValid(new Win32ControlSelector { ClassName = "TBD" }, out _));
    }

    [Theory]
    [InlineData("ThunderRT6TextBox", null, null)]
    [InlineData(null, 4102, null)]
    [InlineData(null, null, "Save to Table")]
    public void AnyStableDiscriminator_IsValid(string? className, int? controlId, string? text)
    {
        var s = new Win32ControlSelector { ClassName = className, ControlId = controlId, TextEquals = text };
        Assert.True(Win32SelectorValidation.IsValid(s, out var reason), reason);
    }

    // ---- resolution: exactly one, or refuse -------------------------------

    [Fact]
    public void ExactlyOneMatch_Resolves()
    {
        var nodes = new[]
        {
            Node("0x1", "ThunderRT6TextBox", controlId: 4102),
            Node("0x2", "ThunderRT6CommandButton", text: "Save to Table"),
        };

        var result = Win32ControlResolver.Resolve(nodes, new Win32ControlSelector { ClassName = "ThunderRT6TextBox" });

        Assert.True(result.IsResolved);
        Assert.Equal("0x1", result.Node!.Handle);
    }

    [Fact]
    public void NoMatch_FailsClosedAsNotFound()
    {
        var nodes = new[] { Node("0x1", "ThunderRT6TextBox") };
        var result = Win32ControlResolver.Resolve(nodes, new Win32ControlSelector { ClassName = "MSFlexGridWndClass" });

        Assert.Equal(Win32ResolutionStatus.NotFound, result.Status);
        Assert.Null(result.Node);
    }

    [Fact]
    public void MultipleMatches_FailClosedAsAmbiguous_RatherThanTakingTheFirst()
    {
        var nodes = new[]
        {
            Node("0x1", "ThunderRT6TextBox", ordinal: 0),
            Node("0x2", "ThunderRT6TextBox", ordinal: 1),
        };

        var result = Win32ControlResolver.Resolve(nodes, new Win32ControlSelector { ClassName = "ThunderRT6TextBox" });

        Assert.Equal(Win32ResolutionStatus.Ambiguous, result.Status);
        Assert.Null(result.Node);
    }

    [Fact]
    public void Ordinal_MayNarrowAnAmbiguousSet_ButOnlyAsATieBreak()
    {
        var nodes = new[]
        {
            Node("0x1", "ThunderRT6TextBox", ordinal: 0),
            Node("0x2", "ThunderRT6TextBox", ordinal: 1),
        };

        var result = Win32ControlResolver.Resolve(
            nodes, new Win32ControlSelector { ClassName = "ThunderRT6TextBox", Ordinal = 1 });

        Assert.True(result.IsResolved);
        Assert.Equal("0x2", result.Node!.Handle);
    }

    [Fact]
    public void InvalidSelector_IsRefusedBeforeAnyMatching()
    {
        var nodes = new[] { Node("0x1", "ThunderRT6TextBox") };
        var result = Win32ControlResolver.Resolve(nodes, new Win32ControlSelector { Ordinal = 0 });

        Assert.Equal(Win32ResolutionStatus.InvalidSelector, result.Status);
    }

    [Fact]
    public void InvisibleOrDisabledControls_AreNotMatchedByDefault()
    {
        var nodes = new[]
        {
            Node("0x1", "ThunderRT6CommandButton", text: "Save to Table", visible: false),
            Node("0x2", "ThunderRT6CommandButton", text: "Save to Table", enabled: false),
        };

        var result = Win32ControlResolver.Resolve(
            nodes, new Win32ControlSelector { ClassName = "ThunderRT6CommandButton" });

        Assert.Equal(Win32ResolutionStatus.NotFound, result.Status);
    }

    [Fact]
    public void ClassPath_MatchesAsASuffix_SoASelectorNeedNotRestateTheWholeTree()
    {
        var nodes = new[]
        {
            Node("0x1", "ThunderRT6TextBox", controlId: 1, path: new[] { "ThunderRT6FormDC", "ThunderRT6Frame", "ThunderRT6TextBox" }),
            Node("0x2", "ThunderRT6TextBox", controlId: 2, path: new[] { "ThunderRT6FormDC", "ThunderRT6PictureBox", "ThunderRT6TextBox" }),
        };

        var result = Win32ControlResolver.Resolve(nodes, new Win32ControlSelector
        {
            ClassName = "ThunderRT6TextBox",
            ClassPath = new[] { "ThunderRT6Frame", "ThunderRT6TextBox" },
        });

        Assert.True(result.IsResolved);
        Assert.Equal("0x1", result.Node!.Handle);
    }
}
