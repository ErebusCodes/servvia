namespace VerduraIdealposTracer.Core.Printing;

public enum KotPrintOutcome
{
    /// <summary>A real device-path/print-spooler acknowledgement was received.</summary>
    ExecutedAcknowledged,
    /// <summary>Confirmed NOT executed (e.g. connection refused) — safe to auto-retry.</summary>
    RetryableLocalFailure,
    /// <summary>Execution was attempted but the outcome could not be confirmed locally.</summary>
    UncertainLocalResult,
}

public sealed record KotPrintResult(KotPrintOutcome Outcome, string? Detail = null);

/// <summary>
/// The one seam between "we decided to print this" and "bytes actually
/// reached a physical device." No implementation of this interface in this
/// repository has been exercised against a real printer or a real Windows
/// host — see <see cref="SimulatedKotPrintTransport"/>'s own doc comment
/// and the story file's Real-Environment Evidence Tiers section. A future
/// real implementation (TCP/USB/Windows-share) must not claim support for
/// a transport it has not actually been run against, mirroring the
/// backend's own PrintJobsProcessor discipline (Story 8-1) of never
/// fabricating a delivered/printed outcome.
/// </summary>
public interface IKotPrintTransport
{
    Task<KotPrintResult> PrintAsync(string renderedContent, CancellationToken cancellationToken);
}

/// <summary>
/// Non-production stand-in, exactly analogous to the backend's
/// `PrinterConnectionType.simulated` (Story 8-1) — explicit and visibly
/// selected, never a silent default. Exists so this story's handler logic
/// (validation, persist-before-print, result mapping) is fully testable
/// without a real printer. Never claims ExecutedAcknowledged by default:
/// callers must explicitly configure the outcome they want simulated, so a
/// test can never accidentally read as "real hardware proof."
/// </summary>
public sealed class SimulatedKotPrintTransport(KotPrintResult resultToReturn) : IKotPrintTransport
{
    public int CallCount { get; private set; }

    public Task<KotPrintResult> PrintAsync(string renderedContent, CancellationToken cancellationToken)
    {
        CallCount++;
        return Task.FromResult(resultToReturn);
    }
}
