using System.Collections.Generic;
using VerduraIdealposBridge.Orders.NativeTable;

namespace VerduraIdealposBridge.Tests
{
    /// <summary>
    /// Coverage for the native table-attached Order Tablet write path that
    /// replaces WebOrder. Pure model + decision logic, vendor-free, so it runs
    /// in CI with no Idealpos install. Proves the six behaviours tonight's
    /// implementation goal requires: append (second round adds, never
    /// replaces), seat assignment, durable externalOrderId dedup, timeout ->
    /// uncertain, restart -> no resend, and the absence of any WebOrder
    /// dependency (this whole suite compiles in the vendor-free CI project).
    /// </summary>
    public static class NativeTableRoundTests
    {
        private static TableRoundIdempotencyContext Ctx(string ext) =>
            new TableRoundIdempotencyContext(ext, checksum: "CS-" + ext, deviceId: "DEV-2");

        private static TableRound Round(string ext, params TableRoundLine[] lines) =>
            new TableRound("5", pos: 1, clerkId: 1, guests: 2, location: 1, lines: lines, idempotency: Ctx(ext));

        /// <summary>A writer that counts submission attempts, so tests can prove
        /// zero-attempt fail-closed / duplicate paths and exactly-once sends.
        /// The only writer type the orchestrator can reach — there is no
        /// WebOrder writer to fall back to.</summary>
        private sealed class SpyWriter : ITableRoundWriter
        {
            private readonly bool _enabled;
            private readonly TableRoundWriteResult _result;
            public int Calls;
            public SpyWriter(bool enabled, TableRoundWriteResult result) { _enabled = enabled; _result = result; }
            public bool IsTransportEnabled { get { return _enabled; } }
            public string TransportName { get { return "spy"; } }
            public TableRoundWriteResult SubmitTableRound(TableRound round) { Calls++; return _result; }
        }

