namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// One control as OBSERVED at runtime by a Win32 tree walk.
///
/// <see cref="Handle"/> is runtime identity only. It is deliberately present
/// here (an observation) and deliberately absent from
/// <see cref="Win32ControlSelector"/> (a persisted rule), because an HWND is
/// re-issued by the window manager on every form load and is meaningless
/// across restarts.
/// </summary>
public sealed record Win32ControlNode
{
    /// <summary>Runtime-only HWND, e.g. "0x1405F6". Never persist this as a selector.</summary>
    public required string Handle { get; init; }

    /// <summary>Win32 window class, e.g. <c>ThunderRT6TextBox</c>, <c>ThunderRT6CommandButton</c>.</summary>
    public string? ClassName { get; init; }

    /// <summary>Window text / caption.</summary>
    public string? Text { get; init; }

    /// <summary>
    /// <c>GetDlgCtrlID</c>. On VB6/ThunderRT6 forms this is the control's
    /// design-time index and is stable across restarts for a given form
    /// version — the closest thing this application has to an AutomationId.
    /// </summary>
    public int ControlId { get; init; }

    /// <summary>Class names from the bound window down to and including this control.</summary>
    public IReadOnlyList<string> ClassPath { get; init; } = Array.Empty<string>();

    /// <summary>Zero-based index among preceding siblings sharing this class, in enumeration order.</summary>
    public int OrdinalAmongSameClassSiblings { get; init; }

    public bool Visible { get; init; }
    public bool Enabled { get; init; }
}

/// <summary>
/// A PERSISTED rule for finding one control, expressed only in terms a Win32
/// capture of this application can actually supply.
///
/// This replaces the previous five-<c>AutomationId</c> model, which was
/// incompatible with the real application: the 2026-09-04 Session-1 capture
/// walked 57 nodes of IPS.exe and found <b>zero non-empty AutomationIds</b>.
/// Every node came back <c>ControlType=Win32</c> with VB6 runtime classes
/// (<c>ThunderRT6*</c>, <c>AfxOleControl42u</c>, <c>MSFlexGridWndClass</c>);
/// UI Automation returned window chrome only, and the Win32
/// <c>EnumChildWindows</c> fallback — which yields class names, control ids,
/// captions and z-order, but no AutomationIds — was the only mechanism that
/// produced content at all.
///
/// There is intentionally NO handle/HWND member on this type. See
/// <c>Win32ControlNode.Handle</c> for why identity is resolved at runtime.
/// </summary>
public sealed record Win32ControlSelector
{
    /// <summary>Exact Win32 class name, case-insensitive. The primary discriminator.</summary>
    public string? ClassName { get; init; }

    /// <summary>Stable VB6 control id from <c>GetDlgCtrlID</c>.</summary>
    public int? ControlId { get; init; }

    /// <summary>Exact caption, case-insensitive and trimmed. Good for buttons with fixed labels.</summary>
    public string? TextEquals { get; init; }

    /// <summary>Caption substring, case-insensitive.</summary>
    public string? TextContains { get; init; }

    /// <summary>
    /// Ancestor class chain, matched as a SUFFIX of the node's own
    /// <see cref="Win32ControlNode.ClassPath"/> so a selector need not restate
    /// the whole tree from the window root.
    /// </summary>
    public IReadOnlyList<string> ClassPath { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Index among same-class siblings. A LAST RESORT: it is positional, so it
    /// silently follows a layout change. <see cref="Win32SelectorValidation"/>
    /// refuses a selector that carries nothing else.
    /// </summary>
    public int? Ordinal { get; init; }

    public bool RequireVisible { get; init; } = true;
    public bool RequireEnabled { get; init; } = true;

    /// <summary>True when this selector carries no discriminator at all.</summary>
    public bool IsEmpty =>
        string.IsNullOrWhiteSpace(ClassName)
        && ControlId is null
        && string.IsNullOrWhiteSpace(TextEquals)
        && string.IsNullOrWhiteSpace(TextContains)
        && ClassPath.Count == 0
        && Ordinal is null;

    public override string ToString()
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(ClassName)) parts.Add($"class={ClassName}");
        if (ControlId is not null) parts.Add($"id={ControlId}");
        if (!string.IsNullOrWhiteSpace(TextEquals)) parts.Add($"text=='{TextEquals}'");
        if (!string.IsNullOrWhiteSpace(TextContains)) parts.Add($"text~'{TextContains}'");
        if (ClassPath.Count > 0) parts.Add($"path={string.Join("/", ClassPath)}");
        if (Ordinal is not null) parts.Add($"ordinal={Ordinal}");
        return parts.Count == 0 ? "<empty selector>" : string.Join(" ", parts);
    }
}

/// <summary>
/// Validates a persisted selector BEFORE it is ever used to act. Keeping this
/// in Core means the rules are exercised by cross-platform unit tests rather
/// than asserted to hold on a machine nobody runs tests on.
/// </summary>
public static class Win32SelectorValidation
{
    private static readonly string[] PlaceholderMarkers =
    {
        "PENDING", "UNSET", "TBD", "PLACEHOLDER", "SESSION1", "DISCOVERY", "EXAMPLE", "CHANGEME",
    };

