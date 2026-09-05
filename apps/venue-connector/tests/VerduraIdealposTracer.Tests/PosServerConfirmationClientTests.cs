using System.Reflection;
using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Core.Terminal.PosServer;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The real confirmation client is a thin adapter: read the "after" term, hand
/// it to the pure evaluator, return what the evaluator says.
///
/// The tests below are mostly about what the adapter must NOT do. It must not
/// hold an opinion about native truth, must not turn an unreadable database
/// into "no sale", and must not soften the evaluator's Ambiguous verdict — the
/// verdict that exists precisely because a matching PLU/quantity delta is
/// reconciliation evidence and not causal identity. No native field binds a
/// sale to a Verdura order; the 2026-09-05 run searched for one and found none.
/// </summary>
public sealed class PosServerConfirmationClientTests
{
    private static readonly string[] QueryColumns =
    {
        "ID", "Code", "Map", "Pos", "DateModified",
        "Line", "Col0", "Col1", "Col2", "Col3", "Col4", "Printed", "OrderedTime", "SeatNumber",
    };

    private static object?[] Row(string plu, int line, long id = 99724, string code = "5", int map = 1, int pos = 1) =>
        new object?[]
        {
            id, code, map, pos, new DateTime(2026, 9, 5, 13, 16, 52),
            line, "SI", "              " + plu, "desc", "1", "1.5", true,
            new DateTime(2026, 9, 5, 13, 16, 49), 0,
        };

    private static PosServerConfirmationClient ClientOver(params object?[][] rows)
    {
        var connection = new FakeDbConnection { Columns = QueryColumns.ToList(), Rows = rows.ToList() };
        return new PosServerConfirmationClient(new PosServerTableStateReader(() => connection));
    }

    private static TableSaleFingerprint Before(params (string Code, int Qty)[] lines) => new()
    {
        TableCode = "5",
        Pos = 1,
        Map = "1",
        Lines = lines.Select(l => new TerminalLineFingerprint(l.Code, l.Qty)).ToList(),
    };

    // ─────────────────────── it delegates, it does not decide ───────────────────────

    [Fact]
    public async Task AFirstRoundOnAFreeTable_WithTheExpectedLine_Confirms()
    {
        var client = ClientOver(Row("23", 1));

        var result = await client.ConfirmRoundAsync(
            TerminalRoundKind.FirstRound, "5", null, beforeFingerprint: null,
            new[] { new TerminalRoundItem("23", 1) }, CancellationToken.None);

        Assert.Equal(TerminalConfirmationOutcome.Confirmed, result.Outcome);
    }

    [Fact]
    public async Task ASecondRoundAppendingNewLines_Confirms_WithPriorLinesIntact()
    {
        // Before: 1 x 23. After: 1 x 23 plus 2 x 511, as two qty-1 rows.
        var client = ClientOver(Row("23", 1), Row("511", 2), Row("511", 3));

        var result = await client.ConfirmRoundAsync(
            TerminalRoundKind.SecondRound, "5", null, Before(("23", 1)),
            new[] { new TerminalRoundItem("511", 2) }, CancellationToken.None);

        Assert.Equal(TerminalConfirmationOutcome.Confirmed, result.Outcome);
    }

    [Fact]
    public async Task AConcurrentUnexpectedLine_IsAmbiguous_NotConfirmed()
    {
        // Our delta is exactly right AND somebody else added a line. The
        // evaluator refuses to attribute; the adapter must pass that through
        // unchanged rather than noticing "our items are all there".
        var client = ClientOver(Row("23", 1), Row("511", 2), Row("999", 3));

        var result = await client.ConfirmRoundAsync(
            TerminalRoundKind.SecondRound, "5", null, Before(("23", 1)),
            new[] { new TerminalRoundItem("511", 1) }, CancellationToken.None);

        Assert.Equal(TerminalConfirmationOutcome.Ambiguous, result.Outcome);
        Assert.True(result.RequiresManualResolution);
    }

    [Fact]
    public async Task AFreeTableAfterTheRound_IsTableMissing_FromTheEvaluator()
    {
        var client = ClientOver(); // no rows: the table carries no sale

        var result = await client.ConfirmRoundAsync(
            TerminalRoundKind.FirstRound, "5", null, null,
            new[] { new TerminalRoundItem("23", 1) }, CancellationToken.None);

        Assert.Equal(TerminalConfirmationOutcome.TableMissing, result.Outcome);
    }

    [Theory]
    [InlineData(TerminalRoundKind.FirstRound)]
    [InlineData(TerminalRoundKind.SecondRound)]
    public async Task TheAdapterReturnsExactlyWhatTheEvaluatorWouldReturn(TerminalRoundKind kind)
    {
        // The strongest statement of "thin adapter": for the same inputs, the
        // adapter's answer and a direct evaluator call are identical.
        var expected = new[] { new TerminalRoundItem("511", 1) };
        var before = Before(("23", 1));
        var client = ClientOver(Row("23", 1), Row("511", 2));

        var viaAdapter = await client.ConfirmRoundAsync(
            kind, "5", null, before, expected, CancellationToken.None);

        var after = new TableSaleFingerprint
        {
            TableCode = "5",
            Pos = 1,
            Map = "1",
            Lines = new[] { new TerminalLineFingerprint("23", 1), new TerminalLineFingerprint("511", 1) },
        };
        var viaEvaluator = TerminalConfirmationEvaluator.Evaluate(kind, "5", before, after, expected);

        Assert.Equal(viaEvaluator.Outcome, viaAdapter.Outcome);
        Assert.Equal(viaEvaluator.Reason, viaAdapter.Reason);
    }

