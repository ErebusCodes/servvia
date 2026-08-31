using System;
using System.Diagnostics;
using System.IO;
using VerduraIdealposBridge.Config;

namespace VerduraIdealposBridge.Idealpos
{
    public class HealthReport
    {
        public bool BridgeRunning { get; set; } = true;
        public string BridgeVersion { get; set; }
        public bool SqlConnected { get; set; }
        public string SqlDetail { get; set; }
        public bool AssembliesLoaded { get; set; }
        public string AssembliesDetail { get; set; }
        public bool IpsExeRunning { get; set; }
        public bool IpsExePathExists { get; set; }
        public string TableAssignmentStrategy { get; set; }
        public bool TableAssignmentConfirmed { get; set; }
        public bool OrderProcessingPathAvailable { get; set; }
        public string[] Reasons { get; set; }
    }

    /// <summary>
    /// The distinction this class exists for: "the bridge process is
    /// running" is not the same claim as "Idealpos is ready to accept
    /// orders". /api/health must never report the latter just because the
    /// former is true.
    /// </summary>
    public class AvailabilityChecker
    {
        private readonly BridgeConfig _config;
        private readonly IdealposReadRepository _repo;

        public AvailabilityChecker(BridgeConfig config, IdealposReadRepository repo)
        {
            _config = config;
            _repo = repo;
        }

        public HealthReport Check()
        {
            var reasons = new System.Collections.Generic.List<string>();
            var report = new HealthReport
            {
                BridgeVersion = typeof(AvailabilityChecker).Assembly.GetName().Version.ToString(),
                TableAssignmentStrategy = _config.TableAssignmentStrategyName,
                TableAssignmentConfirmed = _config.TableAssignmentConfirmed,
            };

            string sqlDetail;
            report.SqlConnected = _repo.CanConnect(out sqlDetail);
            report.SqlDetail = sqlDetail;
            if (!report.SqlConnected) reasons.Add("SQL Server unreachable: " + sqlDetail);

            AssemblyLoadResult asmResult = IdealposAssemblyProbe.TryLoadRequiredAssemblies();
            report.AssembliesLoaded = asmResult.Loaded;
            report.AssembliesDetail = asmResult.Detail;
            if (!report.AssembliesLoaded) reasons.Add("Idealpos assemblies failed to load: " + asmResult.Detail);

            report.IpsExeRunning = Process.GetProcessesByName("IPS").Length > 0;
            if (!report.IpsExeRunning) reasons.Add("No process named 'IPS' found — native Idealpos does not appear to be running.");

            report.IpsExePathExists = !string.IsNullOrWhiteSpace(_config.ExpectedIpsExePath) && File.Exists(_config.ExpectedIpsExePath);

            if (!report.TableAssignmentConfirmed)
            {
                reasons.Add("Table-assignment strategy '" + _config.TableAssignmentStrategyName + "' is configured but not " +
                            "yet confirmed (Idealpos:TableAssignmentConfirmed=false) — run VerduraIdealposHarness against " +
                            "this Idealpos version first. Orders will still be submitted, but automatic table assignment " +
                            "is unproven; watch for orders stuck at 'processed' without advancing to 'assigned_to_table'.");
            }

            report.OrderProcessingPathAvailable = report.SqlConnected && report.AssembliesLoaded && report.IpsExeRunning;
            if (!report.OrderProcessingPathAvailable && reasons.Count == 0)
            {
                reasons.Add("Order-processing path unavailable for an unspecified reason.");
            }

            report.Reasons = reasons.ToArray();
            return report;
        }
    }
}
