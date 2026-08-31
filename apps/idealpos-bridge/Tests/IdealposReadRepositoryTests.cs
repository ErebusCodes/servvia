using System.Collections.Generic;
using VerduraIdealposBridge.Idealpos;

namespace VerduraIdealposBridge.Tests
{
    /// <summary>
    /// Covers IdealposReadRepository.ResolveTableIdentifier and
    /// IsRealProductCode ÔÇö the pure-logic pieces of that class (everything
    /// else touches SQL Server directly and needs a real/disposable database,
    /// out of scope for this dependency-free suite). Both were extracted
    /// while root-causing real, live DUNEDIN behaviour on 2026-08-26.
    /// </summary>
    public static class IdealposReadRepositoryTests
    {
        public static IEnumerable<TestResult> RunAll()
        {
            yield return Assert.Run("ResolveTableIdentifier: uses Caption when non-blank", () =>
            {
                string result = IdealposReadRepository.ResolveTableIdentifier("12", code: 1, index: 5);
                Assert.AreEqual("12", result, "should prefer the real Caption over the fallback");
            });

            yield return Assert.Run("ResolveTableIdentifier: falls back to Code-Index when Caption is empty", () =>
            {
                string result = IdealposReadRepository.ResolveTableIdentifier("", code: 1, index: 5);
                Assert.AreEqual("1-5", result, "empty Caption should fall back to \"{Code}-{Index}\"");
            });

            yield return Assert.Run("ResolveTableIdentifier: falls back to Code-Index when Caption is whitespace-only", () =>
            {
                string result = IdealposReadRepository.ResolveTableIdentifier("   ", code: 1, index: 19);
                Assert.AreEqual("1-19", result, "whitespace-only Caption should be treated the same as empty");
            });

            yield return Assert.Run("ResolveTableIdentifier: falls back to Code-Index when Caption is null", () =>
            {
                string result = IdealposReadRepository.ResolveTableIdentifier(null, code: 2, index: 3);
                Assert.AreEqual("2-3", result, "null Caption should fall back the same way as empty");
            });

            yield return Assert.Run("ResolveTableIdentifier: fallback stays unique across different real DUNEDIN table indices", () =>
            {
                var seen = new HashSet<string>();
                for (int index = 1; index <= 19; index++)
                {
                    string result = IdealposReadRepository.ResolveTableIdentifier("", code: 1, index: index);
                    Assert.IsTrue(seen.Add(result), "fallback identifier collided for index " + index + " ÔÇö must stay unique per table");
                }
                Assert.AreEqual(19, seen.Count, "all 19 real DUNEDIN table indices must resolve to distinct identifiers");
            });

            yield return Assert.Run("ResolveTableIdentifier: does not silently collide two blank-caption tables under different areas", () =>
            {
                string tableInArea1 = IdealposReadRepository.ResolveTableIdentifier("", code: 1, index: 5);
                string tableInArea2 = IdealposReadRepository.ResolveTableIdentifier("", code: 2, index: 5);
                Assert.IsTrue(tableInArea1 != tableInArea2, "same Index under a different Code (floor-plan area) must not collide");
            });

            yield return Assert.Run("IsRealProductCode: accepts a plain positive integer code", () =>
            {
                Assert.IsTrue(IdealposReadRepository.IsRealProductCode("510"), "a real numeric StockItems.Code must be accepted");
            });

            yield return Assert.Run("IsRealProductCode: accepts zero", () =>
            {
                Assert.IsTrue(IdealposReadRepository.IsRealProductCode("0"), "Code 0 is a valid integer and must not be treated specially");
            });

            yield return Assert.Run("IsRealProductCode: rejects the real 'Deleted' placeholder row", () =>
            {
                Assert.IsTrue(!IdealposReadRepository.IsRealProductCode("Deleted"), "IdealPOS's own 'Deleted Deleted Deleted Stock Items' placeholder row must never be treated as a real product");
            });

            yield return Assert.Run("IsRealProductCode: rejects blank/whitespace/null", () =>
            {
                Assert.IsTrue(!IdealposReadRepository.IsRealProductCode(""), "empty code must be rejected");
                Assert.IsTrue(!IdealposReadRepository.IsRealProductCode("   "), "whitespace-only code must be rejected");
                Assert.IsTrue(!IdealposReadRepository.IsRealProductCode(null), "null code must be rejected");
            });

            yield return Assert.Run("IsRealProductCode: rejects a negative number", () =>
            {
                Assert.IsTrue(!IdealposReadRepository.IsRealProductCode("-1"), "a negative code is not a real StockItems.Code shape seen in live data and must fail closed");
            });
        }
    }
}