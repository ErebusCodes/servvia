using System.Data;
using System.Data.Common;

namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>
/// Reads native table state from POSServer. STRICTLY READ-ONLY: this type
/// issues exactly one SELECT and owns no other statement. There is no
/// ExecuteNonQuery, no transaction that writes, no stored-procedure call, and
/// no code path that constructs mutating SQL — a property asserted by test, not
/// merely intended.
///
/// LEAST PRIVILEGE. The connection this is given should authenticate as a login
/// with <c>db_datareader</c> on the POSServer database and nothing else. It
/// must NOT inherit the machine's SYSTEM/sysadmin rights: the reader needs
/// SELECT on two tables, and any privilege beyond that is a liability rather
/// than a convenience. Operators should also set <c>ApplicationIntent=ReadOnly</c>
/// where the deployment supports it. None of this is enforceable from inside
/// the process, which is exactly why it is stated here and in the runbook
/// rather than assumed.
///
/// NO PROVIDER DEPENDENCY. The connection arrives through a factory delegate
/// typed as <see cref="DbConnection"/>, so this assembly takes no dependency on
/// a specific SQL client package and stays cross-platform. The composition root
/// supplies the real provider — which is also what keeps this class trivially
/// testable against an in-memory connection.
///
/// WHY ONE JOINED STATEMENT. The sale and its lines are read together, in one
/// statement, deliberately. PendingSales.ID is regenerated on every ordinary
/// edit (four IDs for one unchanged Table 5 sale on 2026-09-05), so reading the
/// sale and then reading its lines by that ID in a second round trip could
/// join against an ID the native side had already replaced — returning zero
/// lines for a table that is demonstrably occupied, which reads as "free". One
/// statement, one consistent view, and the surrogate ID never escapes the read.
/// </summary>
public sealed class PosServerTableStateReader(
    Func<DbConnection> connectionFactory,
    string? expectedMap = null,
    int commandTimeoutSeconds = 10) : INativeTableStateReader
{
    /// <summary>
    /// The one statement this type ever executes.
    ///
    /// Column provenance, so a future reader knows what is evidence and what is
    /// inference:
    ///   * PendingSales.Code/Map/Pos/DateModified and PendingSaleLines.Line,
    ///     Col0..Col4, Printed, OrderedTime, SeatNumber were all DIRECTLY
    ///     OBSERVED in the sealed 2026-09-05 Table 5 capture.
    ///   * The join column PendingSaleLines.PendingSaleID was NOT observed in
    ///     that capture. It comes from IPS.Data.SQL.dll's embedded DDL, via the
    ///     same name the Bridge's read repository already uses successfully. It
    ///     is the one identifier here that still wants confirming against the
    ///     Front-desk machine.
    ///
    /// LEFT JOIN, so a sale carrying no lines is still seen as a sale — an
    /// open-but-empty table is a real state and must not read as a free one.
    /// No NOLOCK: a dirty read would let uncommitted native work be attributed
    /// to a Verdura round.
    /// </summary>
    public const string TableSaleQuery =
        "SELECT s.ID, s.Code, s.Map, s.Pos, s.DateModified, " +
        "l.Line, l.Col0, l.Col1, l.Col2, l.Col3, l.Col4, l.Printed, l.OrderedTime, l.SeatNumber " +
        "FROM dbo.PendingSales s " +
        "LEFT JOIN dbo.PendingSaleLines l ON l.PendingSaleID = s.ID " +
        "WHERE LTRIM(RTRIM(s.Code)) = @code AND s.Map = @map AND s.Pos = @pos " +
        "ORDER BY s.ID, l.Line";

    /// <summary>
    /// The typed read. Returns a status for every outcome and never conflates
    /// "could not read" with "nothing there".
    /// </summary>
    public async Task<NativeTableReadResult> ReadTableAsync(
        string tableCode,
        string? map,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(tableCode))
        {
            return NativeTableReadResult.Ambiguous("no table code was requested");
        }

        var wantedMap = string.IsNullOrWhiteSpace(map)
            ? (string.IsNullOrWhiteSpace(expectedMap) ? NativeTableSaleCanonicalizer.TableMapMapValue : expectedMap!.Trim())
            : map.Trim();

        if (!int.TryParse(wantedMap, out var mapValue))
        {
            return NativeTableReadResult.Ambiguous($"map '{wantedMap}' is not a native map value");
        }

        List<PosServerSaleWithLines> candidates;
        try
        {
            candidates = await QueryAsync(tableCode.Trim(), mapValue, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Unreachable, timed out, permission denied, provider fault — all of
            // them mean the same thing here: we do not know what is on the
            // table. That is emphatically not "the table is free".
            return NativeTableReadResult.Unavailable(
                $"POSServer could not be read ({ex.GetType().Name}: {ex.Message})");
        }

        return NativeTableSaleCanonicalizer.Canonicalize(tableCode, wantedMap, candidates);
    }

    /// <summary>
    /// <see cref="INativeTableStateReader"/> adapter.
    ///
    /// The interface has exactly two vocabularies — a fingerprint, or null for
    /// "no open sale" — so the two statuses that mean "we do not know" cannot be
    /// expressed in it and MUST NOT be squeezed into null. They throw instead,
    /// which TerminalRoundService catches before the send boundary and records
    /// as FAILED_BEFORE_SEND: pre-send, retryable, native driver never invoked.
    /// The typed result stays available through
    /// <see cref="ReadTableAsync"/> for callers that want the detail.
    /// </summary>
    public async Task<TableSaleFingerprint?> ReadAsync(string tableCode, string? map, CancellationToken cancellationToken)
    {
        var result = await ReadTableAsync(tableCode, map, cancellationToken);

        return result.Status switch
        {
            NativeTableReadStatus.NoOpenSale => null,
            NativeTableReadStatus.Observed => result.Fingerprint,
            NativeTableReadStatus.Ambiguous => throw new NativeCapabilityUnavailableException(
                "The native table state", result.Reason ?? "the native state is ambiguous"),
            NativeTableReadStatus.Unavailable => throw new NativeCapabilityUnavailableException(
                "POSServer", result.Reason ?? "POSServer could not be read"),
            _ => throw new NativeCapabilityUnavailableException("The native table state", $"unhandled status {result.Status}"),
        };
    }

    private async Task<List<PosServerSaleWithLines>> QueryAsync(string tableCode, int mapValue, CancellationToken cancellationToken)
    {
        var grouped = new Dictionary<long, (PosServerPendingSaleRow Sale, List<PosServerPendingSaleLineRow> Lines)>();

        await using var connection = connectionFactory()
            ?? throw new InvalidOperationException("The POSServer connection factory returned null.");
        await connection.OpenAsync(cancellationToken);

        await using var command = connection.CreateCommand();
        command.CommandText = TableSaleQuery;
        command.CommandType = CommandType.Text;
        command.CommandTimeout = commandTimeoutSeconds;
        AddParameter(command, "@code", tableCode);
        AddParameter(command, "@map", mapValue);
        AddParameter(command, "@pos", NativeTableSaleCanonicalizer.TableSalePos);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var saleId = GetInt64(reader, 0) ?? 0L;
            if (!grouped.TryGetValue(saleId, out var entry))
            {
                entry = (new PosServerPendingSaleRow
                {
                    ObservedRowId = saleId,
                    Code = GetString(reader, 1),
                    Map = GetInt32(reader, 2),
                    Pos = GetInt32(reader, 3),
                    DateModified = GetDateTime(reader, 4),
                }, new List<PosServerPendingSaleLineRow>());
                grouped[saleId] = entry;
            }

            // A LEFT JOIN with no lines yields one row whose line columns are
            // all NULL. That is a sale with zero lines, not a line to parse.
            if (reader.IsDBNull(5) && reader.IsDBNull(6) && reader.IsDBNull(7)) continue;

            entry.Lines.Add(new PosServerPendingSaleLineRow
            {
                Line = GetInt32(reader, 5),
                Col0 = GetString(reader, 6),
                Col1 = GetString(reader, 7),
                Col2 = GetString(reader, 8),
                Col3 = GetString(reader, 9),
                Col4 = GetString(reader, 10),
                Printed = GetBoolean(reader, 11),
                OrderedTime = GetDateTime(reader, 12),
                SeatNumber = GetInt32(reader, 13),
            });
        }

        return grouped.Values
            .Select(v => new PosServerSaleWithLines(v.Sale, v.Lines))
            .ToList();
    }

    private static void AddParameter(DbCommand command, string name, object value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    // The Col* columns may surface as text or as numbers depending on the
    // provider and the actual column types, so every accessor converts rather
    // than asserting a CLR type. A read that throws because a driver returned
    // an int where a string was expected would be indistinguishable, upstream,
    // from a database outage.
    private static string? GetString(DbDataReader reader, int i) =>
        reader.IsDBNull(i) ? null : Convert.ToString(reader.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);

    private static long? GetInt64(DbDataReader reader, int i) =>
        reader.IsDBNull(i) ? null : Convert.ToInt64(reader.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);

    private static int? GetInt32(DbDataReader reader, int i) =>
        reader.IsDBNull(i) ? null : Convert.ToInt32(reader.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);

    private static bool? GetBoolean(DbDataReader reader, int i) =>
        reader.IsDBNull(i) ? null : Convert.ToBoolean(reader.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);

    private static DateTime? GetDateTime(DbDataReader reader, int i) =>
        reader.IsDBNull(i) ? null : Convert.ToDateTime(reader.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
}
