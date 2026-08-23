using System.Text.Json;
using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Fixtures;

// Story 9-2 dry-run entry point. See this project's own .csproj doc
// comment for the evidence-tier boundary this executable sits on: it is
// cross-platform, uses a fake automation client, and produces
// UNIT_OR_MOCK / dry-run evidence only — never real Windows/Idealpos
// evidence, regardless of how it is invoked.

var scenarioEnv = Environment.GetEnvironmentVariable("TRACER_FAKE_SCENARIO") ?? "HappyPath";
if (!Enum.TryParse<FakeScenario>(scenarioEnv, ignoreCase: true, out var scenario))
{
    Console.Error.WriteLine($"Unknown TRACER_FAKE_SCENARIO '{scenarioEnv}'. Valid values: {string.Join(", ", Enum.GetNames<FakeScenario>())}");
    return 2;
}

var storePath = Environment.GetEnvironmentVariable("TRACER_STORE_PATH")
    ?? throw new InvalidOperationException("TRACER_STORE_PATH is required.");
var commandId = Environment.GetEnvironmentVariable("TRACER_COMMAND_ID") ?? Guid.NewGuid().ToString();
var selfKillAfter = Environment.GetEnvironmentVariable("TRACER_SELF_KILL_AFTER");

var timeoutMs = scenario is FakeScenario.NavigationTimeout or FakeScenario.OperatorCancelsDuringNavigation
    ? 200
    : 5000;
using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(timeoutMs));

var automationClient = new FakeIdealposUiAutomationClient(scenario);
var expectedProfile = new IdealposVerifiedProfile(
    ExpectedProcessName: "IPSClient",
    ExpectedMainWindowTitleContains: "Idealpos",
    ProfileVersion: "dry-run-fixture-v1");
var localLog = new DurableLocalLog(storePath);

void CrashHook(string phase)
{
    if (string.Equals(selfKillAfter, phase, StringComparison.OrdinalIgnoreCase))
    {
        // Uncatchable, immediate — the .NET analogue of the TypeScript
        // harness's process.kill(pid, 'SIGKILL'): nothing not already
        // fsync'd to storePath survives this.
        Environment.FailFast($"Story 9-2 dry-run: self-kill requested after phase '{phase}'.");
    }
}

var service = new DiscoveryTracerService(automationClient, expectedProfile, localLog, cloudClient: null, crashHook: CrashHook);

try
{
    var result = await service.RunLocalModeAsync(commandId, cts.Token);
    Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
    return result.FailClosedReason is null ? 0 : 1;
}
catch (OperationCanceledException)
{
    Console.Error.WriteLine("Dry run cancelled/timed out before completion.");
    return 3;
}
catch (Exception ex)
{
    // Deliberately does not attempt to synthesize a result or report
    // anything as failed/succeeded to any caller — an unexpected exception
    // here means this run's own outcome cannot be determined, and nothing
    // safe can be claimed about it. Whatever was already fsync'd to
    // storePath before this point (see DiscoveryTracerService's crash-hook
    // ordering) is the only durable record of this attempt.
    Console.Error.WriteLine($"Unexpected error — outcome undetermined, nothing was reported as succeeded or failed: {ex.GetType().Name}: {ex.Message}");
    return 4;
}
