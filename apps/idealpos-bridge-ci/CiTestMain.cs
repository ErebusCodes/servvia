// CI-ONLY entry point — not part of the shipped bridge.
//
// Runs the three self-test suites that do not touch the proprietary
// IdealPos.Webit vendor DLL, so they can execute unattended on a CI
// windows-latest runner that has no Idealpos installation. The other two
// suites (TableAssignmentStrategyTests, IdealposOrderSubmitterTests) are
// vendor-typed and stay local-only; see this project's README and the
// governance guard in scripts/check-bridge-governance.mjs, which fails
// CI if that split is ever changed without updating the recorded inventory.
//
// ExpectedTestCount is a deliberate pin, not a guess: a suite that silently
// loses tests still reports "0 failed", so a bare pass/fail assertion would
// not catch deletion. Adding or removing a covered test must therefore be a
// conscious edit here and in bridge-test-inventory.json.
using System;
using System.Collections.Generic;
using VerduraIdealposBridge.Tests;

namespace VerduraIdealposBridge.Ci
{
    public static class CiTestMain
    {
        private const int ExpectedTestCount = 84;

        public static int Main()
        {
            var results = new List<TestResult>();
            results.AddRange(OrderValidatorTests.RunAll());
            results.AddRange(OrderStatusTests.RunAll());
            results.AddRange(IdealposReadRepositoryTests.RunAll());
            results.AddRange(ReconciliationTests.RunAll());
            results.AddRange(TableAssignmentCapabilityTests.RunAll());
            results.AddRange(NativeTableRoundTests.RunAll());

            int passed = 0, failed = 0;
            foreach (var r in results)
            {
                Console.WriteLine((r.Passed ? "PASS  " : "FAIL  ") + r.Name + (r.Passed ? "" : "  -- " + r.Detail));
                if (r.Passed) passed++; else failed++;
            }

            Console.WriteLine();
            Console.WriteLine(passed + " passed, " + failed + " failed (" + results.Count + " executed).");

            if (results.Count != ExpectedTestCount)
            {
                Console.Error.WriteLine(
                    "TEST INVENTORY CHANGED: expected " + ExpectedTestCount + " CI-covered tests but executed " +
                    results.Count + ". A test was added or removed. If intentional, update ExpectedTestCount here " +
                    "and the matching counts in scripts/bridge-test-inventory.json.");
                return 2;
            }

            return failed == 0 ? 0 : 1;
        }
    }
}
