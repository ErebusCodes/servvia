namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// Which round of a native table sale this request represents. Kept as an
/// explicit dimension (not inferred from "does the table already exist")
/// so the fake, the confirmation evaluator, and a future real driver all
/// agree on intent rather than guessing it from observed state.
/// </summary>
public enum TerminalRoundKind
{
    FirstRound,
    SecondRound,
}

/// <summary>
/// One line of a native terminal round. Carries ONLY the native stock code
/// and a quantity — there is deliberately NO price field. IdealPOS is the
/// sole pricing authority (DL-109 §6, DL-110 §3): the agent physically
/// cannot send a price because the model has nowhere to put one. Any price
/// that ever appears does so only as an <see cref="ObservedTerminalLine"/>
/// on a result — an observation read back FROM IdealPOS, never an input.
/// </summary>
public sealed record TerminalRoundItem(string NativeCode, int Quantity);

/// <summary>
/// The complete input to one native "Save to Table" round.
///
/// A second round (see <see cref="TerminalRoundKind.SecondRound"/>) carries
/// ONLY the new items for that round — it never replays first-round items.
/// Retaining prior lines is IdealPOS's native NEWLINES-append behaviour
/// (DL-113 §5), not something this request re-sends.
/// </summary>
public sealed record TerminalRoundRequest
{
    public required string ExternalOrderId { get; init; }
    public required string RoundId { get; init; }
    public required TerminalRoundKind RoundKind { get; init; }

    /// <summary>
    /// A non-financial correlation reference for this Verdura order. Whether
    /// it can be written into a native IPS sale field is
    /// <c>PENDING_REAL_UI_DISCOVERY</c> (see TerminalRoundService's remarks
    /// and the P0 report): until a legitimate non-financial sale-screen
    /// field is proven from live discovery, this value lives only in the
    /// agent's own durable state and is NOT written into IPS.
    /// </summary>
    public required string OrderReference { get; init; }

    public required string TableCode { get; init; }

    public required IReadOnlyList<TerminalRoundItem> Items { get; init; }

    /// <summary>
    /// Structural validation. Rejects empty rounds, non-positive quantities,
    /// and blank native codes. There is no price to validate because there
    /// is no price field — that invariant is enforced by the type, not here.
    /// </summary>
    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(ExternalOrderId)) errors.Add("ExternalOrderId is required.");
        if (string.IsNullOrWhiteSpace(RoundId)) errors.Add("RoundId is required.");
        if (string.IsNullOrWhiteSpace(TableCode)) errors.Add("TableCode is required.");
        if (Items is null || Items.Count == 0)
        {
            errors.Add("A round must carry at least one item.");
        }
        else
        {
            foreach (var item in Items)
            {
                if (string.IsNullOrWhiteSpace(item.NativeCode)) errors.Add("Every item must have a native code.");
                if (item.Quantity <= 0) errors.Add($"Item '{item.NativeCode}' has a non-positive quantity.");
            }
        }
        return errors;
    }
}

/// <summary>
/// A price OBSERVED on a native line, read back from IdealPOS as evidence.
/// Present on results only. Its existence here — and its total absence from
/// <see cref="TerminalRoundItem"/> — is the whole point: prices flow out of
/// IdealPOS, never into it.
/// </summary>
public sealed record ObservedTerminalLine(string NativeCode, int Quantity, decimal? ObservedNativeUnitPrice);

/// <summary>
/// Every distinguishable outcome of an attempted native round. A structured
/// result rather than a bool so the orchestrator can tell a
/// safe-to-retry pre-send refusal (<see cref="ControlNotFound"/>) apart
/// from genuinely uncertain territory (<see cref="Timeout"/>).
/// </summary>
public enum TerminalExecutionOutcome
{
    /// <summary>The native round completed and the send was reached.</summary>
    Success,

    /// <summary>A dry-run plan was produced; no UI was touched.</summary>
    DryRun,

    /// <summary>A required control could not be located — fail-closed, pre-send, retryable.</summary>
    ControlNotFound,

