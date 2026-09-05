using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// THE LIMITATION, STATED HONESTLY AND PINNED DOWN.
///
/// Nothing in native IdealPOS ties a table sale, or a line on it, to a Verdura
/// order. The 2026-09-05 sealed run searched PendingSales, PendingSaleLines,
/// TableMapSetups, TableActivity and ~SENDSTAT for such a field and found none.
///
/// So this scenario is, to the readback, invisible:
///
///   baseline    Table 5 carries Lemon slice (23) x1
///   Verdura     intends MUHALLEBI (511) x1
///   meanwhile   a staff member independently rings up MUHALLEBI (511) x1
///   post-state  Table 5 carries 23 x1 and 511 x1
///
/// The observed delta is exactly the expected delta whether or not Verdura's
/// send ever landed. Comparing table, PLU and quantity cannot tell whose
/// mutation it was, and no test here pretends otherwise.
///
/// These tests exist to make that permanent and legible: the first group proves
/// the evaluator DOES return Confirmed for the indistinguishable case (so
/// nobody later believes it detects the collision), and the second proves the
/// state machine nevertheless refuses to ATTRIBUTE when it has no evidence of
/// its own execution — without ever converting that refusal into a resend.
/// </summary>
public sealed class ExactDeltaCausalityLimitTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("causality-").FullName;

    private string NewLogPath() => Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson");

    private const string Lemon = "23";
    private const string Muhallebi = "511";

    private static TableSaleFingerprint Table5(params (string Code, int Qty)[] lines) => new()
    {
        TableCode = "5",
        Pos = 1,
        Map = "1",
        Lines = lines.Select(l => new TerminalLineFingerprint(l.Code, l.Qty)).ToList(),
    };

    // ───────────── what the pure evaluator can and cannot see ─────────────

    [Fact]
    public void AnIdenticalConcurrentHumanMutation_IsIndistinguishable_AndTheEvaluatorSaysConfirmed()
    {
        // This is the documented gap, asserted rather than described. The
        // evaluator is answering "does the content match?" — and it does,
        // because a human's MUHALLEBI x1 is byte-identical to ours.
        //
        // If this test ever starts failing because the outcome changed, the
        // reader has gained a causal identifier and this whole file should be
        // revisited. It is NOT a bug report against the evaluator.
        var before = Table5((Lemon, 1));
        var afterProducedByAHuman = Table5((Lemon, 1), (Muhallebi, 1));

        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5", before, afterProducedByAHuman,
            new[] { new TerminalRoundItem(Muhallebi, 1) });

        Assert.Equal(TerminalConfirmationOutcome.Confirmed, result.Outcome);
    }

    [Fact]
    public void WhenBothOursAndTheirsLand_TheDoubledDeltaIsCaught()
    {
        // The collision is only invisible when exactly ONE of the two mutations
        // happened. If ours landed AND a human added the same item, the delta is
        // +2 against an expected +1 and the evaluator refuses.
        var before = Table5((Lemon, 1));
        var after = Table5((Lemon, 1), (Muhallebi, 1), (Muhallebi, 1));

        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5", before, after,
            new[] { new TerminalRoundItem(Muhallebi, 1) });

        Assert.Equal(TerminalConfirmationOutcome.UnexpectedDuplicate, result.Outcome);
        Assert.True(result.RequiresManualResolution);
    }

    [Fact]
    public void ADifferentConcurrentItem_IsCaught_BecauseItIsNotInTheExpectedSet()
    {
        // Worth stating alongside the limitation: the gap is narrow. Only a
        // collision on the SAME PLU at the SAME quantity is invisible.
        var before = Table5((Lemon, 1));
        var after = Table5((Lemon, 1), (Muhallebi, 1), ("999", 1));

        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5", before, after,
            new[] { new TerminalRoundItem(Muhallebi, 1) });

        Assert.Equal(TerminalConfirmationOutcome.Ambiguous, result.Outcome);
    }

    // ───────────── what the state machine does about it ─────────────

    private static TerminalRoundRequest Round1() => new()
    {
        ExternalOrderId = "ORD-CAUSAL",
        RoundId = "round-1",
        RoundKind = TerminalRoundKind.FirstRound,
        OrderReference = "REF-CAUSAL",
        TableCode = "5",
        Items = new[] { new TerminalRoundItem(Lemon, 1) },
    };

    private static TerminalRoundRequest Round2() => new()
    {
        ExternalOrderId = "ORD-CAUSAL",
        RoundId = "round-2",
        RoundKind = TerminalRoundKind.SecondRound,
        OrderReference = "REF-CAUSAL",
        TableCode = "5",
        Items = new[] { new TerminalRoundItem(Muhallebi, 1) },
    };

    [Fact]
    public async Task WithAGuardedActionWindow_AnExactDeltaConfirms()
    {
        // The driver completed a bounded action window in this process and
        // reported success. The window is the extra evidence that makes a
        // content match acceptable as attribution.
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var service = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new FakePosServerConfirmationClient(tableState));

        await service.ExecuteRoundAsync(Round1(), CancellationToken.None);
        var second = await service.ExecuteRoundAsync(Round2(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.CONFIRMED, second.Status);
        Assert.Contains("guarded action window", second.Detail);
    }

    [Fact]
    public async Task WithoutExecutionEvidence_TheSameExactDeltaIsNotAttributed()
    {
        // Identical native state, identical delta — and a different verdict,
        // because the only thing that changed is what we know about our own
        // execution. That is the whole correction: attribution is not a
        // property of the fingerprint.
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var service = new TerminalRoundService(ui, store, reader, confirm);

        await service.ExecuteRoundAsync(Round1(), CancellationToken.None);

        // Somebody — us, or a person; the readback cannot say — puts exactly
        // the expected item on the table.
        tableState.AppendRound("5", new[] { new TerminalRoundItem(Muhallebi, 1) });

        var recovered = await service.ReconcileAsync(
            Round2(), preSendSnapshot: Table5((Lemon, 1)),
            RoundAttributionBasis.RecoveredWithoutExecutionEvidence, CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED, recovered.Status);
        Assert.NotEqual(TerminalRoundStatus.CONFIRMED, recovered.Status);
        Assert.Contains("indistinguishable", recovered.Detail);
    }

    [Fact]
    public async Task RefusingToAttribute_NeverBecomesASecondSend()
    {
        // The failure mode a stricter rule could easily introduce: "not
        // confirmed" must not read as "try again". A round that cannot be
        // attributed stays unresolved and the driver is never touched.
        var logPath = NewLogPath();
        var tableState = new FakeTerminalTableState();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success, tableState);
        var reader = new FakeNativeTableStateReader(tableState);
        var confirm = new FakePosServerConfirmationClient(tableState);
        var store = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        var service = new TerminalRoundService(ui, store, reader, confirm);

        await service.ExecuteRoundAsync(Round1(), CancellationToken.None);
        var drivesAfterRound1 = ui.SaveToTableExecuteCount;

        tableState.AppendRound("5", new[] { new TerminalRoundItem(Muhallebi, 1) });
        await service.ReconcileAsync(Round2(), Table5((Lemon, 1)),
            RoundAttributionBasis.RecoveredWithoutExecutionEvidence, CancellationToken.None);

        // Re-delivery of the same round, and a further sweep, both refuse to drive.
        await service.ExecuteRoundAsync(Round2(), CancellationToken.None);
        await service.ReconcileOutstandingAsync(CancellationToken.None);

        Assert.Equal(drivesAfterRound1, ui.SaveToTableExecuteCount);
        Assert.Equal(1, tableState.Fingerprint("5")!.Lines.Count(l => l.NativeCode == Muhallebi));
    }

    [Fact]
    public void TheTwoAttributionBases_AreTheOnlyOnes_AndNeitherIsADefault()
    {
        // Callers must state their evidence. A default would silently pick one,
        // and the safe-looking choice (GuardedActionWindow) is the one that
        // grants attribution.
        Assert.Equal(
            new[] { RoundAttributionBasis.GuardedActionWindow, RoundAttributionBasis.RecoveredWithoutExecutionEvidence },
            Enum.GetValues<RoundAttributionBasis>());

        var reconcile = typeof(TerminalRoundService).GetMethod(nameof(TerminalRoundService.ReconcileAsync))!;
        var basis = reconcile.GetParameters().Single(p => p.ParameterType == typeof(RoundAttributionBasis));
        Assert.False(basis.HasDefaultValue);
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
