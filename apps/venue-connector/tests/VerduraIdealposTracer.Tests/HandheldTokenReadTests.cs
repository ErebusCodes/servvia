using System.Data.Common;
using VerduraIdealposTracer.Core.Terminal.PosServer;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The CAUSAL half of native confirmation: the checksum the receiver stores
/// against our DeviceID.
///
/// Two properties are load-bearing here and are asserted repeatedly, because
/// both of them protect a real customer's bill:
///
///   "COULD NOT READ" IS NEVER "NO ROW". An unreachable database, a timeout, a
///   permission error and a missing table all mean we do not know what the till
///   is holding. Reported as NoRow, any of them could let a round that IS on a
///   bill have its lines released and sent a second time.
///
///   THE READ IS READ-ONLY BY CONSTRUCTION, not by intention. One SELECT, held
///   in a constant, one column, one parameter, no dynamic SQL, no transaction.
///   Those are structural facts and are asserted as such.
/// </summary>
public sealed class HandheldTokenReadTests
{
    private const string Device = "VERDURA-PROD-0001";
    private const string Token = "0123456789abcdef0123456789abcdef";

    private static FakeDbConnection Store(params object?[] dataValues)
    {
        var conn = new FakeDbConnection { Columns = { "Data" } };
        foreach (var v in dataValues) conn.Rows.Add(new[] { v });
        return conn;
    }

    private static HandheldTokenReader ReaderOver(DbConnection connection) =>
        new(() => connection);

