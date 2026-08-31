using System.Text.Json;
using VerduraIdealposTracer.Core.Persistence;

namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// The durable lifecycle of one native terminal round. The ordering is
/// deliberate and the boundary is <see cref="SEND_INITIATED"/>: everything
/// at or after it is irreversible/uncertain territory in which a retry must
/// NOT blindly drive the UI again.
/// </summary>
public enum TerminalRoundStatus
{
    /// <summary>Persisted before any UI work — safe to retry.</summary>
    RECEIVED,

    /// <summary>The native table was opened (reserved for a future finer-grained driver) — pre-send.</summary>
    TABLE_OPENED,

    /// <summary>Items were entered but not yet sent (reserved for a future finer-grained driver) — pre-send.</summary>
    ITEMS_ENTERED,

    /// <summary>We committed to driving the native Send. Past this point a crash means "unknown", never "resend".</summary>
    SEND_INITIATED,

    /// <summary>The UI reported a send; native POSServer confirmation has not yet been obtained.</summary>
    AWAITING_NATIVE_CONFIRMATION,

    /// <summary>POSServer confirmed the round natively (never UI completion alone).</summary>
    CONFIRMED,

    /// <summary>Outcome cannot be determined safely — requires reconciliation, never auto-retry.</summary>
    UNCERTAIN,

    /// <summary>Refused before the send boundary — safe to retry.</summary>
    FAILED_BEFORE_SEND,
}

/// <summary>One durably-recorded state of a terminal round, keyed by (ExternalOrderId, RoundId).</summary>
public sealed record TerminalRoundStateEntry
{
    public required string ExternalOrderId { get; init; }
    public required string RoundId { get; init; }
    public required string TableCode { get; init; }
    public required TerminalRoundStatus Status { get; init; }
    public IReadOnlyList<TerminalRoundItem> Items { get; init; } = Array.Empty<TerminalRoundItem>();
    public string? Detail { get; init; }
    public DateTimeOffset UpdatedAtUtc { get; init; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// A durable, append-only store of terminal-round states layered on the
/// same fsync'd <see cref="DurableLocalLog"/> the discovery side already
/// trusts for its persist-before-ack property. Latest-write-wins per key on
/// read-back; no row is ever deleted, so the full transition history stays
/// auditable.
/// </summary>
public sealed class TerminalRoundStateStore(DurableLocalLog log)
{
    private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };

    /// <summary>States at or beyond which the UI must not be driven again for this key.</summary>
    public static bool IsPastSendBoundary(TerminalRoundStatus status) =>
        status is TerminalRoundStatus.SEND_INITIATED
            or TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION
            or TerminalRoundStatus.CONFIRMED
            or TerminalRoundStatus.UNCERTAIN;

    public void Record(TerminalRoundStateEntry entry) => log.AppendDurable(entry);

    public TerminalRoundStateEntry? Find(string externalOrderId, string roundId)
    {
        TerminalRoundStateEntry? latest = null;
        foreach (var doc in log.ReadAll())
        {
            TerminalRoundStateEntry? entry;
            try
            {
                entry = JsonSerializer.Deserialize<TerminalRoundStateEntry>(doc.RootElement.GetRawText(), ReadOptions);
            }
            catch (JsonException)
            {
                // Not a terminal-round entry (the log may be shared) — skip.
                continue;
            }
            if (entry is null) continue;
            if (string.Equals(entry.ExternalOrderId, externalOrderId, StringComparison.Ordinal)
                && string.Equals(entry.RoundId, roundId, StringComparison.Ordinal))
            {
                latest = entry;
            }
        }
        return latest;
    }
}
