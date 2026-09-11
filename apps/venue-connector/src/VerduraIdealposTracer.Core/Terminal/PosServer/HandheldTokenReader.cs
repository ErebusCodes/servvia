using System.Data;
using System.Data.Common;

namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>How a token read resolved. "Could not read" is never "no row".</summary>
public enum HandheldTokenReadStatus
{
    /// <summary>A row exists for this DeviceID and its Data value was read.</summary>
    Observed,

    /// <summary>
    /// Resolved: no row exists for this <c>ColumnType</c>. The receiver has
    /// never recorded a checksum for this device — which, on a device that has
    /// sent, is evidence the packet was not picked up.
    /// </summary>
    NoRow,

    /// <summary>
    /// More than one row carries this <c>ColumnType</c>. The receiver's own
    /// logic does <c>SELECT *</c> and reads the first, but Verdura will not
    /// guess which one it meant: two rows is a native state no attribution can
    /// be drawn from.
    /// </summary>
    Ambiguous,

    /// <summary>
    /// Unreachable, timed out, permission denied, table absent. Deliberately
    /// distinct from <see cref="NoRow"/>: reporting an unreadable database as
    /// "no token was ever stored" would let a round that IS on a customer's
    /// bill have its lines released and sent again.
    /// </summary>
    Unavailable,
}

/// <summary>The typed result of one token read. Carries a reason for every non-Observed status.</summary>
public sealed record HandheldTokenReadResult
{
    public required HandheldTokenReadStatus Status { get; init; }

    /// <summary>
    /// The stored <c>Data</c> value, when <see cref="HandheldTokenReadStatus.Observed"/>.
    /// May legitimately be the EMPTY STRING: <c>IsDuplicateHandheldOrder2</c>
    /// inserts a row with <c>Data=''</c> the first time it sees a DeviceID, and
    /// only <c>SaveChecksum</c> later fills it in. An empty value therefore
    /// means "this device is known and no checksum has been stored", which
    /// matches no attempt token and confirms nothing.
    /// </summary>
    public string? StoredToken { get; init; }

    public string? Reason { get; init; }

    public static HandheldTokenReadResult Observed(string? token) =>
        new() { Status = HandheldTokenReadStatus.Observed, StoredToken = token ?? string.Empty };

    public static HandheldTokenReadResult NoRow(string reason) =>
        new() { Status = HandheldTokenReadStatus.NoRow, Reason = reason };

    public static HandheldTokenReadResult Ambiguous(string reason) =>
        new() { Status = HandheldTokenReadStatus.Ambiguous, Reason = reason };

    public static HandheldTokenReadResult Unavailable(string reason) =>
        new() { Status = HandheldTokenReadStatus.Unavailable, Reason = reason };
}

/// <summary>The read-only port onto the till's causal evidence.</summary>
public interface IHandheldTokenReader
{
    /// <summary>
    /// Read the checksum the receiver currently holds for one DeviceID.
    /// Read-only; there is no other method and no way to express a write.
    /// </summary>
    Task<HandheldTokenReadResult> ReadStoredTokenAsync(string deviceId, CancellationToken cancellationToken);
}

