namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// Why a window was or was not chosen. <see cref="Ambiguous"/> exists so an
/// under-specified criteria set fails closed instead of silently binding
/// whichever equally-good candidate happened to enumerate first.
/// </summary>
public enum WindowSelectionStatus
{
    Selected,
    NoCandidate,
    Ambiguous,
}

/// <summary>
/// The outcome of a strict window selection. Callers that intend to ACT on a
/// window must require <see cref="WindowSelectionStatus.Selected"/> — the
/// other two states are refusals, and <see cref="Reason"/> says why.
/// </summary>
public sealed record WindowSelectionResult(
    WindowSelectionStatus Status,
    TopLevelWindowInfo? Window,
    string Reason)
{
    public bool IsSelected => Status == WindowSelectionStatus.Selected && Window is not null;
}

/// <summary>
/// Declarative rules for picking one top-level window. Introduced because a
/// bare "title contains" hint is provably not enough on this application:
/// the 2026-09-04 13:07:59 Session-1 capture bound
/// <c>"Idealpos v7.1 Build 33  Sila Restaurant  DUNEDIN - BACKOFFICE(1)"</c>
/// (class <c>ThunderRT6MDIForm</c>, <c>IsWindowVisible=false</c>) instead of
/// the sale window <c>"POS Screen"</c> (class <c>ThunderRT6FormDC</c>,
/// visible) which was enumerated in the same pass. The back-office MDI title
/// contains the hint "Idealpos"; the string "POS Screen" does not. The hint
/// alone therefore selects exactly the wrong window, every time,
/// deterministically.
/// </summary>
public sealed record WindowSelectionCriteria
{
    /// <summary>Substring the wanted window's title should contain.</summary>
    public string? TitleContains { get; init; }

    /// <summary>
    /// Full title, matched case-insensitively and whitespace-trimmed. When it
    /// matches it outranks every other signal — this is how "POS Screen" wins
    /// over a back-office MDI frame whose title merely mentions the product.
    /// </summary>
    public string? TitleEquals { get; init; }

    /// <summary>
    /// Substrings that DISQUALIFY a window outright. e.g. "BACKOFFICE". A
    /// disqualified window can never be selected, at any score.
    /// </summary>
    public IReadOnlyList<string> TitleExcludes { get; init; } = Array.Empty<string>();

    /// <summary>Window class names that positively indicate the wanted window (e.g. <c>ThunderRT6FormDC</c>).</summary>
    public IReadOnlyList<string> PreferredClassNames { get; init; } = Array.Empty<string>();

    /// <summary>Window class names that disqualify outright (e.g. <c>ThunderRT6MDIForm</c>).</summary>
    public IReadOnlyList<string> ExcludedClassNames { get; init; } = Array.Empty<string>();

    /// <summary>
    /// When true, an invisible window can never be selected. Acting on an
    /// invisible window is what produced a chrome-only tree with zero
    /// client content in the 13:07:59 capture.
    /// </summary>
    public bool RequireVisible { get; init; }

    /// <summary>Legacy shape: a bare title hint and nothing else.</summary>
    public static WindowSelectionCriteria FromTitleHint(string? hint) => new() { TitleContains = hint };
}

/// <summary>
/// Pure, testable choice of WHICH enumerated top-level window to bind.
///
/// Two entry points, deliberately different:
/// <list type="bullet">
/// <item><see cref="Choose"/> — the original lenient discovery walk. It always
/// returns something if any window exists, because a best-effort read-only
/// capture of the wrong window is still evidence. Unchanged behaviour.</item>
/// <item><see cref="Select"/> — strict and fail-closed. Exclusions are
/// absolute, scoring is deterministic, and a tie at the top score is
/// <see cref="WindowSelectionStatus.Ambiguous"/> rather than a coin flip.
/// Anything that intends to ACT on a window must use this.</item>
/// </list>
/// </summary>
public static class WindowSelection
{
    // Ranked so that a stronger signal can never be outvoted by a pile of
    // weaker ones: an exact title match (1000) exceeds every other signal
    // combined (100 + 40 + 20 + 10 = 170).
    private const int ScoreTitleEquals = 1000;
    private const int ScoreTitleContains = 100;
    private const int ScorePreferredClass = 40;
    private const int ScoreVisible = 20;
    private const int ScoreOnPrimaryProcess = 10;

