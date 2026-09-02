SET NOCOUNT ON;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%SPICY%' ORDER BY Code;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%MOUSSAKA%' ORDER BY Code;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%ANGUS%' OR Description LIKE N'%BEEF BURGER%' ORDER BY Code;
