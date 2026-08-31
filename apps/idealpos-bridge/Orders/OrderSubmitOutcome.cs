using System.Collections.Generic;

namespace VerduraIdealposBridge.Orders
{
    public enum OrderSubmitOutcomeKind { Success, ValidationFailed, Duplicate, IdealposSubmissionFailed }

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
    }
}
