namespace VerduraIdealposTracer.Core.Hosting;

/// <summary>
/// The narrow logging surface <see cref="ConnectorPollingLoop"/> needs.
/// Deliberately not a dependency on any specific logging framework — Core
/// stays free of new package references, and a host (e.g. the real Cli's
/// Generic Host bootstrap) adapts this to <c>Microsoft.Extensions.Logging</c>
/// or plain console output as it sees fit. Tests use a trivial in-memory
/// implementation to assert on emitted messages.
/// </summary>
public interface IConnectorHostLog
{
    void Info(string message);
    void Warning(string message);
    void Error(string message);
}

/// <summary>Simplest real implementation: timestamped console output, matching this codebase's existing Console.WriteLine/Console.Error.WriteLine convention (see Program.cs).</summary>
public sealed class ConsoleConnectorHostLog : IConnectorHostLog
{
    public void Info(string message) => Console.WriteLine($"[{DateTimeOffset.UtcNow:O}] INFO  {message}");
    public void Warning(string message) => Console.WriteLine($"[{DateTimeOffset.UtcNow:O}] WARN  {message}");
    public void Error(string message) => Console.Error.WriteLine($"[{DateTimeOffset.UtcNow:O}] ERROR {message}");
}
