SET NOCOUNT ON;
SELECT Code, Description, DepartmentCode, Discontinue, HasVariants, Condiment
FROM dbo.StockItems WHERE Code IN (663,757,701,784,705,788) ORDER BY Code;
SELECT Code, Description, DepartmentCode, Discontinue, HasVariants, Condiment
FROM dbo.StockItems WHERE Code IN (710,793,712,795,673,767) ORDER BY Code;
SELECT Code, Description, DepartmentCode, Discontinue, HasVariants, Condiment
FROM dbo.StockItems WHERE Code IN (679,772,704,787,667,761) ORDER BY Code;
PRINT '---near-dup: avocado---';
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%AVOCADO%' ORDER BY Code;
PRINT '---near-dup: pide---';
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%PIDE%' ORDER BY Code;
PRINT '---near-dup: halloumi loaf---';
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%HALLOUMI%LOAF%' ORDER BY Code;
PRINT '---near-dup: pesto---';
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%PESTO%' ORDER BY Code;
PRINT '---near-dup: spicy mediterranean---';
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%SPICY%MEDITERRANEAN%' ORDER BY Code;
PRINT '---near-dup: moussaka---';
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%MOUSSAKA%' ORDER BY Code;
PRINT '---near-dup: mighty angus---';
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%ANGUS%' ORDER BY Code;
