namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>
/// The real native-confirmation client: a THIN adapter over a read-only table
/// reader plus the pure <see cref="TerminalConfirmationEvaluator"/>.
///
/// It invents no confirmation rules. Its entire job is to obtain the "after"
/// term and hand it, unchanged, to the evaluator along with the caller's
/// pre-send baseline and expected items. Every verdict — Confirmed,
/// ExpectedItemMissing, UnexpectedDuplicate, PriorLinesChanged, Ambiguous,
/// TableMissing, Inconclusive — is the evaluator's. That separation is the
/// point: the rules live in one pure, exhaustively tested function, and adding
/// a rule here would create a second, untested opinion about native truth.
///
/// WHAT A READBACK CAN AND CANNOT ESTABLISH. A before/after delta matching the
/// expected round is strong RECONCILIATION evidence. It is not CAUSAL identity.
/// No native field binds a sale or a line to a Verdura order — the 2026-09-05
/// run looked for one across PendingSales, PendingSaleLines, TableMapSetups,
/// TableActivity and ~SENDSTAT and found none. So if concurrent human activity
/// could have produced the same apparent transition, the evaluator says
/// Ambiguous and the round goes to manual resolution. This adapter must never
/// soften that, and structurally cannot: it does not decide.
///
/// It is strictly read-only, and it never writes to POSServer.
/// </summary>
public sealed class PosServerConfirmationClient(PosServerTableStateReader reader) : IPosServerConfirmationClient
{
    /// <summary>
    /// Reads current native state and delegates the verdict.
    ///
    /// A read that cannot resolve — POSServer unreachable, or two sales
    /// matching one table context — is NOT passed to the evaluator as a null
    /// "after". Null means "no sale exists", which the evaluator legitimately
    /// reads as TableMissing; an unreadable database is a different fact and
    /// would be a false negative that could later be retried into a resend.
    /// Those cases throw, and TerminalRoundService records UNCERTAIN with the
    /// reason attached — a state that reconciles later and never resends.
    /// </summary>
    public async Task<TerminalConfirmationResult> ConfirmRoundAsync(
        TerminalRoundKind roundKind,
        string requestedTable,
        string? map,
        TableSaleFingerprint? beforeFingerprint,
        IReadOnlyList<TerminalRoundItem> expectedNewItems,
        CancellationToken cancellationToken)
    {
        // Prefer the map the caller's own pre-send snapshot observed, so both
        // terms of the delta are read from the same table context.
        var mapContext = map ?? beforeFingerprint?.Map;

        var read = await reader.ReadTableAsync(requestedTable, mapContext, cancellationToken);

        var after = read.Status switch
        {
            NativeTableReadStatus.NoOpenSale => null,
            NativeTableReadStatus.Observed => read.Fingerprint,
            NativeTableReadStatus.Ambiguous => throw new NativeCapabilityUnavailableException(
                "Native confirmation", read.Reason ?? "the native state is ambiguous"),
            NativeTableReadStatus.Unavailable => throw new NativeCapabilityUnavailableException(
                "Native confirmation", read.Reason ?? "POSServer could not be read"),
            _ => throw new NativeCapabilityUnavailableException(
                "Native confirmation", $"unhandled read status {read.Status}"),
        };

        return TerminalConfirmationEvaluator.Evaluate(
            roundKind, requestedTable, beforeFingerprint, after, expectedNewItems);
    }
}
