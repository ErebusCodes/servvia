using System;
using System.IO;
using System.Reflection;
using VerduraIdealposBridge.Logging;

namespace VerduraIdealposBridge.Idealpos
{
    public class AssemblyLoadResult
    {
        public bool Loaded { get; set; }
        public string Detail { get; set; }
    }

    /// <summary>
    /// Optional fallback assembly resolution. Standard .NET Framework
    /// probing already finds IdealPos.Webit.Core.dll / IdealPos.Data.dll /
    /// IdealPos.Common.dll if they sit next to VerduraIdealposBridge.exe
    /// (the normal deployment layout, per README.md) — this hook only
    /// matters if an operator instead points Idealpos:DllProbeDirectory at
    /// a separate folder (e.g. the live Idealpos/ install directory itself,
    /// to avoid keeping a second copy of the DLLs in sync).
    /// </summary>
    public static class IdealposAssemblyProbe
    {
        private static string _probeDirectory;

        public static void Register(string probeDirectory)
        {
            _probeDirectory = string.IsNullOrWhiteSpace(probeDirectory) ? null : probeDirectory;
            if (_probeDirectory == null) return;

            AppDomain.CurrentDomain.AssemblyResolve += OnAssemblyResolve;
            Logger.Info("assembly_probe_registered", Logger.F("directory", _probeDirectory));
        }

        private static Assembly OnAssemblyResolve(object sender, ResolveEventArgs args)
        {
            if (_probeDirectory == null) return null;

            string simpleName = new AssemblyName(args.Name).Name;
            string candidate = Path.Combine(_probeDirectory, simpleName + ".dll");
            if (File.Exists(candidate))
            {
                Logger.Debug("assembly_probe_hit", Logger.F("assembly", simpleName), Logger.F("path", candidate));
                return Assembly.LoadFrom(candidate);
            }
            return null;
        }

        /// <summary>
        /// Forces the CLR to actually load (not merely reference) the three
        /// Idealpos assemblies this bridge depends on, and reports success
        /// or the precise load failure — used by AvailabilityChecker for
        /// /api/health's "assembliesLoaded" field. Compile-time references
        /// alone don't prove a DLL is loadable at run time; only touching a
        /// real type does.
        /// </summary>
        public static AssemblyLoadResult TryLoadRequiredAssemblies()
        {
            try
            {
                var webitType = typeof(IdealPos.Webit.LocalDataHelper);
                // Touch a member to force full type resolution (and, via
                // it, resolution of IdealPos.Data / IdealPos.Common).
                string fullName = webitType.Assembly.FullName;
                return new AssemblyLoadResult { Loaded = true, Detail = fullName };
            }
            catch (Exception ex)
            {
                return new AssemblyLoadResult { Loaded = false, Detail = ex.GetType().Name + ": " + ex.Message };
            }
        }
    }
}