    // ─────────────────────── unreadable is not "no sale" ───────────────────────

    [Fact]
    public async Task WhenPosServerCannotBeRead_ItThrows_RatherThanReportingTableMissing()
    {
        // TableMissing is a claim about native state. An unreadable database
        // supports no claim at all, and reporting one would be a false negative
        // that a later retry could turn into a resend.
        var connection = new FakeDbConnection { FailOnOpen = new InvalidOperationException("server down") };
        var client = new PosServerConfirmationClient(new PosServerTableStateReader(() => connection));

        var ex = await Assert.ThrowsAsync<NativeCapabilityUnavailableException>(
            () => client.ConfirmRoundAsync(
                TerminalRoundKind.FirstRound, "5", null, null,
                new[] { new TerminalRoundItem("23", 1) }, CancellationToken.None));

        Assert.Contains("server down", ex.Message);
    }

    [Fact]
    public async Task WhenTwoSalesMatchTheTableContext_ItThrows_RatherThanChoosingOne()
    {
        var client = ClientOver(Row("23", 1, id: 99724), Row("511", 1, id: 99725));

        await Assert.ThrowsAsync<NativeCapabilityUnavailableException>(
            () => client.ConfirmRoundAsync(
                TerminalRoundKind.FirstRound, "5", null, null,
                new[] { new TerminalRoundItem("23", 1) }, CancellationToken.None));
    }

    [Fact]
    public async Task ItReadsTheTableContextFromTheBeforeSnapshot_SoBothTermsShareOneContext()
    {
        var connection = new FakeDbConnection { Columns = QueryColumns.ToList(), Rows = { Row("23", 1) } };
        var client = new PosServerConfirmationClient(new PosServerTableStateReader(() => connection));

        await client.ConfirmRoundAsync(
            TerminalRoundKind.SecondRound, "5", map: null, Before(("23", 1)),
            new[] { new TerminalRoundItem("23", 1) }, CancellationToken.None);

        Assert.Equal(1, connection.LastParameters["@map"]); // taken from the snapshot's Map
    }

    // ─────────────────────── it cannot grow its own rules ───────────────────────

    [Fact]
    public void TheAdapterDeclaresNoConfirmationLogicOfItsOwn()
    {
        // Any second method producing a TerminalConfirmationResult would be a
        // second, untested opinion about native truth living outside the pure
        // evaluator.
        var producers = typeof(PosServerConfirmationClient)
            .GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
            .Where(m => m.ReturnType == typeof(TerminalConfirmationResult)
                || m.ReturnType == typeof(Task<TerminalConfirmationResult>))
            .Select(m => m.Name)
            .ToList();

        Assert.Equal(new[] { nameof(PosServerConfirmationClient.ConfirmRoundAsync) }, producers);
    }

    [Fact]
    public void TheAdapterNeverConstructsAConfirmationResultItself()
    {
        // Every verdict must come back from TerminalConfirmationEvaluator. A
        // `new TerminalConfirmationResult(...)` anywhere in this file would mean
        // the adapter had started deciding.
        var source = File.ReadAllText(SourcePath("PosServerConfirmationClient.cs"));

        Assert.DoesNotContain("new TerminalConfirmationResult", source);
        Assert.Contains("TerminalConfirmationEvaluator.Evaluate", source);
    }

    [Fact]
    public void TheReaderNeverWritesToPosServer()
    {
        // Call sites, not words: the file's own documentation says the phrase
        // "no ExecuteNonQuery", and a test that cannot tell prose from code
        // would fail on its own explanation. A real write needs an invocation,
        // which needs a receiver and an argument list.
        var source = File.ReadAllText(SourcePath("PosServerTableStateReader.cs"));

        foreach (var forbidden in new[]
                 {
                     ".ExecuteNonQuery(", ".ExecuteNonQueryAsync(",
                     ".ExecuteScalar(", ".ExecuteScalarAsync(",
                     ".BeginTransaction(", ".BeginTransactionAsync(",
                 })
        {
            Assert.DoesNotContain(forbidden, source, StringComparison.OrdinalIgnoreCase);
        }

        // The only statement it can send is the one SELECT constant, and that
        // constant is asserted mutation-free in PosServerTableReadTests.
        Assert.Single(
            source.Split("CommandText = ", StringSplitOptions.None).Skip(1).ToList());
        Assert.Contains("command.CommandText = TableSaleQuery;", source);
    }

    private static string SourcePath(string fileName)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "VerduraIdealposTracer.slnx")))
        {
            dir = dir.Parent;
        }
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "src", "VerduraIdealposTracer.Core", "Terminal", "PosServer", fileName);
    }
}
