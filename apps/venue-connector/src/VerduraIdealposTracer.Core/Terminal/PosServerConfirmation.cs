namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>One native line as read back from POSServer, for fingerprinting. No price, no row ID.</summary>
public sealed record TerminalLineFingerprint(string NativeCode, int Quantity);

/// <summary>
/// A native POSServer table sale, identified by its NATURAL key
/// (Code, Pos, Map) and its line multiset — never by a durable row ID.
/// POSServer regenerates a table's row ID on every ordinary edit
/// (TABLEDATA delete+reinsert; SYSDATA ClearAll) per DL-113 §1/§4, and the
/// 2026-09-05 live run observed four IDs (99719 → 99721 → 99723 → 99724) for
/// one materially unchanged Table 5 sale. This fingerprint deliberately has
/// no ID field, which is why a regenerated ID cannot break confirmation.
/// </summary>
public sealed record TableSaleFingerprint
{
    public required string TableCode { get; init; }
    public int Pos { get; init; } = 1;
    public string? Map { get; init; }
    public IReadOnlyList<TerminalLineFingerprint> Lines { get; init; } = Array.Empty<TerminalLineFingerprint>();
}

public enum TerminalConfirmationOutcome
{
    Confirmed,
    TableMissing,
    ExpectedItemMissing,
    UnexpectedDuplicate,
    PriorLinesChanged,

    /// <summary>
    /// The native state cannot be attributed to this round — typically
    /// because somebody else also changed the table, or because no pre-send
    /// snapshot exists to compare against. Never auto-retried; escalates to
    /// manual resolution (directive §11).
    /// </summary>
    Ambiguous,

    Inconclusive,
}

public sealed record TerminalConfirmationResult(TerminalConfirmationOutcome Outcome, string? Reason)
{
    public bool IsConfirmed => Outcome == TerminalConfirmationOutcome.Confirmed;

    /// <summary>
    /// Whether this outcome means "a human must look at the table", as
    /// opposed to "the machine may keep reconciling".
    /// </summary>
    public bool RequiresManualResolution =>
        Outcome is TerminalConfirmationOutcome.Ambiguous
            or TerminalConfirmationOutcome.PriorLinesChanged
            or TerminalConfirmationOutcome.UnexpectedDuplicate;
}

/// <summary>
/// Reads the current native table state so a round can be compared against a
/// PRE-SEND snapshot rather than against nothing.
///
/// Directive §10 requires
/// <c>pre-send snapshot + expected round = expected native delta</c>. Without
/// this interface the orchestrator had nowhere to obtain the "pre-send"
/// term, which is why it used to pass <c>beforeFingerprint: null</c>.
/// </summary>
public interface INativeTableStateReader
{
    /// <summary>
    /// Returns the current fingerprint of the table, or null when no open
    /// sale exists for it. Read-only.
    /// </summary>
    Task<TableSaleFingerprint?> ReadAsync(string tableCode, string? map, CancellationToken cancellationToken);
}

/// <summary>
/// The native-confirmation contract. A real implementation resolves by
/// (TableCode, Pos=1, Map when available), reads before/after line
/// fingerprints, and delegates the decision to
/// <see cref="TerminalConfirmationEvaluator"/> — never inventing its own.
/// </summary>
public interface IPosServerConfirmationClient
{
    Task<TerminalConfirmationResult> ConfirmRoundAsync(
        TerminalRoundKind roundKind,
        string requestedTable,
        string? map,
        TableSaleFingerprint? beforeFingerprint,
        IReadOnlyList<TerminalRoundItem> expectedNewItems,
        CancellationToken cancellationToken);
}

