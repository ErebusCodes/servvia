using System;
using System.Configuration;
using System.IO;

namespace VerduraIdealposBridge.Config
{
    /// <summary>
    /// Typed, fail-closed reader over App.config. Nothing in this class
    /// invents a default for a setting that matters to safety or
    /// correctness — see individual property comments.
    /// </summary>
    public class BridgeConfig
    {
        public string IpsConnectionString { get; private set; }

        /// <summary>
        /// Optional. Read-only connection to the POSServer database, which
        /// holds native TABLE sales — a different database from IPSTransaction
        /// (DL-112 §A4b).
        ///
        /// Null when unconfigured, and that is the supported default: without
        /// it the bridge anchors web orders in IPSTransaction and stops there,
        /// which is exactly as far as the installed build can honestly go.
        /// Configuring it enables cross-store table resolution; it does not
        /// enable any write, and no supported native conversion exists to
        /// produce a row for it to find yet (DL-111 Q7/Q8).
        /// </summary>
        public string PosServerConnectionString { get; private set; }

        public bool CrossStoreReconciliationEnabled
        {
            get { return !string.IsNullOrWhiteSpace(PosServerConnectionString); }
        }
        public string BindAddress { get; private set; }
        public int Port { get; private set; }
        public bool AllowLan { get; private set; }
        public string ApiKey { get; private set; }
        public string[] CorsAllowedOrigins { get; private set; }
        public string DllProbeDirectory { get; private set; }
        public string ExpectedIpsExePath { get; private set; }
        public int PollingIntervalSeconds { get; private set; }
        public int OrderStaleTimeoutMinutes { get; private set; }
        public string TableAssignmentStrategyName { get; private set; }
        public bool TableAssignmentConfirmed { get; private set; }
        public string StateDatabasePath { get; private set; }
        public string LogDirectory { get; private set; }
        public string MinLogLevel { get; private set; }

        public string BaseDirectory { get; private set; }

