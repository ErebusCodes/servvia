using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using VerduraIdealposBridge.Config;
using VerduraIdealposBridge.Http;
using VerduraIdealposBridge.Idealpos;
using VerduraIdealposBridge.Logging;
using VerduraIdealposBridge.Realtime;
using VerduraIdealposBridge.Orders.NativeTable;

namespace VerduraIdealposBridge.Orders
{
    /// <summary>
    /// Orchestrates one order submission: idempotency check, validation,
    /// per-table serialization, native table-round submission, and initial
    /// state persistence + real-time publish. This is the only class that
    /// ties the idempotency store, the Idealpos read repository, and the
    /// table-round writer together — Api/OrdersEndpoint.cs talks only to this.
    ///
    /// The WebOrder/Ecommerce writer (IdealposOrderSubmitter,
    /// LocalDataHelper.InsertOrders) has been REMOVED from this path per the
    /// product decision: the Order Tablet writes only through
    /// <see cref="ITableRoundWriter"/> and cannot fall back to it. Until the
    /// native transport is proven and enabled, the injected writer is
    /// <see cref="DisabledTableRoundWriter"/> and submission fails closed.
    /// </summary>
    public class OrderService
    {
        private readonly BridgeConfig _config;
        private readonly OrderStateStore _store;
        private readonly IdealposReadRepository _repo;
        private readonly ITableRoundWriter _tableWriter;
        private readonly WebSocketHub _hub;
        private readonly ConcurrentDictionary<string, object> _tableLocks =
            new ConcurrentDictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        public OrderService(BridgeConfig config, OrderStateStore store, IdealposReadRepository repo,
            ITableRoundWriter tableWriter, WebSocketHub hub)
        {
            _config = config;
            _store = store;
            _repo = repo;
            _tableWriter = tableWriter;
            _hub = hub;
        }

        public OrderRecord GetStatus(string externalOrderId) => _store.Find(externalOrderId);

        public OrderSubmitOutcome SubmitOrder(OrderRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.ExternalOrderId))
            {
                return OrderSubmitOutcome.ValidationFailed(new List<string> { "externalOrderId is required." });
            }

            // Idempotency fast path — no DB/Idealpos work at all for a
            // repeat submission. This is the primary mechanism required by
            // "one Verdura order -> two Idealpos orders must never happen".
            var existing = _store.Find(request.ExternalOrderId);
            if (existing != null)
            {
                Logger.Info("order_duplicate_short_circuit", Logger.F("externalOrderId", request.ExternalOrderId), Logger.F("status", existing.Status.ToWireString()));
                return OrderSubmitOutcome.Duplicate(existing);
            }

            List<Idealpos.TableDto> tables = _repo.GetTables();
            var validTableNames = new HashSet<string>(tables.Select(t => t.Table), StringComparer.OrdinalIgnoreCase);
            List<ProductDto> products = _repo.GetProducts();
            var validCodes = new HashSet<string>(products.Select(p => p.Code), StringComparer.OrdinalIgnoreCase);

            var validator = new OrderValidator();
            ValidationResult validation = validator.Validate(request, validTableNames, validCodes, _store.Exists);
            if (!validation.IsValid)
            {
                Logger.Warn("order_validation_failed", Logger.F("externalOrderId", request.ExternalOrderId), Logger.F("errors", string.Join(" | ", validation.Errors)));
                return OrderSubmitOutcome.ValidationFailed(validation.Errors);
            }

