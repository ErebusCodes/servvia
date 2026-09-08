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

        /// <summary>Null unless Bridge:PosServerConnection is configured.
        /// Null means cross-store reconciliation is DISABLED, which is a
        /// different fact from "no table sale was found" and is reported as
        /// such — see ObserveTableLink.</summary>
        private readonly PosServerReadRepository _posServerRepo;

        private Timer _timer;
        private int _tickRunning; // 0/1 used as a poor-man's non-reentrant guard

        public OrderLifecycleWatcher(BridgeConfig config, OrderStateStore store, IdealposReadRepository repo, OrderService service)
            : this(config, store, repo, service, null)
        {
        }

        public OrderLifecycleWatcher(BridgeConfig config, OrderStateStore store, IdealposReadRepository repo, OrderService service, PosServerReadRepository posServerRepo)
        {
            _config = config;
            _store = store;
            _repo = repo;
            _service = service;
            _posServerRepo = posServerRepo;
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

        /// <summary>A native table-attached submission (the only path today —
        /// see OrderService). Durably tagged via StrategyUsed so it survives a
        /// restart. Any legacy WebOrder record (StrategyUsed != "native", with
        /// an IdealposWebReference) still gets the WB* observation below.</summary>
        private static bool IsNativeSubmission(OrderRecord record)
        {
            return string.Equals(record.StrategyUsed, "native", System.StringComparison.OrdinalIgnoreCase);
        }

        private void Observe(OrderRecord record)
        {
            // Native orders are NEVER reconciled via WebOrder/WB* and never via
            // PLU/qty coincidence. The WB* observation below is isolated to
            // legacy WebOrder records; native records fail closed.
            if (IsNativeSubmission(record))
            {
                ObserveNative(record);
                return;
            }

            bool stillResolving = record.Status == OrderStatus.SubmittedToIdealpos
                                || record.Status == OrderStatus.PendingIdealposProcessing
                                || record.Status == OrderStatus.Processed
                                || record.Status == OrderStatus.AnchoredInIdealpos;
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
                    case OrderStatus.AnchoredInIdealpos:
                        // The strongest evidence any state here carries: the
                        // order's own native pending sale was located and its
                        // immutable ID captured. Timing out does not weaken
                        // that — it only records that no supported conversion
                        // onto the requested table happened while watching,
                        // which on the installed build is the expected
                        // outcome rather than a fault (DL-112 §A3).
                        evidence = "CONFIRMED: this order's native pending sale was located in " +
                                   "IPSTransaction.dbo.PendingSales — ID " + record.PendingSalesId +
                                   ", Code '" + record.PendingSalesCode + "'. It is NOT on a table: " +
                                   "native table sales live in POSServer.dbo.PendingSales, and no " +
                                   "supported path converts a WB* web-order sale into one on this build " +
                                   "(DL-112 §A3, DL-111 Q7/Q8). The order exists in Idealpos and can be " +
                                   "actioned by staff from the Web Orders screen; it has not been billed " +
                                   "to the requested table.";
                        break;
                    case OrderStatus.Processed:
                        evidence = "CONFIRMED: WebPendingOrder.Processed=1 was observed — native Idealpos definitely " +
                                   "consumed this order. But no IPSTransaction.dbo.PendingSales row with Code '" +
                                   Reconciliation.BuildNativeWebCode(record.IdealposWebReference) + "' was found within " +
                                   "the timeout, so the order could not even be anchored. Check the native Idealpos " +
                                   "UI/table directly before assuming anything about this order.";
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
                ObserveAnchor(record);
                if (record.Status != OrderStatus.AnchoredInIdealpos) return; // fall through only if it just anchored this tick
            }

            if (record.Status == OrderStatus.AnchoredInIdealpos)
            {
                ObserveTableLink(record);
                return;
            }

            if (record.Status == OrderStatus.AssignedToTable)
            {
                ObservePendingSaleStillOpen(record);
            }
        }

        /// <summary>
        /// Native table-attached reconciliation — deliberately minimal and
        /// fail-closed. There is no proven native readback contract yet (the
        /// live IPS/WPOrder transport is disabled pending Front evidence), so
        /// the bridge cannot positively confirm a native order from outside
        /// IdealPOS. It therefore:
        ///   * keeps the durable state set at submit time (externalOrderId
        ///     dedup, SendInitiated/Submitted/Uncertain in the native state
        ///     machine) untouched;
        ///   * NEVER promotes Submitted -> confirmed without strong native
        ///     evidence — none exists yet;
        ///   * NEVER uses PLU/qty coincidence as proof;
        ///   * ages a bounded-but-unconfirmed in-flight send past the stale
        ///     timeout into Uncertain (terminal, never auto-resent, operator
        ///     verifies), rather than guessing an outcome.
        /// Terminal native states (incl. NativeTransportDisabled while the
        /// transport is off) are left exactly as they are.
        /// </summary>
        private void ObserveNative(OrderRecord record)
        {
            if (record.Status.IsTerminal())
            {
                return;
            }

            // Anchored to the durable SubmittedAtUtc (see NativeStaleTimeout):
            // a process restart never resets this clock.
            if (NativeTable.NativeStaleTimeout.IsStale(record.SubmittedAtUtc, System.DateTime.UtcNow, _config.OrderStaleTimeoutMinutes))
            {
                Transition(record, OrderStatus.Uncertain,
                    "Native table submission was not confirmed within the stale timeout. There is no proven " +
                    "native readback contract yet (live transport disabled pending Front evidence), and PLU/qty " +
                    "coincidence is never used as proof — so the outcome is Uncertain, not a claimed success or " +
                    "failure. Verify on the native IdealPOS table/bill; do not resubmit under a new externalOrderId " +
                    "without first confirming no duplicate exists.");
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

        /// <summary>
        /// STAGE 1 — pre-transfer anchoring. Deterministic, and the part that
        /// actually works today.
        ///
        /// Finds this order's own pending sale in IPSTransaction by the code
        /// native Idealpos gives it ("WB" + OrderReference) and captures the
        /// immutable ID. Replaces a lookup on PendingSales.Reference, which
        /// is NULL for every Webit-ingested order and therefore never matched
        /// anything (DL-112 §4).
        ///
        /// Critically, this does NOT transition to AssignedToTable. The row
        /// found here is a web-order sale, not a table sale, and the two are
        /// in different databases — see ObserveTableLink.
        /// </summary>
        private void ObserveAnchor(OrderRecord record)
        {
            string expectedCode = Reconciliation.BuildNativeWebCode(record.IdealposWebReference);
            if (expectedCode == null)
            {
                Logger.Warn("watcher_anchor_no_web_reference", Logger.F("externalOrderId", record.ExternalOrderId));
                return;
            }

            PendingSaleRow sale = _repo.GetPendingSaleByNativeCode(expectedCode);
            if (!Reconciliation.IsAnchorMatch(sale, expectedCode))
            {
                // Leave status at Processed — do not guess. Logged at Debug so
                // it doesn't spam Info-level logs every poll interval while
                // native Idealpos has simply not materialised the sale yet.
                List<PendingSaleRow> recent = _repo.GetRecentPendingSales(record.SubmittedAtUtc.AddMinutes(-1), 5);
                Logger.Debug("watcher_no_anchor_match_yet",
                    Logger.F("externalOrderId", record.ExternalOrderId),
                    Logger.F("expectedNativeCode", expectedCode),
                    Logger.F("recentPendingSalesCount", recent.Count));
                return;
            }

            record.PendingSalesId = sale.Id;
            record.PendingSalesCode = sale.Code;
            record.AnchoredAtUtc = DateTime.UtcNow;

            // Explicitly NOT set here. The anchor says nothing about a table,
            // and leaving this null is the honest representation of "not yet
            // determined" — setting it false would imply we checked a table
            // and it did not match.
            record.TableMatchesRequest = null;

            Logger.Info("order_anchored",
                Logger.F("externalOrderId", record.ExternalOrderId),
                Logger.F("ipsPendingSaleId", sale.Id),
                Logger.F("ipsPendingSaleCode", sale.Code));

            Transition(record, OrderStatus.AnchoredInIdealpos, null);
        }

        /// <summary>
        /// STAGE 2 — cross-store table linkage.
        ///
        /// Resolves the POSServer.dbo.PendingSales TABLE sale for the
        /// requested table and, only if that resolves, promotes the order to
        /// AssignedToTable. The IPSTransaction anchor ID is deliberately not
        /// carried across: the stores' ID spaces are disjoint, so the linkage
        /// is by table code (DL-112 §A4b).
        ///
        /// On the installed build this cannot succeed, and that is the
        /// expected outcome rather than a defect: no supported native path
        /// converts a WB* sale into a POSServer table sale (DL-112 §A3).
        /// The method is written and tested now so that the moment the vendor
        /// answers DL-111 Q7/Q8 the remaining work is configuration, not
        /// design — and so that nothing in the meantime quietly claims a
        /// table that was never assigned.
        /// </summary>
        private void ObserveTableLink(OrderRecord record)
        {
            if (_posServerRepo == null)
            {
                // Disabled, not negative. Logged at Debug, and the record is
                // left untouched so nothing reads as a checked-and-failed
                // table match.
                Logger.Debug("watcher_cross_store_disabled",
                    Logger.F("externalOrderId", record.ExternalOrderId));
                return;
            }

            string reason;
            PosServerPendingSaleRow tableSale = Reconciliation.SelectTableSale(
                _posServerRepo.GetOpenTableSales(), record.RequestedTable, out reason);

            if (tableSale == null)
            {
                Logger.Debug("watcher_no_table_link_yet",
                    Logger.F("externalOrderId", record.ExternalOrderId),
                    Logger.F("requestedTable", record.RequestedTable),
                    Logger.F("reason", reason));
                return;
            }

            if (!Reconciliation.ConfirmsRequestedTable(tableSale, record.RequestedTable))
            {
                Logger.Warn("table_mismatch",
                    Logger.F("externalOrderId", record.ExternalOrderId),
                    Logger.F("requestedTable", record.RequestedTable),
                    Logger.F("posServerPendingSaleCode", tableSale.Code));
                return;
            }

            record.PosServerPendingSaleId = tableSale.Id;
            record.PosServerPendingSaleCode = tableSale.Code;
            record.TableMatchesRequest = true;

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
            // Watch the row that actually represents the open table sale. An
            // order only reaches AssignedToTable via a resolved POSServer row,
            // so that is the one whose disappearance means the table closed —
            // watching the IPSTransaction anchor instead would be watching the
            // wrong database for this question.
            if (!string.IsNullOrWhiteSpace(record.PosServerPendingSaleCode))
            {
                if (_posServerRepo == null) return; // cannot observe; say nothing rather than infer

                // By CODE, deliberately, not by the captured POSServer ID.
                // POSServer's TABLEDATA handler services an ordinary table
                // update by deleting the row and inserting a fresh one, so the
                // ID changes whenever staff touch the table. Checking the ID
                // would report "row gone" on a routine edit and this method
                // would then declare the order paid and closed mid-service.
                if (_posServerRepo.TableSaleIsOpen(record.PosServerPendingSaleCode)) return; // still open

                Transition(record, OrderStatus.Paid, null);
                Transition(record, OrderStatus.Closed,
                    "Heuristic: no open POSServer.dbo.PendingSales row remains for table '" +
                    record.PosServerPendingSaleCode + "', inferred as paid+closed. Not directly " +
                    "confirmed against native IPS.exe behaviour — see README.md.");
                return;
            }

            if (!record.PendingSalesId.HasValue) return;
            if (_repo.GetPendingSaleById(record.PendingSalesId.Value) != null) return; // still open

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