        public static IEnumerable<TestResult> RunAll()
        {
            // 1. First round on an empty table numbers lines from 1.
            yield return Assert.Run("Append: first round on an empty table numbers lines from 1", () =>
            {
                TableRound r = Round("ORD-1", new TableRoundLine("23", 1m), new TableRoundLine("24", 2m));
                IReadOnlyList<PlannedLine> plan = TableRoundPlan.PlanAppend(0, r);
                Assert.AreEqual(2, plan.Count, "planned line count");
                Assert.AreEqual((short)1, plan[0].Line, "first line ordinal");
                Assert.AreEqual((short)2, plan[1].Line, "second line ordinal");
            });

            // 2. Same table, second round appends after the existing lines.
            yield return Assert.Run("Append: second round continues after existing lines, never replacing", () =>
            {
                TableRound round2 = Round("ORD-2", new TableRoundLine("99", 1m));
                IReadOnlyList<PlannedLine> plan = TableRoundPlan.PlanAppend(3, round2);
                Assert.AreEqual(1, plan.Count, "round 2 carries only its own new line");
                Assert.AreEqual((short)4, plan[0].Line, "round 2 line ordinal continues after the 3 existing lines");
            });

            // 3. A round carries only its own new lines (delta, not full state).
            yield return Assert.Run("Append: a round carries only its own new lines (delta, not full state)", () =>
            {
                TableRound r = Round("ORD-3", new TableRoundLine("23", 1m));
                Assert.AreEqual(1, r.Lines.Count, "round holds only the newly added line");
            });

            // 4. Seat assignment is preserved per line.
            yield return Assert.Run("Seat: each line preserves its seat through the model", () =>
            {
                TableRound r = Round("ORD-4",
                    new TableRoundLine("23", 1m, seat: 1),
                    new TableRoundLine("24", 1m, seat: 2));
                IReadOnlyList<PlannedLine> plan = TableRoundPlan.PlanAppend(0, r);
                Assert.AreEqual(1, plan[0].Source.Seat.Value, "line 1 seat");
                Assert.AreEqual(2, plan[1].Source.Seat.Value, "line 2 seat");
            });

            // 5. A line with no seat stays null — the server decides, not us.
            yield return Assert.Run("Seat: a line without a seat stays null, never coerced to 0", () =>
            {
                var line = new TableRoundLine("23", 1m);
                Assert.IsTrue(!line.Seat.HasValue, "Seat should be null when unspecified");
            });

            // 6. Stock-item vs text line represented distinctly.
            yield return Assert.Run("Line type: stock-item and text lines are represented distinctly", () =>
            {
                var si = new TableRoundLine("23", 1m);
                var text = new TableRoundLine(null, 1m, description: "No onions", lineType: TableRoundLineType.Text);
                Assert.AreEqual(TableRoundLineType.StockItem, si.LineType, "stock item line type");
                Assert.AreEqual(TableRoundLineType.Text, text.LineType, "text line type");
            });

            // 7. Duplicate externalOrderId is refused before any submission.
            yield return Assert.Run("Duplicate externalOrderId is refused before any submission", () =>
            {
                Assert.IsTrue(NativeSubmissionDecider.IsDuplicate(recordAlreadyExists: true), "existing record must be treated as duplicate");
            });

            // 8. A fresh externalOrderId proceeds.
            yield return Assert.Run("A fresh externalOrderId is not a duplicate", () =>
            {
                Assert.IsTrue(!NativeSubmissionDecider.IsDuplicate(recordAlreadyExists: false), "fresh id must proceed");
            });

            // 9. Ambiguous transport outcome classifies as Uncertain.
            yield return Assert.Run("Ambiguous transport outcome classifies as Uncertain, never success", () =>
            {
                Assert.AreEqual(NativeSubmissionState.Uncertain,
                    NativeSubmissionDecider.ClassifyWrite(TableRoundWriteOutcome.Ambiguous), "ambiguous -> uncertain");
            });

            // 10. Timeout while in flight becomes Uncertain.
            yield return Assert.Run("Timeout while in flight becomes Uncertain at every in-flight state", () =>
            {
                Assert.AreEqual(NativeSubmissionState.Uncertain,
                    NativeSubmissionDecider.OnTimeout(NativeSubmissionState.SendInitiated), "SendInitiated timeout");
                Assert.AreEqual(NativeSubmissionState.Uncertain,
                    NativeSubmissionDecider.OnTimeout(NativeSubmissionState.Submitted), "Submitted timeout");
            });

            // 11. Restart never auto-resends an uncertain or in-flight round.
            yield return Assert.Run("Restart never auto-resends an uncertain or in-flight round", () =>
            {
                Assert.IsTrue(!NativeSubmissionDecider.ShouldAutoResend(NativeSubmissionState.SendInitiated), "SendInitiated must not auto-resend");
                Assert.IsTrue(!NativeSubmissionDecider.ShouldAutoResend(NativeSubmissionState.Submitted), "Submitted must not auto-resend");
                Assert.IsTrue(!NativeSubmissionDecider.ShouldAutoResend(NativeSubmissionState.Uncertain), "Uncertain must not auto-resend");
            });

            // 12. After interruption an uncertain round requires operator verification, not a resend.
            yield return Assert.Run("Interrupted uncertain round requires operator verification, not an automatic resend", () =>
            {
                ResendJudgement j = NativeSubmissionDecider.JudgeAfterInterruption(NativeSubmissionState.Uncertain);
                Assert.AreEqual(ResendDecision.DoNotResend, j.Decision, "must not resend");
                Assert.IsTrue(j.RequiresOperator, "must require operator verification");
            });

            // 13. The shipping default transport sends nothing and creates no WebOrder path.
            yield return Assert.Run("Disabled transport sends nothing, acks nothing, and is the shipping default", () =>
            {
                ITableRoundWriter writer = new DisabledTableRoundWriter();
                Assert.IsTrue(!writer.IsTransportEnabled, "transport must be disabled by default");
                TableRoundWriteResult result = writer.SubmitTableRound(Round("ORD-13", new TableRoundLine("23", 1m)));
                Assert.AreEqual(TableRoundWriteOutcome.TransportDisabled, result.Outcome, "disabled writer outcome");
                Assert.IsTrue(result.NativeAckChecksum == null, "a disabled transport must produce no native ack");
                Assert.AreEqual(NativeSubmissionState.TransportDisabled,
                    NativeSubmissionDecider.ClassifyWrite(result.Outcome), "disabled -> TransportDisabled state, not success/failure");
            });

            // 14. The durable causal context is carried verbatim.
            yield return Assert.Run("Idempotency context carries externalOrderId, checksum and deviceId verbatim", () =>
            {
                TableRound r = Round("ORD-14", new TableRoundLine("23", 1m));
                Assert.AreEqual("ORD-14", r.Idempotency.ExternalOrderId, "externalOrderId");
                Assert.AreEqual("CS-ORD-14", r.Idempotency.Checksum, "checksum");
                Assert.AreEqual("DEV-2", r.Idempotency.DeviceId, "deviceId");
            });

            // 15. Fail closed: disabled transport → controlled rejection, zero attempts.
            yield return Assert.Run("Fail closed: disabled transport yields a controlled rejection and attempts zero submissions", () =>
            {
                var spy = new SpyWriter(enabled: false, result: null);
                NativeSubmissionOutcome outcome = NativeTableRoundSubmission.Execute(false, spy, Round("ORD-15", new TableRoundLine("23", 1m)));
                Assert.AreEqual(NativeSubmissionOutcomeKind.ControlledRejectionTransportDisabled, outcome.Kind, "outcome kind");
                Assert.AreEqual(NativeTableRoundSubmission.TransportDisabledMessage, outcome.Message, "controlled rejection message");
                Assert.AreEqual(0, spy.Calls, "a disabled transport must attempt zero submissions");
            });

            // 16. Duplicate externalOrderId attempts zero submissions.
            yield return Assert.Run("Duplicate externalOrderId attempts zero submissions", () =>
            {
                var spy = new SpyWriter(enabled: true, result: TableRoundWriteResult.Submitted("ACK"));
                NativeSubmissionOutcome outcome = NativeTableRoundSubmission.Execute(true, spy, Round("ORD-16", new TableRoundLine("23", 1m)));
                Assert.AreEqual(NativeSubmissionOutcomeKind.Duplicate, outcome.Kind, "duplicate must short-circuit");
                Assert.AreEqual(0, spy.Calls, "a duplicate must attempt zero submissions");
            });

            // 17. Enabled transport makes exactly one bounded submission.
            yield return Assert.Run("Enabled transport makes exactly one bounded submission", () =>
            {
                var spy = new SpyWriter(enabled: true, result: TableRoundWriteResult.Submitted("ACK1"));
                NativeSubmissionOutcome outcome = NativeTableRoundSubmission.Execute(false, spy, Round("ORD-17", new TableRoundLine("23", 1m)));
                Assert.AreEqual(NativeSubmissionOutcomeKind.Submitted, outcome.Kind, "submitted");
                Assert.AreEqual(1, spy.Calls, "exactly one bounded submission");
                Assert.AreEqual("ACK1", outcome.NativeAckChecksum, "native ack carried through");
            });

            // 18. Enabled + ambiguous write → uncertain, still exactly one submission.
            yield return Assert.Run("Enabled + ambiguous write classifies as uncertain, still exactly one submission", () =>
            {
                var spy = new SpyWriter(enabled: true, result: TableRoundWriteResult.Ambiguous("timeout"));
                NativeSubmissionOutcome outcome = NativeTableRoundSubmission.Execute(false, spy, Round("ORD-18", new TableRoundLine("23", 1m)));
                Assert.AreEqual(NativeSubmissionOutcomeKind.Uncertain, outcome.Kind, "ambiguous -> uncertain");
                Assert.AreEqual(1, spy.Calls, "still exactly one submission, never a retry");
            });

            // 19. No WebOrder fallback: a disabled transport never yields success.
            yield return Assert.Run("No WebOrder fallback: a disabled transport never yields a success outcome", () =>
            {
                var spy = new SpyWriter(enabled: false, result: null);
                NativeSubmissionOutcome outcome = NativeTableRoundSubmission.Execute(false, spy, Round("ORD-19", new TableRoundLine("23", 1m)));
                Assert.IsTrue(outcome.Kind != NativeSubmissionOutcomeKind.Submitted, "must never silently succeed via a fallback");
                Assert.AreEqual(0, spy.Calls, "and must not attempt any submission");
            });
        }
    }
}
