using System.Text.RegularExpressions;

namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// Bounds for a passive control-tree capture. Every bound exists to keep a
/// read-only walk from ever becoming an unbounded or hanging operation on a
/// live terminal: a depth cap, a node cap, and a wall-clock cap. None of
/// these makes the capture mutate anything — they only decide when to stop
/// reading.
/// </summary>
public sealed record ControlTreeCaptureOptions
{
    public int MaxDepth { get; init; } = 12;
    public int MaxNodes { get; init; } = 4000;
    public int TimeoutMs { get; init; } = 8000;
    public bool IncludeMenus { get; init; } = true;

    public static ControlTreeCaptureOptions Default => new();
}

/// <summary>
/// One captured control. Everything here is passive METADATA — identity and
/// shape, never content a user typed and never a value the control holds
/// beyond its (sanitized) accessible name. AutomationId / ControlType /
/// ClassName are the selector-relevant facts; Name is free text and is
/// passed through <see cref="ControlTreeSanitizer"/> before it is ever
/// stored.
/// </summary>
public sealed record ControlNodeSnapshot
{
    public required string ControlType { get; init; }
    public string? AutomationId { get; init; }
    public string? Name { get; init; }
    public string? ClassName { get; init; }
    public bool IsEnabled { get; init; }
    public bool IsOffscreen { get; init; }
    public int Depth { get; init; }
    public IReadOnlyList<ControlNodeSnapshot> Children { get; init; } = Array.Empty<ControlNodeSnapshot>();
}

/// <summary>One top-level window discovered by EnumWindows, independent of MainWindowHandle.</summary>
public sealed record TopLevelWindowInfo
{
    public required string Handle { get; init; }
    public string? Title { get; init; }
    public string? ClassName { get; init; }
    public bool Visible { get; init; }
    public string? ProcessName { get; init; }
    public int ProcessId { get; init; }

    /// <summary>
    /// The full path of the executable that owns this window, or null when
    /// it could not be read (access denied, a 32/64-bit boundary, or the
    /// process exiting mid-enumeration).
    ///
    /// A process NAME is not identity. "IPS" is satisfied by IPS.exe, by a
    /// renamed build, and by anything else a venue happens to have called
    /// IPS — which is exactly why the Front-desk binding question
    /// (HWND → PID → executable → session → class/title) needs this field
    /// and cannot be answered by <see cref="ProcessName"/>.
    /// </summary>
    public string? ExecutablePath { get; init; }

    /// <summary>
    /// The Windows terminal-services session this window's process belongs
    /// to, or null when unreadable. A window in another session is invisible
    /// to automation no matter how correct the selectors are, so the session
    /// belongs in the per-window evidence and not only in the snapshot-level
    /// summary.
    /// </summary>
    public int? SessionId { get; init; }

    // Screen geometry, added 2026-09-04. Needed to tell which visible window
    // actually covers the sale area: if the POS Screen form is full-screen and
    // the other visible windows are 0x0 or off-screen, the sale UI cannot be
    // "hosted under another window" and the owner-drawn / windowless
    // hypotheses are the only ones left.
    public int Left { get; init; }
    public int Top { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }
}

/// <summary>Which binding mechanism actually produced the tree.</summary>
public enum CaptureMechanism
{
    None,
    UiaFromHandle,
    Win32,
    Msaa,
}

