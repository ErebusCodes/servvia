using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Fixtures;

/// <summary>
/// A fake native-confirmation client backed by <see cref="FakeTerminalTableState"/>.
/// It captures a per-table "last confirmed" fingerprint so a second round
/// is evaluated against the real prior state (the delta), and always
/// delegates the decision to the pure
/// <see cref="TerminalConfirmationEvaluator"/> — never inventing its own.
/// UNIT_OR_MOCK evidence only; not a real POSServer reader.
/// </summary>
public sealed class FakePosServerConfirmationClient(FakeTerminalTableState tableState) : IPosServerConfirmationClient
{
    private readonly Dictionary<string, TableSaleFingerprint> _lastConfirmed = new(StringComparer.OrdinalIgnoreCase);

    public Task<TerminalConfirmationResult> ConfirmRoundAsync(
        TerminalRoundKind roundKind,
        string requestedTable,
        string? map,
        TableSaleFingerprint? beforeFingerprint,
        IReadOnlyList<TerminalRoundItem> expectedNewItems,
        CancellationToken cancellationToken)
    {
        var key = requestedTable.Trim();
        var after = tableState.Fingerprint(requestedTable);

        // Prefer an explicit before-fingerprint; otherwise use the snapshot
        // captured at this table's previous confirmation.
        TableSaleFingerprint? before = beforeFingerprint;
        if (before is null && roundKind == TerminalRoundKind.SecondRound)
        {
            _lastConfirmed.TryGetValue(key, out before);
        }

        var result = TerminalConfirmationEvaluator.Evaluate(roundKind, requestedTable, before, after, expectedNewItems);

        if (after is not null)
        {
            _lastConfirmed[key] = after;
        }
        return Task.FromResult(result);
    }
}