            // Serialize processing per requested table so two near-
            // simultaneous submissions for the same table don't race
            // against each other inside the bridge. This does NOT prove
            // Idealpos itself won't have a problem — Section K.4 confirmed
            // CheckTableLocked exists on Doshii's *payment* path, not
            // confirmed to run on this local order-creation path at all
            // (Section K.2) — so this is defence on the bridge's side only.
            object tableLock = _tableLocks.GetOrAdd(request.Table.Trim(), _ => new object());
            lock (tableLock)
            {
                // Re-check inside the lock: another request for the same
                // externalOrderId could have completed while we were
                // waiting for the table lock.
                existing = _store.Find(request.ExternalOrderId);
                if (existing != null)
                {
                    return OrderSubmitOutcome.Duplicate(existing);
                }

                Idealpos.TableDto tableInfo = tables.FirstOrDefault(t => string.Equals(t.Table, request.Table.Trim(), StringComparison.OrdinalIgnoreCase));
                bool occupiedWarning = tableInfo != null && tableInfo.LikelyOccupied;
                if (occupiedWarning)
                {
                    Logger.Warn("table_occupied_heuristic_warning", Logger.F("table", request.Table), Logger.F("externalOrderId", request.ExternalOrderId));
                }

                var record = new OrderRecord
                {
                    ExternalOrderId = request.ExternalOrderId,
                    RequestedTable = request.Table.Trim(),
                    ItemsJson = JsonUtil.Serialize(request.Items),
                    Notes = request.Notes,
                    SubmittedAtUtc = DateTime.UtcNow,
                    Status = OrderStatus.Validated,
                    LastObservedAtUtc = DateTime.UtcNow,
                    TableOccupiedWarning = occupiedWarning,
                };
                _store.Insert(record);
                Logger.Info("order_validated", Logger.F("externalOrderId", request.ExternalOrderId), Logger.F("table", record.RequestedTable), Logger.F("itemCount", request.Items.Count));
                Publish(record);

                // Native table-attached write. The WebOrder/Ecommerce writer
                // has been removed: the Order Tablet submits a TableRound
                // through ITableRoundWriter and can never reach
                // LocalDataHelper.InsertOrders — there is no fallback.
                //
                // Pos is pinned to 1 (POSServer's own invariant for these
                // pending-sale rows, STATIC-PROVEN). Clerk / guests / location
                // and per-seat lines are placeholders until the proven native
                // transport is wired; they never leave the bridge while the
                // transport is disabled. externalOrderId is Verdura's durable
                // idempotency key. request.Items and products were already
                // validated above.
                record.StrategyUsed = "native";
                TableRound round = NativeTableRoundMapper.ToTableRound(
                    request, pos: 1, clerkId: 0, guests: 0, location: 1);

                NativeSubmissionOutcome native = NativeTableRoundSubmission.Execute(
                    recordAlreadyExists: false, writer: _tableWriter, round: round);
                record.LastObservedAtUtc = DateTime.UtcNow;

                switch (native.Kind)
                {
                    case NativeSubmissionOutcomeKind.ControlledRejectionTransportDisabled:
                        // Fail closed. Nothing was sent; NativeTransportDisabled
                        // is terminal so the watcher never re-observes or
                        // resends it. Never reports success, never a WebOrder.
                        record.Status = OrderStatus.NativeTransportDisabled;
                        record.LastError = native.Message;
                        _store.Update(record);
                        Publish(record);
                        Logger.Warn("order_native_transport_disabled",
                            Logger.F("externalOrderId", request.ExternalOrderId),
                            Logger.F("transport", _tableWriter.TransportName));
                        return OrderSubmitOutcome.NativeTransportDisabled(record, native.Message);

                    case NativeSubmissionOutcomeKind.Rejected:
                        record.Status = OrderStatus.Failed;
                        record.LastError = native.Message;
                        _store.Update(record);
                        Publish(record);
                        return OrderSubmitOutcome.IdealposFailed(record, native.Message);

                    case NativeSubmissionOutcomeKind.Uncertain:
                        // A bounded send was made but the outcome is unknown.
                        // Terminal and NEVER auto-resent; requires operator
                        // verification (NativeSubmissionDecider).
                        record.Status = OrderStatus.Uncertain;
                        record.LastError = native.Message;
                        _store.Update(record);
                        Publish(record);
                        return OrderSubmitOutcome.IdealposFailed(record, native.Message);

                    case NativeSubmissionOutcomeKind.Submitted:
                        record.Status = OrderStatus.SubmittedToIdealpos;
                        _store.Update(record);
                        Publish(record);
                        Logger.Info("order_submitted",
                            Logger.F("externalOrderId", request.ExternalOrderId),
                            Logger.F("transport", _tableWriter.TransportName));
                        return OrderSubmitOutcome.Success(record);

                    default:
                        record.Status = OrderStatus.Uncertain;
                        record.LastError = "Unclassified native submission outcome.";
                        _store.Update(record);
                        Publish(record);
                        return OrderSubmitOutcome.IdealposFailed(record, record.LastError);
                }
            }
        }

        public void Publish(OrderRecord record)
        {
            var evt = new OrderStatusChangedEvent
            {
                ExternalOrderId = record.ExternalOrderId,
                Status = record.Status.ToWireString(),
                Table = record.RequestedTable,
                PendingSalesId = record.PendingSalesId,
                TableMatchesRequest = record.TableMatchesRequest,
            };
            _hub?.Broadcast(JsonUtil.Serialize(evt));
        }
    }
}
