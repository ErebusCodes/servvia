namespace VerduraIdealposBridge.Realtime
{
    /// <summary>Shape sent down the WebSocket channel — matches the
    /// contract: {"type":"order.statusChanged","externalOrderId":...,"status":...,"table":...}.
    /// This is the bridge's OWN real-time channel to Verdura, unrelated to
    /// and never mixed with Idealpos's own Doshii SignalR connection.</summary>
    public class OrderStatusChangedEvent
    {
        public string Type => "order.statusChanged";
        public string ExternalOrderId { get; set; }
        public string Status { get; set; }
        public string Table { get; set; }
        public int? PendingSalesId { get; set; }
        public bool? TableMatchesRequest { get; set; }
    }
}
