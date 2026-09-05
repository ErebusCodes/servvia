using System.Runtime.InteropServices;
using System.Text;
using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Windows;

/// <summary>
/// LAYER A — DISCOVERY. Read-only. Walks a bound window's child controls into
/// the platform-agnostic <see cref="Win32ControlNode"/> shape so the pure
/// resolver in Core can match selectors against it.
///
/// Nothing in this class sends input, posts a message, sets text, clicks, or
/// foregrounds a window.
///
/// As of 2026-09-05 this assembly contains NO action layer at all — see the
/// note above <see cref="Win32ReadOnlyObservation"/> — so every type here is
/// observation-only.
/// </summary>
internal static class Win32ControlDiscovery
{
    /// <summary>Bounded so a pathological tree cannot hang the connector.</summary>
    public const int MaxNodes = 2000;
    public const int MaxDepth = 24;

    /// <summary>
    /// Enumerates every descendant control of <paramref name="root"/>, in
    /// z-order, recording class, caption, control id, visibility, enablement,
    /// the class path from the root, and the ordinal among same-class
    /// siblings. The HWND is recorded as runtime identity only — it is never
    /// written back into a selector.
    /// </summary>
    public static IReadOnlyList<Win32ControlNode> Enumerate(IntPtr root)
    {
        var nodes = new List<Win32ControlNode>();
        if (root == IntPtr.Zero) return nodes;

        Walk(root, new List<string>(), 0, nodes);
        return nodes;
    }

    private static void Walk(IntPtr parent, List<string> parentPath, int depth, List<Win32ControlNode> sink)
    {
        if (depth >= MaxDepth || sink.Count >= MaxNodes) return;

        var children = new List<IntPtr>();
        ActionNative.EnumChildWindowsShallow(parent, children);

        var seenPerClass = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (var child in children)
        {
            if (sink.Count >= MaxNodes) return;

            var className = ClassOf(child);
            var path = new List<string>(parentPath) { className };

            seenPerClass.TryGetValue(className, out var ordinal);
            seenPerClass[className] = ordinal + 1;

            sink.Add(new Win32ControlNode
            {
                Handle = "0x" + child.ToInt64().ToString("X"),
                ClassName = className,
                Text = TextOf(child),
                ControlId = ActionNative.GetDlgCtrlID(child),
                ClassPath = path,
                OrdinalAmongSameClassSiblings = ordinal,
                Visible = ActionNative.IsWindowVisible(child),
                Enabled = ActionNative.IsWindowEnabled(child),
            });

            Walk(child, path, depth + 1, sink);
        }
    }

    private static string ClassOf(IntPtr h)
    {
        var sb = new StringBuilder(256);
        return ActionNative.GetClassName(h, sb, sb.Capacity) > 0 ? sb.ToString() : string.Empty;
    }

    private static string TextOf(IntPtr h)
    {
        var sb = new StringBuilder(512);
        // WM_GETTEXT rather than GetWindowText: VB6 controls hosted in another
        // thread return empty from GetWindowText but answer WM_GETTEXT.
        var len = ActionNative.SendMessageGetText(h, ActionNative.WM_GETTEXT, sb.Capacity, sb);
        if (len > 0) return sb.ToString();

        sb.Clear();
        return ActionNative.GetWindowText(h, sb, sb.Capacity) > 0 ? sb.ToString() : string.Empty;
    }
}

/// <summary>Why a read-only observation matched or did not match.</summary>
internal sealed record VerificationOutcome(bool Proven, string Reason);

