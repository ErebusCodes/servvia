using System.Data;
using System.Data.Common;

namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>One catalogue row: a PLU and whatever price columns exist for it.</summary>
public sealed record StockItemPrices
{
    public required string NativeCode { get; init; }

    /// <summary>
    /// Keyed by LEVEL NUMBER, because the level is what becomes the column-name
    /// suffix on the receiver (<c>"Price" &amp; PriceLevel</c>, built with
    /// <c>__vbaStrI2</c>). A level whose column does not exist on this
    /// installation is simply absent from the dictionary — which is a different
    /// fact from a level priced at zero, and must stay different.
    /// </summary>
    public IReadOnlyDictionary<int, string?> PricesByLevel { get; init; }
        = new Dictionary<int, string?>();
}

public enum StockItemPriceReadStatus
{
    /// <summary>The catalogue was read. <see cref="StockItemPriceReadResult.Rows"/> holds what it returned.</summary>
    Observed,

    /// <summary>
    /// Unreachable, timed out, permission denied, table absent. Never confused
    /// with "the catalogue is empty": an unreadable catalogue must not be able
    /// to eliminate a price level.
    /// </summary>
    Unavailable,
}

public sealed record StockItemPriceReadResult
{
    public required StockItemPriceReadStatus Status { get; init; }
    public IReadOnlyList<StockItemPrices> Rows { get; init; } = Array.Empty<StockItemPrices>();

    /// <summary>Which price columns actually existed. Empty when none did.</summary>
    public IReadOnlyList<int> AvailableLevels { get; init; } = Array.Empty<int>();

    public string? Reason { get; init; }

    public static StockItemPriceReadResult Observed(
        IReadOnlyList<StockItemPrices> rows,
        IReadOnlyList<int> levels) =>
        new() { Status = StockItemPriceReadStatus.Observed, Rows = rows, AvailableLevels = levels };

    public static StockItemPriceReadResult Unavailable(string reason) =>
        new() { Status = StockItemPriceReadStatus.Unavailable, Reason = reason };
}

/// <summary>The read-only port onto the venue's price catalogue.</summary>
public interface IStockItemPriceReader
{
    Task<StockItemPriceReadResult> ReadPricesAsync(
        IReadOnlyCollection<string> nativeCodes,
        CancellationToken cancellationToken);
}

