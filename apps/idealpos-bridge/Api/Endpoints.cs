using System;
using System.Net;
using VerduraIdealposBridge.Http;
using VerduraIdealposBridge.Idealpos;
using VerduraIdealposBridge.Logging;
using VerduraIdealposBridge.Orders;
using VerduraIdealposBridge.Realtime;

namespace VerduraIdealposBridge.Api
{
    /// <summary>GET /api/health — see AvailabilityChecker for the
    /// "bridge running" vs "Idealpos ready" distinction this deliberately
    /// preserves.</summary>
    public class HealthEndpoint
    {
        private readonly AvailabilityChecker _checker;
        private readonly WebSocketHub _hub;

        public HealthEndpoint(AvailabilityChecker checker, WebSocketHub hub)
        {
            _checker = checker;
            _hub = hub;
        }

        public void Handle(HttpListenerContext ctx, RouteParams routeParams)
        {
            HealthReport report = _checker.Check();
            ResponseWriter.WriteJson(ctx, 200, new
            {
                bridgeRunning = report.BridgeRunning,
                bridgeVersion = report.BridgeVersion,
                sqlConnected = report.SqlConnected,
                sqlDetail = report.SqlDetail,
                assembliesLoaded = report.AssembliesLoaded,
                assembliesDetail = report.AssembliesDetail,
                ipsExeRunning = report.IpsExeRunning,
                ipsExePathExists = report.IpsExePathExists,
                tableAssignmentStrategy = report.TableAssignmentStrategy,
                tableAssignmentConfirmed = report.TableAssignmentConfirmed,
                orderProcessingPathAvailable = report.OrderProcessingPathAvailable,
                connectedRealtimeClients = _hub.ConnectedClientCount,
                reasons = report.Reasons,
            });
        }
    }

    /// <summary>GET /api/products — Idealpos's own LocalDataHelper.GetIpsStockItemsDic(),
    /// nothing invented. See IdealposReadRepository.GetProducts / ProductDto.</summary>
    public class ProductsEndpoint
    {
        private readonly IdealposReadRepository _repo;
        public ProductsEndpoint(IdealposReadRepository repo) { _repo = repo; }

        public void Handle(HttpListenerContext ctx, RouteParams routeParams)
        {
            try
            {
                var products = _repo.GetProducts();
                ResponseWriter.WriteJson(ctx, 200, products);
            }
            catch (Exception ex)
            {
                Logger.Error("products_endpoint_failed", ex);
                ResponseWriter.WriteJson(ctx, 502, new { error = "idealpos_unavailable", detail = ex.Message });
            }
        }
    }

    /// <summary>GET /api/tables — dbo.TableMapSetups, read-only. See
    /// IdealposReadRepository.GetTables / TableDto (LikelyOccupied is an
    /// explicit heuristic, documented there).</summary>
    public class TablesEndpoint
    {
        private readonly IdealposReadRepository _repo;
        public TablesEndpoint(IdealposReadRepository repo) { _repo = repo; }

        public void Handle(HttpListenerContext ctx, RouteParams routeParams)
        {
            try
            {
                var tables = _repo.GetTables();
                ResponseWriter.WriteJson(ctx, 200, tables);
            }
            catch (Exception ex)
            {
                Logger.Error("tables_endpoint_failed", ex);
                ResponseWriter.WriteJson(ctx, 502, new { error = "idealpos_unavailable", detail = ex.Message });
            }
        }
    }

    /// <summary>POST /api/orders and GET /api/orders/{externalOrderId} —
    /// the only two endpoints that touch order state. No /pay endpoint
    /// exists here or anywhere in this project, deliberately — payment
    /// stays entirely inside Idealpos.</summary>
    public class OrdersEndpoint
    {
        private readonly OrderService _service;
        public OrdersEndpoint(OrderService service) { _service = service; }

