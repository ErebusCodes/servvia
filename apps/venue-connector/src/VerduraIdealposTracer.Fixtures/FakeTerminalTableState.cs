using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Fixtures;

/// <summary>
/// The fake's stand-in for native POSServer pending-sale state. Rounds
/// APPEND (never replace), which is how the fake models IdealPOS's native
/// NEWLINES behaviour: a second round's new lines are added to the same
/// table while prior lines are retained. Fingerprints are produced by the
/// natural key (Code, Pos=1) with no row ID — so, exactly like the real
/// confirmation path, a regenerated ID could not affect anything here.
/// </summary>
public sealed class FakeTerminalTableState
{
    private readonly Dictionary<string, List<TerminalRoundItem>> _tables = new(StringComparer.OrdinalIgnoreCase);

    public bool HasTable(string tableCode) => _tables.ContainsKey(tableCode.Trim());

    public void AppendRound(string tableCode, IEnumerable<TerminalRoundItem> items)
    {
        var key = tableCode.Trim();
        if (!_tables.TryGetValue(key, out var lines))
        {
            lines = new List<TerminalRoundItem>();
            _tables[key] = lines;
        }
        lines.AddRange(items);
    }

    public TableSaleFingerprint? Fingerprint(string tableCode)
    {
        var key = tableCode.Trim();
        if (!_tables.TryGetValue(key, out var lines)) return null;
        return new TableSaleFingerprint
        {
            TableCode = key,
            Pos = 1,
            Lines = lines.Select(l => new TerminalLineFingerprint(l.NativeCode, l.Quantity)).ToList(),
        };
    }
}
