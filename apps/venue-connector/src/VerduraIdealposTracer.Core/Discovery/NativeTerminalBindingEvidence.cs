namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// What one desktop window inventory says about WHICH executable actually
/// owns the visible native IdealPOS terminal UI.
/// </summary>
public sealed record NativeTerminalBindingReport
{
    /// <summary>The executable file name the current configuration expects to bind, e.g. "IPS.exe".</summary>
    public required string ExpectedExecutableFileName { get; init; }

    /// <summary>
    /// Every distinct executable owning at least one visible VB6-class
    /// top-level window, with how many such windows each owns. This is the
    /// answer to "who is actually drawing the native terminal?".
    /// </summary>
    public IReadOnlyList<NativeTerminalOwnerCandidate> Candidates { get; init; } = Array.Empty<NativeTerminalOwnerCandidate>();

    /// <summary>True when the expected executable owns at least one visible VB6-class window.</summary>
    public bool ExpectedExecutableIsPresent { get; init; }

    /// <summary>
    /// True when candidates were found and NONE of them is the expected
    /// executable — i.e. the evidence actively contradicts the configured
    /// assumption. An empty inventory is NOT a contradiction (it is an
    /// absence of evidence), and is reported as such.
    /// </summary>
    public bool ContradictsExpectedExecutable { get; init; }

    /// <summary>Windows whose owning executable could not be read at all.</summary>
    public int WindowsWithUnreadableExecutable { get; init; }

    /// <summary>Sessions observed across the candidates — more than one means a cross-session capture.</summary>
    public IReadOnlyList<int> ObservedSessionIds { get; init; } = Array.Empty<int>();

    /// <summary>A human-readable statement of what the evidence supports, for the capture report.</summary>
    public required string Verdict { get; init; }
}

/// <summary>One executable observed owning visible VB6-class top-level windows.</summary>
public sealed record NativeTerminalOwnerCandidate
{
    public required string ExecutablePath { get; init; }
    public required string ExecutableFileName { get; init; }
    public required int WindowCount { get; init; }
    public IReadOnlyList<int> ProcessIds { get; init; } = Array.Empty<int>();
    public IReadOnlyList<int> SessionIds { get; init; } = Array.Empty<int>();

    /// <summary>Sanitized titles/classes of the windows this executable owns, as corroborating evidence.</summary>
    public IReadOnlyList<string> WindowDescriptions { get; init; } = Array.Empty<string>();
}

/// <summary>
/// Pure, offline analysis of a desktop window inventory that answers the one
/// question the Front-desk capture exists to settle: which executable owns
/// the visible native IdealPOS terminal UI?
///
/// It deliberately does NOT decide the binding, and it populates no selector.
/// Its whole job is to make the answer — including an answer that contradicts
/// the current <c>IPS.exe</c> assumption — an explicit, reported fact.
///
/// The window filter is the VB6 form class prefix <c>ThunderRT6</c>, which is
/// not a guess: IdealPOS's terminal forms are VB6 (<c>frmSale</c>,
/// <c>frmTables</c>, <c>frmTableDetails</c>) and every capture so far has seen
/// them as <c>ThunderRT6FormDC</c>. It is used here ONLY to narrow a
/// diagnostic report, never to select or drive a window, so a venue running a
/// non-VB6 build shows up as "no candidates" — an honest absence — rather than
/// as a wrong binding.
/// </summary>
public static class NativeTerminalBindingEvidence
{
    /// <summary>The VB6 window-class prefix IdealPOS's terminal forms have presented in every capture to date.</summary>
    public const string Vb6WindowClassPrefix = "ThunderRT6";

