-- Read-only check: modifier options whose stored priceDeltaCents is not a
-- whole number of cents (Phase D2, Decision A in docs/migration/README.md).
--
-- Servvia money is integer minor units, so such a value is invalid catalog
-- data. Servvia Core refuses to price it (pricing.KindCatalogInvalid); the
-- NestJS order path silently truncates it. Nothing may repair these rows
-- automatically: run this, report the count and ids, and agree a cleanup
-- before any database constraint on modifier prices is proposed.
--
-- It only reads. Deleted items are included on purpose: a constraint would
-- apply to them too.
SELECT m.id                      AS "menuItemId",
       m."organizationId"        AS "organizationId",
       m."deletedAt" IS NOT NULL AS "itemDeleted",
       g ->> 'id'                AS "modifierGroupId",
       o ->> 'id'                AS "optionId",
       o -> 'priceDeltaCents'    AS "priceDeltaCents"
FROM "MenuItem" m
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(m."modifierGroups") = 'array' THEN m."modifierGroups" ELSE '[]'::jsonb END) AS g
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(g -> 'options') = 'array' THEN g -> 'options' ELSE '[]'::jsonb END) AS o
WHERE jsonb_typeof(o -> 'priceDeltaCents') = 'number'
  AND (o ->> 'priceDeltaCents')::numeric <> trunc((o ->> 'priceDeltaCents')::numeric)
ORDER BY 1, 4, 5
