using IdealPos.Webit;

namespace VerduraIdealposBridge.TableAssignment
{
    /// <summary>Matches VerduraIdealposHarness Test A: no table hint set at
    /// all. Useful as an explicit "we know this doesn't auto-assign, staff
    /// will allocate manually" configuration, and as the harness's own
    /// baseline/control.</summary>
    public class NoHintStrategy : ITableAssignmentStrategy
    {
        public string Name => "NoHint";
        public string Description => "No WebOrder field set for table hinting (baseline/control, matches harness Test A). Staff must manually allocate the resulting order to a table.";
        public string Apply(WebOrder order, string table, string webReference) => webReference;
    }

    /// <summary>Matches VerduraIdealposHarness Test B.</summary>
    public class DeliverToStrategy : ITableAssignmentStrategy
    {
        public string Name => "DeliverTo";
        public string Description => "Sets WebOrder.DeliverTo to the table number (matches harness Test B).";
        public string Apply(WebOrder order, string table, string webReference)
        {
            order.DeliverTo = table;
            return webReference;
        }
    }

    /// <summary>Matches VerduraIdealposHarness Test C.</summary>
    public class MessageStrategy : ITableAssignmentStrategy
    {
        public string Name => "Message";
        public string Description => "Sets WebOrder.Message to \"Table <n>\" (matches harness Test C).";
        public string Apply(WebOrder order, string table, string webReference)
        {
            order.Message = "Table " + table;
            return webReference;
        }
    }

    /// <summary>Matches VerduraIdealposHarness Test D. Extrapolates the
    /// confirmed Doshii payment-side OrderId convention ("&lt;prefix&gt;-&lt;table&gt;",
    /// observed in ProcessDoshiiService.ProjectPacket) onto order creation —
    /// an experiment, not a confirmed WebOrder convention.</summary>
    public class ReferencePrefixStrategy : ITableAssignmentStrategy
    {
        public string Name => "ReferencePrefix";
        public string Description => "Prefixes WebOrder.OrderReference with \"T<table>-\" (matches harness Test D). Changes the WebReference used for idempotency tracking — the bridge accounts for this deterministically, see WebReferenceCalculator.";
        public string Apply(WebOrder order, string table, string webReference)
        {
            string prefixed = "T" + table + "-" + webReference;
            order.OrderReference = prefixed;
            return prefixed;
        }
    }

    /// <summary>Matches VerduraIdealposHarness Test E.</summary>
    public class HostReferenceStrategy : ITableAssignmentStrategy
    {
        public string Name => "HostReference";
        public string Description => "Sets WebOrder.HostReference to the table number (matches harness Test E).";
        public string Apply(WebOrder order, string table, string webReference)
        {
            order.HostReference = table;
            return webReference;
        }
    }
}
