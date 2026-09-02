SET NOCOUNT ON;
-- Independent sample: find dept-41 items whose description also appears
-- verbatim (or near-verbatim after removing spaces) in a non-41 row, for
-- items NOT already in the candidate batch under review.
SELECT TOP 15 a.Code AS normal_code, a.Description AS normal_desc, a.DepartmentCode AS normal_dept,
       b.Code AS takeaway_code, b.Description AS takeaway_desc, b.DepartmentCode AS takeaway_dept
FROM dbo.StockItems a
JOIN dbo.StockItems b
  ON REPLACE(REPLACE(UPPER(a.Description),'''',''),' ','') = REPLACE(REPLACE(UPPER(b.Description),'''',''),' ','')
WHERE a.DepartmentCode <> 41 AND b.DepartmentCode = 41
  AND a.Discontinue = 0 AND b.Discontinue = 0
  AND a.Description NOT IN (N'MIGHTY ANGUS BEEF BURGER', N'GARLIC CHEESE PIDE', N'HALLOUMI LOAF',
    N'PESTO CHICKEN PIZZA', N'SPICY MEDITERRANEAN PIZZA', N'GREEK EGGPLANT LAMB MOUSSAKA',
    N'CHICKEN AVOCADO SALAD', N'CHICKEN BALLISTA PIZZA')
ORDER BY a.Code;
