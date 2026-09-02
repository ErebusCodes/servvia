SET NOCOUNT ON;
SELECT Code, Description, DepartmentCode, Discontinue FROM dbo.StockItems WHERE Description = N'CHICKEN BALLISTA PIZZA' ORDER BY Code;
SELECT Code, Description FROM dbo.Departments WHERE Code IN (1,6,30,31,33,34,37,41);
SELECT COUNT(*) AS total_dept41_active FROM dbo.StockItems WHERE DepartmentCode = 41 AND Discontinue = 0;