        public static BridgeConfig Load()
        {
            var cfg = new BridgeConfig();
            cfg.BaseDirectory = AppDomain.CurrentDomain.BaseDirectory;

            var connEntry = ConfigurationManager.ConnectionStrings["IpsConnection"];
            if (connEntry == null || string.IsNullOrWhiteSpace(connEntry.ConnectionString))
            {
                throw new ConfigurationErrorsException(
                    "No 'IpsConnection' connection string in App.config. Refusing to fall back " +
                    "to IdealPos.Webit.Core.dll's own hardcoded default, which would also match " +
                    "a live production POS Server. Configure it explicitly.");
            }
            if (connEntry.ConnectionString.IndexOf("CHANGE_ME", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                throw new ConfigurationErrorsException(
                    "App.config's IpsConnection still contains the placeholder 'CHANGE_ME_TEST_SERVER'. " +
                    "Point it at your disposable test SQL Server (or, once fully validated, production) " +
                    "before starting the bridge.");
            }
            cfg.IpsConnectionString = connEntry.ConnectionString;

            // Optional, unlike IpsConnection: absent means cross-store
            // reconciliation is off, which is a valid and currently correct
            // configuration. A present-but-placeholder value is rejected
            // rather than treated as absent — that would silently disable a
            // feature the operator believed they had turned on.
            var posServerEntry = ConfigurationManager.ConnectionStrings["PosServerConnection"];
            if (posServerEntry != null && !string.IsNullOrWhiteSpace(posServerEntry.ConnectionString))
            {
                if (posServerEntry.ConnectionString.IndexOf("CHANGE_ME", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    throw new ConfigurationErrorsException(
                        "App.config's PosServerConnection still contains a 'CHANGE_ME' placeholder. " +
                        "Either point it at the POSServer database or remove the entry entirely to " +
                        "leave cross-store reconciliation disabled.");
                }
                cfg.PosServerConnectionString = posServerEntry.ConnectionString;
            }

            cfg.BindAddress = GetString("Bridge:BindAddress", "127.0.0.1");
            cfg.Port = GetInt("Bridge:Port", 5588);
            cfg.AllowLan = GetBool("Bridge:AllowLan", false);

            bool isLoopback = cfg.BindAddress == "127.0.0.1" || cfg.BindAddress == "localhost" || cfg.BindAddress == "::1";
            if (!isLoopback && !cfg.AllowLan)
            {
                throw new ConfigurationErrorsException(
                    "Bridge:BindAddress is '" + cfg.BindAddress + "' (not loopback) but Bridge:AllowLan " +
                    "is not 'true'. Refusing to start rather than silently exposing this API on the " +
                    "network. Set Bridge:AllowLan=true only after reading README.md 'Security'.");
            }

            cfg.ApiKey = GetString("Bridge:ApiKey", "");
            if (string.IsNullOrWhiteSpace(cfg.ApiKey))
            {
                throw new ConfigurationErrorsException(
                    "Bridge:ApiKey is not set in App.config. This API controls a restaurant's order " +
                    "pipeline and must not run unauthenticated. Set a real key (e.g. a GUID) before " +
                    "starting the bridge.");
            }

            string corsRaw = GetString("Bridge:CorsAllowedOrigins", "");
            cfg.CorsAllowedOrigins = string.IsNullOrWhiteSpace(corsRaw)
                ? new string[0]
                : Array.ConvertAll(corsRaw.Split(','), s => s.Trim());

            cfg.DllProbeDirectory = GetString("Idealpos:DllProbeDirectory", "");
            cfg.ExpectedIpsExePath = GetString("Idealpos:ExpectedIpsExePath", "");
            cfg.PollingIntervalSeconds = GetInt("Idealpos:PollingIntervalSeconds", 5);
            cfg.OrderStaleTimeoutMinutes = GetInt("Idealpos:OrderStaleTimeoutMinutes", 15);

            cfg.TableAssignmentStrategyName = GetString("Idealpos:TableAssignmentStrategy", "");
            if (string.IsNullOrWhiteSpace(cfg.TableAssignmentStrategyName))
            {
                throw new ConfigurationErrorsException(
                    "Idealpos:TableAssignmentStrategy is not set in App.config. No table-assignment " +
                    "field on WebOrder is confirmed to work without running VerduraIdealposHarness " +
                    "first (see the investigation's Section K.2). Run the harness, pick the strategy " +
                    "that worked (NoHint / DeliverTo / Message / ReferencePrefix / HostReference), and " +
                    "set it explicitly. Refusing to guess.");
            }
            cfg.TableAssignmentConfirmed = GetBool("Idealpos:TableAssignmentConfirmed", false);

            cfg.StateDatabasePath = ResolvePath(cfg.BaseDirectory, GetString("Bridge:StateDatabasePath", "state\\bridge-state.sqlite"));
            cfg.LogDirectory = ResolvePath(cfg.BaseDirectory, GetString("Logging:Directory", "logs"));
            cfg.MinLogLevel = GetString("Logging:MinLevel", "Info");

            return cfg;
        }

        private static string ResolvePath(string baseDir, string maybeRelative)
        {
            if (string.IsNullOrWhiteSpace(maybeRelative)) return maybeRelative;
            return Path.IsPathRooted(maybeRelative) ? maybeRelative : Path.Combine(baseDir, maybeRelative);
        }

        private static string GetString(string key, string fallback)
        {
            string v = ConfigurationManager.AppSettings[key];
            return string.IsNullOrEmpty(v) ? fallback : v;
        }

        private static int GetInt(string key, int fallback)
        {
            string v = ConfigurationManager.AppSettings[key];
            int result;
            return (!string.IsNullOrEmpty(v) && int.TryParse(v, out result)) ? result : fallback;
        }

        private static bool GetBool(string key, bool fallback)
        {
            string v = ConfigurationManager.AppSettings[key];
            bool result;
            return (!string.IsNullOrEmpty(v) && bool.TryParse(v, out result)) ? result : fallback;
        }
    }
}
