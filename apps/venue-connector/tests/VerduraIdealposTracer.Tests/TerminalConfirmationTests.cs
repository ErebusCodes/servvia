using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The pure native-confirmation evaluator. Operates only on the natural key
/// (Code, Pos=1) and line multisets — never a durable row ID — so a
/// regenerated POSServer ID cannot affect any verdict.
/// </summary>
public sealed class TerminalConfirmationTests
{
    private static TableSaleFingerprint Table(string code, params (string Code, int Qty)[] lines) => new()
    {
        TableCode = code,
        Pos = 1,
        Lines = lines.Select(l => new TerminalLineFingerprint(l.Code, l.Qty)).ToList(),
    };

    private static IReadOnlyList<TerminalRoundItem> Expect(params (string Code, int Qty)[] items) =>
        items.Select(i => new TerminalRoundItem(i.Code, i.Qty)).ToList();

    [Fact]
    public void FirstRound_CorrectTableAndItem_Confirms()
    {
        var r = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5", before: null, after: Table("5", ("708", 1)), Expect(("708", 1)));
        Assert.Equal(TerminalConfirmationOutcome.Confirmed, r.Outcome);
    }

    [Fact]
    public void WrongTable_ReportsTableMissing()
    {
        var r = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5", before: null, after: Table("6", ("708", 1)), Expect(("708", 1)));
        Assert.Equal(TerminalConfirmationOutcome.TableMissing, r.Outcome);
    }

    [Fact]
    public void MissingItem_ReportsExpectedItemMissing()
    {
        var r = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5", before: null, after: Table("5"), Expect(("708", 1)));
        Assert.Equal(TerminalConfirmationOutcome.ExpectedItemMissing, r.Outcome);
    }

    [Fact]
    public void DuplicateItem_ReportsUnexpectedDuplicate()
    {
        var r = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5", before: null, after: Table("5", ("708", 2)), Expect(("708", 1)));
        Assert.Equal(TerminalConfirmationOutcome.UnexpectedDuplicate, r.Outcome);
    }

    [Fact]
    public void SecondRound_RegeneratedPosServerId_DoesNotBreakConfirmation()
    {
        // The fingerprints carry NO row ID by design; even though a real
        // POSServer would have regenerated the row's ID between rounds
        // (TABLEDATA delete+reinsert), confirmation depends only on the
        // natural key and lines, so it still confirms.
        var before = Table("5", ("708", 1));
        var after = Table("5", ("708", 1), ("704", 1));
        var r = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5", before, after, Expect(("704", 1)));
        Assert.Equal(TerminalConfirmationOutcome.Confirmed, r.Outcome);
    }

    [Fact]
    public void SecondRound_DroppedPriorLine_ReportsPriorLinesChanged()
    {
        var before = Table("5", ("708", 1));
        var after = Table("5", ("704", 1)); // 708 vanished
        var r = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.SecondRound, "5", before, after, Expect(("704", 1)));
        Assert.Equal(TerminalConfirmationOutcome.PriorLinesChanged, r.Outcome);
    }

    [Fact]
    public void UiCompletionAlone_IsNotConfirmation_WhenTableAbsent()
    {
        // Model "UI said done" but POSServer shows nothing → not Confirmed.
        var r = TerminalConfirmationEvaluator.Evaluate(
            TerminalRoundKind.FirstRound, "5", before: null, after: null, Expect(("708", 1)));
        Assert.NotEqual(TerminalConfirmationOutcome.Confirmed, r.Outcome);
    }
}
