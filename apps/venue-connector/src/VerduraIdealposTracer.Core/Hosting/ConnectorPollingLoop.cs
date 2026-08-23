using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.OrderSubmission;
using VerduraIdealposTracer.Core.Protocol;

namespace VerduraIdealposTracer.Core.Hosting;

/// <summary>
/// DL-095: operationalizes the existing, already-proven "cloud mode" single
/// poll/claim/execute/report cycle (previously only reachable via one
/// bounded 30-second Cli process invocation — see Program.cs's prior
/// single-shot dispatch point) into a continuous, restart-safe, always-on
/// loop suitable for a venue machine that should stay up and keep
/// processing durable Verdura commands without a human re-launching the
/// Cli by hand.
///
/// This class introduces NO new execution semantics: every command is
/// still routed to exactly the same <see cref="DiscoveryTracerService"/> /
/// <see cref="IdealposOrderSubmissionService"/> <c>RunCloudModeAsync</c>
/// methods Program.cs already called, with the same claim/accept/report
/// protocol calls, the same fail-closed behaviour on an unrecognized
/// command type or schema version, and the same "never synthesize an
/// outcome" posture on an unexpected exception. It only adds the loop,
/// per-command isolation (one command's exception can never take down the
/// host or another command's processing), and resilience around the
/// network calls that were previously allowed to simply crash the process.
///
/// Concurrency/duplicate-delivery safety is NOT reinvented here — it comes
/// entirely from the existing server-side protocol (Story 2-10's
/// lease-based, CAS `updateMany` claim/accept, see
/// apps/api/src/connector/connector-command.service.ts). This loop (and
/// even two independent instances of it, accidentally run at once) is
/// simply a client of that already-safe protocol: a losing `AcceptAsync`
/// race throws (surfaced as a non-2xx HTTP status), which
/// <see cref="ProcessOneCommandAsync"/> catches, logs, and treats as "this
/// command isn't mine this tick" — never a crash, never a duplicate
/// submission.
/// </summary>
public sealed class ConnectorPollingLoop(
    ConnectorCommandProtocolClient protocolClient,
    DiscoveryTracerService discoveryService,
    IdealposOrderSubmissionService orderSubmissionService,
    IConnectorHostLog log,
    TimeSpan pollInterval,
    TimeSpan errorBackoff)
{
    /// <summary>
    /// Runs until <paramref name="stoppingToken"/> is cancelled. Never
    /// throws <see cref="OperationCanceledException"/> — a cancellation
    /// requested mid-poll, mid-command, or mid-delay is treated as a clean
    /// shutdown request, not a failure.
    /// </summary>
    public async Task RunAsync(CancellationToken stoppingToken)
    {
        log.Info("Connector polling loop starting.");
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await RunOneCycleAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Expected shutdown path — nothing to report as a failure.
        }
        finally
        {
            log.Info("Connector polling loop stopped.");
        }
    }

    private async Task RunOneCycleAsync(CancellationToken stoppingToken)
    {
        PollResponse poll;
        try
        {
            poll = await protocolClient.PollAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Network down, server unreachable, IdealPOS-adjacent
            // infrastructure unavailable, etc. — the server-side lease
            // protocol already tolerates a connector going quiet (claimed
            // commands become reclaimable once their lease expires), so the
            // safe, fail-closed response here is simply "wait and try
            // again," never a process crash.
            log.Error($"Poll failed — will retry after backoff: {ex.GetType().Name}: {ex.Message}");
            await DelayAsync(errorBackoff, stoppingToken);
            return;
        }

        if (poll.Commands.Count == 0)
        {
            await DelayAsync(pollInterval, stoppingToken);
            return;
        }

        foreach (var command in poll.Commands)
        {
            if (stoppingToken.IsCancellationRequested) break;
            await ProcessOneCommandAsync(command, stoppingToken);
        }

        await DelayAsync(pollInterval, stoppingToken);
    }

    private async Task ProcessOneCommandAsync(ClaimedCommand command, CancellationToken stoppingToken)
    {
        try
        {
            if (command.CommandType == DiscoveryTracerService.CommandType)
            {
                var result = await discoveryService.RunCloudModeAsync(command, stoppingToken);
                log.Info($"commandId={command.Id} type={command.CommandType} failClosedReason={result.FailClosedReason ?? "none"}");
                return;
            }

            if (command.CommandType == IdealposOrderSubmissionService.CommandType)
            {
                var result = await orderSubmissionService.RunCloudModeAsync(command, stoppingToken);
                log.Info(
                    $"commandId={command.Id} type={command.CommandType} externalOrderId={result.ExternalOrderId ?? "n/a"} " +
                    $"reportedOutcome={result.ReportedOutcome ?? "none"} failClosedReason={result.FailClosedReason ?? "none"}");
                return;
            }

            // Same fail-closed posture Program.cs's single-shot dispatch
            // already documented: an unrecognized command type is left
            // unclaimed (never accepted/reported) so it stays reclaimable
            // by a compatible connector build, or for operator investigation.
            log.Warning($"commandId={command.Id} type={command.CommandType} is not handled by this connector build — leaving unclaimed for reclaim.");
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Never let one command's unexpected exception (including a
            // losing AcceptAsync claim race against another connector
            // instance/installation, surfaced as a non-2xx HTTP status)
            // take down the host loop or affect any other command. Same
            // "outcome undetermined, nothing synthesized" posture as
            // Program.cs's prior top-level catch: whatever was already
            // durably persisted/reported before the exception is the only
            // record of this attempt: the command's own server-side lease
            // expiry (or its existing accepted/reported state) governs what
            // happens next, not this loop.
            log.Error($"commandId={command.Id} type={command.CommandType} unexpected error — outcome undetermined, nothing was reported as succeeded or failed: {ex.GetType().Name}: {ex.Message}");
        }
    }

    private static async Task DelayAsync(TimeSpan delay, CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(delay, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown requested during the inter-poll wait — return
            // immediately rather than finishing out the delay.
        }
    }
}
