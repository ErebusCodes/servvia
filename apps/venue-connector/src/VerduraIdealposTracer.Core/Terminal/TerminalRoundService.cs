using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;

namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// Orchestrates one native terminal round with durable idempotency around
/// the irreversible send boundary. This is the class that guarantees "one
/// Verdura round → at most one native drive of the UI":
///
///   * A duplicate (ExternalOrderId, RoundId) whose state is already at or
///     beyond <see cref="TerminalRoundStatus.SEND_INITIATED"/> returns the
///     existing state and NEVER drives the UI again.
///   * The PRE-SEND native snapshot is captured and persisted BEFORE the
///     send boundary, so a reconciliation running after a crash — in a
///     different process — still has the "before" term it needs.
///   * <see cref="TerminalRoundStatus.SEND_INITIATED"/> is persisted (and a
///     crash hook fired) BEFORE the automation client is invoked, so a
///     crash mid-drive replays as "uncertain, do not resend" rather than
///     silently double-sending.
///   * Only a clean return proving no send occurred downgrades to
///     <see cref="TerminalRoundStatus.FAILED_BEFORE_SEND"/>, which is the
///     one post-attempt state that is safe to retry.
///   * <see cref="TerminalRoundStatus.CONFIRMED"/> is reached ONLY via a
///     native confirmation of the expected delta — never from UI completion
///     alone.
///   * An outcome that cannot be attributed to this round lands on
///     <see cref="TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED"/> rather
///     than being retried or confirmed.
///   * The round-kind preconditions — round 1 needs a FREE native table,
///     round 2 needs an EXISTING native sale — are checked against that
///     pre-send snapshot BEFORE the boundary, so a violation is a retryable
///     no-op refusal instead of a mutation nobody can attribute.
///
/// It performs no UI work itself; it depends on
/// <see cref="IIdealposUiAutomationClient"/> (fake in tests, fail-closed
/// driver in production) and on a REQUIRED
/// <see cref="INativeTableStateReader"/> — a round with no baseline can
/// never be attributed afterwards, so the service refuses to be constructed
/// without one. An <see cref="IPosServerConfirmationClient"/> remains
/// optional: without it a round stops honestly at
/// <see cref="TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION"/> and never
/// claims CONFIRMED.
/// </summary>
public sealed class TerminalRoundService(
    IIdealposUiAutomationClient automationClient,
    TerminalRoundStateStore stateStore,
    INativeTableStateReader tableStateReader,
    IPosServerConfirmationClient? confirmationClient = null,
    CrashHook? crashHook = null)
{
    private readonly CrashHook _crashHook = crashHook ?? (_ => { });

    /// <summary>
    /// Executes (or idempotently short-circuits) one round and returns the
    /// resulting durable state. Never throws for a business outcome — only
    /// for a truly unexpected fault, and even then the last durable state
    /// written before the fault is the record of record.
    /// </summary>
    public async Task<TerminalRoundStateEntry> ExecuteRoundAsync(TerminalRoundRequest request, CancellationToken cancellationToken)
    {
        var validationErrors = request.Validate();
        if (validationErrors.Count > 0)
        {
            var invalid = new TerminalRoundStateEntry
            {
                ExternalOrderId = request.ExternalOrderId ?? "(missing)",
                RoundId = request.RoundId ?? "(missing)",
                TableCode = request.TableCode ?? "(missing)",
                Status = TerminalRoundStatus.FAILED_BEFORE_SEND,
                Items = request.Items ?? Array.Empty<TerminalRoundItem>(),
                Detail = "invalid request: " + string.Join("; ", validationErrors),
            };
            stateStore.Record(invalid);
            return invalid;
        }

        // ── Idempotency gate ──
        var existing = stateStore.Find(request.ExternalOrderId, request.RoundId);
        if (existing is not null && TerminalRoundStateStore.IsPastSendBoundary(existing.Status))
        {
            // At or beyond the send boundary — returning the existing state
            // is the whole point. The UI is NOT driven again.
            return existing;
        }

        // RECEIVED (fresh) or a retry of FAILED_BEFORE_SEND both proceed.
        Persist(request, TerminalRoundStatus.RECEIVED, "round received");

        // ── Pre-send snapshot (read-only, pre-boundary, safe to retry) ──
        // Captured BEFORE committing to the drive so that the "before" term
        // of the delta exists even if this process dies mid-send. The reader
        // is a REQUIRED dependency: a round with no baseline can never be
        // attributed afterwards, so "no reader" must be unrepresentable
        // rather than a silent downgrade to a vacuous comparison.
        TableSaleFingerprint? preSend;
        try
        {
            preSend = await tableStateReader.ReadAsync(request.TableCode, map: null, cancellationToken);
        }
        catch (Exception ex)
        {
            // Nothing has been sent. Refusing here is safe and keeps the
            // round retryable, which is strictly better than sending
            // without a baseline we could later reconcile against.
            return Persist(request, TerminalRoundStatus.FAILED_BEFORE_SEND,
                $"could not capture the pre-send native snapshot ({ex.GetType().Name}: {ex.Message}) — not sending without a baseline");
        }

        // ── Round-kind preconditions, checked BEFORE the send boundary ──
        // The old code carried these rules only in the post-send evaluator,
        // which meant an occupied table (round 1) or a missing table sale
        // (round 2) was discovered ONLY AFTER the UI had already been driven
        // — the mutation had happened and the round was merely declared
        // unattributable. Refusing here converts an unresolvable round into a
        // safe, retryable, no-op refusal.
        var precondition = EvaluatePreSendPrecondition(request.RoundKind, request.TableCode, preSend);
        if (precondition is not null)
        {
            return Persist(request, TerminalRoundStatus.FAILED_BEFORE_SEND, precondition, preSend);
        }

        // Commit to driving the UI: persist the irreversible marker AND the
        // snapshot BEFORE the call, so any interruption during the drive
        // replays as "do not resend" with its baseline intact.
        Persist(request, TerminalRoundStatus.SEND_INITIATED, "committing to native drive", preSend);
        _crashHook("send_initiated");

        TerminalSaveToTableResult result;
        try
        {
            result = await automationClient.AttemptSaveToTableAsync(request, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            return Persist(request, TerminalRoundStatus.UNCERTAIN,
                "attempt cancelled/timed out after send boundary — reconcile before retry", preSend);
        }

        result.AssertHonestFailClosed();

        // A refusal that provably never reached the send is safe to retry.
        if (!result.SendBoundaryCrossed && (result.IsFailClosed || result.Outcome == TerminalExecutionOutcome.DryRun))
        {
            var detail = result.Outcome == TerminalExecutionOutcome.DryRun
                ? "dry-run — no mutation"
                : $"fail-closed before send: {result.Outcome} ({result.FailClosedReason})";
            return Persist(request, TerminalRoundStatus.FAILED_BEFORE_SEND, detail, preSend);
        }

        // Anything uncertain (timeout, send-not-reached after a possible
        // send, unreadable price) is uncertain territory — never retried.
        if (result.Outcome is not TerminalExecutionOutcome.Success)
        {
            return Persist(request, TerminalRoundStatus.UNCERTAIN,
                $"uncertain outcome: {result.Outcome} ({result.FailClosedReason})", preSend);
        }

        // UI reported success. That is NOT confirmation.
        var awaiting = Persist(request, TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION,
            "UI send reported; awaiting native confirmation of the expected delta", preSend);

        if (confirmationClient is null)
        {
            // Confirmation not wired — remain honestly at AWAITING rather
            // than claiming CONFIRMED from UI success.
            return awaiting;
        }

        return await ReconcileAsync(request, preSend, cancellationToken);
    }

    /// <summary>
    /// Reconciles a round that has already crossed the send boundary against
    /// native state. Safe to call repeatedly — it sends nothing and drives
    /// nothing, which is what makes it the correct recovery action after a
    /// crash, a lost response, or a restart.
    /// </summary>
    public async Task<TerminalRoundStateEntry> ReconcileAsync(
        TerminalRoundRequest request,
        TableSaleFingerprint? preSendSnapshot,
        CancellationToken cancellationToken)
    {
        if (confirmationClient is null)
        {
            return Persist(request, TerminalRoundStatus.UNCERTAIN,
                "no confirmation client is wired, so the native outcome cannot be established", preSendSnapshot);
        }

        // Prefer the durably persisted snapshot: after a restart the caller
        // has no in-memory baseline, and the persisted one is the whole
        // reason it was written before the send.
        var baseline = preSendSnapshot
            ?? stateStore.Find(request.ExternalOrderId, request.RoundId)?.PreSendSnapshot;

        TerminalConfirmationResult confirmation;
        try
        {
            confirmation = await confirmationClient.ConfirmRoundAsync(
                request.RoundKind,
                request.TableCode,
                map: baseline?.Map,
                beforeFingerprint: baseline,
                expectedNewItems: request.Items,
                cancellationToken);
        }
        catch (Exception ex)
        {
            return Persist(request, TerminalRoundStatus.UNCERTAIN,
                $"confirmation raised {ex.GetType().Name} — reconcile again later", baseline);
        }

        if (confirmation.IsConfirmed)
        {
            return Persist(request, TerminalRoundStatus.CONFIRMED,
                "confirmed natively: the observed delta equals this round", baseline);
        }

        // An outcome nobody can attribute is escalated, not retried. The
        // system prefers an unresolved round over a duplicate kitchen docket.
        if (confirmation.RequiresManualResolution)
        {
            return Persist(request, TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED,
                $"native state cannot be attributed to this round: {confirmation.Outcome} ({confirmation.Reason})", baseline);
        }

        return Persist(request, TerminalRoundStatus.UNCERTAIN,
            $"native confirmation not obtained: {confirmation.Outcome} ({confirmation.Reason})", baseline);
    }

    /// <summary>
    /// The native precondition each round kind requires of the target table,
    /// evaluated against the PRE-SEND snapshot. Returns null when the round
    /// may proceed, or the refusal reason when it must not.
    ///
    /// Round 1 requires a free target table. A first round that lands on a
    /// table somebody else already opened can never be isolated from their
    /// lines afterwards, so it is refused rather than sent-and-escalated.
    /// The rule is deliberately strict about ANY existing native sale, not
    /// merely one carrying lines: an open-but-empty sale still means another
    /// operator owns that table right now, and FAILED_BEFORE_SEND is
    /// retryable, so a genuinely transient row clears itself on the next
    /// attempt instead of being silently merged into.
    ///
    /// Round 2 requires an existing native sale to append to. Without one,
    /// selecting the table on the Table Map would CREATE a sale rather than
    /// extend the intended one — a different operation from the one asked
    /// for, and one that silently loses the "prior lines retained" contract.
    /// </summary>
    internal static string? EvaluatePreSendPrecondition(
        TerminalRoundKind roundKind,
        string tableCode,
        TableSaleFingerprint? preSend)
    {
        var lineCount = preSend?.Lines.Count ?? 0;

        if (roundKind == TerminalRoundKind.FirstRound && preSend is not null)
        {
            return $"table '{tableCode}' already carries a native sale ({lineCount} line(s)) before a first round — "
                + "refusing to send onto an occupied table because this round's delta could not be attributed afterwards";
        }

        if (roundKind == TerminalRoundKind.SecondRound && preSend is null)
        {
            return $"table '{tableCode}' has no existing native sale for a second round to append to — "
                + "refusing to send, because selecting the table would open a new sale rather than extend the intended one";
        }

        if (roundKind == TerminalRoundKind.SecondRound && lineCount == 0)
        {
            return $"table '{tableCode}' has a native sale carrying no lines, so a second round has no prior lines to preserve — "
                + "refusing to send rather than treating an empty baseline as a first round";
        }

        return null;
    }

    /// <summary>
    /// The restart sweep. Replays durable state, finds every round that
    /// crossed the send boundary without reaching a verdict, and RECONCILES
    /// each one — read-only, driving nothing, sending nothing.
    ///
    /// This closes a real gap rather than adding a convenience: before it, a
    /// round left at <see cref="TerminalRoundStatus.SEND_INITIATED"/> by a
    /// crash was only ever revisited if the cloud happened to redeliver that
    /// exact request. Any round the cloud considered answered was invisible
    /// forever — a table that may already carry a kitchen docket, with
    /// nothing in the system pointing at it. Reconciliation cannot make that
    /// worse: it is the same read-only comparison the online path performs,
    /// and the fail-closed rules are unchanged, so an unattributable outcome
    /// still lands on MANUAL_RESOLUTION_REQUIRED and never on a resend.
    ///
    /// An entry whose <see cref="TerminalRoundStateEntry.RoundKind"/> was
    /// never recorded (written by an older schema) is escalated rather than
    /// assumed: guessing the kind would change the verdict, and a wrong guess
    /// toward FirstRound would confirm against an empty baseline and claim
    /// somebody else's lines.
    /// </summary>
    public async Task<IReadOnlyList<TerminalRoundStateEntry>> ReconcileOutstandingAsync(CancellationToken cancellationToken)
    {
        var results = new List<TerminalRoundStateEntry>();

        foreach (var entry in stateStore.FindNeedingReconciliation())
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (entry.RoundKind is null)
            {
                var escalated = entry with
                {
                    Status = TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED,
                    Detail = "durable state does not record which round kind this was, so its native outcome cannot be "
                        + "attributed without guessing — a human must resolve this table",
                    UpdatedAtUtc = DateTimeOffset.UtcNow,
                };
                stateStore.Record(escalated);
                results.Add(escalated);
                continue;
            }

            var request = new TerminalRoundRequest
            {
                ExternalOrderId = entry.ExternalOrderId,
                RoundId = entry.RoundId,
                RoundKind = entry.RoundKind.Value,
                OrderReference = entry.OrderReference ?? entry.ExternalOrderId,
                TableCode = entry.TableCode,
                Items = entry.Items,
            };

            // The persisted snapshot is passed explicitly; ReconcileAsync also
            // falls back to it, but being explicit keeps the sweep's data flow
            // obvious rather than incidental.
            results.Add(await ReconcileAsync(request, entry.PreSendSnapshot, cancellationToken));
        }

        return results;
    }

    private TerminalRoundStateEntry Persist(
        TerminalRoundRequest request,
        TerminalRoundStatus status,
        string detail,
        TableSaleFingerprint? preSendSnapshot = null)
    {
        var entry = new TerminalRoundStateEntry
        {
            ExternalOrderId = request.ExternalOrderId,
            RoundId = request.RoundId,
            TableCode = request.TableCode,
            Status = status,
            Items = request.Items,
            Detail = detail,
            PreSendSnapshot = preSendSnapshot,
            Map = preSendSnapshot?.Map,
            RoundKind = request.RoundKind,
            OrderReference = request.OrderReference,
        };
        stateStore.Record(entry);
        return entry;
    }
}
