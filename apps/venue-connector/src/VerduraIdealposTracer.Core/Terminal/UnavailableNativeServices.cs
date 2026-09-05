namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// Thrown when a native dependency the round pipeline requires does not exist
/// in this build. Carries no partial result and no default — it is raised
/// specifically so that nothing downstream can mistake "unavailable" for
/// "nothing was there".
/// </summary>
public sealed class NativeCapabilityUnavailableException(string what, string why)
    : InvalidOperationException($"{what} is not available in this build: {why}")
{
    public string What { get; } = what;
    public string Why { get; } = why;
}

/// <summary>
/// The production <see cref="INativeTableStateReader"/> for a build that has no
/// POSServer reader yet — it refuses, loudly, every time.
///
/// WHY THIS EXISTS RATHER THAN NOTHING. TerminalRoundService requires a reader:
/// a round with no pre-send baseline can never be attributed afterwards, so
/// "no reader" was deliberately made unrepresentable. That leaves two options
/// for a build with no real reader — don't construct the pipeline at all, or
/// construct it with a dependency that cannot lie. The second is better,
/// because it means the composition root, the DI graph and the round lifecycle
/// are all real and exercised, and the ONLY thing missing is the piece that
/// genuinely does not exist yet.
///
/// WHY IT IS NOT A FAKE. A fake returns a plausible answer. This returns no
/// answer at all. TerminalRoundService catches the throw before the send
/// boundary and records FAILED_BEFORE_SEND — pre-send, retryable, with the
/// native driver never invoked. So a native round attempted on this build
/// stops cleanly and truthfully instead of proceeding on an invented baseline.
///
/// It is replaced — not edited — when a real POSServer reader exists.
/// </summary>
public sealed class UnavailableNativeTableStateReader : INativeTableStateReader
{
    public const string Reason =
        "no POSServer table-state reader is implemented yet; a native round must not be sent without a pre-send "
        + "baseline it can be reconciled against";

    public Task<TableSaleFingerprint?> ReadAsync(string tableCode, string? map, CancellationToken cancellationToken) =>
        throw new NativeCapabilityUnavailableException("The native table-state reader", Reason);
}

/// <summary>
/// The production <see cref="IPosServerConfirmationClient"/> for a build with
/// no POSServer confirmation reader.
///
/// It refuses rather than returning any <see cref="TerminalConfirmationResult"/>
/// at all — including an "inconclusive" one. Returning inconclusive would be a
/// judgement about native state, and this type has looked at no native state;
/// the honest report is that confirmation could not be attempted. The service
/// turns the throw into UNCERTAIN with the reason attached, which is a state
/// that reconciles later and never resends.
///
/// Registering this deliberately in place of <c>null</c> keeps the distinction
/// visible in the object graph: <c>null</c> means "this deployment chose not to
/// confirm", while this type means "this build cannot yet".
/// </summary>
public sealed class UnavailablePosServerConfirmationClient : IPosServerConfirmationClient
{
    public const string Reason =
        "no POSServer confirmation reader is implemented yet; native acceptance cannot be proven, and UI completion "
        + "alone is never confirmation";

    public Task<TerminalConfirmationResult> ConfirmRoundAsync(
        TerminalRoundKind roundKind,
        string requestedTable,
        string? map,
        TableSaleFingerprint? beforeFingerprint,
        IReadOnlyList<TerminalRoundItem> expectedNewItems,
        CancellationToken cancellationToken) =>
        throw new NativeCapabilityUnavailableException("The POSServer confirmation client", Reason);
}