/// <summary>
/// Reads <c>AAAExampleData.Data</c> for <c>ColumnType='IH-&lt;DeviceID&gt;'</c> —
/// the CAUSAL half of native confirmation, and the only artefact found anywhere
/// on this protocol that ties a durable row on the till to a specific Verdura
/// submission.
///
/// ─────────────────────────────────────────────────────────────────────────
/// WHY THIS ROW IS WORTH A CLASS OF ITS OWN.
///
/// Content can never establish causality. Two rounds that ordered the same item
/// are indistinguishable in a readback, and a waiter keying our items at the
/// terminal produces a byte-identical delta. This row is different: its value
/// is OURS, derived from durable Verdura ids, and the only code that writes it
/// is <c>SaveChecksum</c> (0x018267f0) whose sole caller image-wide is
/// 0x01827301 inside <c>ProcessHandheldOrder</c> (0x01826b90). If it holds our
/// token, our packet was picked up. Nothing else can put it there.
///
/// WHAT IT DOES NOT ESTABLISH, AND THIS IS THE WHOLE REASON FOR THE OTHER HALF.
/// That call sits BEFORE <c>DELETE * FROM PendingSaleLines</c> (0x01827664),
/// before <c>DELETE * FROM PendingSales</c> (0x01827709), and before every line
/// write after them. A stored token proves RECEIPT, never APPLICATION. The
/// window it opens is a till that has deleted the table's previous order and
/// not yet written the new one. So this reader is half of a composite proof and
/// is useless alone — which is enforced upstream, in the predicate, not here.
///
/// ─────────────────────────────────────────────────────────────────────────
/// STRICTLY READ-ONLY, in the same precise sense as
/// <see cref="PosServerTableStateReader"/>:
///
///   ENFORCED BY THIS CLASS — exactly one SELECT, held in a constant; no
///   ExecuteNonQuery, ExecuteScalar or BeginTransaction; no dynamically built
///   SQL and no value interpolated into the statement. Structural facts,
///   asserted by test.
///
///   NOT ENFORCED, AND NOT ENFORCEABLE FROM HERE — that the SQL login lacks
///   write rights. A sysadmin connection string would work exactly as well and
///   nothing in this process could tell. That is the database administrator's
///   job, and saying otherwise would be false.
///
/// ─────────────────────────────────────────────────────────────────────────
/// WHICH DATABASE THIS TABLE LIVES IN IS <b>INFERENCE</b>, NOT PROOF.
///
/// The 2026-09-05 ingress capture shows the receiver issuing, in one flow:
/// <c>UPDATE AAAExampleData …</c>, <c>DELETE * FROM PendingSaleLines …</c>,
/// <c>DELETE * FROM PendingSales …</c> and <c>INSERT INTO POSServerMessages
/// …</c>. The last three are POSServer tables, so the first is very likely one
/// too. "Very likely" is not a grade this integration confirms rounds on, so:
///
///   * the connection is CONFIGURED, never inferred — see
///     <see cref="HandheldTokenGate"/>, which defaults to nothing;
///   * a missing table, a wrong database or a permission error all surface as
///     <see cref="HandheldTokenReadStatus.Unavailable"/> with the provider's
///     own message, which the predicate reads as ignorance and never as
///     absence;
///   * confirming the database at the venue is a named acceptance step, not an
///     assumption buried in a default.
///
/// A wrong database therefore costs confirmations. It cannot cost correctness.
/// </summary>
public sealed class HandheldTokenReader(
    Func<DbConnection> connectionFactory,
    int commandTimeoutSeconds = 10) : IHandheldTokenReader
{
    /// <summary>
    /// The <c>ColumnType</c> prefix the receiver keys this row by, from
    /// <c>IsDuplicateHandheldOrder2</c> (0x01835070) and <c>SaveChecksum</c>
    /// (0x018267f0). PROVEN STATIC.
    /// </summary>
    public const string ColumnTypePrefix = "IH-";

    /// <summary>
    /// The one statement this type ever executes.
    ///
    /// It selects <c>Data</c> only. <c>SELECT *</c> — which is what the
    /// receiver itself does — would pull an <c>InsertDate</c> nobody may reason
    /// about: the row is updated in place, so its insert date describes when
    /// the DEVICE was first seen, not when this token was stored. Reading a
    /// column invites using it.
    ///
    /// No <c>TOP 1</c>, deliberately. Collapsing two rows to one here would
    /// hide the <see cref="HandheldTokenReadStatus.Ambiguous"/> case, and an
    /// ambiguous causal store is something an operator must be told about
    /// rather than something a query silently resolves.
    ///
    /// No NOLOCK: a dirty read could show a token from a transaction that later
    /// rolled back, and attributing a customer's food to a rolled-back write is
    /// the exact failure this whole module exists to prevent.
    /// </summary>
    public const string StoredTokenQuery =
        "SELECT Data FROM dbo.AAAExampleData WHERE ColumnType = @columnType";

    public async Task<HandheldTokenReadResult> ReadStoredTokenAsync(
        string deviceId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deviceId))
        {
            return HandheldTokenReadResult.Unavailable(
                "no DeviceID was supplied, so there is no ColumnType to look up. A blank DeviceID is never a "
                + "legitimate Verdura identity.");
        }

        var columnType = ColumnTypePrefix + deviceId.Trim();

        var values = new List<string?>();
        try
        {
            await using var connection = connectionFactory()
                ?? throw new InvalidOperationException("The token-store connection factory returned null.");
            await connection.OpenAsync(cancellationToken);

            await using var command = connection.CreateCommand();
            command.CommandText = StoredTokenQuery;
            command.CommandType = CommandType.Text;
            command.CommandTimeout = commandTimeoutSeconds;

            var parameter = command.CreateParameter();
            parameter.ParameterName = "@columnType";
            parameter.Value = columnType;
            command.Parameters.Add(parameter);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                values.Add(reader.IsDBNull(0)
                    ? null
                    : Convert.ToString(reader.GetValue(0), System.Globalization.CultureInfo.InvariantCulture));
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Unreachable, timed out, permission denied, table absent, wrong
            // database — all of them mean the same thing: we do not know what
            // the till is holding. That is emphatically not "it is holding
            // nothing".
            return HandheldTokenReadResult.Unavailable(
                $"the handheld token store could not be read for ColumnType '{columnType}' "
                + $"({ex.GetType().Name}: {ex.Message}). This is ignorance, not absence — no round may be "
                + "released on the strength of it.");
        }

        if (values.Count == 0)
        {
            return HandheldTokenReadResult.NoRow(
                $"no AAAExampleData row exists for ColumnType '{columnType}'. The receiver inserts one the first "
                + "time it sees a DeviceID, so on a device that has sent, an absent row means the packet never "
                + "reached IsDuplicateHandheldOrder2.");
        }

        if (values.Count > 1)
        {
            return HandheldTokenReadResult.Ambiguous(
                $"{values.Count} AAAExampleData rows carry ColumnType '{columnType}'. The receiver reads the first "
                + "of them; Verdura will not guess which one it meant, so nothing causal is drawn from this.");
        }

        // A NULL Data column reads as the empty string, which is exactly what a
        // freshly inserted row holds. It matches no attempt token.
        return HandheldTokenReadResult.Observed(values[0] ?? string.Empty);
    }
}

/// <summary>
/// A reader that is wired but cannot read, because nothing was configured.
///
/// It exists so the composition root always has SOMETHING to bind, and so that
/// "no token store is configured" arrives at the predicate as
/// <see cref="HandheldTokenReadStatus.Unavailable"/> — ignorance — rather than
/// as a null reference or, far worse, as a silently absent row.
/// </summary>
public sealed class UnconfiguredHandheldTokenReader(string reason) : IHandheldTokenReader
{
    public Task<HandheldTokenReadResult> ReadStoredTokenAsync(
        string deviceId,
        CancellationToken cancellationToken) =>
        Task.FromResult(HandheldTokenReadResult.Unavailable(reason));
}
