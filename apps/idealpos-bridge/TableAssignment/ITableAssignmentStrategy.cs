using IdealPos.Webit;

namespace VerduraIdealposBridge.TableAssignment
{
    /// <summary>
    /// Isolates exactly one open question from the investigation (Section
    /// K.2): which field, if any, on a WebOrder causes native Idealpos to
    /// associate the resulting pending sale with a specific existing table.
    /// VerduraIdealposHarness exists to answer this experimentally; every
    /// strategy here mirrors one of the harness's Tests A-E exactly, so a
    /// result confirmed with the harness can be applied here by config
    /// alone (Idealpos:TableAssignmentStrategy), without changing this
    /// interface or Verdura's API contract, which always stays "table":"12".
    /// </summary>
    public interface ITableAssignmentStrategy
    {
        /// <summary>Matches the harness's --test letter, for traceability
        /// between a harness run and this strategy's behaviour.</summary>
        string Name { get; }

        /// <summary>Human-readable description of exactly what field this
        /// strategy sets and why — surfaced in /api/health so an operator
        /// can see, without reading source, what the running bridge is
        /// currently trying.</summary>
        string Description { get; }

        /// <summary>Mutates the WebOrder (and/or returns a modified
        /// WebReference if the strategy needs to change OrderReference
        /// itself, e.g. ReferencePrefix) to apply the table hint.</summary>
        string Apply(WebOrder order, string table, string webReference);
    }
}
