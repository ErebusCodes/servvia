using System;
using System.Collections.Generic;
using System.Threading;
using VerduraIdealposBridge.Config;
using VerduraIdealposBridge.Idealpos;
using VerduraIdealposBridge.Logging;

namespace VerduraIdealposBridge.Orders
{
    /// <summary>
    /// Read-only background poller. Never writes to Idealpos — only to the
    /// bridge's own SQLite state store. Every transition below cites, in
    /// comments, exactly which piece of the investigation it's based on;
    /// several are explicitly heuristic (see OrderStatus's own doc
    /// comments) because the underlying Idealpos behaviour lives inside
    /// native IPS.exe and could not be decompiled.
    /// </summary>
    public class OrderLifecycleWatcher : IDisposable
    {
        private readonly BridgeConfig _config;
        private readonly OrderStateStore _store;
        private readonly IdealposReadRepository _repo;
        private readonly OrderService _service;
        private Timer _timer;
        private int _tickRunning; // 0/1 used as a poor-man's non-reentrant guard

        public OrderLifecycleWatcher(BridgeConfig config, OrderStateStore store, IdealposReadRepository repo, OrderService service)
        {
            _config = config;
            _store = store;
            _repo = repo;
            _service = service;
        }

        public void Start()
        {
            var interval = TimeSpan.FromSeconds(Math.Max(1, _config.PollingIntervalSeconds));
            _timer = new Timer(_ => Tick(), null, interval, interval);
            Logger.Info("watcher_started", Logger.F("intervalSeconds", _config.PollingIntervalSeconds), Logger.F("staleTimeoutMinutes", _config.OrderStaleTimeoutMinutes));
        }