/// <summary>
/// The complete result of one passive capture. It carries no ability to act
/// — it is a description of what the sale screen looks like, to be read by a
/// human and turned into real selectors. <see cref="Truncated"/> makes any
/// bound that was hit an explicit, auditable fact rather than a silent
/// omission.
///
/// The session fields make a session mismatch an EXPLICIT, self-proving fact
/// in the snapshot itself: if <see cref="SessionMismatch"/> is true, the
/// tracer (<see cref="TracerSessionId"/>) is not on the same desktop session
/// as the target (<see cref="TargetSessionId"/>), which is why a
/// cross-session capture returns nothing — no assertion required, the
/// numbers are in the file.
/// </summary>
public sealed record IdealposControlTreeSnapshot
{
    public required DateTimeOffset CapturedAtUtc { get; init; }
    public string? ProcessName { get; init; }
    public int ProcessId { get; init; }
    public string? RootWindowTitle { get; init; }
    public int NodeCount { get; init; }
    public bool Truncated { get; init; }
    public string? TruncationReason { get; init; }
    public ControlNodeSnapshot? Root { get; init; }
    public IReadOnlyList<string> MenuItems { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Diagnostics { get; init; } = Array.Empty<string>();

    // ── Session diagnostics (self-proving) ──
    public int TracerSessionId { get; init; } = -1;
    public int? TargetSessionId { get; init; }
    public bool SessionMismatch { get; init; }

    // ── How the tree was obtained, and every top-level window seen ──
    public CaptureMechanism Mechanism { get; init; } = CaptureMechanism.None;
    public IReadOnlyList<TopLevelWindowInfo> TopLevelWindows { get; init; } = Array.Empty<TopLevelWindowInfo>();

    /// <summary>
    /// EVERY visible top-level window on the tracer's desktop, not only those
    /// owned by a process whose name we already expected — read-only, and
    /// deliberately unfiltered.
    ///
    /// <see cref="TopLevelWindows"/> is pre-filtered to the configured
    /// candidate process names, which makes it the right input to window
    /// SELECTION and the wrong input to the binding QUESTION: if the native
    /// Table Map turns out to be owned by something other than the expected
    /// executable, a filtered enumeration cannot report that — it reports
    /// "nothing found", which reads as "IdealPOS is not running" and quietly
    /// preserves the assumption it was supposed to test.
    ///
    /// This inventory exists so the Front-desk capture can establish
    /// HWND → PID → executable → session → class/title for whatever actually
    /// owns the visible native UI, and so a contradiction with the expected
    /// executable is surfaced as evidence rather than swallowed as absence.
    /// It feeds <c>NativeTerminalBindingEvidence</c>; it never feeds window
    /// selection or binding.
    /// </summary>
    public IReadOnlyList<TopLevelWindowInfo> DesktopWindowInventory { get; init; } = Array.Empty<TopLevelWindowInfo>();

    /// <summary>
    /// How many nodes represent real CLIENT-AREA content, excluding the root
    /// window element and its non-client TitleBar subtree. This, not
    /// <see cref="NodeCount"/>, is the number that decides whether a capture
    /// is usable: a bound-but-unrendered window yields a nonzero NodeCount
    /// (window frame, system menu, min/max/close) and a ClientNodeCount of
    /// zero.
    /// </summary>
    public int ClientNodeCount { get; init; }

    /// <summary>
    /// The FULL Win32 child-window tree of the bound window, flattened, and
    /// captured UNCONDITIONALLY — not only when UI Automation comes back
    /// empty.
    ///
    /// Added 2026-09-04 after the 14:10:32 POS Screen capture. That capture
    /// bound the correct window and UIA returned a 3-node tree: the
    /// <c>ThunderRT6FormDC</c> root, a <c>TitleBar</c>, and ONE empty
    /// <c>ThunderRT6PictureBoxDC</c> pane. Because that pane is not a
    /// TitleBar, <see cref="ControlTreeQuality.IsChromeOnly"/> judged the
    /// tree "not chrome-only", the mechanism was set to
    /// <see cref="CaptureMechanism.UiaFromHandle"/>, and the Win32
    /// <c>EnumChildWindows</c> fallback — which only ran
    /// <c>if (mechanism == None)</c> — was skipped entirely. The real VB6
    /// sale controls live as native children beneath that pane and were
    /// never enumerated.
    ///
    /// A single empty container pane is technically "client content" and
    /// structurally indistinguishable from real content, so the either/or
    /// fallback could not be repaired by tightening the quality test alone.
    /// This list is therefore always populated: it is the evidence the Win32
    /// selector model is actually derived from.
    /// </summary>
    public IReadOnlyList<Terminal.Win32ControlNode> Win32Controls { get; init; } = Array.Empty<Terminal.Win32ControlNode>();

    /// <summary>
    /// MSAA / <c>IAccessible</c> probes, run UNCONDITIONALLY on the bound
    /// window, on each of its Win32 children, and on the process's other
    /// visible windows.
    ///
    /// Added 2026-09-04 after the 14:19:52 capture showed the Win32 path is
    /// insufficient: the POS Screen form has exactly one child window (the
    /// <c>ThunderRT6PictureBoxDC</c> container, control id 1) and that
    /// container has no children of its own. Nothing corresponding to a table
    /// map, entry field or Save action is addressable as an HWND.
    ///
    /// VB6 lightweight controls create no HWND and appear only as accessible
    /// CHILD IDs on their container, so this is the mechanism that can see
    /// them if any can. Like every other capture path, it is strictly
    /// read-only.
    /// </summary>
    public IReadOnlyList<MsaaProbeResult> MsaaProbes { get; init; } = Array.Empty<MsaaProbeResult>();

    /// <summary>
    /// Total MSAA nodes that look genuinely addressable (named or valued,
    /// non-zero area, not invisible) across every probe. THIS, not
    /// <see cref="Win32Controls"/> count, is the number that decides whether a
    /// capture can populate a selector profile — a lone container control
    /// satisfies "count > 0" while carrying nothing actionable.
    /// </summary>
    public int AddressableAccessibleNodes { get; init; }

    /// <summary>True only when a root window was actually walked — a fail-closed empty capture is not "captured".</summary>
    public bool HasRoot => Root is not null;

    /// <summary>
    /// The honest success test for a discovery capture. <see cref="HasRoot"/>
    /// only says a window frame was bound; this says the walk actually
    /// reached content a selector could be derived from. No selector may be
    /// authored from a snapshot where this is false.
    /// </summary>
    public bool HasClientContent => ClientNodeCount > 0;
}

/// <summary>
/// Redacts anything that could be sensitive from a control's accessible
/// name before it is stored in a snapshot. A POS window's control names can
/// incidentally contain order totals, a customer name/email, or — in the
/// worst case — card digits; a discovery snapshot needs the STRUCTURE, not
/// that content. Pure and deterministic so it is directly unit-testable.
/// AutomationId / ControlType / ClassName are structural identifiers and are
/// never passed through here.
/// </summary>
public static class ControlTreeSanitizer
{
    // 13–19 digits, optionally separated by spaces/dashes — a card PAN shape.
    private static readonly Regex CardLike = new(@"\b(?:\d[ -]?){13,19}\b", RegexOptions.Compiled);
    // Any bare run of 12+ digits (account/loyalty numbers).
    private static readonly Regex LongDigits = new(@"\d{12,}", RegexOptions.Compiled);
    private static readonly Regex Email = new(@"[\w.+-]+@[\w-]+\.[\w.-]+", RegexOptions.Compiled);
    // Currency amounts — order values are not ours to record during discovery.
    private static readonly Regex Currency = new(@"[$£€]\s?\d[\d,]*(?:\.\d{1,2})?", RegexOptions.Compiled);

    public static string? Sanitize(string? name)
    {
        if (string.IsNullOrEmpty(name)) return name;
        var s = CardLike.Replace(name, "[REDACTED-DIGITS]");
        s = LongDigits.Replace(s, "[REDACTED-DIGITS]");
        s = Email.Replace(s, "[REDACTED-EMAIL]");
        s = Currency.Replace(s, "[REDACTED-AMOUNT]");
        return s;
    }
}
