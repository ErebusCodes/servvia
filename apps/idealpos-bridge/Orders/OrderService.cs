using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using VerduraIdealposBridge.Config;
using VerduraIdealposBridge.Http;
using VerduraIdealposBridge.Idealpos;
using VerduraIdealposBridge.Logging;
using VerduraIdealposBridge.Realtime;
using VerduraIdealposBridge.TableAssignment;

namespace VerduraIdealposBridge.Orders
{
    /// <summary>
    /// Orchestrates one order submission: idempotency check, validation,
    /// per-table serialization, table-assignment strategy application,
    /// submission via IdealposOrderSubmitter, and initial state
    /// persistence + real-time publish. This is the only class that ties
    /// the idempotency store, the Idealpos read repository, and the
    /// submitter together — Api/OrdersEndpoint.cs talks only to this.
    /// </summary>
    public class OrderService
    {
        private readonly BridgeConfig _config;
        private readonly OrderStateStore _store;
        private readonly IdealposReadRepository _repo;
        private readonly IdealposOrderSubmitter _submitter;
        private readonly WebSocketHub _hub;
        private readonly ConcurrentDictionary<string, object> _tableLocks =
            new ConcurrentDictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        public OrderService(BridgeConfig config, OrderStateStore store, IdealposReadRepository repo,
            IdealposOrderSubmitter submitter, WebSocketHub hub)
        {
            _config = config;
            _store = store;
            _repo = repo;
            _submitter = submitter;
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

                ITableAssignmentStrategy strategy;
                try
                {
                    strategy = TableAssignmentStrategyFactory.Create(_config.TableAssignmentStrategyName);
                }
                catch (Exception ex)
                {
                    // Should be unreachable — BridgeConfig validates this at
                    // startup — but fail the order honestly rather than
                    // crash the request pipeline if it ever happens.
                    record.Status = OrderStatus.Failed;
                    record.LastError = ex.Message;
                    record.LastObservedAtUtc = DateTime.UtcNow;
                    _store.Update(record);
                    Publish(record);
                    return OrderSubmitOutcome.IdealposFailed(record, ex.Message);
                }

                var relevantProducts = products.Where(p => request.Items.Any(i => string.Equals(i.ProductCode, p.Code, StringComparison.OrdinalIgnoreCase))).ToList();
                OrderSubmissionResult result = _submitter.Submit(request, relevantProducts, strategy);

                record.StrategyUsed = strategy.Name;
                record.IdealposWebReference = result.IdealposWebReference;
                record.OriginGuid = result.OriginGuid.ToString();
                record.LastObservedAtUtc = DateTime.UtcNow;

                if (!result.Success)
                {
                    record.Status = OrderStatus.Failed;
                    record.LastError = result.Error;
                    _store.Update(record);
                    Publish(record);
                    return OrderSubmitOutcome.IdealposFailed(record, result.Error);
                }

                record.Status = OrderStatus.SubmittedToIdealpos;
                _store.Update(record);
                Publish(record);
                Logger.Info("order_submitted", Logger.F("externalOrderId", request.ExternalOrderId), Logger.F("strategy", strategy.Name), Logger.F("idealposWebReference", record.IdealposWebReference));

                return OrderSubmitOutcome.Success(record);
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
