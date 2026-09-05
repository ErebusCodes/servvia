using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Orchestration-level contract for <see cref="TerminalRoundService"/> —
/// the rules that live between the pure evaluator and the driver, and that
/// were previously only asserted on the evaluator (where a violation has
/// already cost a native mutation) or not at all.
///
/// Every test here answers one of two questions:
///   * did we refuse BEFORE the irreversible send when we should have?
///   * after the send boundary, did we reconcile rather than resend?
///
/// UNIT_OR_MOCK evidence. No live IPS; the fixtures stand in for POSServer.
/// </summary>
public sealed class TerminalRoundOrchestrationTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("terminal-orch-").FullName;

    private string NewLogPath() => Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson");

    private static TerminalRoundRequest Round1(string table = "5", string plu = "708", int qty = 1) => new()
    {
        ExternalOrderId = "ORD-8001",
        RoundId = "round-1",
        RoundKind = TerminalRoundKind.FirstRound,
        OrderReference = "REF-8001",
        TableCode = table,
        Items = new[] { new TerminalRoundItem(plu, qty) },
    };

    private static TerminalRoundRequest Round2(string table = "5", string plu = "704", int qty = 1) => new()
    {
        ExternalOrderId = "ORD-8001",
        RoundId = "round-2",
        RoundKind = TerminalRoundKind.SecondRound,
        OrderReference = "REF-8001",
        TableCode = table,
        Items = new[] { new TerminalRoundItem(plu, qty) },
    };

    // ───────────────────────── pre-send preconditions ─────────────────────────

    [Fact]
    public async Task FirstRound_OntoATableThatAlreadyCarriesANativeSale_IsRefusedBeforeSend_AndNeverDrivesTheUi()
    {
        var tableState = new FakeTerminalTableState();
        // Somebody else already opened Table 5 on the terminal.
        tableState.AppendRound("5", new[] { new TerminalRoundItem("601", 2) });

        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var service = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new FakePosServerConfirmationClient(tableState));

        var state = await service.ExecuteRoundAsync(Round1(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.FAILED_BEFORE_SEND, state.Status);
        Assert.Equal(0, ui.SaveToTableExecuteCount); // the refusal happened BEFORE the drive
        Assert.Contains("occupied table", state.Detail);

        // And the stranger's table was left exactly as it was.
        var fp = tableState.Fingerprint("5")!;
        Assert.Equal(new[] { ("601", 2) }, fp.Lines.Select(l => (l.NativeCode, l.Quantity)));
    }

    [Fact]
    public async Task SecondRound_WithNoExistingNativeSale_IsRefusedBeforeSend_AndNeverOpensANewOne()
    {
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var service = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new FakePosServerConfirmationClient(tableState));

        var state = await service.ExecuteRoundAsync(Round2(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.FAILED_BEFORE_SEND, state.Status);
        Assert.Equal(0, ui.SaveToTableExecuteCount);
        Assert.Contains("no existing native sale", state.Detail);
        Assert.Null(tableState.Fingerprint("5")); // no sale was created
    }

    [Fact]
    public async Task WhenThePreSendSnapshotCannotBeRead_TheRoundIsRefusedBeforeSend()
    {
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState) { FailWith = new IOException("POSServer unreachable") };
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var service = new TerminalRoundService(ui, store, reader, new FakePosServerConfirmationClient(tableState));

        var state = await service.ExecuteRoundAsync(Round1(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.FAILED_BEFORE_SEND, state.Status);
        Assert.Equal(0, ui.SaveToTableExecuteCount);
        Assert.Contains("not sending without a baseline", state.Detail);
    }

    [Fact]
    public async Task ARefusedPrecondition_IsRetryable_OnceTheTableStateSatisfiesIt()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var service = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new FakePosServerConfirmationClient(tableState));

        // Round 2 arrives first (out of order) and is refused — no sale yet.
        var refused = await service.ExecuteRoundAsync(Round2(), CancellationToken.None);
        Assert.Equal(TerminalRoundStatus.FAILED_BEFORE_SEND, refused.Status);
        Assert.Equal(0, ui.SaveToTableExecuteCount);

        // Round 1 lands and opens the sale.
        Assert.Equal(TerminalRoundStatus.CONFIRMED, (await service.ExecuteRoundAsync(Round1(), CancellationToken.None)).Status);

        // The same round-2 request is now legitimately retryable — FAILED_BEFORE_SEND
        // is the one post-attempt state that does not lock the key out.
        var retried = await service.ExecuteRoundAsync(Round2(), CancellationToken.None);
        Assert.Equal(TerminalRoundStatus.CONFIRMED, retried.Status);
        Assert.Equal(2, ui.SaveToTableExecuteCount); // round 1 and round 2 — the refusal never drove
    }

    // ─────────────────── the pre-send snapshot is durable ───────────────────

    [Fact]
    public async Task ThePreSendSnapshot_IsPersistedWithSendInitiated_BeforeTheDriverIsEverInvoked()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var reader = new FakeNativeTableStateReader(tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);

        await new TerminalRoundService(ui, store, reader, confirm)
            .ExecuteRoundAsync(Round1(), CancellationToken.None);

        // Round 2 crashes exactly at the boundary, after SEND_INITIATED is
        // durable and before the UI is driven.
        CrashHook crash = phase => { if (phase == "send_initiated") throw new InvalidOperationException("crash at the send boundary"); };
        var crashing = new TerminalRoundService(ui, store, reader, confirm, crash);
        await Assert.ThrowsAsync<InvalidOperationException>(() => crashing.ExecuteRoundAsync(Round2(), CancellationToken.None));

        Assert.Equal(1, ui.SaveToTableExecuteCount); // only round 1 ever drove

        // A brand-new store over the same durable log — i.e. what a restarted
        // process sees — finds the snapshot waiting for it.
        var afterRestart = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var persisted = afterRestart.Find("ORD-8001", "round-2")!;
        Assert.Equal(TerminalRoundStatus.SEND_INITIATED, persisted.Status);
        Assert.NotNull(persisted.PreSendSnapshot);
        Assert.Equal(new[] { ("708", 1) },
            persisted.PreSendSnapshot!.Lines.Select(l => (l.NativeCode, l.Quantity)));
    }

    [Fact]
    public async Task AfterRestart_ReconciliationUsesThePersistedBaseline_RatherThanGuessing()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));

        await new TerminalRoundService(ui, store, reader, confirm).ExecuteRoundAsync(Round1(), CancellationToken.None);

        CrashHook crash = phase => { if (phase == "send_initiated") throw new InvalidOperationException("crash"); };
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => new TerminalRoundService(ui, store, reader, confirm, crash).ExecuteRoundAsync(Round2(), CancellationToken.None));

        // Restart: fresh store, fresh service, NO in-memory snapshot.
        var restartedStore = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var restarted = new TerminalRoundService(ui, restartedStore, reader, confirm);

        var reconciled = await restarted.ReconcileAsync(Round2(), preSendSnapshot: null, CancellationToken.None);

        // The crash was BEFORE the drive, so the round never reached the
        // native side: the expected 704 is absent. That is ExpectedItemMissing
        // (still resolvable) — NOT the "no snapshot, cannot attribute"
        // Ambiguous a baseline-less reconciliation would have produced, which
        // is precisely what proves the baseline came off disk.
        Assert.Equal(TerminalRoundStatus.UNCERTAIN, reconciled.Status);
        Assert.Contains("ExpectedItemMissing", reconciled.Detail);
        Assert.Equal(1, ui.SaveToTableExecuteCount); // reconciliation drives nothing
    }

    [Fact]
    public async Task LostResponseAfterTheNativeApply_IsUncertain_IsNeverResent_AndReconcilesToConfirmedAfterRestart()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var service = new TerminalRoundService(ui, store, reader, confirm);

        await service.ExecuteRoundAsync(Round1(), CancellationToken.None);

        // Round 2: the native side really applies it, then the answer is lost.
        ui.TerminalScenario = FakeTerminalScenario.LostResponseAfterNativeApply;
        var lost = await service.ExecuteRoundAsync(Round2(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.UNCERTAIN, lost.Status);
        Assert.Equal(2, ui.SaveToTableExecuteCount);

        // Re-delivery of the same round must NOT resend, even though the
        // caller has no idea whether it worked.
        var redelivered = await service.ExecuteRoundAsync(Round2(), CancellationToken.None);
        Assert.Equal(TerminalRoundStatus.UNCERTAIN, redelivered.Status);
        Assert.Equal(2, ui.SaveToTableExecuteCount);

        // Restart, then reconcile: the persisted baseline plus the current
        // native state prove the round DID land, exactly once.
        var restarted = new TerminalRoundService(
            ui, new TerminalRoundStateStore(new DurableLocalLog(logPath)), reader, confirm);
        var reconciled = await restarted.ReconcileAsync(Round2(), preSendSnapshot: null, CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.CONFIRMED, reconciled.Status);
        Assert.Equal(2, ui.SaveToTableExecuteCount); // still never resent
        var fp = tableState.Fingerprint("5")!;
        Assert.Equal(1, fp.Lines.Count(l => l.NativeCode == "704")); // applied exactly once
    }

    [Fact]
    public async Task WithNoConfirmationClient_ARoundStopsAtAwaiting_AndIsNeverClaimedConfirmed()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var service = new TerminalRoundService(ui, store, new FakeNativeTableStateReader(tableState));

        var state = await service.ExecuteRoundAsync(Round1(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION, state.Status);
        Assert.Equal(1, ui.SaveToTableExecuteCount);

        // Still past the boundary: a redelivery does not re-drive.
        Assert.Equal(TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION,
            (await service.ExecuteRoundAsync(Round1(), CancellationToken.None)).Status);
        Assert.Equal(1, ui.SaveToTableExecuteCount);
    }

    // ─────────────── concurrent human activity after the send ───────────────

    /// <summary>
    /// Simulates a human touching the same table between our pre-send
    /// snapshot and the confirmation read — the exact window in which a
    /// before/after delta stops being causally ours.
    /// </summary>
    private sealed class ConcurrentlyMutatedConfirmationClient(
        FakeTerminalTableState tableState,
        Action<FakeTerminalTableState> intrusion) : IPosServerConfirmationClient
    {
        private readonly FakePosServerConfirmationClient _inner = new(tableState);

        public Task<TerminalConfirmationResult> ConfirmRoundAsync(
            TerminalRoundKind roundKind,
            string requestedTable,
            string? map,
            TableSaleFingerprint? beforeFingerprint,
            IReadOnlyList<TerminalRoundItem> expectedNewItems,
            CancellationToken cancellationToken)
        {
            intrusion(tableState);
            return _inner.ConfirmRoundAsync(
                roundKind, requestedTable, map, beforeFingerprint, expectedNewItems, cancellationToken);
        }
    }

    private async Task<(TerminalRoundStateEntry State, FakeIdealposUiAutomationClient Ui, TerminalRoundService Service)>
        RunRound2WithIntrusionAsync(Action<FakeTerminalTableState> intrusion)
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));

        // Round 1 lands cleanly with an ordinary confirmation client.
        await new TerminalRoundService(ui, store, reader, new FakePosServerConfirmationClient(tableState))
            .ExecuteRoundAsync(Round1(), CancellationToken.None);

        var service = new TerminalRoundService(
            ui, store, reader, new ConcurrentlyMutatedConfirmationClient(tableState, intrusion));
        var state = await service.ExecuteRoundAsync(Round2(), CancellationToken.None);
        return (state, ui, service);
    }

    [Fact]
    public async Task AConcurrentLineFromSomeoneElse_EscalatesToManualResolution_AndIsNeverResent()
    {
        var (state, ui, service) = await RunRound2WithIntrusionAsync(
            ts => ts.AppendRound("5", new[] { new TerminalRoundItem("999", 1) }));

        Assert.Equal(TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED, state.Status);
        Assert.Contains("999", state.Detail);
        Assert.Equal(2, ui.SaveToTableExecuteCount);

        Assert.Equal(TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED,
            (await service.ExecuteRoundAsync(Round2(), CancellationToken.None)).Status);
        Assert.Equal(2, ui.SaveToTableExecuteCount); // manual resolution never auto-retries
    }

    [Fact]
    public async Task AConcurrentMutationOfTheSamePlu_IsNotOverclaimedAsOurs_ButEscalated()
    {
        // The hard case: the intruder adds the SAME PLU this round is adding,
        // so the apparent delta is +2 where we expected +1. A delta-based
        // rule that merely asked "did our item appear?" would have confirmed.
        var (state, ui, _) = await RunRound2WithIntrusionAsync(
            ts => ts.AppendRound("5", new[] { new TerminalRoundItem("704", 1) }));

        Assert.Equal(TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED, state.Status);
        Assert.Contains("duplicate", state.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(2, ui.SaveToTableExecuteCount);
    }

    [Fact]
    public async Task APriorLineRemovedByAConcurrentActor_EscalatesToManualResolution_NeverConfirmed()
    {
        var (state, ui, _) = await RunRound2WithIntrusionAsync(ts => ts.RemoveLine("5", "708"));

        Assert.Equal(TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED, state.Status);
        Assert.Contains("708", state.Detail);
        Assert.Equal(2, ui.SaveToTableExecuteCount);
    }

    /// <summary>Answers with a sale that is on a DIFFERENT table than the one requested.</summary>
    private sealed class WrongTableConfirmationClient(string actualTable) : IPosServerConfirmationClient
    {
        public Task<TerminalConfirmationResult> ConfirmRoundAsync(
            TerminalRoundKind roundKind,
            string requestedTable,
            string? map,
            TableSaleFingerprint? beforeFingerprint,
            IReadOnlyList<TerminalRoundItem> expectedNewItems,
            CancellationToken cancellationToken)
        {
            var after = new TableSaleFingerprint
            {
                TableCode = actualTable,
                Pos = 1,
                Lines = expectedNewItems.Select(i => new TerminalLineFingerprint(i.NativeCode, i.Quantity)).ToList(),
            };
            return Task.FromResult(TerminalConfirmationEvaluator.Evaluate(
                roundKind, requestedTable, beforeFingerprint, after, expectedNewItems));
        }
    }

    [Theory]
    [InlineData("15")]
    [InlineData("25")]
    [InlineData("50")]
    public async Task ASaleOnANeighbouringTable_IsNeverAcceptedAsConfirmationOfTable5(string actualTable)
    {
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var service = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new WrongTableConfirmationClient(actualTable));

        var state = await service.ExecuteRoundAsync(Round1(), CancellationToken.None);

        Assert.NotEqual(TerminalRoundStatus.CONFIRMED, state.Status);
        Assert.Equal(TerminalRoundStatus.UNCERTAIN, state.Status);
        Assert.Contains(actualTable, state.Detail);

        // And it is still past the boundary, so nothing is resent.
        await service.ExecuteRoundAsync(Round1(), CancellationToken.None);
        Assert.Equal(1, ui.SaveToTableExecuteCount);
    }

    // ───────────── the blanket "no blind resend" guard ─────────────

    [Theory]
    [InlineData(TerminalRoundStatus.SEND_INITIATED)]
    [InlineData(TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION)]
    [InlineData(TerminalRoundStatus.CONFIRMED)]
    [InlineData(TerminalRoundStatus.UNCERTAIN)]
    [InlineData(TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED)]
    public async Task NoPostBoundaryState_EverDrivesTheNativeUiAgain(TerminalRoundStatus recorded)
    {
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var request = Round1();

        store.Record(new TerminalRoundStateEntry
        {
            ExternalOrderId = request.ExternalOrderId,
            RoundId = request.RoundId,
            TableCode = request.TableCode,
            Status = recorded,
            Items = request.Items,
            Detail = "seeded by the test",
        });

        var service = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new FakePosServerConfirmationClient(tableState));
        var state = await service.ExecuteRoundAsync(request, CancellationToken.None);

        Assert.Equal(recorded, state.Status);
        Assert.Equal(0, ui.SaveToTableExecuteCount);
    }

    [Fact]
    public void EverySendBoundaryStatus_IsCoveredByTheNoResendGuard()
    {
        // Guards the guard: if a new status is added past the boundary, this
        // fails until IsPastSendBoundary is taught about it.
        foreach (var status in Enum.GetValues<TerminalRoundStatus>())
        {
            var expected = status is not (TerminalRoundStatus.RECEIVED
                or TerminalRoundStatus.TABLE_OPENED
                or TerminalRoundStatus.ITEMS_ENTERED
                or TerminalRoundStatus.FAILED_BEFORE_SEND);
            Assert.Equal(expected, TerminalRoundStateStore.IsPastSendBoundary(status));
        }
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
