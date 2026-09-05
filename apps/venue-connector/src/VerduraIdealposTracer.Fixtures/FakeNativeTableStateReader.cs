using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Fixtures;

/// <summary>
/// Reads the pre-send fingerprint out of <see cref="FakeTerminalTableState"/>.
///
/// It exists so tests can exercise the real §10 shape —
/// <c>pre-send + expected = delta</c> — rather than the degenerate one the
/// orchestrator used to produce by passing a null baseline.
/// UNIT_OR_MOCK evidence only; not a real POSServer reader.
/// </summary>
public sealed class FakeNativeTableStateReader(FakeTerminalTableState tableState) : INativeTableStateReader
{
    /// <summary>Set to have the reader fail, exercising the "no baseline, do not send" path.</summary>
    public Exception? FailWith { get; set; }

    public int ReadCount { get; private set; }

    public Task<TableSaleFingerprint?> ReadAsync(string tableCode, string? map, CancellationToken cancellationToken)
    {
        ReadCount++;
        if (FailWith is not null) throw FailWith;
        return Task.FromResult(tableState.Fingerprint(tableCode));
    }
}
