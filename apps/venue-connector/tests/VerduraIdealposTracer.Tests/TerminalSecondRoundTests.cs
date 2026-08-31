using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Second-round contract: the same Table 5, NEW items only, prior lines
/// retained natively, and never a replay of round one.
/// </summary>
public sealed class TerminalSecondRoundTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("terminal-second-").FullName;

    private TerminalRoundStateStore NewStore() =>
        new(new DurableLocalLog(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson")));

    [Fact]
    public async Task SecondRound_AddsNewItemsOnly_RetainsPriorLines_NoReplay()
    {
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var service = new TerminalRoundService(ui, NewStore(), confirm);

        var first = new TerminalRoundRequest
        {
            ExternalOrderId = "ORD-6001",
            RoundId = "round-1",
            RoundKind = TerminalRoundKind.FirstRound,
            OrderReference = "REF-6001",
            TableCode = "5",
            Items = new[] { new TerminalRoundItem("708", 1) },
        };
        var second = new TerminalRoundRequest
        {
            ExternalOrderId = "ORD-6001",
            RoundId = "round-2",
            RoundKind = TerminalRoundKind.SecondRound,
            OrderReference = "REF-6001",
            TableCode = "5",
            Items = new[] { new TerminalRoundItem("704", 1) }, // NEW item only — no 708 replay
        };

        await service.ExecuteRoundAsync(first, CancellationToken.None);
        var secondState = await service.ExecuteRoundAsync(second, CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.CONFIRMED, secondState.Status);

        // Prior line retained AND new line added exactly once.
        var fp = tableState.Fingerprint("5");
        Assert.NotNull(fp);
        Assert.Contains(fp!.Lines, l => l.NativeCode == "708" && l.Quantity == 1);
        Assert.Contains(fp.Lines, l => l.NativeCode == "704" && l.Quantity == 1);

        // The request never carried the first-round item.
        Assert.DoesNotContain(second.Items, i => i.NativeCode == "708");
        Assert.Single(second.Items);
    }

    [Fact]
    public async Task SecondRound_OnUnknownTable_FailsClosed()
    {
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success);
        var second = new TerminalRoundRequest
        {
            ExternalOrderId = "ORD-6002",
            RoundId = "round-2",
            RoundKind = TerminalRoundKind.SecondRound,
            OrderReference = "REF-6002",
            TableCode = "9",
            Items = new[] { new TerminalRoundItem("704", 1) },
        };

        var result = await ui.AttemptSaveToTableAsync(second, CancellationToken.None);

        Assert.Equal(TerminalExecutionOutcome.UnexpectedScreen, result.Outcome);
        Assert.False(result.SendBoundaryCrossed);
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