/// <summary>
/// Pure, deterministic confirmation logic over fingerprints. No I/O, no
/// clock, no row IDs — every rule is directly unit-testable and, by
/// operating only on the natural key and line multisets, is immune to
/// POSServer regenerating row IDs.
///
/// <b>Hardened 2026-09-05</b> against three gaps the Phase 1 audit found:
/// the map was carried but never compared; a first round ignored the prior
/// state entirely, so a pre-existing sale carrying the same PLU would have
/// confirmed a round we did not cause; and unexpected new lines from a
/// concurrent human were silently tolerated.
/// </summary>
public static class TerminalConfirmationEvaluator
{
    private static Dictionary<string, int> ByCode(IEnumerable<TerminalLineFingerprint> lines)
    {
        var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in lines)
        {
            map.TryGetValue(l.NativeCode.Trim(), out var q);
            map[l.NativeCode.Trim()] = q + l.Quantity;
        }
        return map;
    }

    private static Dictionary<string, int> ExpectedByCode(IEnumerable<TerminalRoundItem> items)
    {
        var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var i in items)
        {
            map.TryGetValue(i.NativeCode.Trim(), out var q);
            map[i.NativeCode.Trim()] = q + i.Quantity;
        }
        return map;
    }

    /// <summary>
    /// Reports whether the observed native delta is exactly the round's items,
    /// with prior lines intact and nothing else changed.
    ///
    /// <b>WHAT <see cref="TerminalConfirmationOutcome.Confirmed"/> MEANS, AND
    /// WHAT IT DOES NOT.</b> It means the CONTENT matches. It does not mean
    /// Verdura caused the change, and this function cannot establish that: no
    /// native field binds a sale or a line to a Verdura order. If a person
    /// independently rings up the identical PLU and quantity in the same
    /// interval, the delta is byte-identical to ours and this returns
    /// Confirmed. That limitation is real, is not detectable here, and is
    /// deliberately not papered over — the caller supplies the missing half
    /// (evidence about our own execution) through
    /// <c>RoundAttributionBasis</c>, and TerminalRoundService refuses to treat
    /// a content match as attribution when that evidence is absent.
    ///
    /// Both round kinds are evaluated as a delta against
    /// <paramref name="before"/>. The round kind then decides what a
    /// legitimate "before" looks like: a first round expects an empty or
    /// absent table, a second round REQUIRES a snapshot to compare against
    /// and refuses to guess without one.
    ///
    /// UI completion alone can never reach here — this is evaluated against
    /// native state.
    /// </summary>
    public static TerminalConfirmationResult Evaluate(
        TerminalRoundKind roundKind,
        string requestedTable,
        TableSaleFingerprint? before,
        TableSaleFingerprint? after,
        IReadOnlyList<TerminalRoundItem> expectedNewItems)
    {
        if (after is null)
        {
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.TableMissing,
                "no POSServer table sale was found after the round");
        }

        // Exact, token-based table matching. A substring test would let
        // table 5 confirm against table 15 (Phase 1 audit, defect D4).
        if (!TableIdentity.SameTable(after.TableCode, requestedTable))
        {
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.TableMissing,
                $"POSServer sale is on table '{after.TableCode}', not the requested '{requestedTable}'");
        }

        if (after.Pos != 1)
        {
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.Inconclusive,
                $"POSServer sale is at Pos {after.Pos}, not the Pos 1 these handlers maintain");
        }

        // Map is table-context evidence: Map=1 separated the native table
        // sale from web tickets in the live run. When both sides know it and
        // they disagree, we are looking at a different table context.
        if (before?.Map is not null && after.Map is not null
            && !string.Equals(before.Map.Trim(), after.Map.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.Inconclusive,
                $"table map changed from '{before.Map}' to '{after.Map}' across the round");
        }

        // A second round without a pre-send snapshot cannot be evaluated:
        // the prior-lines rule would pass vacuously and the delta would be
        // computed against zero. Refuse rather than confirm on a vacuous
        // comparison.
        if (roundKind == TerminalRoundKind.SecondRound && before is null)
        {
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.Ambiguous,
                "no pre-send snapshot was captured for a second round, so the native delta cannot be attributed to it");
        }

        var beforeByCode = ByCode(before?.Lines ?? Array.Empty<TerminalLineFingerprint>());
        var afterByCode = ByCode(after.Lines);
        var expected = ExpectedByCode(expectedNewItems);

        // A first round expects to be the first thing on this table. If the
        // table already carried lines, somebody else opened it and this
        // round's contribution cannot be isolated.
        if (roundKind == TerminalRoundKind.FirstRound && beforeByCode.Count > 0)
        {
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.Ambiguous,
                $"table '{requestedTable}' already carried {beforeByCode.Count} line group(s) before a first round — "
                + "the native state cannot be attributed to this round");
        }

        // Every prior line must be retained at least at its prior quantity.
        foreach (var (code, priorQty) in beforeByCode)
        {
            afterByCode.TryGetValue(code, out var nowQty);
            if (nowQty < priorQty)
            {
                return new TerminalConfirmationResult(TerminalConfirmationOutcome.PriorLinesChanged,
                    $"prior line '{code}' dropped from {priorQty} to {nowQty} — a later round must retain earlier lines");
            }
        }

        // The delta (after minus before) must equal the expected new items.
        foreach (var (code, expQty) in expected)
        {
            beforeByCode.TryGetValue(code, out var priorQty);
            afterByCode.TryGetValue(code, out var nowQty);
            var delta = nowQty - priorQty;
            if (delta < expQty)
            {
                return new TerminalConfirmationResult(TerminalConfirmationOutcome.ExpectedItemMissing,
                    $"expected {expQty} new of '{code}' but {delta} appeared");
            }
            if (delta > expQty)
            {
                return new TerminalConfirmationResult(TerminalConfirmationOutcome.UnexpectedDuplicate,
                    $"expected {expQty} new of '{code}' but {delta} appeared — duplicate");
            }
        }

        // Anything that grew and was NOT ours is someone else acting on the
        // same table between our snapshots. Directive §11: prefer an
        // unresolved round over a false confirmation.
        foreach (var (code, nowQty) in afterByCode)
        {
            beforeByCode.TryGetValue(code, out var priorQty);
            var delta = nowQty - priorQty;
            if (delta <= 0) continue;
            if (expected.ContainsKey(code)) continue;

            return new TerminalConfirmationResult(TerminalConfirmationOutcome.Ambiguous,
                $"line '{code}' gained {delta} between the pre-send and post-send snapshots but was not part of this round — "
                + "concurrent activity on the table, so this round cannot be confirmed");
        }

        return new TerminalConfirmationResult(TerminalConfirmationOutcome.Confirmed, null);
    }
}