    internal static bool LooksPlaceholder(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        foreach (var marker in PlaceholderMarkers)
        {
            if (value.Contains(marker, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    /// <summary>
    /// A selector is valid only when it carries at least one NON-POSITIONAL
    /// discriminator (class, control id, or caption). Ordinal and class-path
    /// alone are positional and follow a layout change silently, so they may
    /// refine a selector but never constitute one.
    /// </summary>
    public static bool IsValid(Win32ControlSelector? selector, out string reason)
    {
        if (selector is null)
        {
            reason = "selector is null";
            return false;
        }

        if (selector.IsEmpty)
        {
            reason = "selector carries no discriminator at all";
            return false;
        }

        foreach (var (field, value) in new[]
                 {
                     (nameof(Win32ControlSelector.ClassName), selector.ClassName),
                     (nameof(Win32ControlSelector.TextEquals), selector.TextEquals),
                     (nameof(Win32ControlSelector.TextContains), selector.TextContains),
                 })
        {
            if (value is not null && LooksPlaceholder(value))
            {
                reason = $"'{field}' is a placeholder value ('{value}')";
                return false;
            }
        }

        if (selector.ClassPath.Any(p => p is null || LooksPlaceholder(p)))
        {
            reason = "ClassPath contains a blank or placeholder segment";
            return false;
        }

        var hasStable =
            !string.IsNullOrWhiteSpace(selector.ClassName)
            || selector.ControlId is not null
            || !string.IsNullOrWhiteSpace(selector.TextEquals)
            || !string.IsNullOrWhiteSpace(selector.TextContains);

        if (!hasStable)
        {
            reason = "selector is positional only (ordinal/class-path); it needs a class name, control id or caption";
            return false;
        }

        if (selector.Ordinal is < 0)
        {
            reason = $"Ordinal must be >= 0 (was {selector.Ordinal})";
            return false;
        }

        reason = "valid";
        return true;
    }
}

public enum Win32ResolutionStatus
{
    Resolved,
    NotFound,
    Ambiguous,
    InvalidSelector,
}

public sealed record Win32ResolutionResult(
    Win32ResolutionStatus Status,
    Win32ControlNode? Node,
    string Reason)
{
    public bool IsResolved => Status == Win32ResolutionStatus.Resolved && Node is not null;
}

/// <summary>
/// Matches a persisted selector against a runtime-observed control tree.
/// Pure and platform-agnostic so the fail-closed rules are unit-testable.
/// </summary>
public static class Win32ControlResolver
{
    /// <summary>
    /// Resolves to exactly one node or refuses. Zero matches is
    /// <see cref="Win32ResolutionStatus.NotFound"/>; two or more is
    /// <see cref="Win32ResolutionStatus.Ambiguous"/>. Neither is ever
    /// narrowed by picking the first — an ambiguous selector is a defect in
    /// the profile, and acting on a guess is exactly the failure mode this
    /// model exists to prevent.
    /// </summary>
    public static Win32ResolutionResult Resolve(
        IReadOnlyList<Win32ControlNode> nodes,
        Win32ControlSelector selector)
    {
        if (!Win32SelectorValidation.IsValid(selector, out var invalidReason))
            return new Win32ResolutionResult(Win32ResolutionStatus.InvalidSelector, null, invalidReason);

        if (nodes is null || nodes.Count == 0)
            return new Win32ResolutionResult(Win32ResolutionStatus.NotFound, null, "the control tree is empty");

        var matches = nodes.Where(n => Matches(n, selector)).ToList();

        if (matches.Count == 1)
            return new Win32ResolutionResult(Win32ResolutionStatus.Resolved, matches[0], $"matched {selector} -> {matches[0].Handle}");

        if (matches.Count == 0)
        {
            return new Win32ResolutionResult(
                Win32ResolutionStatus.NotFound,
                null,
                $"no control in {nodes.Count} node(s) matched {selector}");
        }

        // Ordinal is the documented last-resort tie-break. It may only narrow
        // an ALREADY-matching set; it can never widen one.
        if (selector.Ordinal is int ordinal)
        {
            var byOrdinal = matches.Where(m => m.OrdinalAmongSameClassSiblings == ordinal).ToList();
            if (byOrdinal.Count == 1)
            {
                return new Win32ResolutionResult(
                    Win32ResolutionStatus.Resolved,
                    byOrdinal[0],
                    $"matched {selector} via ordinal tie-break -> {byOrdinal[0].Handle}");
            }
        }

        return new Win32ResolutionResult(
            Win32ResolutionStatus.Ambiguous,
            null,
            $"{matches.Count} controls matched {selector} — refusing to guess: "
            + string.Join(", ", matches.Take(5).Select(m => $"{m.Handle}(class={m.ClassName},id={m.ControlId},text='{m.Text}')")));
    }

    private static bool Matches(Win32ControlNode node, Win32ControlSelector selector)
    {
        if (selector.RequireVisible && !node.Visible) return false;
        if (selector.RequireEnabled && !node.Enabled) return false;

        if (!string.IsNullOrWhiteSpace(selector.ClassName)
            && !string.Equals(node.ClassName, selector.ClassName, StringComparison.OrdinalIgnoreCase))
            return false;

        if (selector.ControlId is int id && node.ControlId != id) return false;

        if (!string.IsNullOrWhiteSpace(selector.TextEquals)
            && !string.Equals(node.Text?.Trim(), selector.TextEquals!.Trim(), StringComparison.OrdinalIgnoreCase))
            return false;

        if (!string.IsNullOrWhiteSpace(selector.TextContains)
            && (node.Text is null || !node.Text.Contains(selector.TextContains!, StringComparison.OrdinalIgnoreCase)))
            return false;

        if (selector.ClassPath.Count > 0 && !EndsWithPath(node.ClassPath, selector.ClassPath)) return false;

        return true;
    }

    private static bool EndsWithPath(IReadOnlyList<string> actual, IReadOnlyList<string> expectedSuffix)
    {
        if (expectedSuffix.Count > actual.Count) return false;
        var offset = actual.Count - expectedSuffix.Count;
        for (var i = 0; i < expectedSuffix.Count; i++)
        {
            if (!string.Equals(actual[offset + i], expectedSuffix[i], StringComparison.OrdinalIgnoreCase))
                return false;
        }
        return true;
    }
}
