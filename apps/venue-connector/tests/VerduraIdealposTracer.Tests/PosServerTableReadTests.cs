using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Core.Terminal.PosServer;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The read-only POSServer table readback, against the sealed 2026-09-05
/// Table 5 evidence.
///
/// The shape being reproduced, verbatim from that run:
///
///   PendingSales      ID=99724  Code='5'  Map=1  POS=1  DateModified=13:16:52
///   PendingSaleLines  Line 1  Col0=SI  Col1='              23'  Col2='Lemon slice'
///                             Col3=1  Col4=1.5  Printed=True  OrderedTime=13:16:49
///                     Line 2  Col0=SI  Col1='             511'  Col2='MUHALLEBI'
///                             Col3=1  Col4=6    Printed=True  OrderedTime=14:07:37
///                     Line 3  (identical to line 2 — quantity 2 is TWO qty-1 rows)
///
/// Two properties are load-bearing throughout and are asserted repeatedly:
/// PendingSales.ID never becomes identity, and "cannot read" never becomes
/// "nothing there".
/// </summary>
public sealed class PosServerTableReadTests
{
    private static readonly string[] QueryColumns =
    {
        "ID", "Code", "Map", "Pos", "DateModified",
        "Line", "Col0", "Col1", "Col2", "Col3", "Col4", "Printed", "OrderedTime", "SeatNumber",
    };

    private static PosServerPendingSaleRow Sale(long id = 99724, string code = "5", int? map = 1, int? pos = 1) =>
        new() { ObservedRowId = id, Code = code, Map = map, Pos = pos, DateModified = new DateTime(2026, 9, 5, 13, 16, 52) };

    /// <summary>A line in the exact shape observed — space-padded Col1, qty 1, Printed true.</summary>
    private static PosServerPendingSaleLineRow Line(
        int line, string plu, string? qty = "1", string? price = "1.5", string col0 = "SI",
        string? description = "Lemon slice", DateTime? orderedTime = null) =>
        new()
        {
            Line = line,
            Col0 = col0,
            Col1 = "              " + plu, // space-padded, exactly as observed
            Col2 = description,
            Col3 = qty,
            Col4 = price,
            Printed = true,
            OrderedTime = orderedTime ?? new DateTime(2026, 9, 5, 13, 16, 49),
            SeatNumber = 0,
        };

    private static NativeTableReadResult Read(
        string requestedTable = "5", string? map = null, params PosServerSaleWithLines[] candidates) =>
        NativeTableSaleCanonicalizer.Canonicalize(requestedTable, map ?? NativeTableSaleCanonicalizer.ObservedTableMapValueOnThisInstallation, NativeTableSaleCanonicalizer.ObservedTableSalePosOnThisInstallation, candidates);

    // ─────────────────────── resolution outcomes ───────────────────────

    [Fact]
    public void AFreeTable5_ReadsAsNoOpenSale_NotAsAnEmptySale()
    {
        var result = Read("5");

        Assert.Equal(NativeTableReadStatus.NoOpenSale, result.Status);
        Assert.Null(result.Fingerprint);
    }

    [Fact]
    public void OneTable5SaleWithTheRound1Line_IsObserved()
    {
        var result = Read("5", null,
            new PosServerSaleWithLines(Sale(), new[] { Line(1, "23") }));

        Assert.Equal(NativeTableReadStatus.Observed, result.Status);
        var fp = result.Fingerprint!;
        Assert.Equal("5", fp.TableCode);
        Assert.Equal(1, fp.Pos);
        Assert.Equal("1", fp.Map);
        var line = Assert.Single(fp.Lines);
        Assert.Equal("23", line.NativeCode); // trimmed
        Assert.Equal(1, line.Quantity);
    }

