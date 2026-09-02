SET NOCOUNT ON;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description IN (N'ZAATAR LOAF', N'ZA''ATAR LOAF') ORDER BY Code;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description IN (N'FALAFEL SALAD', N'FALAFEL SALAD/ PLATE') ORDER BY Code;