/// <summary>
/// READ-ONLY OBSERVATION.
///
/// <b>The action layer was deleted on 2026-09-05.</b> This assembly used to
/// carry a <c>Win32NativeAction</c> type holding <c>WM_SETTEXT</c> and
/// <c>BM_CLICK</c>. It is gone, deliberately, for two reasons:
///
/// <list type="number">
/// <item>Its only caller drove a workflow IdealPOS does not have — it typed
/// the TABLE code into the PLU field and pressed a "Save" button that does
/// not exist (see the Phase 1 audit, defects D1–D3).</item>
/// <item>The static analysis of <c>IPS.exe</c> recovered
/// <c>frmTables.cmd_MouseDown</c> for the table-map cells and no
/// <c>cmd_Click</c> handler. A posted <c>BM_CLICK</c> raises <c>Click</c>,
/// not <c>MouseDown</c>, so the primitive we had may not have driven the
/// application at all — and keeping a plausible-looking but unproven click
/// primitive around is worse than having none.</item>
/// </list>
///
/// No action primitive will be reintroduced until the passive capture of the
/// real native Table Map establishes which mechanism actually works. Until
/// then this assembly physically cannot mutate IdealPOS.
/// </summary>
internal static class Win32ReadOnlyObservation
{
    /// <summary>
    /// Observes whether a control carries the expected table code, matching
    /// on WHOLE TOKENS via <see cref="TableIdentity"/>.
    ///
    /// The predecessor used <c>text.Contains(code)</c>, under which table "5"
    /// matched "15", "25", "50" and "Table 5 of 19". That is the wrong-table
    /// hazard directive §29 requires a stop for, so the substring test is
    /// gone.
    ///
    /// This is an OBSERVATION, not a confirmation: seeing a table code on
    /// screen says nothing about who put it there. Causal confirmation is the
    /// exclusive job of the native delta reconciliation.
    /// </summary>
    public static VerificationOutcome ObserveTableCarried(
        IntPtr window,
        Win32ControlSelector selector,
        string expectedTableCode)
    {
        var nodes = Win32ControlDiscovery.Enumerate(window);
        var resolved = Win32ControlResolver.Resolve(nodes, selector);

        if (!resolved.IsResolved)
            return new VerificationOutcome(false, $"control did not resolve: {resolved.Reason}");

        var text = resolved.Node!.Text ?? string.Empty;
        if (!TableIdentity.TextCarriesTable(text, expectedTableCode))
        {
            return new VerificationOutcome(
                false,
                $"control resolved but shows '{text}', which does not carry table '{expectedTableCode}' as a whole token");
        }

        return new VerificationOutcome(true, $"control shows '{text}', carrying table '{expectedTableCode}' as a whole token");
    }
}

/// <summary>
/// Interop for the discovery layer.
///
/// <b>Every entry point here is a reader.</b> The mutating imports
/// (<c>WM_SETTEXT</c>, <c>BM_CLICK</c>, and the generic
/// <c>SendMessage</c>/<c>SendMessageSetText</c> that carried them) were
/// removed on 2026-09-05 along with the action layer. The one remaining
/// message send is <c>WM_GETTEXT</c>, which retrieves a control's caption and
/// changes nothing — VB6 controls hosted on another thread return empty from
/// <c>GetWindowText</c> but answer <c>WM_GETTEXT</c>, so it is required for
/// observation.
///
/// Keeping the mutating imports out of the file entirely — rather than
/// merely not calling them — means a future edit cannot reintroduce a click
/// by accident.
/// </summary>
internal static class ActionNative
{
    public const uint WM_GETTEXT = 0x000D;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    /// <summary>Read-only geometry.</summary>
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, ref RECT lpRect);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    /// <summary>WM_GETTEXT only — retrieves a caption, mutates nothing.</summary>
    [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)]
    public static extern int SendMessageGetText(IntPtr hWnd, uint msg, int wParam, StringBuilder lParam);

    /// <summary>Direct children only — the recursion is owned by the caller so depth stays bounded.</summary>
    public static void EnumChildWindowsShallow(IntPtr parent, List<IntPtr> sink)
    {
        EnumChildWindows(parent, (h, _) =>
        {
            if (GetParent(h) == parent) sink.Add(h);
            return true;
        }, IntPtr.Zero);
    }
}
