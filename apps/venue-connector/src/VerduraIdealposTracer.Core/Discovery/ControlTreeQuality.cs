namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// Pure, testable judgement of whether a captured tree actually contains
/// CLIENT-AREA content, or only the window's non-client chrome.
///
/// The second live capture proved why raw node count is the wrong test.
/// Binding "IPS Client - Terminal 1" (hwnd 0x104E4) returned seven nodes —
/// enough for the old <c>NodeCount &gt; 1</c> check to declare UIA a success
/// and skip the Win32/MSAA fallbacks entirely — but all seven were window
/// furniture:
///
///   Window "MainForm"
///     └─ TitleBar
///          ├─ MenuBar "System Menu Bar" └─ MenuItem "System"
///          ├─ Button "Minimize"  ├─ Button "Maximize"  └─ Button "Close"
///
/// Not one table cell, PLU field, or Save action — nothing a selector could
/// ever be derived from. A capture like that is a FAILED capture that
/// reported success, which is the one outcome a discovery tool must never
/// produce: it would have let the operator believe the sale screen had been
/// walked when it had not.
///
/// The rule below is structural, not a node-count heuristic. Win32/WinForms
/// UIA always exposes non-client furniture as a <c>TitleBar</c> child of the
/// window element, so "every child of the root is a TitleBar" means the
/// client area yielded nothing — regardless of how many buttons that
/// TitleBar happens to contain.
/// </summary>
public static class ControlTreeQuality
{
    /// <summary>The UIA control type of the non-client title bar subtree.</summary>
    private const string TitleBarControlType = "TitleBar";

    /// <summary>
    /// Counts nodes that represent real client-area content — every node in
    /// the tree except the root window element itself and everything inside
    /// its non-client TitleBar subtree(s).
    /// </summary>
    public static int CountClientNodes(ControlNodeSnapshot? root)
    {
        if (root is null) return 0;

        var count = 0;
        foreach (var child in root.Children)
        {
            if (IsTitleBar(child)) continue;
            count += 1 + CountDescendants(child);
        }
        return count;
    }

    /// <summary>
    /// True when a tree WAS obtained but carries no client-area content —
    /// i.e. the walk reached the window frame and stopped. Callers must
    /// treat this as "this mechanism failed, try the next one", never as a
    /// successful capture.
    /// </summary>
    public static bool IsChromeOnly(ControlNodeSnapshot? root) =>
        root is not null && CountClientNodes(root) == 0;

    /// <summary>
    /// A human-readable reason for a chrome-only result, for the snapshot's
    /// own Diagnostics list. The operator must be told what to change, not
    /// merely that the node count was low.
    /// </summary>
    public static string ChromeOnlyDiagnostic(string mechanism, int nodeCount) =>
        $"{mechanism} returned {nodeCount} node(s) but ZERO client-area content — only window chrome "
        + "(TitleBar / System menu / Minimize / Maximize / Close). The window frame exists, its client "
        + "area is not rendered. This is a FAILED capture, not a sale screen: no selector can be derived "
        + "from it. Bring the terminal to a visible, logged-in sale/table screen and re-run.";

    private static bool IsTitleBar(ControlNodeSnapshot node) =>
        string.Equals(node.ControlType, TitleBarControlType, StringComparison.OrdinalIgnoreCase);

    private static int CountDescendants(ControlNodeSnapshot node)
    {
        var count = 0;
        foreach (var child in node.Children)
        {
            count += 1 + CountDescendants(child);
        }
        return count;
    }
}