    [Fact]
    public async Task Reads_the_stored_token_for_our_device()
    {
        var conn = Store(Token);

        var result = await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Observed, result.Status);
        Assert.Equal(Token, result.StoredToken);
    }

    [Fact]
    public async Task Keys_the_lookup_by_the_IH_prefixed_ColumnType()
    {
        var conn = Store(Token);

        await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        // The receiver keys this row 'IH-<DeviceID>' — PROVEN STATIC from
        // IsDuplicateHandheldOrder2 (0x01835070) and SaveChecksum (0x018267f0).
        Assert.Equal("IH-" + Device, conn.LastParameters["@columnType"]);
    }

    [Fact]
    public async Task Trims_the_device_id_before_building_the_ColumnType()
    {
        var conn = Store(Token);

        await ReaderOver(conn).ReadStoredTokenAsync("  " + Device + "  ", CancellationToken.None);

        Assert.Equal("IH-" + Device, conn.LastParameters["@columnType"]);
    }

    [Fact]
    public async Task An_absent_row_is_NoRow_and_says_so()
    {
        var conn = Store();

        var result = await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.NoRow, result.Status);
        Assert.Null(result.StoredToken);
        Assert.Contains("IH-" + Device, result.Reason);
    }

    [Fact]
    public async Task An_empty_stored_value_is_Observed_and_empty_not_absent()
    {
        // IsDuplicateHandheldOrder2 INSERTs a row with Data='' the first time it
        // sees a DeviceID; only SaveChecksum later fills it in. "This device is
        // known and no checksum has been stored" is a different fact from "this
        // device is unknown", and it matches no attempt token either way.
        var conn = Store("");

        var result = await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Observed, result.Status);
        Assert.Equal(string.Empty, result.StoredToken);
        Assert.NotEqual(Token, result.StoredToken);
    }

    [Fact]
    public async Task A_null_stored_value_reads_as_empty_rather_than_throwing()
    {
        var conn = Store(new object?[] { null }[0]);

        var result = await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Observed, result.Status);
        Assert.Equal(string.Empty, result.StoredToken);
    }

    [Fact]
    public async Task Two_rows_for_one_ColumnType_are_Ambiguous_never_the_first_one()
    {
        var conn = Store(Token, "some-other-token");

        var result = await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Ambiguous, result.Status);
        Assert.Null(result.StoredToken);
    }

    [Theory]
    [InlineData("unreachable")]
    [InlineData("Login failed for user")]
    [InlineData("Invalid object name 'dbo.AAAExampleData'")]
    public async Task Every_read_failure_is_Unavailable_and_never_NoRow(string message)
    {
        var conn = Store(Token);
        conn.FailOnExecute = new InvalidOperationException(message);

        var result = await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Unavailable, result.Status);
        Assert.NotEqual(HandheldTokenReadStatus.NoRow, result.Status);
        Assert.Contains(message, result.Reason);
        Assert.Contains("ignorance, not absence", result.Reason);
    }

    [Fact]
    public async Task An_unreachable_server_is_Unavailable_not_NoRow()
    {
        var conn = Store(Token);
        conn.FailOnOpen = new InvalidOperationException("network-related or instance-specific error");

        var result = await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Unavailable, result.Status);
    }

    [Fact]
    public async Task A_null_connection_from_the_factory_is_Unavailable_not_a_crash()
    {
        var reader = new HandheldTokenReader(() => null!);

        var result = await reader.ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Unavailable, result.Status);
    }

    [Fact]
    public async Task A_blank_device_id_is_refused_without_touching_the_database()
    {
        var conn = Store(Token);

        var result = await ReaderOver(conn).ReadStoredTokenAsync("   ", CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Unavailable, result.Status);
        Assert.Equal(0, conn.ExecuteCount);
    }

    [Fact]
    public async Task Cancellation_propagates_rather_than_being_reported_as_Unavailable()
    {
        var conn = Store(Token);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => ReaderOver(conn).ReadStoredTokenAsync(Device, cts.Token));
    }

    [Fact]
    public async Task The_read_is_one_round_trip()
    {
        var conn = Store(Token);

        await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(1, conn.ExecuteCount);
    }

    /// <summary>
    /// STRUCTURAL READ-ONLY ASSERTIONS. These are about the SQL this type can
    /// ever emit, not about what a given test happened to run.
    /// </summary>
    [Fact]
    public void The_only_statement_is_a_single_parameterised_select()
    {
        var sql = HandheldTokenReader.StoredTokenQuery;

        Assert.StartsWith("SELECT ", sql, StringComparison.Ordinal);
        Assert.Contains("@columnType", sql, StringComparison.Ordinal);

        foreach (var forbidden in new[]
                 {
                     "UPDATE", "INSERT", "DELETE", "MERGE", "EXEC", "DROP", "ALTER", "TRUNCATE",
                     "GRANT", "NOLOCK", "TOP ", ";",
                 })
        {
            Assert.DoesNotContain(forbidden, sql, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task The_device_id_is_passed_as_a_parameter_and_never_concatenated_into_the_sql()
    {
        var conn = Store(Token);

        // A device id that would be catastrophic if it reached the statement.
        await ReaderOver(conn).ReadStoredTokenAsync("X'; DROP TABLE AAAExampleData; --", CancellationToken.None);

        Assert.Single(conn.ExecutedCommands);
        Assert.Equal(HandheldTokenReader.StoredTokenQuery, conn.ExecutedCommands[0]);
        Assert.DoesNotContain("DROP", conn.ExecutedCommands[0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task The_reader_never_opens_a_transaction()
    {
        // FakeDbConnection throws NotSupportedException from BeginDbTransaction,
        // so a reader that opened one could not complete a read at all.
        var conn = Store(Token);

        var result = await ReaderOver(conn).ReadStoredTokenAsync(Device, CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Observed, result.Status);
    }
}

/// <summary>
/// The gate. Its whole job is to refuse by default, and to refuse in a way that
/// still binds a reader — so "nothing is configured" reaches the predicate as
/// ignorance rather than as a null or, far worse, as an absent row.
/// </summary>
public sealed class HandheldTokenGateTests
{
    private static DbProviderFactory? NoProvider(string _) => null;
    private static DbProviderFactory? SomeProvider(string _) => FakeDbProviderFactory.Instance;

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void An_unset_connection_string_disables_the_read(string? value)
    {
        var decision = HandheldTokenGate.Decide(value, null, SomeProvider);

        Assert.False(decision.Enabled);
        Assert.Null(decision.ConnectionFactory);
        Assert.Contains(HandheldTokenGate.ConnectionStringVariable, decision.Reason);
    }

    [Fact]
    public void A_disabled_gate_still_produces_a_reader_that_answers_Unavailable()
    {
        var decision = HandheldTokenGate.Decide(null, null, SomeProvider);

        var reader = decision.CreateReader();

        Assert.IsType<UnconfiguredHandheldTokenReader>(reader);
    }

    [Fact]
    public async Task The_unconfigured_reader_answers_Unavailable_carrying_the_gate_reason()
    {
        var decision = HandheldTokenGate.Decide(null, null, SomeProvider);

        var result = await decision.CreateReader().ReadStoredTokenAsync("D", CancellationToken.None);

        Assert.Equal(HandheldTokenReadStatus.Unavailable, result.Status);
        Assert.Equal(decision.Reason, result.Reason);
        // Specifically NOT NoRow. An unconfigured build must never look like a
        // till that has never seen us.
        Assert.NotEqual(HandheldTokenReadStatus.NoRow, result.Status);
    }

    [Fact]
    public void An_unregistered_provider_disables_rather_than_half_enabling()
    {
        var decision = HandheldTokenGate.Decide("Server=x;Database=y", null, NoProvider);

        Assert.False(decision.Enabled);
        Assert.Null(decision.ConnectionFactory);
    }

    [Fact]
    public void A_throwing_provider_resolver_disables_rather_than_propagating()
    {
        var decision = HandheldTokenGate.Decide(
            "Server=x;Database=y", "Nonsense.Provider", _ => throw new ArgumentException("no such provider"));

        Assert.False(decision.Enabled);
        Assert.Contains("no such provider", decision.Reason);
    }

    [Fact]
    public void A_configured_gate_enables_and_states_what_it_does_and_does_not_enforce()
    {
        var decision = HandheldTokenGate.Decide("Server=x;Database=y", null, SomeProvider);

        Assert.True(decision.Enabled);
        Assert.NotNull(decision.ConnectionFactory);
        Assert.IsType<HandheldTokenReader>(decision.CreateReader());

        // It claims the structural property...
        Assert.Contains("exactly one SELECT", decision.Reason);
        // ...and does NOT claim to enforce least privilege.
        Assert.Contains("NOT enforced by this connector", decision.Reason);
        // ...and states the one thing an operator must verify themselves.
        Assert.Contains("INFERENCE, NOT PROOF", decision.Reason);
    }

    [Fact]
    public void The_token_connection_is_a_separate_variable_from_the_POSServer_one()
    {
        // They may not be the same database, and the ingress capture is
        // suggestive rather than conclusive. A shared variable would commit an
        // operator to a guess they never made.
        Assert.NotEqual(NativeReadbackGate.ConnectionStringVariable, HandheldTokenGate.ConnectionStringVariable);
    }

    [Fact]
    public void Setting_only_the_POSServer_connection_does_not_enable_the_token_read()
    {
        // Durable evidence without causal evidence must never confirm.
        var decision = HandheldTokenGate.Decide(null, null, SomeProvider);

        Assert.False(decision.Enabled);
    }
}
