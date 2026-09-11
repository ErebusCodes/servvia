using VerduraIdealposTracer.Core.Terminal.PosServer;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Reading the venue's price catalogue — the missing half of the price-level
/// proof.
///
/// The property that matters most: an unreadable catalogue is Unavailable and
/// NEVER an empty one. An empty catalogue lets every price level survive
/// unchallenged, which the prover would report as "ambiguous" — an answer about
/// the venue's pricing, drawn from a database outage.
///
/// The second: which Price columns exist is DISCOVERED. Price1..Price4 and
/// Price8 are names found in one binary, not a schema guarantee, and a column
/// this installation does not have must read as absent rather than as a level
/// nothing is priced at.
/// </summary>
public sealed class StockItemPriceReadTests
{
    /// <summary>
    /// A connection that answers the DISCOVERY statement with `columnNames`,
    /// and the row statement with nothing.
    ///
    /// The two statements have different shapes, so they need different result
    /// sets — handing the schema rows back a second time would have the reader
    /// parse column names as prices. `ResultSets` queues one per statement.
    /// </summary>
    private static FakeDbConnection Discovery(params string[] columnNames)
    {
        var c = new FakeDbConnection();
        c.ResultSets.Enqueue((
            new List<string> { "COLUMN_NAME" },
            columnNames.Select(n => new object?[] { n }).ToList()));
        // No catalogue rows by default: these tests are about discovery and
        // about failure handling, not about parsing prices.
        c.ResultSets.Enqueue((new List<string> { "Code" }, new List<object?[]>()));
        return c;
    }

    /// <summary>A connection that discovers `levels` and then returns `rows` for them.</summary>
    private static FakeDbConnection Catalogue(
        int[] levels,
        params (string Code, string?[] Prices)[] rows)
    {
        var c = new FakeDbConnection();
        c.ResultSets.Enqueue((
            new List<string> { "COLUMN_NAME" },
            levels.Select(l => new object?[] { $"Price{l}" }).ToList()));
        var cols = new List<string> { "Code" };
        cols.AddRange(levels.Select(l => $"Price{l}"));
        c.ResultSets.Enqueue((
            cols,
            rows.Select(r => new object?[] { r.Code }.Concat(r.Prices.Cast<object?>()).ToArray())
                .ToList()));
        return c;
    }

    private static StockItemPriceReader ReaderOver(FakeDbConnection conn) => new(() => conn);

    [Fact]
    public async Task Discovers_only_the_price_columns_that_exist()
    {
        // Discovery returns these; the row read then sees the same shape back,
        // which is enough to assert the discovered level set.
        var conn = Discovery("Price1", "Price2", "Description", "PriceGroup", "Price8");

        var result = await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        Assert.Equal(StockItemPriceReadStatus.Observed, result.Status);
        Assert.Equal(new[] { 1, 2, 8 }, result.AvailableLevels);
    }

    [Fact]
    public async Task Ignores_price_shaped_columns_that_are_not_a_level()
    {
        // `PriceGroup`, `PriceLevel`, `Price` all start with "Price" and none is
        // `Price<digit>`. Selecting one would put a non-price in a price slot.
        var conn = Discovery("Price", "PriceGroup", "PriceLevel", "Price10", "Price3");

        var result = await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        Assert.Equal(new[] { 3 }, result.AvailableLevels);
    }

    [Fact]
    public async Task A_catalogue_with_no_price_column_at_all_is_Unavailable_and_says_why()
    {
        var conn = Discovery("Description", "PriceGroup");

        var result = await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        Assert.Equal(StockItemPriceReadStatus.Unavailable, result.Status);
        Assert.Contains("must not be activated", result.Reason);
    }

    [Theory]
    [InlineData("Login failed for user")]
    [InlineData("Invalid object name 'dbo.StockItems'")]
    [InlineData("Timeout expired")]
    public async Task Every_read_failure_is_Unavailable_and_never_an_empty_catalogue(string message)
    {
        var conn = Discovery("Price1");
        conn.FailOnExecute = new InvalidOperationException(message);

        var result = await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        Assert.Equal(StockItemPriceReadStatus.Unavailable, result.Status);
        Assert.Empty(result.Rows);
        Assert.Contains("ignorance, not evidence", result.Reason);
    }

    [Fact]
    public async Task An_unreachable_server_is_Unavailable()
    {
        var conn = Discovery("Price1");
        conn.FailOnOpen = new InvalidOperationException("network-related error");

        var result = await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        Assert.Equal(StockItemPriceReadStatus.Unavailable, result.Status);
    }

    [Fact]
    public async Task An_empty_request_is_refused_without_touching_the_database()
    {
        var conn = Discovery("Price1");

        var result = await ReaderOver(conn).ReadPricesAsync(Array.Empty<string>(), CancellationToken.None);

        Assert.Equal(StockItemPriceReadStatus.Unavailable, result.Status);
        Assert.Equal(0, conn.ExecuteCount);
    }

    [Fact]
    public async Task A_null_connection_from_the_factory_is_Unavailable_not_a_crash()
    {
        var reader = new StockItemPriceReader(() => null!);

        var result = await reader.ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        Assert.Equal(StockItemPriceReadStatus.Unavailable, result.Status);
    }