    /// <summary>
    /// Strict selection. Returns <see cref="WindowSelectionStatus.Selected"/>
    /// only when exactly one window holds the highest score and scored above
    /// zero, so a caller can never act on a window chosen by enumeration order.
    /// </summary>
    public static WindowSelectionResult Select(
        IReadOnlyList<TopLevelWindowInfo> windows,
        WindowSelectionCriteria criteria,
        int primaryPid)
    {
        if (windows is null || windows.Count == 0)
            return new WindowSelectionResult(WindowSelectionStatus.NoCandidate, null, "no top-level windows were enumerated");

        criteria ??= new WindowSelectionCriteria();

        var eligible = new List<TopLevelWindowInfo>();
        var rejected = new List<string>();

        foreach (var w in windows)
        {
            if (criteria.RequireVisible && !w.Visible)
            {
                rejected.Add($"{Describe(w)}: not visible");
                continue;
            }

            var badTitle = criteria.TitleExcludes.FirstOrDefault(x =>
                !string.IsNullOrWhiteSpace(x)
                && !string.IsNullOrEmpty(w.Title)
                && w.Title!.Contains(x, StringComparison.OrdinalIgnoreCase));
            if (badTitle is not null)
            {
                rejected.Add($"{Describe(w)}: title excluded by '{badTitle}'");
                continue;
            }

            var badClass = criteria.ExcludedClassNames.FirstOrDefault(x =>
                !string.IsNullOrWhiteSpace(x)
                && string.Equals(w.ClassName, x, StringComparison.OrdinalIgnoreCase));
            if (badClass is not null)
            {
                rejected.Add($"{Describe(w)}: class excluded by '{badClass}'");
                continue;
            }

            eligible.Add(w);
        }

        if (eligible.Count == 0)
        {
            return new WindowSelectionResult(
                WindowSelectionStatus.NoCandidate,
                null,
                $"all {windows.Count} enumerated window(s) were excluded: {string.Join("; ", rejected)}");
        }

        var scored = eligible
            .Select(w => (Window: w, Score: ScoreOf(w, criteria, primaryPid)))
            .Where(x => x.Score > 0)
            .ToList();

        if (scored.Count == 0)
        {
            return new WindowSelectionResult(
                WindowSelectionStatus.NoCandidate,
                null,
                $"{eligible.Count} window(s) survived exclusion but none matched any positive criterion "
                + $"(titleEquals='{criteria.TitleEquals}', titleContains='{criteria.TitleContains}', "
                + $"preferredClasses=[{string.Join(",", criteria.PreferredClassNames)}])");
        }

        var top = scored.Max(x => x.Score);
        var winners = scored.Where(x => x.Score == top).ToList();

        if (winners.Count > 1)
        {
            return new WindowSelectionResult(
                WindowSelectionStatus.Ambiguous,
                null,
                $"{winners.Count} windows tie at score {top} — refusing to guess: "
                + string.Join("; ", winners.Select(x => Describe(x.Window))));
        }

        return new WindowSelectionResult(
            WindowSelectionStatus.Selected,
            winners[0].Window,
            $"selected {Describe(winners[0].Window)} at score {top} "
            + $"(next best {(scored.Count > 1 ? scored.Where(x => x.Score < top).Max(x => x.Score) : 0)})");
    }

