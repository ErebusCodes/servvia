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
///   * <see cref="TerminalRoundStatus.SEND_INITIATED"/> is persisted (and a
///     crash hook fired) BEFORE the automation client is invoked, so a
///     crash mid-drive replays as "uncertain, do not resend" rather than
///     silently double-sending.
///   * Only a clean return proving no send occurred downgrades to
///     <see cref="TerminalRoundStatus.FAILED_BEFORE_SEND"/>, which is the
///     one post-attempt state that is safe to retry.
///   * <see cref="TerminalRoundStatus.CONFIRMED"/> is reached ONLY via a
///     native POSServer confirmation — never from UI completion alone.
///
/// It performs no UI work itself; it depends on
/// <see cref="IIdealposUiAutomationClient"/> (fake in tests, fail-closed
/// scaffold in production) and, optionally, an
/// <see cref="IPosServerConfirmationClient"/>.
/// </summary>
public sealed class TerminalRoundService(
    IIdealposUiAutomationClient automationClient,
    TerminalRoundStateStore stateStore,
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

        // Commit to driving the UI: persist the irreversible marker BEFORE
        // the call, so any interruption during the drive replays as
        // "do not resend". A clean return will supersede this marker.
        Persist(request, TerminalRoundStatus.SEND_INITIATED, "committing to native drive");
        _crashHook("send_initiated");

        TerminalSaveToTableResult result;
        try
        {
            result = await automationClient.AttemptSaveToTableAsync(request, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            var uncertain = Persist(request, TerminalRoundStatus.UNCERTAIN, "attempt cancelled/timed out after send boundary — reconcile before retry");
            return uncertain;
        }

        result.AssertHonestFailClosed();

        // A refusal that provably never reached the send is safe to retry.
        if (!result.SendBoundaryCrossed && (result.IsFailClosed || result.Outcome == TerminalExecutionOutcome.DryRun))
        {
            var detail = result.Outcome == TerminalExecutionOutcome.DryRun
                ? "dry-run — no mutation"
                : $"fail-closed before send: {result.Outcome} ({result.FailClosedReason})";
            return Persist(request, TerminalRoundStatus.FAILED_BEFORE_SEND, detail);
        }

        // Anything uncertain (timeout, send-not-reached, unreadable price
        // after a possible send) is uncertain territory — never retried.
        if (result.Outcome is not TerminalExecutionOutcome.Success)
        {
            return Persist(request, TerminalRoundStatus.UNCERTAIN,
                $"uncertain outcome: {result.Outcome} ({result.FailClosedReason})");
        }

        // UI reported success. That is NOT confirmation.
        var awaiting = Persist(request, TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION, "UI send reported; awaiting native POSServer confirmation");

        if (confirmationClient is null)
        {
            // Confirmation not wired this commit — remain honestly at
            // AWAITING rather than claiming CONFIRMED from UI success.
            return awaiting;
        }

        TerminalConfirmationResult confirmation;
        try
        {
            confirmation = await confirmationClient.ConfirmRoundAsync(
                request.RoundKind, request.TableCode, map: null,
                beforeFingerprint: null, expectedNewItems: request.Items, cancellationToken);
        }
        catch (Exception ex)
        {
            return Persist(request, TerminalRoundStatus.UNCERTAIN, $"confirmation raised {ex.GetType().Name} — reconcile");
        }

        return confirmation.IsConfirmed
            ? Persist(request, TerminalRoundStatus.CONFIRMED, "confirmed natively via POSServer")
            : Persist(request, TerminalRoundStatus.UNCERTAIN, $"native confirmation failed: {confirmation.Outcome} ({confirmation.Reason})");
    }

    private TerminalRoundStateEntry Persist(TerminalRoundRequest request, TerminalRoundStatus status, string detail)
    {
        var entry = new TerminalRoundStateEntry
        {
            ExternalOrderId = request.ExternalOrderId,
            RoundId = request.RoundId,
            TableCode = request.TableCode,
            Status = status,
            Items = request.Items,
            Detail = detail,
        };
        stateStore.Record(entry);
        return entry;
    }
}
