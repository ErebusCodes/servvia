namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// Pure, testable choice of WHICH enumerated top-level window to bind and
/// walk. The first live capture proved this matters: IPSClient.exe owns ~15
/// top-level windows — empty WinForms shells, transient "Overwrite …"
/// dialogs, IME/GDI helper windows, and the real terminal window
/// "IPS Client - Terminal 1". Binding the first one gave a 2-node empty
/// tree. The title hint (from the profile) is what disambiguates the real
/// terminal window from the noise.
/// </summary>
public static class WindowSelection
{
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
}
