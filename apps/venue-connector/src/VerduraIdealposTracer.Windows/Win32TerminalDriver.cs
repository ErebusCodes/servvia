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
/// foregrounds a window. It is deliberately a separate type from
/// <see cref="Win32NativeAction"/> so "can observe" and "can mutate" are
/// distinguishable at a glance and in review.
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

/// <summary>The outcome of one bounded native action.</summary>
internal sealed record NativeActionResult(bool Issued, string Detail);

/// <summary>
/// LAYER B — ACTION. The ONLY type in this assembly permitted to mutate the
/// target application, and the only one holding message-sending interop.
///
/// Critically, every method here reports whether the message was ISSUED —
/// never whether it SUCCEEDED. A posted message that returns zero tells you
/// nothing about whether IdealPOS did what you wanted. Proof of success is
/// the exclusive job of <see cref="Win32ActionVerification"/>, and the caller
/// must not treat <see cref="NativeActionResult.Issued"/> as success.
/// </summary>
internal static class Win32NativeAction
{
    /// <summary>Sets a control's text via WM_SETTEXT. Issued-only; verify separately.</summary>
    public static NativeActionResult SetText(IntPtr control, string text)
    {
        if (control == IntPtr.Zero) return new NativeActionResult(false, "null control handle");
        if (!ActionNative.IsWindowEnabled(control)) return new NativeActionResult(false, "control is disabled");

        var rc = ActionNative.SendMessageSetText(control, ActionNative.WM_SETTEXT, IntPtr.Zero, text);
        return new NativeActionResult(rc != IntPtr.Zero, $"WM_SETTEXT returned {rc}");
    }

    /// <summary>Clicks a button via BM_CLICK. Issued-only; verify separately.</summary>
    public static NativeActionResult Click(IntPtr control)
    {
        if (control == IntPtr.Zero) return new NativeActionResult(false, "null control handle");
        if (!ActionNative.IsWindowEnabled(control)) return new NativeActionResult(false, "control is disabled");
        if (!ActionNative.IsWindowVisible(control)) return new NativeActionResult(false, "control is not visible");

        ActionNative.SendMessage(control, ActionNative.BM_CLICK, IntPtr.Zero, IntPtr.Zero);
        return new NativeActionResult(true, "BM_CLICK issued");
    }
}

/// <summary>Why a post-action verification passed or failed.</summary>
internal sealed record VerificationOutcome(bool Proven, string Reason);

/// <summary>
/// LAYER C — VERIFICATION. Re-reads the application's own state after an
/// action and decides whether the intended effect is OBSERVABLE.
///
/// This is what lets the connector report a table assignment truthfully:
/// success is earned by observing IdealPOS in the expected state, never by
/// the fact that a message was sent.
/// </summary>
internal static class Win32ActionVerification
{
    /// <summary>
    /// Proves a table assignment by re-enumerating the bound window and
    /// requiring that the profile's confirmation control resolves to exactly
    /// one node whose text carries the expected table code.
    ///
    /// Any other outcome — control gone, ambiguous, or showing a different
    /// table — is NOT proven, and the caller must fail closed.
    /// </summary>
    public static VerificationOutcome ProveTableAssigned(
        IntPtr window,
        Win32ControlSelector confirmationSelector,
        string expectedTableCode)
    {
        var after = Win32ControlDiscovery.Enumerate(window);
        var resolved = Win32ControlResolver.Resolve(after, confirmationSelector);

        if (!resolved.IsResolved)
            return new VerificationOutcome(false, $"confirmation control did not resolve after the action: {resolved.Reason}");

        var text = resolved.Node!.Text ?? string.Empty;
        if (!text.Contains(expectedTableCode, StringComparison.OrdinalIgnoreCase))
        {
            return new VerificationOutcome(
                false,
                $"confirmation control resolved but shows '{text}', which does not carry the requested table '{expectedTableCode}'");
        }

        return new VerificationOutcome(true, $"confirmation control shows '{text}', carrying table '{expectedTableCode}'");
    }
}

/// <summary>
/// Interop for the discovery and action layers. Kept apart from the capture's
/// read-only <c>Native</c> class so that the message-sending entry points —
/// the only ones that can change the target application — are not mixed into
/// a type documented as observation-only.
/// </summary>
internal static class ActionNative
{
    public const uint WM_SETTEXT = 0x000C;
    public const uint WM_GETTEXT = 0x000D;
    public const uint BM_CLICK = 0x00F5;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessageSetText(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);

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
