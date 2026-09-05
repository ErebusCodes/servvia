using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Fixtures;

/// <summary>
/// A fake native-confirmation client backed by <see cref="FakeTerminalTableState"/>.
/// It reads the CURRENT table fingerprint as the "after" term and always
/// delegates the decision to the pure
/// <see cref="TerminalConfirmationEvaluator"/> — never inventing its own.
/// UNIT_OR_MOCK evidence only; not a real POSServer reader.
///
/// It deliberately does NOT keep a "last confirmed" fingerprint of its own.
/// An earlier version did, and silently substituted that cached snapshot
/// whenever the caller passed <c>beforeFingerprint: null</c> — which made a
/// second round look CONFIRMED even though the orchestrator had supplied no
/// baseline at all. That is a capability no real POSServer client has (the
/// pre-send state is knowable only to whoever captured it before the send),
/// so the fixture must not have it either: the baseline now comes from the
/// caller or the round is honestly unattributable.
/// </summary>
public sealed class FakePosServerConfirmationClient(FakeTerminalTableState tableState) : IPosServerConfirmationClient
{
    public Task<TerminalConfirmationResult> ConfirmRoundAsync(
        TerminalRoundKind roundKind,
        string requestedTable,
        string? map,
        TableSaleFingerprint? beforeFingerprint,
        IReadOnlyList<TerminalRoundItem> expectedNewItems,
        CancellationToken cancellationToken)
    {
        var after = tableState.Fingerprint(requestedTable);
        var result = TerminalConfirmationEvaluator.Evaluate(
            roundKind, requestedTable, beforeFingerprint, after, expectedNewItems);
        return Task.FromResult(result);
    }
}
