using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// What a restarted connector process knows, and what it does about it.
///
/// The gap these tests close: a round left at SEND_INITIATED by a crash used
/// to be reachable only through <c>Find(externalOrderId, roundId)</c> — i.e.
/// only if the cloud happened to redeliver that exact request. Any round the
/// cloud considered answered was invisible forever, even though it named a
/// table that might already carry a kitchen docket. Reconciliation is
/// read-only, so there was never a safety reason to forget it; there is only
/// the rule that it must be reconciled and never resent.
///
/// UNIT_OR_MOCK evidence. Every "restart" here is a genuinely new store and
/// service over the same durable log file.
/// </summary>
public sealed class TerminalRestartRecoveryTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("terminal-restart-").FullName;

    private string NewLogPath() => Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson");

    private static TerminalRoundRequest Round1(string roundId = "round-1") => new()
    {
        ExternalOrderId = "ORD-9001",
        RoundId = roundId,
        RoundKind = TerminalRoundKind.FirstRound,
        OrderReference = "REF-9001",
        TableCode = "5",
        Items = new[] { new TerminalRoundItem("708", 1) },
    };

    private static TerminalRoundRequest Round2() => new()
    {
        ExternalOrderId = "ORD-9001",
        RoundId = "round-2",
        RoundKind = TerminalRoundKind.SecondRound,
        OrderReference = "REF-9001",
        TableCode = "5",
        Items = new[] { new TerminalRoundItem("704", 1) },
    };

    // ───────────────── what durable state must carry ─────────────────

    [Fact]
    public async Task DurableState_RecordsEnoughToRebuildTheRoundFaithfully()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var service = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new FakePosServerConfirmationClient(tableState));

        await service.ExecuteRoundAsync(Round1(), CancellationToken.None);

        var persisted = new TerminalRoundStateStore(new DurableLocalLog(logPath)).Find("ORD-9001", "round-1")!;

        // Round kind is the one that changes the verdict, so it is the one
        // that must survive: a second round misread as a first would confirm
        // against an empty baseline.
        Assert.Equal(TerminalRoundKind.FirstRound, persisted.RoundKind);
        Assert.Equal("REF-9001", persisted.OrderReference);
        Assert.Equal("5", persisted.TableCode);
        Assert.Equal(new[] { ("708", 1) }, persisted.Items.Select(i => (i.NativeCode, i.Quantity)));
    }

    [Fact]
    public async Task FindAllLatest_ReturnsTheLastStatePerKey_NotEveryTransition()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var service = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new FakePosServerConfirmationClient(tableState));

        await service.ExecuteRoundAsync(Round1(), CancellationToken.None);
        await service.ExecuteRoundAsync(Round2(), CancellationToken.None);

        var latest = new TerminalRoundStateStore(new DurableLocalLog(logPath)).FindAllLatest();

        Assert.Equal(2, latest.Count); // two keys, many transitions each
        Assert.Equal(TerminalRoundStatus.CONFIRMED, latest[("ORD-9001", "round-1")].Status);
        Assert.Equal(TerminalRoundStatus.CONFIRMED, latest[("ORD-9001", "round-2")].Status);
    }

    [Fact]
    public void AnUnreadableRowInTheSharedLog_DoesNotHideTheOutstandingRounds()
    {
        // The log is shared with other subsystems and is append-only across
        // schema versions. One row this store cannot parse must never make
        // every outstanding round invisible.
        var logPath = NewLogPath();
        var log = new DurableLocalLog(logPath);
        log.AppendDurable(new { type = "something_else_entirely", commandId = "abc" });
        var store = new TerminalRoundStateStore(log);
        store.Record(new TerminalRoundStateEntry
        {
            ExternalOrderId = "ORD-9002",
            RoundId = "round-1",
            TableCode = "5",
            Status = TerminalRoundStatus.SEND_INITIATED,
            RoundKind = TerminalRoundKind.FirstRound,
        });

        var outstanding = new TerminalRoundStateStore(new DurableLocalLog(logPath)).FindNeedingReconciliation();

        Assert.Equal("ORD-9002", Assert.Single(outstanding).ExternalOrderId);
    }

    // ───────────────── the restart sweep ─────────────────

    [Theory]
    [InlineData(TerminalRoundStatus.SEND_INITIATED)]
    [InlineData(TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION)]
    [InlineData(TerminalRoundStatus.UNCERTAIN)]
    public void EveryUnresolvedPostBoundaryState_IsFoundByTheSweep(TerminalRoundStatus status)
    {
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        store.Record(new TerminalRoundStateEntry
        {
            ExternalOrderId = "ORD-9003",
            RoundId = "round-1",
            TableCode = "5",
            Status = status,
            RoundKind = TerminalRoundKind.FirstRound,
        });

        Assert.Single(store.FindNeedingReconciliation());
    }

    [Theory]
    [InlineData(TerminalRoundStatus.CONFIRMED)]
    [InlineData(TerminalRoundStatus.FAILED_BEFORE_SEND)]
    [InlineData(TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED)]
    public void SettledStates_AreNotReSwept(TerminalRoundStatus status)
    {
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        store.Record(new TerminalRoundStateEntry
        {
            ExternalOrderId = "ORD-9004",
            RoundId = "round-1",
            TableCode = "5",
            Status = status,
            RoundKind = TerminalRoundKind.FirstRound,
        });

        Assert.Empty(store.FindNeedingReconciliation());
    }

    [Fact]
    public void RoundsAwaitingAHuman_AreSurfacedSeparately_RatherThanLost()
    {
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        store.Record(new TerminalRoundStateEntry
        {
            ExternalOrderId = "ORD-9005",
            RoundId = "round-1",
            TableCode = "5",
            Status = TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED,
            RoundKind = TerminalRoundKind.SecondRound,
        });

        Assert.Empty(store.FindNeedingReconciliation());
        Assert.Equal("ORD-9005", Assert.Single(store.FindAwaitingHumanAttention()).ExternalOrderId);
    }

    [Fact]
    public async Task AfterACrashAtTheBoundary_TheSweepResolvesTheRound_WithoutTheCloudRedeliveringAnything()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));

        await new TerminalRoundService(ui, store, reader, confirm).ExecuteRoundAsync(Round1(), CancellationToken.None);

        // Round 2: the native side applies it, then the response is lost and
        // the process dies. Nothing further arrives from the cloud.
        ui.TerminalScenario = FakeTerminalScenario.LostResponseAfterNativeApply;
        var lost = await new TerminalRoundService(ui, store, reader, confirm)
            .ExecuteRoundAsync(Round2(), CancellationToken.None);
        Assert.Equal(TerminalRoundStatus.UNCERTAIN, lost.Status);

        // Restart. The sweep — not a redelivered request — finds it.
        var restarted = new TerminalRoundService(
            ui, new TerminalRoundStateStore(new DurableLocalLog(logPath)), reader, confirm);
        var swept = await restarted.ReconcileOutstandingAsync(CancellationToken.None);

        var resolved = Assert.Single(swept);
        Assert.Equal("round-2", resolved.RoundId);
        Assert.Equal(TerminalRoundStatus.CONFIRMED, resolved.Status);
        Assert.Equal(2, ui.SaveToTableExecuteCount); // the sweep drove nothing
        Assert.Equal(1, tableState.Fingerprint("5")!.Lines.Count(l => l.NativeCode == "704"));
    }

    [Fact]
    public async Task TheSweepNeverResends_EvenWhenItCannotResolveTheRound()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));

        await new TerminalRoundService(ui, store, reader, confirm).ExecuteRoundAsync(Round1(), CancellationToken.None);

        // A crash strictly BEFORE the drive: the round never reached the
        // native side, so the sweep will find the expected line missing.
        CrashHook crash = phase => { if (phase == "send_initiated") throw new InvalidOperationException("crash"); };
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => new TerminalRoundService(ui, store, reader, confirm, crash).ExecuteRoundAsync(Round2(), CancellationToken.None));

        var before = ui.SaveToTableExecuteCount;

        var restarted = new TerminalRoundService(
            ui, new TerminalRoundStateStore(new DurableLocalLog(logPath)), reader, confirm);
        var swept = await restarted.ReconcileOutstandingAsync(CancellationToken.None);

        var unresolved = Assert.Single(swept);
        Assert.Equal(TerminalRoundStatus.UNCERTAIN, unresolved.Status);
        Assert.NotEqual(TerminalRoundStatus.CONFIRMED, unresolved.Status);
        Assert.Equal(before, ui.SaveToTableExecuteCount); // fail-closed: reconcile, never resend
    }

    [Fact]
    public async Task ARoundWhoseKindWasNeverRecorded_IsEscalated_NotGuessed()
    {
        // A row written by an older schema. Assuming FirstRound here would
        // confirm against an empty baseline and claim lines that may be
        // somebody else's; assuming SecondRound would be equally arbitrary.
        var logPath = NewLogPath();
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        store.Record(new TerminalRoundStateEntry
        {
            ExternalOrderId = "ORD-9006",
            RoundId = "round-1",
            TableCode = "5",
            Status = TerminalRoundStatus.SEND_INITIATED,
            Items = new[] { new TerminalRoundItem("708", 1) },
            RoundKind = null,
        });

        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var service = new TerminalRoundService(
            ui,
            new TerminalRoundStateStore(new DurableLocalLog(logPath)),
            new FakeNativeTableStateReader(tableState),
            new FakePosServerConfirmationClient(tableState));

        var swept = await service.ReconcileOutstandingAsync(CancellationToken.None);

        var escalated = Assert.Single(swept);
        Assert.Equal(TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED, escalated.Status);
        Assert.Contains("round kind", escalated.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, ui.SaveToTableExecuteCount);

        // And the escalation is durable, so the next restart does not re-sweep it.
        Assert.Empty(new TerminalRoundStateStore(new DurableLocalLog(logPath)).FindNeedingReconciliation());
    }

    [Fact]
    public async Task TheSweepIsIdempotent_ASecondPassChangesNothingAndDrivesNothing()
    {
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));

        await new TerminalRoundService(ui, store, reader, confirm).ExecuteRoundAsync(Round1(), CancellationToken.None);
        ui.TerminalScenario = FakeTerminalScenario.LostResponseAfterNativeApply;
        await new TerminalRoundService(ui, store, reader, confirm).ExecuteRoundAsync(Round2(), CancellationToken.None);

        var service = new TerminalRoundService(
            ui, new TerminalRoundStateStore(new DurableLocalLog(logPath)), reader, confirm);

        var first = await service.ReconcileOutstandingAsync(CancellationToken.None);
        Assert.Equal(TerminalRoundStatus.CONFIRMED, Assert.Single(first).Status);

        var second = await service.ReconcileOutstandingAsync(CancellationToken.None);
        Assert.Empty(second); // nothing left outstanding
        Assert.Equal(2, ui.SaveToTableExecuteCount);
        Assert.Equal(1, tableState.Fingerprint("5")!.Lines.Count(l => l.NativeCode == "704"));
    }

    [Fact]
    public async Task ARoundThatIsStillUnattributable_StaysUnresolved_AcrossRepeatedSweeps()
    {
        // The fail-closed end state: repeated sweeping must not eventually
        // "give up and confirm", and must not eventually resend.
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

        var service = new TerminalRoundService(
            ui, new TerminalRoundStateStore(new DurableLocalLog(logPath)), reader, confirm);

        for (var pass = 0; pass < 3; pass++)
        {
            var swept = await service.ReconcileOutstandingAsync(CancellationToken.None);
            Assert.Equal(TerminalRoundStatus.UNCERTAIN, Assert.Single(swept).Status);
        }

        Assert.Equal(1, ui.SaveToTableExecuteCount); // only round 1 ever drove
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
