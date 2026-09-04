namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// Decides whether a capture can actually populate a selector profile.
///
/// Three gates have now each been shown insufficient on this application, in
/// order:
/// <list type="number">
/// <item><c>NodeCount &gt; 1</c> — passed a chrome-only tree (7 nodes of
/// title bar and min/max/close).</item>
/// <item><c>ClientNodeCount &gt; 0</c> — passed the 14:10:32 POS Screen
/// capture, whose single "client" node was an empty
/// <c>ThunderRT6PictureBoxDC</c> container.</item>
/// <item><c>Win32Controls.Count &gt; 0</c> — passed the 14:19:52 capture,
/// whose single Win32 control was that same container (control id 1, blank
/// caption, no children).</item>
/// </list>
///
/// Each replacement was defeated by the same thing: a container is
/// structurally indistinguishable from content when you only count nodes. So
/// this gate asks whether anything ADDRESSABLE was seen — something a driver
/// could actually name and act on — rather than whether the tree was
/// non-empty.
/// </summary>
public static class CaptureUsability
{
    /// <summary>
    /// True when the capture contains at least one control a selector could
    /// realistically bind to.
    ///
    /// Deliberately generous about *what* counts, because the sale controls
    /// have not yet been observed and over-narrow rules would reject the very
    /// capture we are waiting for. It is strict about the one case actually
    /// proven degenerate: a lone, blank, childless container.
    /// </summary>
    public static bool IsUsableForSelectorDerivation(IdealposControlTreeSnapshot snapshot, out string reason)
    {
        if (snapshot is null)
        {
            reason = "no snapshot";
            return false;
        }

        if (!snapshot.HasRoot)
        {
            reason = "no root window was bound";
            return false;
        }

        var addressable = snapshot.AddressableAccessibleNodes;
        var captionedWin32 = snapshot.Win32Controls.Count(c => !string.IsNullOrWhiteSpace(c.Text));
        var win32Count = snapshot.Win32Controls.Count;

        if (addressable > 0)
        {
            reason = $"{addressable} addressable accessible node(s) observed";
            return true;
        }

        if (captionedWin32 > 0)
        {
            reason = $"{captionedWin32} Win32 control(s) carry a caption";
            return true;
        }

        // Two or more child HWNDs is real structure rather than a bare
        // container, even if none of them happens to carry a caption.
        if (win32Count >= 2)
        {
            reason = $"{win32Count} Win32 child controls form a real structure";
            return true;
        }

        reason = win32Count == 1
            ? $"the ONLY Win32 control is '{snapshot.Win32Controls[0].ClassName}' "
              + $"(id {snapshot.Win32Controls[0].ControlId}, blank caption, no children) — a container, not a control — "
              + "and zero accessible nodes are addressable"
            : $"zero Win32 controls and zero addressable accessible nodes were found under "
              + $"'{snapshot.RootWindowTitle}'";
        return false;
    }
}
