SET NOCOUNT ON;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%AVOCADO%' ORDER BY Code;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%PIDE%' ORDER BY Code;
