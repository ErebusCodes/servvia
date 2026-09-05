using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The pure delta rules: <c>pre-send snapshot + expected round =
/// expected native delta</c> (directive §10), with concurrent mutation
/// treated as ambiguity rather than success (§11).
///
/// Every case here is expressed WITHOUT a row ID, which is what makes the
/// observed PendingSales.ID churn (99719 → 99721 → 99723 → 99724 for one
/// materially unchanged sale) irrelevant to confirmation.
/// </summary>
public sealed class NativeReconciliationTests
{
    private static TableSaleFingerprint Table(string code, string? map, params (string Plu, int Qty)[] lines) => new()
    {
        TableCode = code,
        Pos = 1,
        Map = map,
        Lines = lines.Select(l => new TerminalLineFingerprint(l.Plu, l.Qty)).ToList(),
    };

    private static TerminalRoundItem[] Items(params (string Plu, int Qty)[] items) =>
        items.Select(i => new TerminalRoundItem(i.Plu, i.Qty)).ToArray();

    // ── Round 1 ────────────────────────────────────────────────────────────

    [Fact]
    public void FirstRound_OnAFreeTable_WithTheExpectedLine_Confirms()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5",
            before: null,
            after: Table("5", "1", ("23", 1)),
            expectedNewItems: Items(("23", 1)));

        Assert.Equal(TerminalConfirmationOutcome.Confirmed, result.Outcome);
    }

    /// <summary>
    /// A first round onto a table somebody else already opened cannot be
    /// isolated — even when the expected PLU is present, because it might be
    /// theirs. The old evaluator ignored `before` on this path and would have
    /// confirmed.
    /// </summary>
    [Fact]
    public void FirstRound_OnATableThatWasAlreadyOccupied_IsAmbiguous()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5",
            before: Table("5", "1", ("23", 1)),
            after: Table("5", "1", ("23", 2)),
            expectedNewItems: Items(("23", 1)));

        Assert.Equal(TerminalConfirmationOutcome.Ambiguous, result.Outcome);
        Assert.True(result.RequiresManualResolution);
    }

    // ── Round 2 append (the proven native behaviour) ───────────────────────

    [Fact]
    public void SecondRound_AppendingNewLines_WhilePriorLinesSurvive_Confirms()
    {
        // Exactly the live Table 5 run: Lemon slice stays, two MUHALLEBI arrive.
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5",
            before: Table("5", "1", ("23", 1)),
            after: Table("5", "1", ("23", 1), ("511", 2)),
            expectedNewItems: Items(("511", 2)));

        Assert.Equal(TerminalConfirmationOutcome.Confirmed, result.Outcome);
    }

    [Fact]
    public void SecondRound_RepeatingARoundOneItem_ConfirmsOnTheDeltaNotTheTotal()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5",
            before: Table("5", "1", ("23", 1)),
            after: Table("5", "1", ("23", 3)),
            expectedNewItems: Items(("23", 2)));

        Assert.Equal(TerminalConfirmationOutcome.Confirmed, result.Outcome);
    }

    /// <summary>
    /// The dropped-baseline defect (F1). Without a pre-send snapshot the
    /// prior-lines rule passes vacuously and the delta is measured against
    /// zero, so the evaluator must refuse instead of confirming.
    /// </summary>
    [Fact]
    public void SecondRound_WithNoPreSendSnapshot_IsAmbiguous_NotConfirmed()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5",
            before: null,
            after: Table("5", "1", ("23", 1), ("511", 2)),
            expectedNewItems: Items(("511", 2)));

        Assert.Equal(TerminalConfirmationOutcome.Ambiguous, result.Outcome);
        Assert.Contains("pre-send snapshot", result.Reason);
    }

    [Fact]
    public void SecondRound_LosingAPriorLine_ReportsPriorLinesChanged()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5",
            before: Table("5", "1", ("23", 1)),
            after: Table("5", "1", ("511", 2)),
            expectedNewItems: Items(("511", 2)));

        Assert.Equal(TerminalConfirmationOutcome.PriorLinesChanged, result.Outcome);
        Assert.True(result.RequiresManualResolution);
    }

    [Fact]
    public void SecondRound_AppliedTwice_ReportsUnexpectedDuplicate()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5",
            before: Table("5", "1", ("23", 1)),
            after: Table("5", "1", ("23", 1), ("511", 4)),
            expectedNewItems: Items(("511", 2)));

        Assert.Equal(TerminalConfirmationOutcome.UnexpectedDuplicate, result.Outcome);
        Assert.True(result.RequiresManualResolution);
    }

    [Fact]
    public void SecondRound_WithTheExpectedItemAbsent_ReportsExpectedItemMissing()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5",
            before: Table("5", "1", ("23", 1)),
            after: Table("5", "1", ("23", 1)),
            expectedNewItems: Items(("511", 2)));

        Assert.Equal(TerminalConfirmationOutcome.ExpectedItemMissing, result.Outcome);
    }

    // ── Concurrent human activity (§11) ────────────────────────────────────

    /// <summary>
    /// Somebody added a Coke to Table 5 between our snapshots. Our own items
    /// arrived exactly as expected — but the table also changed in a way we
    /// did not cause, so the round must not be confirmed.
    /// </summary>
    [Fact]
    public void ConcurrentUnexpectedLine_MakesTheRoundAmbiguous_EvenWhenOurDeltaIsCorrect()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5",
            before: Table("5", "1", ("23", 1)),
            after: Table("5", "1", ("23", 1), ("511", 2), ("999", 1)),
            expectedNewItems: Items(("511", 2)));

        Assert.Equal(TerminalConfirmationOutcome.Ambiguous, result.Outcome);
        Assert.Contains("999", result.Reason);
        Assert.True(result.RequiresManualResolution);
    }

    // ── Table and context identity ─────────────────────────────────────────

    [Fact]
    public void ASaleOnADifferentTable_IsNeverConfirmation()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5",
            before: null,
            after: Table("15", "1", ("23", 1)),
            expectedNewItems: Items(("23", 1)));

        Assert.Equal(TerminalConfirmationOutcome.TableMissing, result.Outcome);
    }

    [Fact]
    public void ASaleAtANonPosOnePosition_IsInconclusive()
    {
        var after = Table("5", "1", ("23", 1)) with { Pos = 2 };

        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5", before: null, after: after, expectedNewItems: Items(("23", 1)));

        Assert.Equal(TerminalConfirmationOutcome.Inconclusive, result.Outcome);
    }

    /// <summary>
    /// Map was carried but never compared (defect F2). Map=1 separated the
    /// native table sale from web tickets in the live run, so a map change
    /// across the round means we are not looking at the same context.
    /// </summary>
    [Fact]
    public void AChangedMap_IsInconclusive()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5",
            before: Table("5", "1", ("23", 1)),
            after: Table("5", "0", ("23", 1), ("511", 2)),
            expectedNewItems: Items(("511", 2)));

        Assert.Equal(TerminalConfirmationOutcome.Inconclusive, result.Outcome);
    }

    [Fact]
    public void AMissingTable_IsNeverConfirmation()
    {
        var result = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5", before: null, after: null, expectedNewItems: Items(("23", 1)));

        Assert.Equal(TerminalConfirmationOutcome.TableMissing, result.Outcome);
    }
}
