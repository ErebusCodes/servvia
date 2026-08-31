using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// UNIT_OR_MOCK evidence for the native first-round contract. Fake-backed,
/// fail-closed, no live IPS. Table 5 / PLU 708 / qty 1 throughout.
/// </summary>
public sealed class TerminalFirstRoundTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("terminal-first-").FullName;

    private TerminalRoundStateStore NewStore() =>
        new(new DurableLocalLog(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson")));

    private static TerminalRoundRequest FirstRound() => new()
    {
        ExternalOrderId = "ORD-5001",
        RoundId = "round-1",
        RoundKind = TerminalRoundKind.FirstRound,
        OrderReference = "VERDURA-REF-5001",
        TableCode = "5",
        Items = new[] { new TerminalRoundItem("708", 1) },
    };

    [Fact]
    public void DryRunPlan_ForTable5Plu708_ProducesTenStepPlan_AndNoMutation()
    {
        var request = FirstRound();
        var plan = TerminalActionPlan.Build(request);
        var result = TerminalSaveToTableResult.DryRun(request.RoundId, request.TableCode, plan);

        Assert.Equal(TerminalExecutionOutcome.DryRun, result.Outcome);
        Assert.False(result.Mutated);
        Assert.False(result.SendBoundaryCrossed);
        Assert.Equal(10, plan.Count);
        Assert.Contains(plan, s => s.Contains("Table 5"));
        Assert.Contains(plan, s => s.Contains("PLU 708"));
        result.AssertHonestFailClosed();
    }

    [Fact]
    public void TerminalRoundItem_HasNoPriceField()
    {
        var props = typeof(TerminalRoundItem).GetProperties();
        Assert.DoesNotContain(props, p => p.Name.Contains("price", StringComparison.OrdinalIgnoreCase)
                                           || p.Name.Contains("amount", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task FakeSuccessPath_Confirms_AndObservesNativePriceFromIdealpos()
    {
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var service = new TerminalRoundService(ui, NewStore(), confirm);

        var state = await service.ExecuteRoundAsync(FirstRound(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.CONFIRMED, state.Status);
        Assert.Equal(1, ui.SaveToTableExecuteCount);

        // The price is observed FROM the (fake) POS, never sent to it.
        var direct = await ui.AttemptSaveToTableAsync(FirstRound() with { RoundId = "probe" }, CancellationToken.None);
        Assert.Equal(23.00m, Assert.Single(direct.ObservedLines).ObservedNativeUnitPrice);
    }

    [Fact]
    public async Task ModalBlocks_FailsClosed_BeforeSend_Retryable()
    {
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.ModalBlocks);
        var service = new TerminalRoundService(ui, NewStore());

        var state = await service.ExecuteRoundAsync(FirstRound(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.FAILED_BEFORE_SEND, state.Status);
    }

    [Fact]
    public async Task WrongExpectedScreen_FailsClosed()
    {
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.UnexpectedScreen);
        var result = await ui.AttemptSaveToTableAsync(FirstRound(), CancellationToken.None);

        Assert.Equal(TerminalExecutionOutcome.UnexpectedScreen, result.Outcome);
        Assert.True(result.IsFailClosed);
        Assert.False(result.SendBoundaryCrossed);
        result.AssertHonestFailClosed();
    }

    [Fact]
    public void MissingSelector_FailsClosed_ViaCoreReadinessGate()
    {
        // This is the exact gate the Windows implementation delegates to.
        var ready = TerminalSelectorReadiness.IsReadyForLiveExecution(TerminalUiSelectors.Empty, out var reason);
        Assert.False(ready);
        Assert.NotNull(reason);
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
