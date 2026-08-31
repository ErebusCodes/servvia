// CI-ONLY MIRROR — not part of the shipped bridge, never compiled into
// VerduraIdealposBridge.exe.
//
// Tests/TestRunner.cs holds three types in one file: TestRunner (which calls
// all five suites, two of which need the proprietary IdealPos.Webit vendor
// DLL) plus the TestResult/Assert helpers that every suite depends on. A
// GitHub runner has no vendor DLL, so the CI project cannot compile
// TestRunner.cs at all — and C# gives no way to include part of a file.
//
// The block below is therefore a byte-for-byte copy of the TestResult+Assert
// region of Tests/TestRunner.cs. It is NOT allowed to drift: CI runs
// `npm run check:bridge-governance`, which re-extracts that region from
// TestRunner.cs and fails the build if the two are not byte-identical. Edit
// Tests/TestRunner.cs, then re-sync this file — never the other way round.
using System;

namespace VerduraIdealposBridge.Tests
{
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
