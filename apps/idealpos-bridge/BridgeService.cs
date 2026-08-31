using System.ServiceProcess;
using VerduraIdealposBridge.Logging;

namespace VerduraIdealposBridge
{
    /// <summary>
    /// Windows Service wrapper. See deploy/install-service.ps1 for exact
    /// sc.exe/New-Service commands and README.md "Windows Service" for the
    /// service-account discussion (Trusted_Connection=True means the
    /// account this service runs as IS the SQL Server login).
    /// </summary>
    public class BridgeService : ServiceBase
    {
        private readonly BridgeHost _host = new BridgeHost();

        public BridgeService()
        {
            ServiceName = "VerduraIdealposBridge";
            AutoLog = true;
        }

        protected override void OnStart(string[] args)
        {
            try
            {
                _host.Start();
            }
            catch (System.Exception ex)
            {
                // AutoLog writes this to the Windows Application event log
                // too, which is where a service that fails to start needs
                // to be visible — a console-only error would be invisible.
                Logger.Error("service_start_failed", ex);
                throw;
            }
        }

        protected override void OnStop()
        {
            _host.Stop();
        }
    }
}
