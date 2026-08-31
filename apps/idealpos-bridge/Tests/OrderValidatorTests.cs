using System.Collections.Generic;
using VerduraIdealposBridge.Orders;

namespace VerduraIdealposBridge.Tests
{
    public static class OrderValidatorTests
    {
        public static IEnumerable<TestResult> RunAll()
        {
            var validTables = new HashSet<string>(System.StringComparer.OrdinalIgnoreCase) { "12", "13" };
            var validProducts = new HashSet<string>(System.StringComparer.OrdinalIgnoreCase) { "101002", "101003", "101004" };

            yield return Assert.Run("Validator: valid order passes", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "VERDURA-1",
                    Table = "12",
                    Items = new List<OrderLineRequest>
                    {
                        new OrderLineRequest { ProductCode = "101002", Quantity = 2 },
                        new OrderLineRequest { ProductCode = "101003", Quantity = 1 },
                    }
                };
                var result = new OrderValidator().Validate(req, validTables, validProducts, id => false);
                Assert.IsTrue(result.IsValid, "expected valid, errors: " + string.Join(" | ", result.Errors));
            });

            yield return Assert.Run("Validator: unknown table rejected", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "VERDURA-2",
                    Table = "999",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "101002", Quantity = 1 } }
                };
                var result = new OrderValidator().Validate(req, validTables, validProducts, id => false);
                Assert.IsTrue(!result.IsValid, "expected invalid for unknown table");
            });

            yield return Assert.Run("Validator: unknown product rejected", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "VERDURA-3",
                    Table = "12",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "NOPE", Quantity = 1 } }
                };
                var result = new OrderValidator().Validate(req, validTables, validProducts, id => false);
                Assert.IsTrue(!result.IsValid, "expected invalid for unknown product");
            });

            yield return Assert.Run("Validator: zero/negative quantity rejected", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "VERDURA-4",
                    Table = "12",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "101002", Quantity = 0 } }
                };
                var result = new OrderValidator().Validate(req, validTables, validProducts, id => false);
                Assert.IsTrue(!result.IsValid, "expected invalid for zero quantity");
            });

            yield return Assert.Run("Validator: empty items rejected", () =>
            {
                var req = new OrderRequest { ExternalOrderId = "VERDURA-5", Table = "12", Items = new List<OrderLineRequest>() };
                var result = new OrderValidator().Validate(req, validTables, validProducts, id => false);
                Assert.IsTrue(!result.IsValid, "expected invalid for empty items");
            });

            yield return Assert.Run("Validator: missing externalOrderId rejected", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "",
                    Table = "12",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "101002", Quantity = 1 } }
                };
                var result = new OrderValidator().Validate(req, validTables, validProducts, id => false);
                Assert.IsTrue(!result.IsValid, "expected invalid for missing externalOrderId");
            });

            yield return Assert.Run("Validator: duplicate product codes in one order rejected", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "VERDURA-6",
                    Table = "12",
                    Items = new List<OrderLineRequest>
                    {
                        new OrderLineRequest { ProductCode = "101002", Quantity = 1 },
                        new OrderLineRequest { ProductCode = "101002", Quantity = 1 },
                    }
                };
                var result = new OrderValidator().Validate(req, validTables, validProducts, id => false);
                Assert.IsTrue(!result.IsValid, "expected invalid for duplicate product code within one order");
            });

            yield return Assert.Run("Validator: existing externalOrderId flagged as duplicate, not a validation error", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "VERDURA-7",
                    Table = "12",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "101002", Quantity = 1 } }
                };
                var result = new OrderValidator().Validate(req, validTables, validProducts, id => id == "VERDURA-7");
                Assert.IsTrue(result.IsValid, "duplicate should still be structurally valid");
                Assert.IsTrue(result.IsDuplicate, "expected IsDuplicate=true");
            });
        }
    }
}