        public void HandleSubmit(HttpListenerContext ctx, RouteParams routeParams)
        {
            OrderRequest request;
            try
            {
                request = ResponseWriter.ReadJsonBody<OrderRequest>(ctx);
            }
            catch (Exception ex)
            {
                ResponseWriter.WriteJson(ctx, 400, new { error = "invalid_json", detail = ex.Message });
                return;
            }

            OrderSubmitOutcome outcome = _service.SubmitOrder(request);
            switch (outcome.Kind)
            {
                case OrderSubmitOutcomeKind.ValidationFailed:
                    ResponseWriter.WriteJson(ctx, 400, new { error = "validation_failed", errors = outcome.ValidationErrors });
                    return;

                case OrderSubmitOutcomeKind.Duplicate:
                    // Same externalOrderId seen before: return its current
                    // state, 200 not 201 — this is the idempotency contract,
                    // not an error. No second Idealpos order is created.
                    ResponseWriter.WriteJson(ctx, 200, ToResponseBody(outcome.Record, duplicate: true));
                    return;

                case OrderSubmitOutcomeKind.IdealposSubmissionFailed:
                    ResponseWriter.WriteJson(ctx, 502, new
                    {
                        error = "idealpos_submission_failed",
                        detail = outcome.Error,
                        externalOrderId = outcome.Record?.ExternalOrderId,
                        status = outcome.Record?.Status.ToWireString(),
                    });
                    return;

                case OrderSubmitOutcomeKind.Success:
                    ResponseWriter.WriteJson(ctx, 201, ToResponseBody(outcome.Record, duplicate: false));
                    return;
            }
        }

        public void HandleGetStatus(HttpListenerContext ctx, RouteParams routeParams)
        {
            string externalOrderId = routeParams.Get("externalOrderId");
            OrderRecord record = _service.GetStatus(externalOrderId);
            if (record == null)
            {
                ResponseWriter.WriteJson(ctx, 404, new { error = "not_found", externalOrderId });
                return;
            }
            ResponseWriter.WriteJson(ctx, 200, ToResponseBody(record, duplicate: false));
        }

        private static object ToResponseBody(OrderRecord r, bool duplicate)
        {
            return new
            {
                externalOrderId = r.ExternalOrderId,
                status = r.Status.ToWireString(),
                table = r.RequestedTable,
                idealposWebPendingOrderId = r.WebPendingOrderId,
                // IPSTransaction anchor — the order's own web-order sale.
                // Existing field names kept so this stays wire-compatible;
                // their meaning is unchanged, it is only the (previously
                // wrong) inference drawn from them that changed.
                idealposPendingSaleId = r.PendingSalesId,
                idealposPendingSaleCode = r.PendingSalesCode,
                anchoredAtUtc = r.AnchoredAtUtc,
                // POSServer table sale — a different database. Null until a
                // supported native conversion exists (DL-111 Q7/Q8).
                posServerPendingSaleId = r.PosServerPendingSaleId,
                posServerPendingSaleCode = r.PosServerPendingSaleCode,
                // Null means "not determined yet", NOT "checked and did not
                // match". Only ever true off a resolved POSServer table sale.
                tableMatchesRequest = r.TableMatchesRequest,
                processed = r.Status != OrderStatus.Received && r.Status != OrderStatus.Validated && r.Status != OrderStatus.SubmittedToIdealpos && r.Status != OrderStatus.PendingIdealposProcessing,
                tableOccupiedWarning = r.TableOccupiedWarning,
                strategyUsed = r.StrategyUsed,
                // Reported as a fact, not left for the caller to assume. The
                // Webit contract has no table field, so no strategy assigns a
                // table on this ingest path — see TableAssignmentCapability.
                tableAssignedNatively = TableAssignmentCapability.CanAssignNativeTableViaWebit,
                tableAssignmentEffect = TableAssignmentCapability.DescribeEffect(r.StrategyUsed),
                submittedAtUtc = r.SubmittedAtUtc,
                lastObservedAtUtc = r.LastObservedAtUtc,
                lastError = r.LastError,
                duplicate,
            };
        }
    }
}
