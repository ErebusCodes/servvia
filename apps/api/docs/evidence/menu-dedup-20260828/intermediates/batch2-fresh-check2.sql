SET NOCOUNT ON;
SELECT Code, Description, DepartmentCode, Discontinue, HasVariants, Condiment
FROM dbo.StockItems WHERE Code IN ('710','793','712','795','673','767') ORDER BY Code;
SELECT Code, Description, DepartmentCode, Discontinue, HasVariants, Condiment
FROM dbo.StockItems WHERE Code IN ('679','772','704','787','667','761') ORDER BY Code;
