using System.Collections.Generic;
using IdealPos.Webit;
using VerduraIdealposBridge.TableAssignment;

namespace VerduraIdealposBridge.Tests
{
    public static class TableAssignmentStrategyTests
    {
        public static IEnumerable<TestResult> RunAll()
        {
            yield return Assert.Run("Factory: known strategy names all construct", () =>
            {
                foreach (var name in TableAssignmentStrategyFactory.KnownStrategyNames)
                {
                    var strategy = TableAssignmentStrategyFactory.Create(name);
                    Assert.AreEqual(name, strategy.Name, "strategy name round-trip for " + name);
                }
            });

            yield return Assert.Run("Factory: unknown strategy name throws", () =>
            {
                bool threw = false;
                try { TableAssignmentStrategyFactory.Create("NotARealStrategy"); }
                catch (System.ArgumentException) { threw = true; }
                Assert.IsTrue(threw, "expected ArgumentException for unrecognized strategy name");
            });

            yield return Assert.Run("NoHintStrategy: leaves WebOrder table-hint fields untouched", () =>
            {
                var order = new WebOrder { OrderReference = "VERDURA-1" };
                string finalRef = new NoHintStrategy().Apply(order, "12", "VERDURA-1");
                Assert.AreEqual("VERDURA-1", finalRef, "WebReference should be unchanged");
                Assert.AreEqual((string)null, order.DeliverTo, "DeliverTo should stay unset");
                Assert.AreEqual((string)null, order.Message, "Message should stay unset");
                Assert.AreEqual((string)null, order.HostReference, "HostReference should stay unset (ctor default)");
            });

            yield return Assert.Run("DeliverToStrategy: sets DeliverTo, WebReference unchanged", () =>
            {
                var order = new WebOrder { OrderReference = "VERDURA-2" };
                string finalRef = new DeliverToStrategy().Apply(order, "12", "VERDURA-2");
                Assert.AreEqual("12", order.DeliverTo, "DeliverTo should equal the table");
                Assert.AreEqual("VERDURA-2", finalRef, "WebReference should be unchanged");
            });

            yield return Assert.Run("MessageStrategy: sets Message, WebReference unchanged", () =>
            {
                var order = new WebOrder { OrderReference = "VERDURA-3" };
                string finalRef = new MessageStrategy().Apply(order, "12", "VERDURA-3");
                Assert.AreEqual("Table 12", order.Message, "Message should be 'Table <n>'");
                Assert.AreEqual("VERDURA-3", finalRef, "WebReference should be unchanged");
            });

            yield return Assert.Run("HostReferenceStrategy: sets HostReference, WebReference unchanged", () =>
            {
                var order = new WebOrder { OrderReference = "VERDURA-4" };
                string finalRef = new HostReferenceStrategy().Apply(order, "12", "VERDURA-4");
                Assert.AreEqual("12", order.HostReference, "HostReference should equal the table");
                Assert.AreEqual("VERDURA-4", finalRef, "WebReference should be unchanged");
            });

            yield return Assert.Run("ReferencePrefixStrategy: mutates OrderReference AND returns the new WebReference deterministically", () =>
            {
                var order = new WebOrder { OrderReference = "VERDURA-5" };
                string finalRef = new ReferencePrefixStrategy().Apply(order, "12", "VERDURA-5");
                Assert.AreEqual("T12-VERDURA-5", order.OrderReference, "OrderReference should be table-prefixed");
                Assert.AreEqual("T12-VERDURA-5", finalRef, "returned WebReference should match the mutated OrderReference");

                // Idempotency correctness: re-applying with the same inputs
                // must always derive the identical WebReference, since
                // OrderService's idempotency key is externalOrderId and the
                // Idealpos-side reference must be a deterministic function
                // of it for InsertOrders()'s own (WebReference, Origin)
                // dedup to also work as a defence-in-depth layer.
                var order2 = new WebOrder { OrderReference = "VERDURA-5" };
                string finalRef2 = new ReferencePrefixStrategy().Apply(order2, "12", "VERDURA-5");
                Assert.AreEqual(finalRef, finalRef2, "same externalOrderId+table must always derive the same WebReference");
            });
        }
    }
}
