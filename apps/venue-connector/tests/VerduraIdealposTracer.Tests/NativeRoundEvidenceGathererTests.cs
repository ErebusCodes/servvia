using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Core.Terminal.PosServer;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Gathering both halves of the confirmation evidence.
///
/// ONE PROPERTY DOMINATES THIS FILE: a read that did not resolve must report
/// SILENCE, never a claim. Specifically it must never report
/// <c>StoredTokenForDevice = null</c> with <c>TokenWasRead = true</c>, because
/// that pair is a positive statement — "we looked, the till holds nothing" —
/// and the API is entitled to release a round's lines on it. A timeout that
/// reported itself that way would send a customer's food to the kitchen twice.
///
/// The second property: the two halves are INDEPENDENT. Either may fail while
/// the other succeeds, and the report says which, because "causal read worked,
/// durable read timed out" converges on the next tick and "both failed" does
/// not.
/// </summary>
public sealed class NativeRoundEvidenceGathererTests
{
    private const string Device = "VERDURA-PROD-0001";
    private const string Token = "0123456789abcdef0123456789abcdef";

    private sealed class StubTokenReader(HandheldTokenReadResult result, Exception? throws = null)
        : IHandheldTokenReader
    {
        public Task<HandheldTokenReadResult> ReadStoredTokenAsync(string deviceId, CancellationToken ct)
            => throws is not null ? throw throws : Task.FromResult(result);
    }

    private sealed class StubTableReader(NativeTableReadResult result, Exception? throws = null)
        : INativeTableStateReaderWithDetail
    {
        public string? LastMap { get; private set; }
        public string? LastTable { get; private set; }

        public Task<NativeTableReadResult> ReadTableAsync(string tableCode, string? map, CancellationToken ct)
        {
            LastTable = tableCode;
            LastMap = map;
            if (throws is not null) throw throws;
            return Task.FromResult(result);
        }
    }

    private static NativeTableReadResult ObservedTable(params (string Code, int Qty)[] lines) =>
        NativeTableReadResult.Sale(new NativeTableSaleObservation
        {
            TableCode = "5",
            Pos = 1,
            Map = "1",
            Lines = lines.Select(l => new ObservedNativeLine { NativeCode = l.Code, Quantity = l.Qty }).ToList(),
        });

    private static NativeRoundEvidenceGatherer Gatherer(
        HandheldTokenReadResult token,
        NativeTableReadResult table,
        Exception? tokenThrows = null,
        Exception? tableThrows = null) =>
        new(new StubTokenReader(token, tokenThrows), new StubTableReader(table, tableThrows));

    [Fact]
    public async Task Reports_both_halves_when_both_reads_resolve()
    {
        var g = Gatherer(HandheldTokenReadResult.Observed(Token), ObservedTable(("23", 1), ("511", 2)));

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.True(payload.TokenWasRead);
        Assert.Equal(Token, payload.StoredTokenForDevice);
        Assert.Equal("observed", payload.CurrentTable!.Status);
        Assert.Equal("5", payload.CurrentTable.TableCode);
        Assert.Equal(1, payload.CurrentTable.Pos);
        Assert.Equal("1", payload.CurrentTable.Map);
        Assert.Collection(
            payload.CurrentTable.Lines!,
            l => { Assert.Equal("23", l.NativeCode); Assert.Equal(1, l.Quantity); },
            l => { Assert.Equal("511", l.NativeCode); Assert.Equal(2, l.Quantity); });
    }

    [Fact]
    public async Task An_absent_token_row_IS_reported_as_null_because_it_is_a_real_reading()
    {
        var g = Gatherer(HandheldTokenReadResult.NoRow("no row for IH-" + Device), ObservedTable());

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.True(payload.TokenWasRead);
        Assert.Null(payload.StoredTokenForDevice);
    }

    [Fact]
    public async Task An_empty_stored_value_is_reported_as_empty_not_as_absent()
    {
        // IsDuplicateHandheldOrder2 inserts Data='' the first time it sees a
        // device. "Known, no checksum" is a real state distinct from "unknown",
        // and it matches no attempt token either way.
        var g = Gatherer(HandheldTokenReadResult.Observed(string.Empty), ObservedTable());

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.True(payload.TokenWasRead);
        Assert.Equal(string.Empty, payload.StoredTokenForDevice);
        Assert.NotNull(payload.StoredTokenForDevice);
    }

    [Theory]
    [InlineData("unavailable")]
    [InlineData("ambiguous")]
    public async Task A_token_read_that_did_not_resolve_reports_silence_never_a_null(string kind)
    {
        var result = kind == "unavailable"
            ? HandheldTokenReadResult.Unavailable("login failed")
            : HandheldTokenReadResult.Ambiguous("two rows");

        var g = Gatherer(result, ObservedTable());

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        // The dangerous pair — (null, true) — is a positive claim the API may
        // release a round's lines on. Neither of these reads earned it.
        Assert.False(payload.TokenWasRead);
        Assert.Null(payload.StoredTokenForDevice);
        Assert.NotNull(payload.TokenReadReason);
    }

    [Fact]
    public async Task A_token_reader_that_throws_reports_silence_rather_than_propagating()
    {
        var g = Gatherer(
            HandheldTokenReadResult.Observed(Token),
            ObservedTable(),
            tokenThrows: new InvalidOperationException("pool exhausted"));

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.False(payload.TokenWasRead);
        Assert.Null(payload.StoredTokenForDevice);
        Assert.Contains("pool exhausted", payload.TokenReadReason);
    }

