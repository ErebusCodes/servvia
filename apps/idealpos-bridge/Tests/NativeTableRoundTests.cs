using System;
using System.Collections.Generic;
using VerduraIdealposBridge.Orders;
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

            // ---- UI/API -> TableRound mapping (screenshot acceptance) ----

            // 20. Screenshot 2/3: selecting Table 5 carries tableCode "5" through unchanged.
            yield return Assert.Run("Selected Table 5 becomes native tableCode \"5\"", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "ORD-20",
                    Table = "5",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "LEMON", Quantity = 1m } },
                };
                TableRound round = NativeTableRoundMapper.ToTableRound(req, pos: 1, clerkId: 0, guests: 0, location: 1);
                Assert.AreEqual("5", round.TableCode, "selected table code carried through unchanged");
            });

            // 21. Screenshot 3: one menu item becomes one native round line, code + qty preserved.
            yield return Assert.Run("One menu item becomes one native round line preserving code and quantity", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "ORD-21",
                    Table = "5",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "LEMON", Quantity = 2m } },
                };
                TableRound round = NativeTableRoundMapper.ToTableRound(req, pos: 1, clerkId: 0, guests: 0, location: 1);
                Assert.AreEqual(1, round.Lines.Count, "one item -> one line");
                Assert.AreEqual("LEMON", round.Lines[0].StockItemCode, "product code preserved");
                Assert.AreEqual(2m, round.Lines[0].Quantity, "quantity preserved");
            });

            // 22. Screenshot 3: Lemon Slice on Seat 1 — seat survives the mapping.
            yield return Assert.Run("Seat assignment survives mapping (Lemon Slice on Seat 1)", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "ORD-22",
                    Table = "5",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "LEMON", Quantity = 1m, Seat = 1 } },
                };
                TableRound round = NativeTableRoundMapper.ToTableRound(req, pos: 1, clerkId: 0, guests: 0, location: 1);
                Assert.IsTrue(round.Lines[0].Seat.HasValue, "seat is carried");
                Assert.AreEqual(1, round.Lines[0].Seat.Value, "seat value survives");
            });

            // 23. A line with no seat maps to null — the server decides, never coerced.
            yield return Assert.Run("A line with no seat maps to null seat, never coerced", () =>
            {
                var req = new OrderRequest
                {
                    ExternalOrderId = "ORD-23",
                    Table = "5",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "LEMON", Quantity = 1m } },
                };
                TableRound round = NativeTableRoundMapper.ToTableRound(req, pos: 1, clerkId: 0, guests: 0, location: 1);
                Assert.IsTrue(!round.Lines[0].Seat.HasValue, "absent seat stays null");
            });

            // 24. Screenshot 3 round 2: a second Send maps to only the new round's lines,
            //     which the server appends after the existing lines (not a full-state resend).
            yield return Assert.Run("A second Send to Kitchen maps to a round of only its own new lines, appended after existing", () =>
            {
                var round1 = new OrderRequest
                {
                    ExternalOrderId = "ORD-24-r1",
                    Table = "5",
                    Items = new List<OrderLineRequest>
                    {
                        new OrderLineRequest { ProductCode = "BREAD", Quantity = 1m },
                        new OrderLineRequest { ProductCode = "WATER", Quantity = 1m },
                    },
                };
                var round2 = new OrderRequest
                {
                    ExternalOrderId = "ORD-24-r2",
                    Table = "5",
                    Items = new List<OrderLineRequest> { new OrderLineRequest { ProductCode = "LEMON", Quantity = 1m } },
                };
                TableRound r1 = NativeTableRoundMapper.ToTableRound(round1, 1, 0, 0, 1);
                TableRound r2 = NativeTableRoundMapper.ToTableRound(round2, 1, 0, 0, 1);
                Assert.AreEqual(2, r1.Lines.Count, "round 1 has its two lines");
                Assert.AreEqual(1, r2.Lines.Count, "round 2 carries ONLY its own new line, not the prior table state");
                // Appended after round 1's 2 lines: round 2's single line takes ordinal 3.
                IReadOnlyList<PlannedLine> appended = TableRoundPlan.PlanAppend(r1.Lines.Count, r2);
                Assert.AreEqual((short)3, appended[0].Line, "round 2 line is appended after the existing lines");
            });

            // ---- ObserveNative stale-timeout invariant (durable, restart-safe) ----

            // 25. Not stale before the window elapses.
            yield return Assert.Run("Stale timeout: an in-flight submission is not stale before the window elapses", () =>
            {
                var submittedAt = new DateTime(2026, 9, 9, 12, 0, 0, DateTimeKind.Utc);
                DateTime now = submittedAt.AddMinutes(9);
                Assert.IsTrue(!NativeStaleTimeout.IsStale(submittedAt, now, 10), "9 min < 10 min timeout -> not stale");
            });

            // 26. Stale after the window elapses.
            yield return Assert.Run("Stale timeout: an in-flight submission is stale after the window elapses", () =>
            {
                var submittedAt = new DateTime(2026, 9, 9, 12, 0, 0, DateTimeKind.Utc);
                DateTime now = submittedAt.AddMinutes(11);
                Assert.IsTrue(NativeStaleTimeout.IsStale(submittedAt, now, 10), "11 min > 10 min timeout -> stale");
            });

            // 27. Strict boundary — exactly at the timeout is not yet stale.
            yield return Assert.Run("Stale timeout: exactly at the timeout is not yet stale (strict boundary)", () =>
            {
                var submittedAt = new DateTime(2026, 9, 9, 12, 0, 0, DateTimeKind.Utc);
                DateTime now = submittedAt.AddMinutes(10);
                Assert.IsTrue(!NativeStaleTimeout.IsStale(submittedAt, now, 10), "exactly 10 min is not > 10 min");
            });

            // 28. Anchored to the DURABLE submission timestamp, so a restart never resets the clock.
            yield return Assert.Run("Stale timeout: anchored to the durable submission timestamp — a process restart does not reset it", () =>
            {
                // SubmittedAtUtc is persisted (TEXT NOT NULL) and survives a
                // restart unchanged; staleness is a pure function of
                // (submittedAtUtc, nowUtc). So an order submitted just before a
                // crash keeps aging from its ORIGINAL time, not from reboot.
                var submittedAt = new DateTime(2026, 9, 9, 12, 0, 0, DateTimeKind.Utc);
                // "now" observed shortly after a restart, 9 min after submission:
                Assert.IsTrue(!NativeStaleTimeout.IsStale(submittedAt, submittedAt.AddMinutes(9), 10),
                    "still within window after a restart -> not stale (clock not reset to 0 at reboot)");
                // A later poll, 11 min after the ORIGINAL submission, is stale —
                // proving the elapsed time is measured from submittedAt, never
                // from process start.
                Assert.IsTrue(NativeStaleTimeout.IsStale(submittedAt, submittedAt.AddMinutes(11), 10),
                    "past the window relative to the durable submission time -> stale");
            });

            // 29. A non-positive configured timeout is clamped to 0 (fail-closed: any elapsed time is stale).
            yield return Assert.Run("Stale timeout: a non-positive configured timeout clamps to 0 (any elapsed time is stale)", () =>
            {
                var submittedAt = new DateTime(2026, 9, 9, 12, 0, 0, DateTimeKind.Utc);
                Assert.IsTrue(NativeStaleTimeout.IsStale(submittedAt, submittedAt.AddSeconds(1), 0), "0 timeout: 1s elapsed is stale");
                Assert.IsTrue(NativeStaleTimeout.IsStale(submittedAt, submittedAt.AddSeconds(1), -5), "negative timeout clamps to 0");
            });
        }
    }
}
