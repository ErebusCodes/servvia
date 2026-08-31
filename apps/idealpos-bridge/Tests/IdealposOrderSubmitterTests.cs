using System.Collections.Generic;
using IdealPos.Webit;
using VerduraIdealposBridge.Idealpos;
using VerduraIdealposBridge.Orders;
using VerduraIdealposBridge.TableAssignment;

namespace VerduraIdealposBridge.Tests
{
    /// <summary>
    /// Covers IdealposOrderSubmitter.BuildOrder() — the pure object
    /// construction extracted from Submit() so it can run here without a
    /// live database or Idealpos. Added 2026-08-30/31 alongside the fix for
    /// the AddCustomer null-reference crash proven in Webit.log for
    /// ORD-600001 (WebOrder.Customer was never assigned).
    /// </summary>
    public static class IdealposOrderSubmitterTests
    {
        private static OrderRequest SampleRequest(string externalOrderId = "ORD-TEST-1", string table = "5", string notes = null)
        {
            return new OrderRequest
            {
                ExternalOrderId = externalOrderId,
                Table = table,
                Notes = notes,
                Items = new List<OrderLineRequest>
                {
                    new OrderLineRequest { ProductCode = "708", Quantity = 1m },
                },
            };
        }

        private static IReadOnlyList<ProductDto> SampleProducts()
        {
            return new List<ProductDto>
            {
                new ProductDto { Code = "708", Description = "CHICKEN BALLISTA PIZZA" },
            };
        }

        public static IEnumerable<TestResult> RunAll()
        {
            yield return Assert.Run("BuildOrder: Customer is never null", () =>
            {
                string webRef;
                var order = IdealposOrderSubmitter.BuildOrder(SampleRequest(), SampleProducts(), new NoHintStrategy(), out webRef);
                Assert.IsTrue(order.Customer != null, "WebOrder.Customer must not be null — the legacy Webit AddCustomer routine crashes on a null Customer (confirmed in Webit.log for ORD-600001)");
            });

            yield return Assert.Run("BuildOrder: Customer.CreationState asks Idealpos to resolve/create the customer itself", () =>
            {
                string webRef;
                var order = IdealposOrderSubmitter.BuildOrder(SampleRequest(), SampleProducts(), new NoHintStrategy(), out webRef);
                Assert.AreEqual(CreationStates.Create, order.Customer.CreationState, "Customer.CreationState");
            });

            yield return Assert.Run("BuildOrder: no fabricated personal information on Customer", () =>
            {
                string webRef;
                var order = IdealposOrderSubmitter.BuildOrder(SampleRequest(), SampleProducts(), new NoHintStrategy(), out webRef);
                Assert.AreEqual((string)null, order.Customer.FirstName, "FirstName must not be fabricated");
                Assert.AreEqual((string)null, order.Customer.LastName, "LastName must not be fabricated");
                Assert.AreEqual((string)null, order.Customer.Email, "Email must not be fabricated");
                Assert.AreEqual((string)null, order.Customer.ContactNumber, "ContactNumber must not be fabricated");
                Assert.AreEqual((string)null, order.Customer.Code, "Code must not be fabricated — no existing customer record to reference");
                Assert.AreEqual((string)null, order.Customer.Reference, "Reference must not be fabricated");
                Assert.AreEqual("Web Order", order.Customer.ContactName, "ContactName is a channel label, not a person");
            });

            yield return Assert.Run("BuildOrder: table-assignment strategy still applies unchanged", () =>
            {
                string webRef;
                var order = IdealposOrderSubmitter.BuildOrder(SampleRequest(table: "5"), SampleProducts(), new DeliverToStrategy(), out webRef);
                Assert.AreEqual("5", order.DeliverTo, "DeliverToStrategy must still set DeliverTo");
                Assert.AreEqual("ORD-TEST-1", webRef, "webReference unchanged for a non-mutating strategy");
            });

            yield return Assert.Run("BuildOrder: nativeCode/quantity mapping unchanged", () =>
            {
                string webRef;
                var order = IdealposOrderSubmitter.BuildOrder(SampleRequest(), SampleProducts(), new NoHintStrategy(), out webRef);
                Assert.AreEqual(1, order.Items.Length, "item count");
                Assert.AreEqual("708", order.Items[0].Code, "product code");
                Assert.AreEqual(1m, order.Items[0].Quantity, "quantity");
                Assert.AreEqual(PricingMode.Inherit, order.Items[0].PricingMode, "price must still be left for Idealpos to resolve natively");
            });

            yield return Assert.Run("BuildOrder: externalOrderId preserved as OrderReference for a non-mutating strategy", () =>
            {
                string webRef;
                var order = IdealposOrderSubmitter.BuildOrder(SampleRequest(externalOrderId: "ORD-TEST-2"), SampleProducts(), new NoHintStrategy(), out webRef);
                Assert.AreEqual("ORD-TEST-2", order.OrderReference, "OrderReference");
                Assert.AreEqual("ORD-TEST-2", webRef, "returned webReference");
            });

            yield return Assert.Run("BuildOrder: OrderDetail is EatIn (unchanged by this fix)", () =>
            {
                string webRef;
                var order = IdealposOrderSubmitter.BuildOrder(SampleRequest(), SampleProducts(), new NoHintStrategy(), out webRef);
                Assert.AreEqual(OrderMode.EatIn, order.OrderDetail, "OrderDetail must remain EatIn — this fix only touches Customer");
            });

            yield return Assert.Run("BuildOrder: PaymentDetail is None (unchanged by this fix)", () =>
            {
                string webRef;
                var order = IdealposOrderSubmitter.BuildOrder(SampleRequest(), SampleProducts(), new NoHintStrategy(), out webRef);
                Assert.AreEqual(PaymentMode.None, order.PaymentDetail, "PaymentDetail must remain None — this fix only touches Customer");
            });

            yield return Assert.Run("BuildOrder: repeated calls with the same request produce independent Customer instances (no shared mutable state)", () =>
            {
                string webRef1, webRef2;
                var order1 = IdealposOrderSubmitter.BuildOrder(SampleRequest(), SampleProducts(), new NoHintStrategy(), out webRef1);
                var order2 = IdealposOrderSubmitter.BuildOrder(SampleRequest(), SampleProducts(), new NoHintStrategy(), out webRef2);
                Assert.IsTrue(!ReferenceEquals(order1.Customer, order2.Customer), "each call must build its own Customer instance");
            });
        }
    }
}
