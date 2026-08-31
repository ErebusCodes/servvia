namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>One native line as read back from POSServer, for fingerprinting. No price, no row ID.</summary>
public sealed record TerminalLineFingerprint(string NativeCode, int Quantity);

/// <summary>
/// A native POSServer table sale, identified by its NATURAL key
/// (Code, Pos, Map) and its line multiset — never by a durable row ID.
/// POSServer regenerates a table's row ID on every ordinary edit
/// (TABLEDATA delete+reinsert; SYSDATA ClearAll) per DL-113 §1/§4, so any
/// model that keyed on an ID would silently start reading a different row.
/// This fingerprint deliberately has no ID field, which is why a
/// regenerated ID cannot break confirmation.
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
    Inconclusive,
}

public sealed record TerminalConfirmationResult(TerminalConfirmationOutcome Outcome, string? Reason)
{
    public bool IsConfirmed => Outcome == TerminalConfirmationOutcome.Confirmed;
}

/// <summary>
/// The native-confirmation contract. Defined now even though it is not
/// fully wired to a live POSServer reader in this commit. A real
/// implementation resolves by (TableCode, Pos=1, Map when available),
/// reads before/after line fingerprints, and delegates the decision to
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
    /// A first round confirms when the requested table exists at Pos 1 and
    /// the expected new PLU/qty appears with no unexpected duplicate. A
    /// second round additionally requires every prior line to be retained
    /// unchanged, with the new item appearing exactly once (by quantity
    /// delta). UI completion alone is never enough to reach here — this is
    /// evaluated against native POSServer state.
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
        if (!string.Equals(after.TableCode.Trim(), requestedTable.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.TableMissing,
                $"POSServer sale is on table '{after.TableCode}', not the requested '{requestedTable}'");
        }
        if (after.Pos != 1)
        {
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.Inconclusive,
                $"POSServer sale is at Pos {after.Pos}, not the Pos 1 these handlers maintain");
        }

        var afterByCode = ByCode(after.Lines);
        var expected = ExpectedByCode(expectedNewItems);

        if (roundKind == TerminalRoundKind.SecondRound)
        {
            var beforeByCode = ByCode(before?.Lines ?? Array.Empty<TerminalLineFingerprint>());

            // Every prior line must be retained at least at its prior quantity.
            foreach (var (code, priorQty) in beforeByCode)
            {
                afterByCode.TryGetValue(code, out var nowQty);
                if (nowQty < priorQty)
                {
                    return new TerminalConfirmationResult(TerminalConfirmationOutcome.PriorLinesChanged,
                        $"prior line '{code}' dropped from {priorQty} to {nowQty} — a second round must retain earlier lines");
                }
            }

            // The delta (after minus before) must equal the expected new items exactly.
            foreach (var (code, expQty) in expected)
            {
                beforeByCode.TryGetValue(code, out var priorQty);
                afterByCode.TryGetValue(code, out var nowQty);
                var delta = nowQty - priorQty;
                if (delta < expQty)
                {
                    return new TerminalConfirmationResult(TerminalConfirmationOutcome.ExpectedItemMissing,
                        $"expected {expQty} new of '{code}' but only {delta} appeared");
                }
                if (delta > expQty)
                {
                    return new TerminalConfirmationResult(TerminalConfirmationOutcome.UnexpectedDuplicate,
                        $"expected {expQty} new of '{code}' but {delta} appeared — duplicate");
                }
            }
            return new TerminalConfirmationResult(TerminalConfirmationOutcome.Confirmed, null);
        }

        // First round: the expected items must appear with matching quantity and no duplicate.
        foreach (var (code, expQty) in expected)
        {
            afterByCode.TryGetValue(code, out var nowQty);
            if (nowQty < expQty)
            {
                return new TerminalConfirmationResult(TerminalConfirmationOutcome.ExpectedItemMissing,
                    $"expected {expQty} of '{code}' but found {nowQty}");
            }
            if (nowQty > expQty)
            {
                return new TerminalConfirmationResult(TerminalConfirmationOutcome.UnexpectedDuplicate,
                    $"expected {expQty} of '{code}' but found {nowQty} — duplicate");
            }
        }
        return new TerminalConfirmationResult(TerminalConfirmationOutcome.Confirmed, null);
    }
}
