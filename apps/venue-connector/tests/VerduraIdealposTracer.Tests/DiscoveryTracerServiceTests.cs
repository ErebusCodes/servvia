using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// UNIT_OR_MOCK evidence for Story 9-2's discovery state machine — every
/// required failure case from the story's "Required failure cases"
/// section that does not require live Windows/Idealpos access. Uses
/// FakeIdealposUiAutomationClient (VerduraIdealposTracer.Fixtures) — never
/// real Windows/Idealpos evidence.
/// </summary>
public sealed class DiscoveryTracerServiceTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("tracer-tests-").FullName;
    private readonly IdealposVerifiedProfile _profile = new("IPSClient", "Idealpos", "test-profile-v1");

    private DiscoveryTracerService BuildService(FakeScenario scenario, out DurableLocalLog log)
    {
        log = new DurableLocalLog(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson"));
        var client = new FakeIdealposUiAutomationClient(scenario);
        return new DiscoveryTracerService(client, _profile, log);
    }

    [Fact]
    public async Task HappyPath_ConfirmsThroughHarmlessNavigation_AndNeverClaimsOutOfScopeOutcomes()
    {
        var service = BuildService(FakeScenario.HappyPath, out _);

        var result = await service.RunLocalModeAsync("cmd-1", CancellationToken.None);

        // Each dimension's own ceiling state, not a uniform "Confirmed" —
        // process detection's terminal state is Detected (there is no
        // further "confirm" step for mere presence), profile matching's is
        // Matched, and only the harmless-navigation interaction itself
        // reaches Confirmed.
        Assert.Equal(TracerOutcomeState.Detected, result.IdealposProcessDetected);
        Assert.Equal(TracerOutcomeState.Matched, result.IdealposUiProfileMatched);
        Assert.Equal(TracerOutcomeState.Confirmed, result.IdealposInteractionAttempted);
        Assert.Null(result.FailClosedReason);
        result.AssertDiscoveryOnlyInvariant(); // throws if any out-of-scope dimension was ever set
    }

    [Fact]
    public async Task IdealposNotRunning_FailsClosedAtProcessDetection()
    {
        var service = BuildService(FakeScenario.IdealposNotRunning, out _);

        var result = await service.RunLocalModeAsync("cmd-2", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.FailedClosed, result.IdealposProcessDetected);
        Assert.Equal(TracerOutcomeState.NotAttempted, result.IdealposUiProfileMatched);
        Assert.NotNull(result.FailClosedReason);
    }

    [Fact]
    public async Task WrongVersionProfile_FailsClosedAtProfileMatch_NeverInteracts()
    {
        var service = BuildService(FakeScenario.WrongVersionProfile, out _);

        var result = await service.RunLocalModeAsync("cmd-3", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.Detected, result.IdealposProcessDetected);
        Assert.Equal(TracerOutcomeState.FailedClosed, result.IdealposUiProfileMatched);
        Assert.Equal(TracerOutcomeState.NotAttempted, result.IdealposInteractionAttempted);
    }

    [Fact]
    public async Task InsufficientPermissions_FailsClosedAtProcessDetection()
    {
        var service = BuildService(FakeScenario.InsufficientPermissions, out _);

        var result = await service.RunLocalModeAsync("cmd-4", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.FailedClosed, result.IdealposProcessDetected);
        Assert.Contains("permission", result.FailClosedReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SessionLocked_FailsClosedBeforeAnyInteraction()
    {
        var service = BuildService(FakeScenario.SessionLocked, out _);

        var result = await service.RunLocalModeAsync("cmd-5", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.Matched, result.IdealposUiProfileMatched);
        Assert.Equal(TracerOutcomeState.NotAttempted, result.IdealposInteractionAttempted);
        Assert.Contains("locked", result.FailClosedReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UnexpectedModalDialog_FailsClosedBeforeAnyInteraction()
    {
        var service = BuildService(FakeScenario.UnexpectedModalDialog, out _);

        var result = await service.RunLocalModeAsync("cmd-6", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.NotAttempted, result.IdealposInteractionAttempted);
        Assert.Contains("modal", result.FailClosedReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task IdealposBusy_FailsClosedBeforeAnyInteraction()
    {
        var service = BuildService(FakeScenario.IdealposBusy, out _);

        var result = await service.RunLocalModeAsync("cmd-7", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.NotAttempted, result.IdealposInteractionAttempted);
        Assert.Contains("busy", result.FailClosedReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ControlNotFoundDuringProfileMatch_FailsClosed_NotUncertain()
    {
        // Before any mutating action — idealpos.md §16's crash-window
        // boundary places this on the retryable/fail-closed side, not Uncertain.
        var service = BuildService(FakeScenario.ControlNotFoundDuringProfileMatch, out _);

        var result = await service.RunLocalModeAsync("cmd-8", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.FailedClosed, result.IdealposUiProfileMatched);
    }

    [Fact]
    public async Task ControlAmbiguousDuringProfileMatch_FailsClosed_NotUncertain()
    {
        var service = BuildService(FakeScenario.ControlAmbiguousDuringProfileMatch, out _);

        var result = await service.RunLocalModeAsync("cmd-9", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.FailedClosed, result.IdealposUiProfileMatched);
    }

    [Fact]
    public async Task UiChangedBeforeNavigation_BecomesUncertain_NeverSilentlyRetried()
    {
        var service = BuildService(FakeScenario.UiChangedBeforeNavigation, out _);

        var result = await service.RunLocalModeAsync("cmd-10", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.Uncertain, result.IdealposInteractionAttempted);
        Assert.NotNull(result.FailClosedReason);
    }

    [Fact]
    public async Task ActionTimeout_BecomesUncertain_NotFailedClosed()
    {
        var service = BuildService(FakeScenario.NavigationTimeout, out _);
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

        var result = await service.RunLocalModeAsync("cmd-11", cts.Token);

        Assert.Equal(TracerOutcomeState.Uncertain, result.IdealposInteractionAttempted);
    }

    [Fact]
    public async Task UnexpectedErrorDuringNavigation_BecomesUncertain()
    {
        var service = BuildService(FakeScenario.NavigationThrowsUnexpectedError, out _);

        var result = await service.RunLocalModeAsync("cmd-12", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.Uncertain, result.IdealposInteractionAttempted);
    }

    [Fact]
    public async Task NavigationCompletesButUnverifiable_BecomesUncertain_NeverConfirmed()
    {
        // "Idealpos result cannot be determined" — completion of a UI action
        // is never, by itself, treated as confirmation (idealpos.md §16's
        // "successful UI input is never proof" rule, applied here).
        var service = BuildService(FakeScenario.NavigationCompletesButUnverifiable, out _);

        var result = await service.RunLocalModeAsync("cmd-13", CancellationToken.None);

        Assert.Equal(TracerOutcomeState.Uncertain, result.IdealposInteractionAttempted);
    }

    [Fact]
    public async Task OperatorCancels_DuringNavigation_BecomesUncertain_NeverAutoResubmitted()
    {
        var service = BuildService(FakeScenario.OperatorCancelsDuringNavigation, out _);
        using var cts = new CancellationTokenSource();

        var runTask = service.RunLocalModeAsync("cmd-14", cts.Token);
        await Task.Delay(10);
        cts.Cancel();

        var result = await runTask;
        Assert.Equal(TracerOutcomeState.Uncertain, result.IdealposInteractionAttempted);
    }

    [Fact]
    public async Task EveryRun_PersistsClaimedThenTerminal_BeforeReturning()
    {
        var service = BuildService(FakeScenario.HappyPath, out var log);

        await service.RunLocalModeAsync("cmd-15", CancellationToken.None);

        var entries = log.ReadAll();
        Assert.Equal(2, entries.Count);
        Assert.Equal("claimed", entries[0].RootElement.GetProperty("type").GetString());
        Assert.Equal("terminal", entries[1].RootElement.GetProperty("type").GetString());
    }

    [Theory]
    [InlineData(FakeScenario.IdealposNotRunning)]
    [InlineData(FakeScenario.WrongVersionProfile)]
    [InlineData(FakeScenario.SessionLocked)]
    [InlineData(FakeScenario.UnexpectedModalDialog)]
    [InlineData(FakeScenario.IdealposBusy)]
    [InlineData(FakeScenario.UiChangedBeforeNavigation)]
    [InlineData(FakeScenario.NavigationThrowsUnexpectedError)]
    public async Task NoScenario_EverPopulatesAnOutOfScopeDimension(FakeScenario scenario)
    {
        var service = BuildService(scenario, out _);

        var result = await service.RunLocalModeAsync("cmd-scope", CancellationToken.None);

        // Throws if IdealposOrderAccepted/EFTPOS/KDS/KOT were ever touched —
        // the structural backstop, exercised across every failure path.
        result.AssertDiscoveryOnlyInvariant();
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir)) Directory.Delete(_tempDir, recursive: true);
    }
}
