using System;

namespace VerduraIdealposBridge.Orders
{
    /// <summary>
    /// States, as a fact the API can report rather than a caveat buried in a
    /// document, whether this bridge can put an order on a native Idealpos
    /// table via the Webit path.
    ///
    /// It cannot, and the reason is structural rather than configurational.
    /// IdealPos.Webit.Core's own WebOrder contract has no table dimension of
    /// any kind. Its complete field set is HostReference, OrderReference,
    /// Items, Customer, UseCustomerAddressing, DeliveryAddress, PostalAddress,
    /// DeliverTo, PriceMode, OrderedDate, DeliveryDate, TriggerPromotions,
    /// CalculatePoints, GiftOrder, PaymentDetail, the four amount fields,
    /// OrderDetail, GiftMessage, Message, DatebaseId and Processed. There is
    /// no table field. OrderDetail is an OrderMode, whose values are None,
    /// Pickup, EatIn, Delivery and ErrorReport — no table there either.
    ///
    /// Every table-assignment strategy this bridge ships is therefore an
    /// attempt to encode a table into a field that is not a table field:
    /// DeliverTo is a delivery-address line, Message is docket text, and
    /// HostReference/OrderReference are order identifiers. At best they cause
    /// a table number to be PRINTED. None of them causes Idealpos to assign
    /// the table, because the wire contract has nowhere to say it.
    ///
    /// This closes the question DL-108 §K.2 left open ("which strategy works")
    /// without needing the harness run it called for: the answer is that none
    /// can, and no live experiment is required to establish it.
    ///
    /// Deliberately NOT implemented as a hard refusal to start. If a future
    /// Idealpos build adds a table field to the Webit contract, this becomes
    /// wrong, and a bridge that refused to run would then be a blocker rather
    /// than an honest reporter. It reports; it does not forbid.
    /// </summary>
    public static class TableAssignmentCapability
    {
        /// <summary>
        /// Can any Webit-path strategy cause Idealpos to assign the requested
        /// table? No — see the class comment. The requested table still
        /// travels with the order and is still what reconciliation compares
        /// against; it simply is not honoured by this ingest path.
        /// </summary>
        public const bool CanAssignNativeTableViaWebit = false;

        public const string Reason =
            "The Idealpos Webit WebOrder contract has no table field, and OrderMode has no table value. " +
            "Every available strategy encodes the table into a non-table field (DeliverTo, Message, " +
            "HostReference or OrderReference), which at most prints it. A native table assignment " +
            "cannot be expressed on this ingest path at all.";

        /// <summary>
        /// What a given strategy actually does to the order, in one line, for
        /// the status API. Named strategies match TableAssignmentStrategyFactory.
        /// </summary>
        public static string DescribeEffect(string strategyName)
        {
            switch ((strategyName ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "nohint":
                    return "no table hint is sent; the order carries no table anywhere in the Webit payload";
                case "deliverto":
                    return "writes the table into WebOrder.DeliverTo, a delivery-address line; does not assign a table";
                case "message":
                    return "writes the table into WebOrder.Message, which is docket text; PRINTS the table on the " +
                           "kitchen docket without assigning it, which reads to staff as an assignment that did not happen";
                case "hostreference":
                    return "writes the table into WebOrder.HostReference, an order identifier; does not assign a table";
                case "referenceprefix":
                    return "rewrites WebOrder.OrderReference to embed the table; does not assign a table, and it " +
                           "changes the native pending-sale code that reconciliation anchors on";
                default:
                    return "unrecognised strategy; effect unknown";
            }
        }

        /// <summary>
        /// Strategies that mislead rather than merely fail. Message prints a
        /// table on the docket that was never assigned; ReferencePrefix moves
        /// the anchor key. Both are worth surfacing rather than treating as
        /// equivalent to the harmless no-ops.
        /// </summary>
        public static bool IsMisleading(string strategyName)
        {
            string s = (strategyName ?? string.Empty).Trim();
            return string.Equals(s, "Message", StringComparison.OrdinalIgnoreCase)
                || string.Equals(s, "ReferencePrefix", StringComparison.OrdinalIgnoreCase);
        }
    }
}