    [Fact]
    public void Round2Append_KeepsTheRound1LineAndAddsTheNewOnes()
    {
        // The real final state: 1 x Lemon slice, then 2 x MUHALLEBI as two rows.
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[]
        {
            Line(1, "23", price: "1.5", description: "Lemon slice"),
            Line(2, "511", price: "6", description: "MUHALLEBI", orderedTime: new DateTime(2026, 9, 5, 14, 7, 37)),
            Line(3, "511", price: "6", description: "MUHALLEBI", orderedTime: new DateTime(2026, 9, 5, 14, 7, 37)),
        }));

        var observation = result.Observation!;
        Assert.Equal(3, observation.Lines.Count);

        // Quantity 2 is two qty-1 rows. The evaluator sums by code, so the
        // fingerprint carries the rows and the aggregation happens where the
        // rules live.
        Assert.Equal(2, observation.Lines.Count(l => l.NativeCode == "511"));
        Assert.All(observation.Lines, l => Assert.Equal(1, l.Quantity));
    }

    // ─────────────────────── the table context is exact ───────────────────────

    [Theory]
    [InlineData("15")]
    [InlineData("25")]
    [InlineData("50")]
    public void ASaleOnANeighbouringTable_NeverAnswersForTable5(string otherTable)
    {
        var result = Read("5", null,
            new PosServerSaleWithLines(Sale(code: otherTable), new[] { Line(1, "23") }));

        Assert.Equal(NativeTableReadStatus.NoOpenSale, result.Status);
    }

    [Fact]
    public void AWebOrTakeawaySaleOnMapZero_NeverAnswersForADineInTable()
    {
        // Map=0 is the web/takeaway partition — Verdura's own WBORD row lives
        // there. Reading across that boundary would let a web ticket confirm a
        // dine-in round.
        var result = Read("5", null,
            new PosServerSaleWithLines(Sale(map: 0), new[] { Line(1, "23") }));

        Assert.Equal(NativeTableReadStatus.NoOpenSale, result.Status);
        Assert.Contains("Map=1", result.Reason);
    }

    [Fact]
    public void AConfiguredMapMatchesThatMap_AndOnlyThatMap()
    {
        // The map is venue configuration. These assertions say "a configured
        // map 1 matches a map-1 sale, and a map-2 sale does not" — they
        // deliberately do NOT say "native tables live on map 1", which the
        // sealed run never established.
        var saleOnMap1 = new PosServerSaleWithLines(Sale(map: 1), new[] { Line(1, "23") });

        var matching = NativeTableSaleCanonicalizer.Canonicalize("5", "1", 1, new[] { saleOnMap1 });
        var notMatching = NativeTableSaleCanonicalizer.Canonicalize("5", "2", 1, new[] { saleOnMap1 });

        Assert.Equal(NativeTableReadStatus.Observed, matching.Status);
        Assert.Equal(NativeTableReadStatus.NoOpenSale, notMatching.Status);
    }

    [Fact]
    public void ASaleOnAnotherConfiguredMap_IsFoundWhenThatMapIsTheConfiguredOne()
    {
        // The converse, so neither map is privileged by the tests: a venue
        // configured for map 4 reads map-4 tables.
        var saleOnMap4 = new PosServerSaleWithLines(Sale(map: 4), new[] { Line(1, "23") });

        var result = NativeTableSaleCanonicalizer.Canonicalize("5", "4", 1, new[] { saleOnMap4 });

        Assert.Equal(NativeTableReadStatus.Observed, result.Status);
        Assert.Equal("4", result.Observation!.Map);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void WithNoExpectedMapSupplied_TheReadFailsClosed_RatherThanAssumingOne(string? map)
    {
        var result = NativeTableSaleCanonicalizer.Canonicalize(
            "5", map, 1, new[] { new PosServerSaleWithLines(Sale(), new[] { Line(1, "23") }) });

        Assert.Equal(NativeTableReadStatus.Ambiguous, result.Status);
        Assert.Contains("venue configuration, not a", result.Reason);
    }

    [Fact]
    public void WithNoExpectedPosSupplied_TheReadFailsClosed()
    {
        var result = NativeTableSaleCanonicalizer.Canonicalize(
            "5", "1", null, new[] { new PosServerSaleWithLines(Sale(), new[] { Line(1, "23") }) });

        Assert.Equal(NativeTableReadStatus.Ambiguous, result.Status);
        Assert.Contains("POS context", result.Reason);
    }

    [Fact]
    public async Task TheReaderRefusesWhenItsConfiguredContextHasNoMap()
    {
        var connection = Connection();
        var reader = new PosServerTableStateReader(
            () => connection, new NativeTableContext { ExpectedMap = null, ExpectedPos = 1 });

        var result = await reader.ReadTableAsync("5", null, CancellationToken.None);

        Assert.Equal(NativeTableReadStatus.Ambiguous, result.Status);
        Assert.Equal(0, connection.ExecuteCount); // it never even queried
    }

    [Fact]
    public void TheObservedContextIsOfferedAsEvidence_NotAppliedImplicitly()
    {
        // The constant still exists — it is real evidence and a sensible
        // starting point for configuring a venue — but the reader requires it
        // to be handed over rather than reaching for it.
        Assert.Equal("1", NativeTableContext.ObservedOnThisInstallation.ExpectedMap);
        Assert.Equal(1, NativeTableContext.ObservedOnThisInstallation.ExpectedPos);

        var ctorTakesContext = typeof(PosServerTableStateReader)
            .GetConstructors()
            .Single()
            .GetParameters()
            .Single(p => p.ParameterType == typeof(NativeTableContext));
        Assert.False(ctorTakesContext.HasDefaultValue);
    }

    [Fact]
    public void ASaleAtAnotherPos_IsNotTheTableSaleTheseHandlersMaintain()
    {
        var result = Read("5", null,
            new PosServerSaleWithLines(Sale(pos: 2), new[] { Line(1, "23") }));

        Assert.Equal(NativeTableReadStatus.NoOpenSale, result.Status);
    }

    [Fact]
    public void TwoSalesMatchingTheSameTableContext_AreAmbiguous_NeverPickTheNewest()
    {
        // "Take the highest ID" would order them by the one value the Table 5
        // run proved unstable, and would silently answer a question that has
        // two answers.
        var result = Read("5", null,
            new PosServerSaleWithLines(Sale(id: 99724), new[] { Line(1, "23") }),
            new PosServerSaleWithLines(Sale(id: 99725), new[] { Line(1, "511") }));

        Assert.Equal(NativeTableReadStatus.Ambiguous, result.Status);
        Assert.Contains("99724", result.Reason);
        Assert.Contains("99725", result.Reason);
        Assert.Null(result.Fingerprint);
    }

    // ─────────────────────── the surrogate ID is not identity ───────────────────────

    [Fact]
    public void AChangedRowIdBetweenReads_DoesNotChangeTheLogicalFingerprint()
    {
        // The exact live observation: 99719 → 99721 → 99723 → 99724 for one
        // materially unchanged sale.
        var lines = new[] { Line(1, "23"), Line(2, "511", price: "6") };

        var first = Read("5", null, new PosServerSaleWithLines(Sale(id: 99719), lines)).Fingerprint!;
        var later = Read("5", null, new PosServerSaleWithLines(Sale(id: 99724), lines)).Fingerprint!;

        // Compared by content, not by reference: see
        // TheFingerprintDoesNotProvideStructuralEquality below for why `==` is
        // the wrong tool here.
        Assert.Equal(first.TableCode, later.TableCode);
        Assert.Equal(first.Pos, later.Pos);
        Assert.Equal(first.Map, later.Map);
        Assert.Equal(first.Lines, later.Lines); // element-wise
    }

    [Fact]
    public void TheFingerprintDoesNotProvideStructuralEquality_SoNothingMayCompareSnapshotsWithEquals()
    {
        // TableSaleFingerprint is a record whose Lines is an IReadOnlyList, and
        // List<T> has reference equality. So two fingerprints with identical
        // content compare UNEQUAL, and two sharing one list instance would
        // compare equal even if the rest differed. Both directions are wrong,
        // which is why confirmation aggregates by code in the evaluator and
        // never asks whether two snapshots are "equal".
        //
        // Pinned as a test so the trap is a documented fact rather than
        // something the next person discovers by writing `before == after`.
        var lines = new[] { new TerminalLineFingerprint("23", 1) };
        var a = new TableSaleFingerprint { TableCode = "5", Pos = 1, Map = "1", Lines = lines.ToList() };
        var b = new TableSaleFingerprint { TableCode = "5", Pos = 1, Map = "1", Lines = lines.ToList() };

        Assert.NotEqual(a, b);              // identical content, different list instances
        Assert.Equal(a.Lines, b.Lines);     // the content itself does compare
    }

    [Fact]
    public void TheFingerprintExposesNoRowId_EvenThoughTheObservationRecordsOne()
    {
        var result = Read("5", null, new PosServerSaleWithLines(Sale(id: 99724), new[] { Line(1, "23") }));

        Assert.Equal(99724, result.Observation!.ObservedRowId); // kept as evidence
        var fingerprintProperties = typeof(TableSaleFingerprint).GetProperties().Select(p => p.Name);
        Assert.DoesNotContain(fingerprintProperties, n => n.Contains("Id", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void PhysicallyReorderedRows_CanonicalizeToTheSameObservation()
    {
        var ordered = Read("5", null, new PosServerSaleWithLines(Sale(),
            new[] { Line(1, "23"), Line(2, "511", price: "6"), Line(3, "511", price: "6") }));

        var shuffled = Read("5", null, new PosServerSaleWithLines(Sale(),
            new[] { Line(3, "511", price: "6"), Line(1, "23"), Line(2, "511", price: "6") }));

        Assert.Equal(ordered.Observation!.Lines, shuffled.Observation!.Lines);
        Assert.Equal(ordered.Fingerprint!.Lines, shuffled.Fingerprint!.Lines);
    }

    // ─────────────────────── malformed content fails closed ───────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("     ")]
    public void ALineWithNoNativeCode_IsAmbiguous(string? plu)
    {
        var line = Line(1, "23") with { Col1 = plu };
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[] { line }));

        Assert.Equal(NativeTableReadStatus.Ambiguous, result.Status);
        Assert.Contains("no native code", result.Reason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("1.5")]
    public void ALineWithAnUnreadableQuantity_IsAmbiguous(string? qty)
    {
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[] { Line(1, "23", qty: qty) }));

        Assert.Equal(NativeTableReadStatus.Ambiguous, result.Status);
        Assert.Contains("quantity", result.Reason);
    }

    [Fact]
    public void AnIntegralDecimalQuantity_IsAccepted_BecauseADriverMaySurfaceItThatWay()
    {
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[] { Line(1, "23", qty: "2.000") }));

        Assert.Equal(NativeTableReadStatus.Observed, result.Status);
        Assert.Equal(2, Assert.Single(result.Observation!.Lines).Quantity);
    }

    [Fact]
    public void ALineWithAPresentButUnreadablePrice_IsAmbiguous()
    {
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[] { Line(1, "23", price: "££") }));

        Assert.Equal(NativeTableReadStatus.Ambiguous, result.Status);
        Assert.Contains("price", result.Reason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void AnAbsentPrice_IsObservational_NotMalformed(string? price)
    {
        // Absent and unreadable are different facts. Confirmation never uses
        // the price, so an absent one must not block a read.
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[] { Line(1, "23", price: price) }));

        Assert.Equal(NativeTableReadStatus.Observed, result.Status);
        Assert.Null(Assert.Single(result.Observation!.Lines).NativeUnitPrice);
    }

    [Fact]
    public void NonSaleItemLines_AreCountedAsEvidence_ButDoNotEnterTheFingerprint()
    {
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[]
        {
            Line(1, "23"),
            Line(2, "", col0: "TX", description: "a text line"),
        }));

        Assert.Equal(NativeTableReadStatus.Observed, result.Status);
        Assert.Equal(1, result.Observation!.NonSaleItemLineCount);
        Assert.Single(result.Fingerprint!.Lines);
    }

    // ─────────────────────── price and Printed semantics ───────────────────────

    [Fact]
    public void TheNativePriceIsReadFromIdealpos_AndHasNowhereToBeSuppliedFrom()
    {
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[] { Line(1, "23", price: "1.5") }));

        Assert.Equal(1.5m, Assert.Single(result.Observation!.Lines).NativeUnitPrice);

        // The price is observed on the OBSERVATION and is absent from the
        // fingerprint confirmation reasons about — and there is no input type
        // it could ever be supplied through.
        Assert.DoesNotContain(typeof(TerminalLineFingerprint).GetProperties(),
            p => p.Name.Contains("price", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(typeof(TerminalRoundItem).GetProperties(),
            p => p.Name.Contains("price", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void PrintedIsCarriedAsObservationOnly_AndNeverReachesConfirmation()
    {
        // Printed=True was written on every line at creation while both printer
        // logs recorded ZERO bytes. It is written by the sale path, not the
        // printer path, so it can never be evidence a docket physically exists.
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[] { Line(1, "23") }));

        Assert.True(result.Observation!.Lines.Single().PrintedFlag);

        var fingerprintNames = typeof(TableSaleFingerprint).GetProperties().Select(p => p.Name)
            .Concat(typeof(TerminalLineFingerprint).GetProperties().Select(p => p.Name));
        Assert.DoesNotContain(fingerprintNames, n => n.Contains("print", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void OrderedTimeIsObserved_ForRoundPartitioning_ButBindsNothingToVerdura()
    {
        var t = new DateTime(2026, 9, 5, 14, 7, 37);
        var result = Read("5", null, new PosServerSaleWithLines(Sale(), new[] { Line(1, "511", orderedTime: t) }));

        Assert.Equal(t, Assert.Single(result.Observation!.Lines).OrderedTime);

        var fingerprintNames = typeof(TableSaleFingerprint).GetProperties().Select(p => p.Name)
            .Concat(typeof(TerminalLineFingerprint).GetProperties().Select(p => p.Name));
        Assert.DoesNotContain(fingerprintNames, n => n.Contains("time", StringComparison.OrdinalIgnoreCase));
    }

    // ─────────────────────── the SQL adapter ───────────────────────

    private static FakeDbConnection Connection(params object?[][] rows)
    {
        var c = new FakeDbConnection { Columns = QueryColumns.ToList() };
        c.Rows = rows.ToList();
        return c;
    }

    private static object?[] Row(long id, string code, int map, int pos, int? line, string? col0, string? col1, string? col3, string? col4) =>
        new object?[]
        {
            id, code, map, pos, new DateTime(2026, 9, 5, 13, 16, 52),
            line, col0, col1, "desc", col3, col4, true, new DateTime(2026, 9, 5, 13, 16, 49), 0,
        };

    [Fact]
    public async Task TheAdapterReadsTheSaleAndItsLines_InASingleRoundTrip()
    {
        // One statement, one consistent view: reading the sale and then its
        // lines separately could join against an ID the native side had already
        // regenerated, returning zero lines for an occupied table.
        var connection = Connection(
            Row(99724, "5", 1, 1, 1, "SI", "              23", "1", "1.5"),
            Row(99724, "5", 1, 1, 2, "SI", "             511", "1", "6"));
        var reader = new PosServerTableStateReader(() => connection, NativeTableContext.ObservedOnThisInstallation);

        var result = await reader.ReadTableAsync("5", null, CancellationToken.None);

        Assert.Equal(NativeTableReadStatus.Observed, result.Status);
        Assert.Equal(2, result.Fingerprint!.Lines.Count);
        Assert.Equal(1, connection.ExecuteCount);
    }

    [Fact]
    public async Task TheAdapterParameterizesTheTableContext_AndNeverInterpolatesIt()
    {
        var connection = Connection();
        var reader = new PosServerTableStateReader(() => connection, NativeTableContext.ObservedOnThisInstallation);

        await reader.ReadTableAsync("5", null, CancellationToken.None);

        Assert.Equal("5", connection.LastParameters["@code"]);
        Assert.Equal(1, connection.LastParameters["@map"]);
        Assert.Equal(1, connection.LastParameters["@pos"]);
        Assert.DoesNotContain("'5'", connection.ExecutedCommands.Single());
    }

    [Fact]
    public async Task ASaleWithNoLines_ReadsAsAnOpenSaleWithZeroLines_NotAsAFreeTable()
    {
        // The LEFT JOIN yields one row with null line columns. An open-but-empty
        // table is a real state and must not read as free.
        var connection = Connection(Row(99724, "5", 1, 1, null, null, null, null, null));
        var reader = new PosServerTableStateReader(() => connection, NativeTableContext.ObservedOnThisInstallation);

        var result = await reader.ReadTableAsync("5", null, CancellationToken.None);

        Assert.Equal(NativeTableReadStatus.Observed, result.Status);
        Assert.Empty(result.Fingerprint!.Lines);
    }

    [Fact]
    public async Task WhenTheServerCannotBeReached_TheResultIsUnavailable_NotAnEmptyTable()
    {
        var connection = new FakeDbConnection { FailOnOpen = new InvalidOperationException("network unreachable") };
        var reader = new PosServerTableStateReader(() => connection, NativeTableContext.ObservedOnThisInstallation);

        var result = await reader.ReadTableAsync("5", null, CancellationToken.None);

        Assert.Equal(NativeTableReadStatus.Unavailable, result.Status);
        Assert.NotEqual(NativeTableReadStatus.NoOpenSale, result.Status);
        Assert.Contains("network unreachable", result.Reason);
    }

    [Fact]
    public async Task ATransientQueryFailure_IsUnavailable_NotAnEmptyTable()
    {
        var connection = new FakeDbConnection
        {
            Columns = QueryColumns.ToList(),
            FailOnExecute = new TimeoutException("query timed out"),
        };
        var reader = new PosServerTableStateReader(() => connection, NativeTableContext.ObservedOnThisInstallation);

        var result = await reader.ReadTableAsync("5", null, CancellationToken.None);

        Assert.Equal(NativeTableReadStatus.Unavailable, result.Status);
        Assert.Contains("TimeoutException", result.Reason);
    }

    [Fact]
    public async Task TheInterfaceAdapter_ThrowsForUnavailable_SoTheRoundFailsBeforeSend()
    {
        // INativeTableStateReader can only say "fingerprint" or "no sale".
        // "I could not look" must not be squeezed into null — that is the exact
        // confusion that sends a first round onto an occupied table.
        var connection = new FakeDbConnection { FailOnOpen = new InvalidOperationException("down") };
        var reader = new PosServerTableStateReader(() => connection, NativeTableContext.ObservedOnThisInstallation);

        await Assert.ThrowsAsync<NativeCapabilityUnavailableException>(
            () => reader.ReadAsync("5", null, CancellationToken.None));
    }

    [Fact]
    public async Task TheInterfaceAdapter_ThrowsForAmbiguous()
    {
        var connection = Connection(
            Row(99724, "5", 1, 1, 1, "SI", "23", "1", "1.5"),
            Row(99725, "5", 1, 1, 1, "SI", "511", "1", "6"));
        var reader = new PosServerTableStateReader(() => connection, NativeTableContext.ObservedOnThisInstallation);

        await Assert.ThrowsAsync<NativeCapabilityUnavailableException>(
            () => reader.ReadAsync("5", null, CancellationToken.None));
    }

    [Fact]
    public async Task TheInterfaceAdapter_ReturnsNullOnlyForAGenuinelyFreeTable()
    {
        var connection = Connection();
        var reader = new PosServerTableStateReader(() => connection, NativeTableContext.ObservedOnThisInstallation);

        Assert.Null(await reader.ReadAsync("5", null, CancellationToken.None));
    }

    [Fact]
    public void TheOnlyStatementIsASelect_WithNoMutatingVerb()
    {
        var sql = PosServerTableStateReader.TableSaleQuery;

        Assert.StartsWith("SELECT", sql, StringComparison.OrdinalIgnoreCase);
        foreach (var verb in new[] { "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "TRUNCATE", "EXEC", "ALTER" })
        {
            Assert.DoesNotContain(verb, sql, StringComparison.OrdinalIgnoreCase);
        }
        // A dirty read would let uncommitted native work be attributed to us.
        Assert.DoesNotContain("NOLOCK", sql, StringComparison.OrdinalIgnoreCase);
    }
}
