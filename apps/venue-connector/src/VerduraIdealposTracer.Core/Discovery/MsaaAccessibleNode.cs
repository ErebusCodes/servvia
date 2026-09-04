namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// One node observed through MSAA / <c>IAccessible</c> (oleacc).
///
/// This model exists because the 14:19:52 POS Screen capture proved the Win32
/// child-HWND path insufficient: the sale form has exactly ONE child window,
/// the <c>ThunderRT6PictureBoxDC</c> container (control id 1), and that
/// container has zero children of its own. No table map, entry field or Save
/// action is addressable as an HWND.
///
/// VB6 "lightweight" / windowless controls create no HWND at all. They are
/// exposed instead as <b>child IDs on the container's accessible object</b> —
/// which is why <see cref="ChildId"/> matters here and has no Win32 analogue.
/// </summary>
public sealed record MsaaAccessibleNode
{
    /// <summary>
    /// How this node is addressed. <c>0</c> (CHILDID_SELF) means the node is
    /// a real accessible object; a non-zero value means it is a WINDOWLESS
    /// child of its parent, addressed only by this id. A non-zero ChildId is
    /// the signature of a VB6 lightweight control.
    /// </summary>
    public int ChildId { get; init; }

    /// <summary>Numeric MSAA role (ROLE_SYSTEM_*).</summary>
    public int Role { get; init; }

    /// <summary>Human-readable role from <c>GetRoleText</c>, e.g. "push button", "text".</summary>
    public string? RoleText { get; init; }

    /// <summary>Sanitized accessible name — for a POS button this is typically its caption.</summary>
    public string? Name { get; init; }

    /// <summary>Sanitized accessible value — for an entry field this is its contents.</summary>
    public string? Value { get; init; }

    /// <summary>Numeric MSAA state bitmask (STATE_SYSTEM_*).</summary>
    public int State { get; init; }

    /// <summary>Decoded state flags, e.g. "focusable", "invisible", "unavailable".</summary>
    public IReadOnlyList<string> StateText { get; init; } = Array.Empty<string>();

    /// <summary>Default action name, e.g. "Press". Its presence indicates an actionable element.</summary>
    public string? DefaultAction { get; init; }

    /// <summary>Screen rectangle: left, top, width, height. Zero-area nodes are not addressable.</summary>
    public int Left { get; init; }
    public int Top { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }

    /// <summary>The HWND this accessible object belongs to, when it has one. Runtime identity only.</summary>
    public string? OwningHandle { get; init; }

    public int Depth { get; init; }

    public IReadOnlyList<MsaaAccessibleNode> Children { get; init; } = Array.Empty<MsaaAccessibleNode>();

    /// <summary>
    /// True when this node looks like something a driver could actually
    /// address: it has a name or value, a non-zero area, and is not marked
    /// invisible. Used to decide whether a capture is genuinely usable rather
    /// than merely non-empty.
    /// </summary>
    public bool IsAddressable =>
        (!string.IsNullOrWhiteSpace(Name) || !string.IsNullOrWhiteSpace(Value))
        && Width > 0 && Height > 0
        && !StateText.Contains("invisible");
}

/// <summary>Result of probing one window through MSAA.</summary>
public sealed record MsaaProbeResult
{
    public required string Handle { get; init; }
    public string? WindowClassName { get; init; }
    public string? WindowTitle { get; init; }

    /// <summary>Which OBJID_* was queried (CLIENT, WINDOW, ...).</summary>
    public string ObjectId { get; init; } = "CLIENT";

    public bool Reachable { get; init; }
    public string? FailureReason { get; init; }
    public MsaaAccessibleNode? Root { get; init; }

    public int TotalNodes { get; init; }
    public int AddressableNodes { get; init; }
}
