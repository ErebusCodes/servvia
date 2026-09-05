namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// The canonical, ordered intent of a native round, as human-readable
/// steps. Shared so the dry-run CLI, the fake, and the fail-closed Windows
/// driver all describe the SAME plan rather than three drifting copies.
/// Building the plan touches nothing — it is pure text.
///
/// <b>Rebuilt 2026-09-05.</b> This used to be a hand-written ten-line string
/// array that mentioned a "Save-to-Table / Send action". The native workflow
/// has no Save button, and the hand-written text could not drift-check
/// against what the driver actually did. It now renders the typed
/// <see cref="NativeRoundPlan"/>, so the description and the execution model
/// are the same object.
/// </summary>
public static class TerminalActionPlan
{
    public static IReadOnlyList<string> Build(TerminalRoundRequest request) =>
        NativeRoundPlan.Describe(NativeRoundPlan.Build(request));
}
