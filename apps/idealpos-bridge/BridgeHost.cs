using System;
using VerduraIdealposBridge.Api;
using VerduraIdealposBridge.Config;
using VerduraIdealposBridge.Http;
using VerduraIdealposBridge.Idealpos;
using VerduraIdealposBridge.Logging;
using VerduraIdealposBridge.Orders;
using VerduraIdealposBridge.Realtime;

namespace VerduraIdealposBridge
{
    /// <summary>
    /// Wires every piece together and owns Start/Stop. Used identically by
    /// Program.cs's console mode and by BridgeService.cs's Windows Service
    /// mode, so "run interactively for testing" and "run as a service in
    /// production" are exactly the same code path.
    /// </summary>
    public class BridgeHost
    {
        private HttpServer _http;
        private OrderLifecycleWatcher _watcher;
        private OrderStateStore _store;

        public void Start()
        {
            BridgeConfig config = BridgeConfig.Load();
            Logger.Init(config.LogDirectory, config.MinLogLevel, echoToConsole: Environment.UserInteractive);
            Logger.Info("bridge_starting",
                Logger.F("bindAddress", config.BindAddress),
                Logger.F("port", config.Port),
                Logger.F("allowLan", config.AllowLan),
                Logger.F("tableAssignmentStrategy", config.TableAssignmentStrategyName),
                Logger.F("tableAssignmentConfirmed", config.TableAssignmentConfirmed),
                Logger.F("canAssignNativeTableViaWebit", TableAssignmentCapability.CanAssignNativeTableViaWebit),
                Logger.F("tableAssignmentEffect", TableAssignmentCapability.DescribeEffect(config.TableAssignmentStrategyName)));
            if (TableAssignmentCapability.IsMisleading(config.TableAssignmentStrategyName))
            {
                // Loud, because these two do not merely fail to assign a
                // table — Message prints one on the kitchen docket that was
                // never assigned, and ReferencePrefix moves the pending-sale
                // code reconciliation anchors on.
                Logger.Warn("table_assignment_strategy_is_misleading",
                    Logger.F("strategy", config.TableAssignmentStrategyName),
                    Logger.F("effect", TableAssignmentCapability.DescribeEffect(config.TableAssignmentStrategyName)));
            }

            if (!string.IsNullOrWhiteSpace(config.DllProbeDirectory))
            {
                IdealposAssemblyProbe.Register(config.DllProbeDirectory);
            }

            var repo = new IdealposReadRepository(config.IpsConnectionString);
            var submitter = new IdealposOrderSubmitter();
            var hub = new WebSocketHub();

            // Null unless PosServerConnection is configured. Logged either way
            // so the operator can see from the log which reconciliation mode
            // the bridge is actually running in, rather than inferring it from
            // the absence of table transitions.
            PosServerReadRepository posServerRepo = null;
            if (config.CrossStoreReconciliationEnabled)
            {
                posServerRepo = new PosServerReadRepository(config.PosServerConnectionString);
                string detail;
                bool reachable = posServerRepo.CanConnect(out detail);
                Logger.Info("cross_store_reconciliation_enabled", Logger.F("posServerReachable", reachable), Logger.F("detail", detail));
            }
            else
            {
                Logger.Info("cross_store_reconciliation_disabled",
                    Logger.F("reason", "no PosServerConnection in App.config — orders will anchor in IPSTransaction and stop there"));
            }

            _store = new OrderStateStore(config.StateDatabasePath);
            var orderService = new OrderService(config, _store, repo, submitter, hub);

            _watcher = new OrderLifecycleWatcher(config, _store, repo, orderService, posServerRepo);
            _watcher.Start();

            var availability = new AvailabilityChecker(config, repo);
            var healthEndpoint = new HealthEndpoint(availability, hub);
            var productsEndpoint = new ProductsEndpoint(repo);
            var tablesEndpoint = new TablesEndpoint(repo);
            var ordersEndpoint = new OrdersEndpoint(orderService);

            _http = new HttpServer(config, hub);
            _http.MapGet("/api/health", healthEndpoint.Handle);
            _http.MapGet("/api/products", productsEndpoint.Handle);
            _http.MapGet("/api/tables", tablesEndpoint.Handle);
            _http.MapPost("/api/orders", ordersEndpoint.HandleSubmit);
            _http.MapGet("/api/orders/{externalOrderId}", ordersEndpoint.HandleGetStatus);
            _http.MapWebSocket("/ws/orders");
            _http.Start();

            // Fail loudly, once, at startup if Idealpos isn't reachable at
            // all — the bridge still starts (so /api/health itself is
            // reachable to report why), but this makes the condition
            // impossible to miss in the log.
            HealthReport initial = availability.Check();
            if (!initial.OrderProcessingPathAvailable)
            {
                Logger.Warn("bridge_started_with_idealpos_unavailable", Logger.F("reasons", string.Join(" | ", initial.Reasons)));
            }
            else
            {
                Logger.Info("bridge_started_idealpos_available");
            }
        }

        public void Stop()
        {
            Logger.Info("bridge_stopping");
            _http?.Stop();
            _watcher?.Dispose();
        }
    }
}
