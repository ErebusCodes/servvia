using System.Collections.Generic;

namespace VerduraIdealposBridge.Orders
{
    public enum OrderSubmitOutcomeKind { Success, ValidationFailed, Duplicate, IdealposSubmissionFailed, NativeTransportDisabled }

    /// <summary>What the HTTP layer needs to pick a status code and body —
    /// kept separate from OrderRecord so Api/OrdersEndpoint.cs doesn't need
    /// to know about SQLite/state-store internals.</summary>
    public class OrderSubmitOutcome
    {
        public OrderSubmitOutcomeKind Kind { get; private set; }
        public OrderRecord Record { get; private set; }
        public List<string> ValidationErrors { get; private set; }
        public string Error { get; private set; }

        public static OrderSubmitOutcome Success(OrderRecord record) =>
            new OrderSubmitOutcome { Kind = OrderSubmitOutcomeKind.Success, Record = record };

        public static OrderSubmitOutcome Duplicate(OrderRecord record) =>
            new OrderSubmitOutcome { Kind = OrderSubmitOutcomeKind.Duplicate, Record = record };

        public static OrderSubmitOutcome ValidationFailed(List<string> errors) =>
            new OrderSubmitOutcome { Kind = OrderSubmitOutcomeKind.ValidationFailed, ValidationErrors = errors };

        public static OrderSubmitOutcome IdealposFailed(OrderRecord record, string error) =>
            new OrderSubmitOutcome { Kind = OrderSubmitOutcomeKind.IdealposSubmissionFailed, Record = record, Error = error };

        /// <summary>Fail-closed: the native table-write transport is not enabled,
        /// so nothing was sent and — critically — there was no fallback to the
        /// removed WebOrder path. The HTTP layer turns this into a controlled
        /// 503, never a success.</summary>
        public static OrderSubmitOutcome NativeTransportDisabled(OrderRecord record, string message) =>
            new OrderSubmitOutcome { Kind = OrderSubmitOutcomeKind.NativeTransportDisabled, Record = record, Error = message };
    }
}
