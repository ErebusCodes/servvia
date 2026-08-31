using System;
using System.Collections.Generic;

namespace VerduraIdealposBridge.Tests
{
    /// <summary>
    /// Hand-rolled, dependency-free test runner (no NUnit/xUnit, matching
    /// the project's zero-NuGet policy) for the pieces of this bridge that
    /// are pure logic ��� no SQL Server, no running Idealpos, no Windows
    /// Service required. Run via:
    ///     VerduraIdealposBridge.exe --selftest
    /// Exit code is the number of failed assertions (0 = all passed).
    /// </summary>
    public static class TestRunner
    {
        public static int RunAll()
        {
            var results = new List<TestResult>();
            results.AddRange(OrderValidatorTests.RunAll());
            results.AddRange(TableAssignmentStrategyTests.RunAll());
            results.AddRange(OrderStatusTests.RunAll());
            results.AddRange(IdealposReadRepositoryTests.RunAll());
            results.AddRange(IdealposOrderSubmitterTests.RunAll());

            int passed = 0, failed = 0;
            foreach (var r in results)
            {
                Console.ForegroundColor = r.Passed ? ConsoleColor.Green : ConsoleColor.Red;
                Console.WriteLine((r.Passed ? "PASS  " : "FAIL  ") + r.Name + (r.Passed ? "" : "  -- " + r.Detail));
                Console.ResetColor();
                if (r.Passed) passed++; else failed++;
            }
            Console.WriteLine();
            Console.WriteLine(passed + " passed, " + failed + " failed.");
            return failed;
        }
    }

    public class TestResult
    {
        public string Name;
        public bool Passed;
        public string Detail;

        public static TestResult Pass(string name) => new TestResult { Name = name, Passed = true };
        public static TestResult Fail(string name, string detail) => new TestResult { Name = name, Passed = false, Detail = detail };
    }

    /// <summary>Minimal assertion helpers ��� throws AssertionException, caught
    /// by each test's runner wrapper and turned into a TestResult.</summary>
    public static class Assert
    {
        public class AssertionException : Exception
        {
            public AssertionException(string message) : base(message) { }
        }

        public static void IsTrue(bool condition, string message)
        {
            if (!condition) throw new AssertionException(message);
        }

        public static void AreEqual<T>(T expected, T actual, string context)
        {
            if (!Equals(expected, actual))
            {
                throw new AssertionException(context + ": expected <" + expected + "> but was <" + actual + ">");
            }
        }

        public static TestResult Run(string name, Action test)
        {
            try
            {
                test();
                return TestResult.Pass(name);
            }
            catch (AssertionException ex)
            {
                return TestResult.Fail(name, ex.Message);
            }
            catch (Exception ex)
            {
                return TestResult.Fail(name, "unexpected exception: " + ex);
            }
        }
    }
}