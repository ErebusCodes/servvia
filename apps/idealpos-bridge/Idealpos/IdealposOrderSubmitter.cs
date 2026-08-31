using System;
using System.Collections.Generic;
using System.Linq;
using IdealPos.Webit;
using VerduraIdealposBridge.Logging;
using VerduraIdealposBridge.Orders;
using VerduraIdealposBridge.TableAssignment;

namespace VerduraIdealposBridge.Idealpos
{
    public class OrderSubmissionResult
    {
        public bool Success { get; set; }
        public string IdealposWebReference { get; set; }
        public Guid OriginGuid { get; set; }
        public string Error { get; set; }
    }

    /// <summary>
    /// The one and only place this bridge writes anything to Idealpos.
    /// Calls Idealpos's own LocalDataHelper.InsertOrders() — confirmed via
    /// decompilation to be the exact method both the real Doshii/Ecommerce
    /// pipeline and the legacy Webit COM pipeline call (Section K.1 of the
    /// investigation) — and does not reimplement its SQL. Everything this
    /// class does before that call is pure object construction; everything
    /// after is handled by IdealposReadRepository (read-only) and
    /// OrderLifecycleWatcher.
    /// </summary>
    public class IdealposOrderSubmitter
    {
        // Confirmed via decompilation of IdealposService.exe:
        //   IdealposService.Services.EcommerceService.GetPendingOrder()
        //   IdealposService.IdealposServiceLogic.ProcessOrder()
        // Both call LocalDataHelper.InsertOrders(..., new Guid("02C1A621-1C2E-4E73-A09E-7AF1CCA49F80")).
        // Using the same value means bridge-submitted orders are, at the
        // database level, indistinguishable from genuine Doshii orders.
        public static readonly Guid ConfirmedEcommercePluginGuid =
            new Guid("02C1A621-1C2E-4E73-A09E-7AF1CCA49F80");

        public OrderSubmissionResult Submit(OrderRequest request, IReadOnlyList<ProductDto> resolvedProducts, ITableAssignmentStrategy strategy)
        {
            string idealposWebReference;
            WebOrder order = BuildOrder(request, resolvedProducts, strategy, out idealposWebReference);

            Logger.Info("idealpos_submit_attempt",
                Logger.F("externalOrderId", request.ExternalOrderId),
                Logger.F("table", request.Table),
                Logger.F("strategy", strategy.Name),
                Logger.F("idealposWebReference", idealposWebReference),
                Logger.F("itemCount", order.Items.Length));

            try
            {
                // Preflight (2026-08-19), confirmed via reflection against the
                // REAL IdealPos.Webit.Core.dll (not the earlier assumption):
                // LocalDataHelper.InsertOrders(IEnumerable<WebOrder>, Guid)
                // returns void, not int/rows-affected. This bridge previously
                // assumed (and this call site previously would not even
                // compile against the real assembly, having assigned the
                // call's result to `int rows`) that a row count was
                // available as evidence of success. It is not: the real API
                // gives no feedback whatsoever beyond "did this call throw."
                // `Success = true` below is therefore, and was always
                // intended to be, evidence only that InsertOrders() did not
                // throw — never evidence that Idealpos actually persisted or
                // will process the row. See OrderLifecycleWatcher for the
                // only real evidence of native consumption.
                LocalDataHelper.InsertOrders(new[] { order }, ConfirmedEcommercePluginGuid);
                Logger.Info("idealpos_submit_result",
                    Logger.F("externalOrderId", request.ExternalOrderId));
                return new OrderSubmissionResult
                {
                    Success = true,
                    IdealposWebReference = idealposWebReference,
                    OriginGuid = ConfirmedEcommercePluginGuid,
                };
            }
            catch (Exception ex)
            {
                Logger.Error("idealpos_submit_failed", ex, Logger.F("externalOrderId", request.ExternalOrderId));
                return new OrderSubmissionResult
                {
                    Success = false,
                    IdealposWebReference = idealposWebReference,
                    OriginGuid = ConfirmedEcommercePluginGuid,
                    Error = ex.GetType().Name + ": " + ex.Message,
                };
            }
        }

        /// <summary>
        /// Pure object construction — no SQL, no Idealpos call — so it can be
        /// exercised directly by IdealposOrderSubmitterTests without a live
        /// database or running Idealpos. Submit() is the only caller in
        /// production code.
        /// </summary>
        internal static WebOrder BuildOrder(OrderRequest request, IReadOnlyList<ProductDto> resolvedProducts, ITableAssignmentStrategy strategy, out string idealposWebReference)
        {
            var now = DateTime.UtcNow;
            var order = new WebOrder
            {
                OrderReference = request.ExternalOrderId,
                HostReference = "VerduraIdealposBridge",
                OrderedDate = now,
                DeliveryDate = now,
                OrderDetail = OrderMode.EatIn,
                PaymentDetail = PaymentMode.None, // unpaid — staff pay normally in Idealpos
                GiftOrder = false,
                TriggerPromotions = false,
                CalculatePoints = false,
                Message = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes,
                Items = BuildItems(request, resolvedProducts),
                // 2026-08-30: WebOrder.Customer was never assigned here, so it
                // stayed null. Confirmed via C:\ProgramData\Idealpos
                // Solutions\Idealpos\LOGS\Webit.log for ORD-600001 (the first
                // order this integration ever attempted) that the legacy
                // Webit AddCustomer routine dereferences WebOrder.Customer
                // unconditionally and crashes ("Object variable or With block
                // variable not set") when it is null — after which the order
                // is still marked Processed, silently, with no live sale
                // created. Customer.CreationState exists specifically (see
                // IdealPos.Webit.Core.dll's CreationStates enum:
                // None/Create/NotExists/DefaultNotFound) to tell Idealpos how
                // to resolve the customer; Create is the only value that asks
                // Idealpos to resolve/create one itself rather than requiring
                // an existing customer record we don't have. No name/contact
                // details are fabricated — ContactName is a channel label
                // ("Web Order"), not a person, matching Customer.ContactName's
                // own documented purpose ("used if firstname/lastname aren't
                // supplied").
                Customer = new Customer
                {
                    CreationState = CreationStates.Create,
                    ContactName = "Web Order",
                },
            };

            // Table-assignment strategy may set DeliverTo / Message / HostReference,
            // or (ReferencePrefix) mutate OrderReference itself and return the
            // new value — this is the ONLY point where table-hint fields are
            // touched, isolated per Section K.2's open question.
            idealposWebReference = strategy.Apply(order, request.Table, request.ExternalOrderId);
            if (order.Message != null && strategy.Name == "Message")
            {
                // MessageStrategy overwrites Message for the table hint; any
                // customer note supplied by Verdura would otherwise be lost
                // silently. Fold both in rather than dropping the note.
                if (!string.IsNullOrWhiteSpace(request.Notes))
                {
                    order.Message = order.Message + " | " + request.Notes;
                }
            }

            return order;
        }

        private static StockItem[] BuildItems(OrderRequest request, IReadOnlyList<ProductDto> resolvedProducts)
        {
            var byCode = resolvedProducts.ToDictionary(p => p.Code, p => p, StringComparer.OrdinalIgnoreCase);
            return request.Items.Select(line =>
            {
                ProductDto product;
                byCode.TryGetValue(line.ProductCode, out product);
                return new StockItem
                {
                    Code = line.ProductCode,
                    Description = product != null ? product.Description : line.ProductCode,
                    Quantity = line.Quantity,
                    // PricingMode left at its constructor default (Inherit)
                    // so Idealpos prices the line itself.
                };
            }).ToArray();
        }
    }
}
