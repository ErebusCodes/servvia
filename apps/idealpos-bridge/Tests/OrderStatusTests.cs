using System.Collections.Generic;
using VerduraIdealposBridge.Orders;

namespace VerduraIdealposBridge.Tests
{
    /// <summary>
    /// Regression coverage for the 2026-08-19 preflight independent-review
    /// fix: a stale-timeout must never collapse into Failed (a false claim
    /// of confirmed non-execution) — see OrderLifecycleWatcher.Observe()
    /// and OrderStatus.Uncertain's own doc comment. Pure enum-level logic,
    /// runnable via --selftest with no SQL Server/Idealpos required.
    /// </summary>
    public static class OrderStatusTests
    {
        public static IEnumerable<TestResult> RunAll()
        {
            yield return Assert.Run("Uncertain: wire string is 'uncertain'", () =>
            {
                Assert.AreEqual("uncertain", Orders.OrderStatus.Uncertain.ToWireString(), "ToWireString(Uncertain)");
            });

            yield return Assert.Run("Uncertain: is terminal (watcher must not re-observe it)", () =>
            {
                Assert.IsTrue(Orders.OrderStatus.Uncertain.IsTerminal(), "Uncertain.IsTerminal() should be true");
            });

            yield return Assert.Run("Failed: is still terminal (unchanged by this fix)", () =>
            {
                Assert.IsTrue(Orders.OrderStatus.Failed.IsTerminal(), "Failed.IsTerminal() should be true");
            });

            yield return Assert.Run("The three in-flight states remain non-terminal", () =>
            {
                Assert.IsTrue(!Orders.OrderStatus.SubmittedToIdealpos.IsTerminal(), "SubmittedToIdealpos should not be terminal");
                Assert.IsTrue(!Orders.OrderStatus.PendingIdealposProcessing.IsTerminal(), "PendingIdealposProcessing should not be terminal");
                Assert.IsTrue(!Orders.OrderStatus.Processed.IsTerminal(), "Processed should not be terminal");
            });

            yield return Assert.Run("Every OrderStatus value round-trips through ToWireString to a non-empty, unique string", () =>
            {
                var seen = new HashSet<string>();
                foreach (Orders.OrderStatus status in System.Enum.GetValues(typeof(Orders.OrderStatus)))
                {
                    string wire = status.ToWireString();
                    Assert.IsTrue(!string.IsNullOrWhiteSpace(wire), status + " must have a non-empty wire string");
                    Assert.IsTrue(seen.Add(wire), "wire string \"" + wire + "\" is not unique — collides for " + status);
                }
            });
        }
    }
}
