SET NOCOUNT ON;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%HALLOUMI%' ORDER BY Code;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description LIKE N'%PESTO%' ORDER BY Code;
