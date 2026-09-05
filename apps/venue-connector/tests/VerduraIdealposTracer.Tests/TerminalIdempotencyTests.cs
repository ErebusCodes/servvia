using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Durable idempotency around the irreversible send boundary. The single
/// rule under test: one Verdura round drives the native UI at most once,
/// and nothing at or past SEND_INITIATED is ever blindly re-driven.
/// </summary>
public sealed class TerminalIdempotencyTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("terminal-idem-").FullName;

    private DurableLocalLog NewLog() => new(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson"));

    private static TerminalRoundRequest Round() => new()
    {
        ExternalOrderId = "ORD-7001",
        RoundId = "round-1",
        RoundKind = TerminalRoundKind.FirstRound,
        OrderReference = "REF-7001",
        TableCode = "5",
        Items = new[] { new TerminalRoundItem("708", 1) },
    };

    [Fact]
    public async Task DuplicateExternalOrderIdAndRoundId_ReturnsExistingState_WithoutReExecuting()
    {
        var log = NewLog();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(log);
        var service = new TerminalRoundService(ui, store, new FakeNativeTableStateReader(tableState), confirm);

        var first = await service.ExecuteRoundAsync(Round(), CancellationToken.None);
        var second = await service.ExecuteRoundAsync(Round(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.CONFIRMED, first.Status);
        Assert.Equal(TerminalRoundStatus.CONFIRMED, second.Status);
        Assert.Equal(1, ui.SaveToTableExecuteCount); // executed exactly once
    }

    [Fact]
    public async Task CrashAfterSendInitiated_DoesNotResend_OnReplay()
    {
        var log = NewLog();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success);
        var store = new TerminalRoundStateStore(log);

        // First service crashes exactly at the SEND_INITIATED boundary,
        // AFTER that state is durably persisted but BEFORE the UI is driven.
        CrashHook crash = phase => { if (phase == "send_initiated") throw new InvalidOperationException("simulated crash at send boundary"); };
        var crashingService = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(ui.TableState), confirmationClient: null, crashHook: crash);

        await Assert.ThrowsAsync<InvalidOperationException>(() => crashingService.ExecuteRoundAsync(Round(), CancellationToken.None));
        Assert.Equal(0, ui.SaveToTableExecuteCount); // crash happened before the drive

        // A fresh service replays against the same durable store.
        var replayService = new TerminalRoundService(ui, store, new FakeNativeTableStateReader(ui.TableState));
        var replayed = await replayService.ExecuteRoundAsync(Round(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.SEND_INITIATED, replayed.Status); // returns existing uncertain state
        Assert.Equal(0, ui.SaveToTableExecuteCount); // never re-driven
    }

    [Fact]
    public async Task FailedBeforeSend_CanRetrySafely()
    {
        var log = NewLog();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.ControlNotFound, tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(log);
        var service = new TerminalRoundService(ui, store, new FakeNativeTableStateReader(tableState), confirm);

        var failed = await service.ExecuteRoundAsync(Round(), CancellationToken.None);
        Assert.Equal(TerminalRoundStatus.FAILED_BEFORE_SEND, failed.Status);
        Assert.Equal(1, ui.SaveToTableExecuteCount);

        // The condition clears; a retry is permitted and succeeds.
        ui.TerminalScenario = FakeTerminalScenario.Success;
        var retried = await service.ExecuteRoundAsync(Round(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.CONFIRMED, retried.Status);
        Assert.Equal(2, ui.SaveToTableExecuteCount);
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