    [Fact]
    public async Task Cancellation_propagates_rather_than_being_reported_as_Unavailable()
    {
        var conn = Discovery("Price1");
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => ReaderOver(conn).ReadPricesAsync(new[] { "758" }, cts.Token));
    }

    [Fact]
    public async Task Every_requested_code_is_passed_as_its_own_parameter()
    {
        var conn = Discovery("Price1");

        await ReaderOver(conn).ReadPricesAsync(new[] { "758", "219", "823" }, CancellationToken.None);

        Assert.Equal("758", conn.LastParameters["@code0"]);
        Assert.Equal("219", conn.LastParameters["@code1"]);
        Assert.Equal("823", conn.LastParameters["@code2"]);
    }

    [Fact]
    public async Task Codes_are_trimmed_before_being_bound()
    {
        var conn = Discovery("Price1");

        await ReaderOver(conn).ReadPricesAsync(new[] { "   758   " }, CancellationToken.None);

        Assert.Equal("758", conn.LastParameters["@code0"]);
    }

    [Fact]
    public async Task A_hostile_stock_code_reaches_the_statement_only_as_a_parameter()
    {
        var conn = Discovery("Price1");

        await ReaderOver(conn).ReadPricesAsync(
            new[] { "1'; DROP TABLE StockItems; --" }, CancellationToken.None);

        var lastSql = conn.ExecutedCommands[^1];
        Assert.DoesNotContain("DROP", lastSql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("@code0", lastSql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_discovery_statement_is_a_single_read_with_no_caller_input_in_it()
    {
        var sql = StockItemPriceReader.PriceColumnDiscoveryQuery;

        Assert.StartsWith("SELECT ", sql, StringComparison.Ordinal);
        foreach (var forbidden in new[]
                 {
                     "UPDATE", "INSERT", "DELETE", "MERGE", "EXEC", "DROP", "ALTER", "TRUNCATE", ";",
                 })
        {
            Assert.DoesNotContain(forbidden, sql, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task The_row_statement_names_only_columns_the_server_returned()
    {
        // Discovery reported Price1 and Price2, so exactly those are selected.
        // Nothing a caller supplied can become a column name.
        var conn = Discovery("Price1", "Price2");

        await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        var lastSql = conn.ExecutedCommands[^1];
        Assert.Contains("s.[Price1]", lastSql, StringComparison.Ordinal);
        Assert.Contains("s.[Price2]", lastSql, StringComparison.Ordinal);
        Assert.DoesNotContain("Price3", lastSql, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Returns_a_price_per_discovered_level_for_each_row()
    {
        var conn = Catalogue(
            new[] { 1, 2 },
            ("758", new string?[] { "18.00", "20.00" }),
            ("219", new string?[] { "18.00", "19.50" }));

        var result = await ReaderOver(conn).ReadPricesAsync(
            new[] { "758", "219" }, CancellationToken.None);

        Assert.Equal(StockItemPriceReadStatus.Observed, result.Status);
        Assert.Equal(2, result.Rows.Count);
        var first = result.Rows.Single(r => r.NativeCode == "758");
        Assert.Equal("18.00", first.PricesByLevel[1]);
        Assert.Equal("20.00", first.PricesByLevel[2]);
    }

    [Fact]
    public async Task A_NULL_price_is_carried_as_null_rather_than_omitted()
    {
        // The row exists and this level has no price for it. The prover counts
        // that as `absent` — neither a match nor a mismatch — which it can only
        // do if the level is present in the dictionary with a null value.
        var conn = Catalogue(new[] { 1, 3 }, ("758", new string?[] { "18.00", null }));

        var result = await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        var row = Assert.Single(result.Rows);
        Assert.True(row.PricesByLevel.ContainsKey(3));
        Assert.Null(row.PricesByLevel[3]);
    }

    [Fact]
    public async Task Trims_the_code_the_catalogue_returns()
    {
        var conn = Catalogue(new[] { 1 }, ("   758   ", new string?[] { "18.00" }));

        var result = await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        Assert.Equal("758", Assert.Single(result.Rows).NativeCode);
    }

    [Fact]
    public async Task A_row_with_no_code_is_skipped_rather_than_keyed_on_blank()
    {
        var conn = Catalogue(
            new[] { 1 },
            ("   ", new string?[] { "18.00" }),
            ("758", new string?[] { "18.00" }));

        var result = await ReaderOver(conn).ReadPricesAsync(new[] { "758" }, CancellationToken.None);

        Assert.Equal("758", Assert.Single(result.Rows).NativeCode);
    }

    [Fact]
    public void The_candidate_levels_are_single_digits_only()
    {
        // The receiver builds the column name by concatenating the level, so a
        // single digit is the whole range it can produce. Level 0 is included
        // nowhere: `Price0` is not a column found in the image.
        Assert.DoesNotContain(0, StockItemPriceReader.CandidateLevels);
        Assert.All(StockItemPriceReader.CandidateLevels, l => Assert.InRange(l, 1, 9));
    }
}