    /// <summary>The visible screen was not the expected native sale/table screen — fail-closed, pre-send.</summary>
    UnexpectedScreen,

    /// <summary>A modal dialog was blocking interaction — fail-closed, pre-send.</summary>
    ModalDetected,

    /// <summary>The entered PLU did not resolve to the expected native item — fail-closed, pre-send.</summary>
    PluResolutionMismatch,

    /// <summary>The native quantity did not match what was requested — fail-closed, pre-send.</summary>
    QuantityMismatch,

    /// <summary>The native price could not be read back for verification.</summary>
    NativePriceUnreadable,

    /// <summary>The Save-to-Table / Send action could not be reached.</summary>
    SendNotReached,

    /// <summary>The operation timed out.</summary>
    Timeout,

    /// <summary>The outcome cannot be determined safely — never auto-retried.</summary>
    Uncertain,
}

/// <summary>
/// The structured result of <see cref="Automation.IIdealposUiAutomationClient.AttemptSaveToTableAsync"/>.
/// </summary>
public sealed record TerminalSaveToTableResult
{
    public required TerminalExecutionOutcome Outcome { get; init; }
    public required string RoundId { get; init; }
    public required string TableCode { get; init; }

    /// <summary>
    /// Whether the attempt crossed the point of no return — the moment the
    /// native Send/Save-to-Table action was actually invoked. A fail-closed
    /// refusal always leaves this <c>false</c>; only a real send sets it
    /// <c>true</c>. The orchestrator uses this, not the outcome alone, to
    /// decide whether a retry is safe.
    /// </summary>
    public bool SendBoundaryCrossed { get; init; }

    /// <summary>Whether this attempt mutated IPS. In this phase it is always false.</summary>
    public bool Mutated { get; init; }

    /// <summary>The intended, ordered action plan — populated for dry-run and for fail-closed diagnostics.</summary>
    public IReadOnlyList<string> ActionPlan { get; init; } = Array.Empty<string>();

    /// <summary>Prices read back FROM IdealPOS, if any were observed. Never an input.</summary>
    public IReadOnlyList<ObservedTerminalLine> ObservedLines { get; init; } = Array.Empty<ObservedTerminalLine>();

    public string? FailClosedReason { get; init; }
    public IReadOnlyList<string> Diagnostics { get; init; } = Array.Empty<string>();

    public bool IsFailClosed =>
        Outcome is TerminalExecutionOutcome.ControlNotFound
            or TerminalExecutionOutcome.UnexpectedScreen
            or TerminalExecutionOutcome.ModalDetected
            or TerminalExecutionOutcome.PluResolutionMismatch
            or TerminalExecutionOutcome.QuantityMismatch;

    public static TerminalSaveToTableResult DryRun(string roundId, string tableCode, IReadOnlyList<string> plan) => new()
    {
        Outcome = TerminalExecutionOutcome.DryRun,
        RoundId = roundId,
        TableCode = tableCode,
        SendBoundaryCrossed = false,
        Mutated = false,
        ActionPlan = plan,
    };

    public static TerminalSaveToTableResult FailClosed(
        TerminalExecutionOutcome outcome, string roundId, string tableCode, string reason, IReadOnlyList<string> plan) => new()
    {
        Outcome = outcome,
        RoundId = roundId,
        TableCode = tableCode,
        SendBoundaryCrossed = false,
        Mutated = false,
        ActionPlan = plan,
        FailClosedReason = reason,
    };

    /// <summary>
    /// Structural backstop: a fail-closed or dry-run result must never claim
    /// a mutation or a crossed send boundary. Called by the orchestrator on
    /// every result it handles and asserted in tests.
    /// </summary>
    public void AssertHonestFailClosed()
    {
        if ((Outcome == TerminalExecutionOutcome.DryRun || IsFailClosed) && (Mutated || SendBoundaryCrossed))
        {
            throw new InvalidOperationException(
                $"Result outcome {Outcome} must not report Mutated/SendBoundaryCrossed — a refusal cannot also be a mutation.");
        }
    }
}