        private void Tick()
        {
            if (Interlocked.CompareExchange(ref _tickRunning, 1, 0) != 0) return; // previous tick still running (slow SQL?) — skip, don't pile up
            try
            {
                List<OrderRecord> active = _store.FindActive();
                foreach (OrderRecord record in active)
                {
                    try
                    {
                        Observe(record);
                    }
                    catch (Exception ex)
                    {
                        Logger.Error("watcher_observe_failed", ex, Logger.F("externalOrderId", record.ExternalOrderId));
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.Error("watcher_tick_failed", ex);
            }
            finally
            {
                Interlocked.Exchange(ref _tickRunning, 0);
            }
        }

        private void Observe(OrderRecord record)
        {
            bool stillResolving = record.Status == OrderStatus.SubmittedToIdealpos
                                || record.Status == OrderStatus.PendingIdealposProcessing
                                || record.Status == OrderStatus.Processed;
            if (stillResolving && DateTime.UtcNow - record.SubmittedAtUtc > TimeSpan.FromMinutes(_config.OrderStaleTimeoutMinutes))
            {
                // Preflight fix (2026-08-19, independent review): this used
                // to transition straight to Failed. That is a false claim
                // of confirmed non-execution: at every one of the three
                // "stillResolving" states, native Idealpos may already have
                // processed (or may still go on to process) the order —
                // this watcher only stops WATCHING after the timeout, it
                // never proves Idealpos stopped TRYING. The Processed case
                // is the sharpest example: WebPendingOrder.Processed=1 was
                // already CONFIRMED there (native Idealpos definitely
                // consumed the order) — calling that "failed" would be an
                // outright lie, not just an imprecise label. Uncertain is
                // terminal (the watcher will not re-observe it) but honestly
                // says "stopped watching, outcome unconfirmed" rather than
                // asserting an outcome that isn't known.
                string evidence;
                switch (record.Status)
                {
                    case OrderStatus.Processed:
                        evidence = "CONFIRMED: WebPendingOrder.Processed=1 was observed — native Idealpos definitely " +
                                   "consumed this order. No PendingSales correlation was found within the timeout. " +
                                   "Check the native Idealpos UI/table directly before assuming anything about this order.";
                        break;
                    case OrderStatus.PendingIdealposProcessing:
                        evidence = "CONFIRMED: a WebPendingOrder row exists (Processed=0) — native Idealpos has not " +
                                   "consumed it yet as of the last observation, but may still do so later.";
                        break;
                    default:
                        evidence = "No WebPendingOrder row was ever observed for this order's WebReference. This does " +
                                   "not prove InsertOrders() failed to persist it — it may not have committed/replicated " +
                                   "in time for this watcher to see it, or may still appear.";
                        break;
                }
                Transition(record, OrderStatus.Uncertain, "Timed out after " + _config.OrderStaleTimeoutMinutes +
                    " minute(s) waiting for Idealpos to process this order (Idealpos:OrderStaleTimeoutMinutes). " +
                    "Last known state: " + record.Status.ToWireString() + ". " + evidence +
                    " Do not resubmit under a new externalOrderId without first confirming, via the Idealpos UI or " +
                    "a direct SQL check, that no duplicate order already exists.");
                return;
            }

            if (record.Status == OrderStatus.SubmittedToIdealpos || record.Status == OrderStatus.PendingIdealposProcessing)
            {
                ObserveWebPendingOrder(record);
                if (record.Status != OrderStatus.Processed) return; // fall through only if it just became Processed this tick
            }

            if (record.Status == OrderStatus.Processed)
            {
                ObservePendingSaleAssignment(record);
                return;
            }

            if (record.Status == OrderStatus.AssignedToTable && record.PendingSalesId.HasValue)
            {
                ObservePendingSaleStillOpen(record);
            }
        }

        /// <summary>Confirmed mechanism (Section K.1): a row in
        /// dbo.WebPendingOrder keyed by WebReference, whose Processed
        /// column flips from 0 to 1 once native IPS.exe consumes it.</summary>
        private void ObserveWebPendingOrder(OrderRecord record)
        {
            WebPendingOrderRow row = _repo.GetWebPendingOrderByReference(record.IdealposWebReference);
            if (row == null)
            {
                // Confirmed code path (LocalDataHelper.GetPendingOrders()):
                // corrupted/undeserializable rows are deleted without ever
                // being marked Processed. A brand-new SubmittedToIdealpos
                // row missing on the very first poll is more likely
                // replication/commit latency than that path, so only
                // escalate to Rejected once we've previously confirmed the
                // row existed (PendingIdealposProcessing) or logged its ID.
                if (record.Status == OrderStatus.PendingIdealposProcessing || record.WebPendingOrderId.HasValue)
                {
                    Transition(record, OrderStatus.Rejected,
                        "WebPendingOrder row disappeared before Processed=1 — matches the confirmed " +
                        "corrupted-record cleanup path in LocalDataHelper.GetPendingOrders() " +
                        "(deserialization failure), not an explicit business rejection (none was found " +
                        "in the local pipeline).");
                }
                return;
            }

            record.WebPendingOrderId = row.Id;

            if (record.Status == OrderStatus.SubmittedToIdealpos)
            {
                Transition(record, OrderStatus.PendingIdealposProcessing, null);
            }

            if (row.Processed)
            {
                Transition(record, OrderStatus.Processed, null);
            }
        }

        /// <summary>NOT fully confirmed (Section K.2 — the harness's open
        /// question): whether native Idealpos links PendingSales.Reference
        /// back to our WebReference, and whether PendingSales.Code ends up
        /// equal to the requested table, both depend on behaviour this
        /// investigation could not decompile. Falls back to an unfiltered
        /// recent-rows scan (same rationale as the harness's watch
        /// command) if the direct Reference match finds nothing.</summary>
        private void ObservePendingSaleAssignment(OrderRecord record)
        {
            PendingSaleRow sale = _repo.GetPendingSaleByReference(record.IdealposWebReference);
            if (sale == null)
            {
                // Leave status at Processed — do not guess. Logged at Debug
                // so it doesn't spam Info-level logs every poll interval
                // while normal (staff hasn't picked it up / mapping isn't
                // via Reference in this Idealpos version).
                List<PendingSaleRow> recent = _repo.GetRecentPendingSales(record.SubmittedAtUtc.AddMinutes(-1), 5);
                Logger.Debug("watcher_no_pending_sale_match_yet",
                    Logger.F("externalOrderId", record.ExternalOrderId),
                    Logger.F("recentPendingSalesCount", recent.Count));
                return;
            }

            record.PendingSalesId = sale.Id;
            record.PendingSalesCode = sale.Code;
            record.TableMatchesRequest = string.Equals(
                (sale.Code ?? "").Trim(), (record.RequestedTable ?? "").Trim(), StringComparison.OrdinalIgnoreCase);

            if (record.TableMatchesRequest == false)
            {
                Logger.Warn("table_mismatch",
                    Logger.F("externalOrderId", record.ExternalOrderId),
                    Logger.F("requestedTable", record.RequestedTable),
                    Logger.F("actualPendingSalesCode", sale.Code));
            }

            Transition(record, OrderStatus.AssignedToTable, null);
        }

        /// <summary>HEURISTIC (see OrderStatus.Paid/Closed doc comments):
        /// a tracked PendingSales row disappearing is treated as evidence
        /// the sale was finalized (moved into dbo.Transactions, which does
        /// carry a confirmed audit trigger) and the table closed. This was
        /// never directly proven against native IPS.exe's actual behaviour
        /// on payment — validate this specifically during end-to-end
        /// testing (README.md Test 8/9) before relying on it operationally.</summary>
        private void ObservePendingSaleStillOpen(OrderRecord record)
        {
            PendingSaleRow row = _repo.GetPendingSaleById(record.PendingSalesId.Value);
            if (row != null) return; // still open — nothing to do

            Transition(record, OrderStatus.Paid, null);
            Transition(record, OrderStatus.Closed,
                "Heuristic: PendingSales row " + record.PendingSalesId + " disappeared, inferred as " +
                "paid+closed. Not directly confirmed against native IPS.exe behaviour — see README.md.");
        }

        private void Transition(OrderRecord record, OrderStatus newStatus, string note)
        {
            OrderStatus old = record.Status;
            record.Status = newStatus;
            record.LastObservedAtUtc = DateTime.UtcNow;
            // Uncertain added to this list during the 2026-08-19 preflight
            // review, alongside the Failed->Uncertain timeout fix above: an
            // Uncertain transition's note carries exactly the evidence (e.g.
            // "WebPendingOrder.Processed=1 was confirmed") an operator needs
            // to decide what to do — losing it here would silently defeat
            // the whole point of distinguishing Uncertain from Failed.
            bool isDiagnosticStatus = newStatus == OrderStatus.Rejected || newStatus == OrderStatus.Failed || newStatus == OrderStatus.Uncertain;
            if (note != null) record.LastError = isDiagnosticStatus ? note : record.LastError;
            _store.Update(record);
            Logger.Info("order_state_transition",
                Logger.F("externalOrderId", record.ExternalOrderId),
                Logger.F("from", old.ToWireString()),
                Logger.F("to", newStatus.ToWireString()));
            _service.Publish(record);
        }

        public void Dispose()
        {
            _timer?.Dispose();
        }
    }
}
