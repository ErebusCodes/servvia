using VerduraIdealposTracer.Core.Discovery;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Regression for the first live capture: IPSClient owns ~15 top-level
/// windows (empty shells, transient "Overwrite …" dialogs, IME/GDI helpers,
/// and the real "IPS Client - Terminal 1"). Binding the first gave an empty
/// tree; the title hint must pick the real terminal window out of the noise.
/// </summary>
public sealed class WindowSelectionTests
{
    private static TopLevelWindowInfo W(string handle, string? title, int pid = 12800, bool visible = false) => new()
    {
        Handle = handle,
        Title = title,
        ClassName = "WindowsForms10.Window.8.app.0.ea7f4a_r8_ad1",
        Visible = visible,
        ProcessName = "IPSClient",
        ProcessId = pid,
    };

    private static readonly IReadOnlyList<TopLevelWindowInfo> LiveShape = new[]
    {
        W("0x1053E", ""),                       // empty shell (was wrongly chosen before)
        W("0x104E4", "IPS Client - Terminal 1"),// the real terminal window
        W("0x104B0", "Overwrite In Progress"),  // transient dialog
        W("0x4036A", "Hibernate Listener"),
        W("0x104A6", "MSCTFIME UI"),
    };

    [Fact]
    public void TitleHint_SelectsTheRealTerminalWindow_NotAnEmptyShellOrDialog()
    {
        var chosen = WindowSelection.Choose(LiveShape, "IPS Client", primaryPid: 12800);
        Assert.NotNull(chosen);
        Assert.Equal("0x104E4", chosen!.Handle);
        Assert.Equal("IPS Client - Terminal 1", chosen.Title);
    }

    [Fact]
    public void WithoutHint_PrefersATitledWindowOverAnEmptyShell()
    {
        var chosen = WindowSelection.Choose(LiveShape, titleHint: null, primaryPid: 12800);
        Assert.NotNull(chosen);
        Assert.False(string.IsNullOrWhiteSpace(chosen!.Title));
    }

    [Fact]
    public void EmptyList_ReturnsNull()
    {
        Assert.Null(WindowSelection.Choose(System.Array.Empty<TopLevelWindowInfo>(), "IPS Client", 1));
    }
}
