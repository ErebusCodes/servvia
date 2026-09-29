-- Read-only check: is each table session (visit) financially complete?
-- (Phase D6, docs/migration/d6-payments-settlement.md.)
--
-- Phase D10: this invariant is now ENFORCED by the table-session close, in
-- Servvia Core (services/core-platform/internal/tables/pgstore, closeReadiness),
-- under lock in the close's transaction. This file stays the read-only
-- documentation of the rule; tests/integration/visit_close_test.go proves the
-- two agree. Change both together. A visit is financially complete
-- only when ALL hold:
--   * every standing (not voided) check of the visit is settled (a check
--     whose settlement was revoked by a refund is open again, Phase D9);
--   * no accepted round line of the visit's non-cancelled orders is outside a
--     standing check (a round submitted after the last check is unbilled);
--   * no payment, refund or reversal of the visit's checks is pending or
--     uncertain (its financial outcome is not known yet; Phase D9).
-- One settled check never implies the visit is complete. It only reads.
SELECT s.id AS "tableSessionId",
       s.status::text AS "sessionStatus",
       (SELECT count(*) FROM "Check" c
         WHERE c."tableSessionId" = s.id AND c.status = 'open') AS "unsettledChecks",
       (SELECT count(*) FROM "Check" c
         WHERE c."tableSessionId" = s.id AND c.status = 'settled') AS "settledChecks",
       (SELECT count(*) FROM "OrderItem" i
          JOIN "OrderRound" r ON r.id = i."roundId"
          JOIN "Order" o ON o.id = i."orderId"
         WHERE o."tableSessionId" = s.id AND o.status <> 'cancelled'
           AND NOT EXISTS (SELECT 1 FROM "CheckLine" l
                            WHERE l."orderItemId" = i.id AND l."voidedAt" IS NULL)) AS "unbilledLines",
       (SELECT count(*) FROM "CheckPayment" p JOIN "Check" c ON c.id = p."checkId"
         WHERE c."tableSessionId" = s.id AND p.status IN ('pending', 'uncertain'))
       + (SELECT count(*) FROM "PaymentAdjustment" a JOIN "CheckPayment" p ON p.id = a."paymentId" JOIN "Check" c ON c.id = p."checkId"
         WHERE c."tableSessionId" = s.id AND a.status IN ('pending', 'uncertain')) AS "unresolvedMoney",
       NOT EXISTS (SELECT 1 FROM "Check" c WHERE c."tableSessionId" = s.id AND c.status = 'open')
         AND NOT EXISTS (SELECT 1 FROM "CheckPayment" p JOIN "Check" c ON c.id = p."checkId"
                          WHERE c."tableSessionId" = s.id AND p.status IN ('pending', 'uncertain'))
         AND NOT EXISTS (SELECT 1 FROM "PaymentAdjustment" a JOIN "CheckPayment" p ON p.id = a."paymentId"
                           JOIN "Check" c ON c.id = p."checkId"
                          WHERE c."tableSessionId" = s.id AND a.status IN ('pending', 'uncertain'))
         AND NOT EXISTS (SELECT 1 FROM "OrderItem" i
                           JOIN "OrderRound" r ON r.id = i."roundId"
                           JOIN "Order" o ON o.id = i."orderId"
                          WHERE o."tableSessionId" = s.id AND o.status <> 'cancelled'
                            AND NOT EXISTS (SELECT 1 FROM "CheckLine" l
                                             WHERE l."orderItemId" = i.id AND l."voidedAt" IS NULL))
         AS "financiallyComplete"
FROM "TableSession" s
