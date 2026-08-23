namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// The complete, truthful result of one discovery-tracer run. Every
/// dimension in Story 9-2's "Required state and result separation" list is
/// represented as its own field, defaulting to <see cref="TracerOutcomeState.NotAttempted"/>.
/// A discovery-only run (this story's actual scope) leaves every dimension
/// from <see cref="IdealposOrderAccepted"/> onward at its default —
/// enforced by <see cref="AssertDiscoveryOnlyInvariant"/>, not merely by
/// convention.
/// </summary>
public sealed record DiscoveryTraceResult
{
    public required string CommandId { get; init; }
    public required DateTimeOffset StartedAtUtc { get; init; }
    public DateTimeOffset? CompletedAtUtc { get; init; }

    // ── Connector-protocol dimensions (Story 2-10 vocabulary) ──
    public TracerOutcomeState ConnectorCommandDelivery { get; init; } = TracerOutcomeState.NotAttempted;
    public TracerOutcomeState ConnectorDurableAcceptance { get; init; } = TracerOutcomeState.NotAttempted;

    // ── Idealpos discovery dimensions — this story's actual scope ──
    public TracerOutcomeState IdealposProcessDetected { get; init; } = TracerOutcomeState.NotAttempted;
    public TracerOutcomeState IdealposUiProfileMatched { get; init; } = TracerOutcomeState.NotAttempted;
    public TracerOutcomeState IdealposInteractionAttempted { get; init; } = TracerOutcomeState.NotAttempted;

    // ── Everything below is explicitly OUT OF SCOPE for this story. Every
    // real run must leave these at NotAttempted — see
    // AssertDiscoveryOnlyInvariant. They exist as named fields (not simply
    // omitted) so a future real order-submit story extends this same
    // result shape instead of inventing a parallel one, and so "we never
    // attempted this" is an explicit, auditable fact rather than an
    // absence someone could misread as "unknown." ──
    public TracerOutcomeState IdealposOrderAccepted { get; init; } = TracerOutcomeState.NotAttempted;
    public string? IdealposTransactionReference { get; init; }
    public TracerOutcomeState EftposInitiatedState { get; init; } = TracerOutcomeState.NotAttempted;
    public EftposResultState EftposResult { get; init; } = EftposResultState.NotAttempted;
    public TracerOutcomeState KdsAccepted { get; init; } = TracerOutcomeState.NotAttempted;
    public KotResultState KotResult { get; init; } = KotResultState.NotAttempted;

    public string? FailClosedReason { get; init; }
    public IReadOnlyList<string> Diagnostics { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Throws if any out-of-scope dimension was populated — a structural
    /// backstop (not just a code-review convention) against this tracer
    /// ever silently claiming Idealpos order, EFTPOS, KDS, or KOT success.
    /// Called by every code path that produces a final result, and
    /// asserted in tests.
    /// </summary>
    public void AssertDiscoveryOnlyInvariant()
    {
        var violations = new List<string>();
        if (IdealposOrderAccepted != TracerOutcomeState.NotAttempted)
            violations.Add(nameof(IdealposOrderAccepted));
        if (IdealposTransactionReference is not null)
            violations.Add(nameof(IdealposTransactionReference));
        if (EftposInitiatedState != TracerOutcomeState.NotAttempted)
            violations.Add(nameof(EftposInitiatedState));
        if (EftposResult != EftposResultState.NotAttempted)
            violations.Add(nameof(EftposResult));
        if (KdsAccepted != TracerOutcomeState.NotAttempted)
            violations.Add(nameof(KdsAccepted));
        if (KotResult != KotResultState.NotAttempted)
            violations.Add(nameof(KotResult));

        if (violations.Count > 0)
        {
            throw new InvalidOperationException(
                "Discovery-only tracer run produced a result outside its scope: "
                + string.Join(", ", violations)
                + ". This tracer must never report Idealpos order, EFTPOS, KDS or KOT outcomes.");
        }
    }
}