    private static int ScoreOf(TopLevelWindowInfo w, WindowSelectionCriteria criteria, int primaryPid)
    {
        var score = 0;

        if (!string.IsNullOrWhiteSpace(criteria.TitleEquals)
            && !string.IsNullOrEmpty(w.Title)
            && string.Equals(w.Title!.Trim(), criteria.TitleEquals!.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            score += ScoreTitleEquals;
        }

        if (!string.IsNullOrWhiteSpace(criteria.TitleContains)
            && !string.IsNullOrEmpty(w.Title)
            && w.Title!.Contains(criteria.TitleContains!, StringComparison.OrdinalIgnoreCase))
        {
            score += ScoreTitleContains;
        }

        if (criteria.PreferredClassNames.Any(c =>
                !string.IsNullOrWhiteSpace(c) && string.Equals(w.ClassName, c, StringComparison.OrdinalIgnoreCase)))
        {
            score += ScorePreferredClass;
        }

        // Visibility and process affinity only ever break ties between windows
        // that already matched something; they never make a match on their own.
        if (score > 0)
        {
            if (w.Visible) score += ScoreVisible;
            if (w.ProcessId == primaryPid) score += ScoreOnPrimaryProcess;
        }

        return score;
    }

    private static string Describe(TopLevelWindowInfo w) =>
        $"[{w.Handle} '{w.Title}' class={w.ClassName} visible={w.Visible} pid={w.ProcessId}]";

    /// <summary>
    /// Lenient discovery selection — UNCHANGED behaviour, retained for the
    /// read-only capture path where binding *something* still yields evidence.
    /// The first live capture proved this matters: IPSClient.exe owns ~15
    /// top-level windows — empty WinForms shells, transient "Overwrite …"
    /// dialogs, IME/GDI helper windows, and the real terminal window
    /// "IPS Client - Terminal 1". Binding the first one gave a 2-node empty
    /// tree.
    ///
    /// Do NOT use this to pick a window to act on: its fallback chain will
    /// happily return an unrelated window. Use <see cref="Select"/> instead.
    /// </summary>
    public static TopLevelWindowInfo? Choose(IReadOnlyList<TopLevelWindowInfo> windows, string? titleHint, int primaryPid)
    {
        if (windows is null || windows.Count == 0) return null;

        bool OnPrimary(TopLevelWindowInfo w) => w.ProcessId == primaryPid;
        bool TitleMatches(TopLevelWindowInfo w) =>
            !string.IsNullOrWhiteSpace(titleHint)
            && !string.IsNullOrEmpty(w.Title)
            && w.Title!.Contains(titleHint!, StringComparison.OrdinalIgnoreCase);

        // 1. A title-hint match — the real terminal window, on the primary
        //    process first, then any process.
        var hit = windows.FirstOrDefault(w => OnPrimary(w) && TitleMatches(w))
                  ?? windows.FirstOrDefault(TitleMatches);
        if (hit is not null) return hit;

        // 2. Any window with a non-empty title on the primary, then anywhere.
        //    (Falls back before visibility because this venue's terminal
        //    windows can report not-visible while still walkable via UIA.)
        var titled = windows.FirstOrDefault(w => OnPrimary(w) && !string.IsNullOrWhiteSpace(w.Title))
                     ?? windows.FirstOrDefault(w => !string.IsNullOrWhiteSpace(w.Title));
        if (titled is not null) return titled;

        // 3. Last resort: a visible window, else the primary's first, else any.
        return windows.FirstOrDefault(w => OnPrimary(w) && w.Visible)
               ?? windows.FirstOrDefault(OnPrimary)
               ?? windows.FirstOrDefault(w => w.Visible)
               ?? windows[0];
    }

    /// <summary>
    /// Lenient selection that still honours exclusions. This is what the
    /// read-only capture path uses: it keeps the best-effort fallback (so a
    /// capture still produces evidence) but can never bind a window the
    /// profile explicitly disqualified — which is precisely the 13:07:59
    /// back-office failure.
    /// </summary>
    public static TopLevelWindowInfo? Choose(
        IReadOnlyList<TopLevelWindowInfo> windows,
        WindowSelectionCriteria criteria,
        int primaryPid)
    {
        if (windows is null || windows.Count == 0) return null;
        criteria ??= new WindowSelectionCriteria();

        var strict = Select(windows, criteria, primaryPid);
        if (strict.IsSelected) return strict.Window;

        // Fall back to the lenient chain, but only across windows that the
        // criteria did not disqualify.
        var permitted = windows.Where(w =>
            !criteria.TitleExcludes.Any(x =>
                !string.IsNullOrWhiteSpace(x)
                && !string.IsNullOrEmpty(w.Title)
                && w.Title!.Contains(x, StringComparison.OrdinalIgnoreCase))
            && !criteria.ExcludedClassNames.Any(x =>
                !string.IsNullOrWhiteSpace(x)
                && string.Equals(w.ClassName, x, StringComparison.OrdinalIgnoreCase))).ToList();

        return permitted.Count == 0 ? null : Choose(permitted, criteria.TitleContains, primaryPid);
    }
}