    [Fact]
    public async Task A_failed_table_read_does_not_cost_us_the_token_read()
    {
        // The two halves are independent. This one converges next tick; a
        // report that collapsed both to "unavailable" would not say so.
        var g = Gatherer(
            HandheldTokenReadResult.Observed(Token),
            NativeTableReadResult.Unavailable("POSServer timed out"));

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.True(payload.TokenWasRead);
        Assert.Equal(Token, payload.StoredTokenForDevice);
        Assert.Equal("unavailable", payload.CurrentTable!.Status);
    }

    [Fact]
    public async Task A_failed_token_read_does_not_cost_us_the_table_read()
    {
        var g = Gatherer(HandheldTokenReadResult.Unavailable("login failed"), ObservedTable(("23", 1)));

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.False(payload.TokenWasRead);
        Assert.Equal("observed", payload.CurrentTable!.Status);
        Assert.Single(payload.CurrentTable.Lines!);
    }

    [Theory]
    [InlineData("noOpenSale")]
    [InlineData("ambiguous")]
    [InlineData("unavailable")]
    public async Task Every_non_observed_table_status_survives_translation_as_itself(string expected)
    {
        var result = expected switch
        {
            "noOpenSale" => NativeTableReadResult.NoSale("table 5 is free"),
            "ambiguous" => NativeTableReadResult.Ambiguous("two sales match"),
            _ => NativeTableReadResult.Unavailable("unreachable"),
        };

        var g = Gatherer(HandheldTokenReadResult.Observed(Token), result);

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.Equal(expected, payload.CurrentTable!.Status);
        // Crucially, none of them carries lines. An `unavailable` that arrived
        // with `Lines = []` would read on the far side as an empty table, and
        // an empty table makes every line of a real round look new.
        Assert.Null(payload.CurrentTable.Lines);
    }

    [Fact]
    public async Task A_genuinely_empty_observed_table_carries_an_empty_line_list_not_a_null_one()
    {
        // An open-but-empty table is a real state and must be distinguishable
        // from an unreadable one. The API refuses an observed snapshot with no
        // line list, so this path must supply one.
        var g = Gatherer(HandheldTokenReadResult.Observed(Token), ObservedTable());

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.Equal("observed", payload.CurrentTable!.Status);
        Assert.NotNull(payload.CurrentTable.Lines);
        Assert.Empty(payload.CurrentTable.Lines!);
    }

    [Fact]
    public async Task A_table_reader_that_throws_becomes_unavailable_never_noOpenSale()
    {
        var g = Gatherer(
            HandheldTokenReadResult.Observed(Token),
            ObservedTable(),
            tableThrows: new TimeoutException("query timed out"));

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.Equal("unavailable", payload.CurrentTable!.Status);
        Assert.NotEqual("noOpenSale", payload.CurrentTable.Status);
        Assert.Contains("query timed out", payload.CurrentTable.Reason);
    }

    [Fact]
    public async Task The_caller_supplied_map_is_passed_through_so_both_delta_terms_share_a_context()
    {
        var table = new StubTableReader(ObservedTable());
        var g = new NativeRoundEvidenceGatherer(
            new StubTokenReader(HandheldTokenReadResult.Observed(Token)), table);

        await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.Equal("1", table.LastMap);
        Assert.Equal("5", table.LastTable);
    }

    [Fact]
    public async Task A_null_map_is_passed_through_so_the_reader_uses_its_configured_one_or_fails_closed()
    {
        var table = new StubTableReader(ObservedTable());
        var g = new NativeRoundEvidenceGatherer(
            new StubTokenReader(HandheldTokenReadResult.Observed(Token)), table);

        await g.GatherAsync(Device, "5", null, CancellationToken.None);

        // Not defaulted here. The reader refuses rather than guessing which
        // partition to look in — map 0 is web/takeaway.
        Assert.Null(table.LastMap);
    }

    [Fact]
    public async Task Quantities_are_reported_per_row_and_never_pre_summed()
    {
        // The sealed Table 5 run recorded qty 2 as TWO qty-1 rows. The API sums
        // by code; summing here as well is how the two ends drift apart.
        var g = Gatherer(
            HandheldTokenReadResult.Observed(Token),
            ObservedTable(("511", 1), ("511", 1)));

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        Assert.Equal(2, payload.CurrentTable!.Lines!.Count);
        Assert.All(payload.CurrentTable.Lines!, l => Assert.Equal(1, l.Quantity));
    }

    [Fact]
    public async Task The_payload_carries_no_verdict_and_no_round_terms()
    {
        var g = Gatherer(HandheldTokenReadResult.Observed(Token), ObservedTable(("23", 1)));

        var payload = await g.GatherAsync(Device, "5", "1", CancellationToken.None);

        // Structural: the type has no property that could express a verdict,
        // an expected item set, or a pre-send baseline. A connector that could
        // supply those could hand over the values it is checked against.
        var names = typeof(NativeRoundEvidencePayload).GetProperties().Select(p => p.Name).ToHashSet();
        Assert.DoesNotContain("Confirmed", names);
        Assert.DoesNotContain("Verdict", names);
        Assert.DoesNotContain("ExpectedItems", names);
        Assert.DoesNotContain("PreSendTable", names);
        Assert.NotNull(payload);
    }
}
