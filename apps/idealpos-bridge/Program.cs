using System;
using System.ServiceProcess;
using VerduraIdealposBridge.Tests;

namespace VerduraIdealposBridge
{
    public static class Program
    {
        private static void Main(string[] args)
        {
            if (args.Length > 0 && string.Equals(args[0], "--selftest", StringComparison.OrdinalIgnoreCase))
            {
                // Pure-logic tests only (validator, idempotency-key
                // derivation, strategy factory) — no SQL Server, no
                // Idealpos DLLs, no Windows Service involved. See
                // Tests/README in this folder and Tests/TestRunner.cs.
                int failures = TestRunner.RunAll();
                Environment.Exit(failures == 0 ? 0 : 1);
                return;
            }

            bool forceConsole = args.Length > 0 && string.Equals(args[0], "--console", StringComparison.OrdinalIgnoreCase);

            if (Environment.UserInteractive || forceConsole)
            {
                RunInteractive();
            }
            else
            {
                ServiceBase.Run(new ServiceBase[] { new BridgeService() });
            }
        }

        private static void RunInteractive()
        {
            var host = new BridgeHost();
            try
            {
                host.Start();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine();
                Console.WriteLine("FAILED TO START");
                Console.WriteLine(ex);
                Console.ResetColor();
                Environment.Exit(1);
                return;
            }

            Console.WriteLine();
            Console.WriteLine("VerduraIdealposBridge is running. Press Ctrl+C to stop.");
            var stopSignal = new System.Threading.ManualResetEventSlim(false);
            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                stopSignal.Set();
            };
            stopSignal.Wait();

            host.Stop();
        }
    }
}
