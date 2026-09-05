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

    /// <summary>
    /// The native state cannot be attributed to this round and no further
    /// automated reconciliation will resolve it — a human must look at the
    /// table. Distinguished from <see cref="UNCERTAIN"/> (which the machine
    /// may still resolve on a later sweep) because the operational response
    /// is different. Directive §9/§11.
    /// </summary>
    MANUAL_RESOLUTION_REQUIRED,

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

    /// <summary>
    /// The native table state observed IMMEDIATELY BEFORE the send, persisted
    /// with the round so a later reconciliation — including one after a crash
    /// and restart in a different process — can still compute the delta.
    /// Directive §9 step 4; without it a recovering process has an "after"
    /// and no "before", and cannot attribute anything.
    /// </summary>
    public TableSaleFingerprint? PreSendSnapshot { get; init; }

    /// <summary>The map value observed at pre-send, retained as table-context evidence.</summary>
    public string? Map { get; init; }

    /// <summary>
    /// Which round kind this was. Persisted because reconciliation after a
    /// restart is NOT round-kind-agnostic: a first round expects a free
    /// table, a second round REQUIRES a baseline and refuses to guess without
    /// one. A recovering process that did not know the kind would have to
    /// assume one, and either assumption silently changes the verdict — a
    /// second round misread as a first would confirm against an empty
    /// "before" and call somebody else's lines ours.
    ///
    /// Nullable, not required, on purpose: log lines written before this
    /// field existed genuinely do not carry it, and a default would be a
    /// guess wearing a value's clothing. A sweep that meets a null here
    /// escalates instead of assuming.
    /// </summary>
    public TerminalRoundKind? RoundKind { get; init; }

    /// <summary>
    /// The Verdura correlation reference, retained so a recovering process
    /// can rebuild the original request faithfully. Never written into IPS
    /// (see <see cref="TerminalRoundRequest.OrderReference"/>).
    /// </summary>
    public string? OrderReference { get; init; }

    /// <summary>
    /// True when this state may still be resolved by an automated,
    /// read-only reconciliation sweep. These are the rounds that crossed the
    /// send boundary without reaching a verdict — the ones a restart must not
    /// simply forget about, because each one is a table that may or may not
    /// carry a docket nobody has accounted for.
    ///
    /// <see cref="TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED"/> is
    /// deliberately excluded: further machine reconciliation will not resolve
    /// it, and re-sweeping it would only churn. It is surfaced by
    /// <see cref="TerminalRoundStateStore.FindAwaitingHumanAttention"/>
    /// instead.
    /// </summary>
    public bool NeedsReconciliation =>
        Status is TerminalRoundStatus.SEND_INITIATED
            or TerminalRoundStatus.AWAITING_NATIVE_CONFIRMATION
            or TerminalRoundStatus.UNCERTAIN;
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
            or TerminalRoundStatus.UNCERTAIN
            or TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED;

    public void Record(TerminalRoundStateEntry entry) => log.AppendDurable(entry);

    public TerminalRoundStateEntry? Find(string externalOrderId, string roundId) =>
        FindAllLatest().TryGetValue((externalOrderId, roundId), out var entry) ? entry : null;

    /// <summary>
    /// Replays the whole durable log and returns the LATEST state of every
    /// round key it contains. This is the reconstruction a restarting process
    /// performs: the log is append-only, so "current state" is by definition
    /// the last row per key, and no separate checkpoint can drift from it.
    ///
    /// Rows the log carries for other subsystems, and rows written by an
    /// older/newer schema that will not deserialize, are skipped rather than
    /// allowed to abort the replay — one unreadable row must never make every
    /// outstanding round invisible.
    /// </summary>
    public IReadOnlyDictionary<(string ExternalOrderId, string RoundId), TerminalRoundStateEntry> FindAllLatest()
    {
        var latest = new Dictionary<(string, string), TerminalRoundStateEntry>();
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
            if (string.IsNullOrEmpty(entry.ExternalOrderId) || string.IsNullOrEmpty(entry.RoundId)) continue;
            latest[(entry.ExternalOrderId, entry.RoundId)] = entry;
        }
        return latest;
    }

    /// <summary>
    /// Every round that crossed the send boundary and has not reached a
    /// verdict. Without this, a round left at
    /// <see cref="TerminalRoundStatus.SEND_INITIATED"/> by a crash is
    /// invisible after a restart — it is only ever revisited if the cloud
    /// happens to redeliver that exact request, and a table that may already
    /// carry a docket is quietly forgotten. Reconciliation is read-only, so
    /// there is no safety argument for forgetting it; there is only the
    /// safety rule that it must be reconciled rather than resent.
    /// </summary>
    public IReadOnlyList<TerminalRoundStateEntry> FindNeedingReconciliation() =>
        FindAllLatest().Values
            .Where(e => e.NeedsReconciliation)
            .OrderBy(e => e.UpdatedAtUtc)
            .ToList();

    /// <summary>
    /// Every round the machine has given up on and a human must resolve.
    /// Surfaced separately so it is operationally visible without being
    /// re-swept.
    /// </summary>
    public IReadOnlyList<TerminalRoundStateEntry> FindAwaitingHumanAttention() =>
        FindAllLatest().Values
            .Where(e => e.Status == TerminalRoundStatus.MANUAL_RESOLUTION_REQUIRED)
            .OrderBy(e => e.UpdatedAtUtc)
            .ToList();
}