    /// <summary>
    /// Summarizes an inventory. <paramref name="inventory"/> should be the
    /// UNFILTERED desktop enumeration
    /// (<see cref="IdealposControlTreeSnapshot.DesktopWindowInventory"/>);
    /// passing the process-name-filtered list would reproduce exactly the
    /// blind spot this type exists to remove.
    /// </summary>
    public static NativeTerminalBindingReport Summarize(
        IReadOnlyList<TopLevelWindowInfo> inventory,
        string expectedExecutableFileName)
    {
        var expected = (expectedExecutableFileName ?? string.Empty).Trim();

        var vb6Windows = (inventory ?? Array.Empty<TopLevelWindowInfo>())
            .Where(w => w.Visible)
            .Where(w => w.ClassName?.StartsWith(Vb6WindowClassPrefix, StringComparison.OrdinalIgnoreCase) == true)
            .ToList();

        var unreadable = vb6Windows.Count(w => string.IsNullOrWhiteSpace(w.ExecutablePath));

        var candidates = vb6Windows
            .Where(w => !string.IsNullOrWhiteSpace(w.ExecutablePath))
            .GroupBy(w => w.ExecutablePath!, StringComparer.OrdinalIgnoreCase)
            .Select(g => new NativeTerminalOwnerCandidate
            {
                ExecutablePath = g.Key,
                ExecutableFileName = FileNameOf(g.Key),
                WindowCount = g.Count(),
                ProcessIds = g.Select(w => w.ProcessId).Distinct().OrderBy(x => x).ToList(),
                SessionIds = g.Where(w => w.SessionId.HasValue).Select(w => w.SessionId!.Value).Distinct().OrderBy(x => x).ToList(),
                WindowDescriptions = g.Select(w => $"{w.Handle} [{w.ClassName}] '{w.Title}'").ToList(),
            })
            .OrderByDescending(c => c.WindowCount)
            .ThenBy(c => c.ExecutableFileName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var expectedPresent = !string.IsNullOrWhiteSpace(expected)
            && candidates.Any(c => string.Equals(c.ExecutableFileName, expected, StringComparison.OrdinalIgnoreCase));

        // An empty inventory is an absence of evidence, never a contradiction.
        var contradicts = candidates.Count > 0 && !expectedPresent;

        var sessions = candidates.SelectMany(c => c.SessionIds).Distinct().OrderBy(x => x).ToList();

        return new NativeTerminalBindingReport
        {
            ExpectedExecutableFileName = expected,
            Candidates = candidates,
            ExpectedExecutableIsPresent = expectedPresent,
            ContradictsExpectedExecutable = contradicts,
            WindowsWithUnreadableExecutable = unreadable,
            ObservedSessionIds = sessions,
            Verdict = BuildVerdict(expected, candidates, expectedPresent, contradicts, unreadable, sessions),
        };
    }

    private static string FileNameOf(string path)
    {
        try { return Path.GetFileName(path); }
        catch (ArgumentException) { return path; }
    }

    private static string BuildVerdict(
        string expected,
        IReadOnlyList<NativeTerminalOwnerCandidate> candidates,
        bool expectedPresent,
        bool contradicts,
        int unreadable,
        IReadOnlyList<int> sessions)
    {
        if (candidates.Count == 0)
        {
            var suffix = unreadable > 0
                ? $" {unreadable} VB6-class window(s) were seen but their owning executable could not be read, so this is inconclusive rather than negative."
                : " No visible VB6-class top-level window was found at all — either the native terminal is not on this desktop/session, or this build does not present VB6 forms.";
            return "NO EVIDENCE: the inventory does not identify any owner of the native terminal UI." + suffix;
        }

        var owners = string.Join(", ", candidates.Select(c => $"{c.ExecutableFileName} ({c.WindowCount} window(s), pid(s) {string.Join("/", c.ProcessIds)})"));
        var sessionNote = sessions.Count > 1
            ? $" WARNING: candidates span more than one session ({string.Join("/", sessions)}); automation only ever sees its own."
            : string.Empty;

        if (contradicts)
        {
            return $"CONTRADICTION: the configured expected executable '{expected}' owns no visible VB6-class window, "
                + $"but these executables do: {owners}. The IPS.exe assumption is not supported by this capture and "
                + "must be re-decided from this evidence rather than re-asserted." + sessionNote;
        }

        return expectedPresent
            ? $"CONSISTENT: '{expected}' owns visible VB6-class window(s). Observed owners: {owners}." + sessionNote
            : $"INCONCLUSIVE: owners observed ({owners}) but no expected executable was configured to compare against." + sessionNote;
    }
}