/// <summary>
/// Reads <c>StockItems.Price1..PriceN</c> — the missing half of the price-level
/// proof, and the only thing standing between this integration and a provable
/// answer to "what will the customer actually be charged".
///
/// ─────────────────────────────────────────────────────────────────────────
/// WHY THIS READ EXISTS AT ALL.
///
/// Verdura sends <c>-9999</c> so the till prices the line itself. The till then
/// resolves it from <c>StockItems."Price" &amp; PriceLevel</c>, a LITERAL column
/// name — so the level Verdura sends chooses which of the venue's price columns
/// becomes the customer's price. Send the wrong one and every bill is wrong,
/// silently, with nothing on the wire to notice.
///
/// The 42 captured packets cannot settle it: the venue iPad always sends a real
/// price, a real price is not <c>-9999</c>, so the receiver skips the lookup and
/// the <c>PriceLevel</c> in those packets is never read. What the captures DO
/// give is 115 PLUs and the price the venue actually charged for each. Pair that
/// with this read and the question becomes arithmetic — see
/// <c>waiterpad-price-level-proof.ts</c>, which does the comparing. This class
/// only fetches; it draws no conclusion and has no opinion about levels.
///
/// ─────────────────────────────────────────────────────────────────────────
/// WHICH COLUMNS EXIST IS DISCOVERED, NOT ASSUMED.
///
/// <c>Price1..Price4</c> and <c>Price8</c> are the names found in <c>IPS.exe</c>.
/// That is evidence about one binary, not a schema guarantee for this
/// installation, so this reader asks <c>INFORMATION_SCHEMA</c> which price
/// columns actually exist and selects exactly those. A level whose column is
/// absent is reported absent rather than defaulted, because "this venue has no
/// Price3" and "this venue prices nothing at level 3" are different facts and
/// only the first is true.
///
/// That discovery is also what keeps the statement SAFE while being dynamic: the
/// column list is built from names the server itself returned, filtered against
/// a strict <c>Price&lt;digit&gt;</c> pattern, and never from caller input.
///
/// ─────────────────────────────────────────────────────────────────────────
/// STRICTLY READ-ONLY. Two SELECTs, both parameterised where they carry a value,
/// no ExecuteNonQuery, no transaction, no dynamically built predicate. The
/// least-privilege requirement on the login is operational and is NOT claimed
/// here — see <see cref="HandheldTokenGate.OperationalPrivilegeRequirement"/>.
/// </summary>
public sealed class StockItemPriceReader(
    Func<DbConnection> connectionFactory,
    int commandTimeoutSeconds = 30) : IStockItemPriceReader
{
    /// <summary>Which price columns this installation actually has.</summary>
    public const string PriceColumnDiscoveryQuery =
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        + "WHERE TABLE_NAME = 'StockItems' AND COLUMN_NAME LIKE 'Price%'";

    /// <summary>
    /// Levels considered at all. The receiver builds the column name by string
    /// concatenation, so a single digit is the whole range it can produce.
    /// </summary>
    public static readonly IReadOnlyList<int> CandidateLevels = new[] { 1, 2, 3, 4, 5, 6, 7, 8, 9 };

    public async Task<StockItemPriceReadResult> ReadPricesAsync(
        IReadOnlyCollection<string> nativeCodes,
        CancellationToken cancellationToken)
    {
        if (nativeCodes is null || nativeCodes.Count == 0)
        {
            return StockItemPriceReadResult.Unavailable(
                "no stock codes were requested, so there is nothing to price");
        }

        try
        {
            await using var connection = connectionFactory()
                ?? throw new InvalidOperationException("The catalogue connection factory returned null.");
            await connection.OpenAsync(cancellationToken);

            var levels = await DiscoverLevelsAsync(connection, cancellationToken);
            if (levels.Count == 0)
            {
                return StockItemPriceReadResult.Unavailable(
                    "StockItems carries no Price<n> column on this installation, so the -9999 sentinel "
                    + "would resolve against a column that does not exist. The native route must not be "
                    + "activated until this is understood.");
            }

            var rows = await ReadRowsAsync(connection, nativeCodes, levels, cancellationToken);
            return StockItemPriceReadResult.Observed(rows, levels);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // An unreadable catalogue proves nothing about any price level. It
            // must never come back as an empty catalogue, which would let every
            // level survive unchallenged and read as "ambiguous" rather than
            // "we could not look".
            return StockItemPriceReadResult.Unavailable(
                $"the stock catalogue could not be read ({ex.GetType().Name}: {ex.Message}). This is "
                + "ignorance, not evidence — no price level may be concluded from it.");
        }
    }

    private async Task<List<int>> DiscoverLevelsAsync(DbConnection connection, CancellationToken cancellationToken)
    {
        var found = new List<int>();

        await using var command = connection.CreateCommand();
        command.CommandText = PriceColumnDiscoveryQuery;
        command.CommandType = CommandType.Text;
        command.CommandTimeout = commandTimeoutSeconds;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var name = reader.IsDBNull(0) ? null : Convert.ToString(reader.GetValue(0));
            foreach (var level in CandidateLevels)
            {
                if (string.Equals(name?.Trim(), $"Price{level}", StringComparison.OrdinalIgnoreCase))
                {
                    found.Add(level);
                }
            }
        }

        found.Sort();
        return found;
    }

    private async Task<List<StockItemPrices>> ReadRowsAsync(
        DbConnection connection,
        IReadOnlyCollection<string> nativeCodes,
        IReadOnlyList<int> levels,
        CancellationToken cancellationToken)
    {
        // The column list comes from names the SERVER returned, each already
        // matched against an exact `Price<digit>` literal above, so nothing a
        // caller supplied reaches the statement text. The codes themselves are
        // parameters.
        var columns = string.Join(", ", levels.Select(l => $"s.[Price{l}]"));
        var placeholders = string.Join(", ", nativeCodes.Select((_, i) => $"@code{i}"));
        var sql =
            $"SELECT s.[Code], {columns} FROM dbo.StockItems s "
            + $"WHERE LTRIM(RTRIM(s.[Code])) IN ({placeholders})";

        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.CommandType = CommandType.Text;
        command.CommandTimeout = commandTimeoutSeconds;

        var i = 0;
        foreach (var code in nativeCodes)
        {
            var p = command.CreateParameter();
            p.ParameterName = $"@code{i++}";
            p.Value = code.Trim();
            command.Parameters.Add(p);
        }

        var rows = new List<StockItemPrices>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var code = reader.IsDBNull(0) ? null : Convert.ToString(reader.GetValue(0))?.Trim();
            if (string.IsNullOrWhiteSpace(code)) continue;

            var prices = new Dictionary<int, string?>();
            for (var c = 0; c < levels.Count; c++)
            {
                var ordinal = c + 1;
                // A NULL price is carried as null rather than omitted: the row
                // exists and this level has no price for it, which the prover
                // counts as `absent` — neither a match nor a mismatch.
                prices[levels[c]] = reader.IsDBNull(ordinal)
                    ? null
                    : Convert.ToString(reader.GetValue(ordinal), System.Globalization.CultureInfo.InvariantCulture);
            }

            rows.Add(new StockItemPrices { NativeCode = code, PricesByLevel = prices });
        }

        return rows;
    }
}
