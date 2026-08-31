using System.Collections.Generic;
using VerduraIdealposBridge.Orders;

namespace VerduraIdealposBridge.Tests
{
    /// <summary>
    /// Locks in the structural finding that closes DL-108 §K.2: no Webit
    /// strategy can assign a native table, because the vendor's own WebOrder
    /// contract has no table field and OrderMode has no table value.
    ///
    /// The point of testing a constant is that it is not really a constant —
    /// it is a claim about the vendor contract, and these tests are where a
    /// future change to it has to be argued rather than assumed.
    ///
    /// Pure logic; runs under --selftest and in CI.
    /// </summary>
    public static class TableAssignmentCapabilityTests
    {
        public static IEnumerable<TestResult> RunAll()
        {
            yield return Assert.Run("No Webit strategy can assign a native table", () =>
            {
                Assert.IsTrue(!TableAssignmentCapability.CanAssignNativeTableViaWebit,
                    "the Webit WebOrder contract has no table field; nothing on this path can assign one");
            });

            yield return Assert.Run("The reason names the contract, not a configuration problem", () =>
            {
                // A vague reason would let this be read as "not set up yet".
                // It is not fixable by configuration and the text must say so.
                Assert.IsTrue(TableAssignmentCapability.Reason.Contains("no table field"), "should name the missing field");
                Assert.IsTrue(TableAssignmentCapability.Reason.Contains("OrderMode"), "should name the enum with no table value");
            });

            yield return Assert.Run("Every shipped strategy is described, none as assigning a table", () =>
            {
                foreach (string name in new[] { "NoHint", "DeliverTo", "Message", "HostReference", "ReferencePrefix" })
                {
                    string effect = TableAssignmentCapability.DescribeEffect(name);
                    Assert.IsTrue(!string.IsNullOrWhiteSpace(effect), name + " must have an effect description");
                    Assert.IsTrue(!effect.Contains("unrecognised"), name + " must be recognised");
                    Assert.IsTrue(effect.IndexOf("assigns a table", System.StringComparison.OrdinalIgnoreCase) < 0,
                        name + " must not be described as assigning a table, was: " + effect);
                }
            });

            yield return Assert.Run("Strategy names are matched case-insensitively, as App.config is hand-edited", () =>
            {
                Assert.AreEqual(
                    TableAssignmentCapability.DescribeEffect("NoHint"),
                    TableAssignmentCapability.DescribeEffect("nohint"),
                    "case should not change the description");
            });

            yield return Assert.Run("Message is flagged misleading — it prints a table it never assigned", () =>
            {
                Assert.IsTrue(TableAssignmentCapability.IsMisleading("Message"), "Message writes docket text");
                Assert.IsTrue(TableAssignmentCapability.DescribeEffect("Message").Contains("PRINTS"),
                    "its description should say the table gets printed");
            });

            yield return Assert.Run("ReferencePrefix is flagged misleading — it moves the reconciliation anchor", () =>
            {
                Assert.IsTrue(TableAssignmentCapability.IsMisleading("ReferencePrefix"), "ReferencePrefix rewrites OrderReference");
                Assert.IsTrue(TableAssignmentCapability.DescribeEffect("ReferencePrefix").Contains("anchor"),
                    "its description should mention the anchor it moves");
            });

            yield return Assert.Run("The harmless no-ops are not flagged as misleading", () =>
            {
                Assert.IsTrue(!TableAssignmentCapability.IsMisleading("NoHint"), "NoHint sends nothing");
                Assert.IsTrue(!TableAssignmentCapability.IsMisleading("DeliverTo"), "DeliverTo does not print to the docket");
                Assert.IsTrue(!TableAssignmentCapability.IsMisleading("HostReference"), "HostReference does not print to the docket");
            });

            yield return Assert.Run("An unknown strategy reports unknown rather than claiming safety", () =>
            {
                Assert.IsTrue(TableAssignmentCapability.DescribeEffect("SomethingNew").Contains("unrecognised"),
                    "an unrecognised strategy must not be described as harmless");
                Assert.IsTrue(TableAssignmentCapability.DescribeEffect(null).Contains("unrecognised"), "null");
            });
        }
    }
}
