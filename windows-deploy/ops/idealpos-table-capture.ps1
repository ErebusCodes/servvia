<#
.SYNOPSIS
  READ-ONLY evidence capture for the native IdealPOS Table two-round test.

.DESCRIPTION
  Takes a timestamped, SELECT-only snapshot of every native structure that
  changes when a cashier opens a table, adds a PLU, sends a round, adds
  another PLU and sends again — plus the new tail of every relevant log since
  the previous step, and the PIDs of every IdealPOS process so a restart
  between steps is obvious.

  THIS SCRIPT NEVER WRITES. Every SQL statement is a SELECT; the connection
  carries Application Name=VerduraCaptureProbe so its activity is
  attributable, and ApplicationIntent is irrelevant here because nothing is
  mutated. It does not touch printer routing, does not start a packet
  capture, and does not send anything to any IdealPOS port.

  It is driven one STEP at a time by a human operator at the console, so the
  restaurant workflow is never blocked waiting on automation.

.PARAMETER Step
  A label for this capture point, e.g. 00-baseline, 01-open, 02-add-A,
  03-send-R1, 04-add-B, 05-send-R2, 06-close.

.PARAMETER TableCode
  The native table code as it appears in PendingSales.Code (e.g. '5').

.PARAMETER OutRoot
  Directory to write evidence into. A per-run subdirectory is created.

.EXAMPLE
  .\idealpos-table-capture.ps1 -Step 00-baseline -TableCode 5
  # ... operator opens Table 5 on the till ...
  .\idealpos-table-capture.ps1 -Step 01-open -TableCode 5
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Step,
  [Parameter(Mandatory)][string]$TableCode,
  [string]$OutRoot = 'C:\ProgramData\Verdura\evidence\idealpos-table-capture',
  [string]$SqlInstance = 'localhost\IDEALSQL'
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss.fff'
$runDir = Join-Path $OutRoot $Step
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

# Log byte offsets persist between steps so each capture emits ONLY the new
# lines produced by the operator action that just happened.
$offsetFile = Join-Path $OutRoot 'log-offsets.json'

# SQL Server here is 10.50 (2008 R2, compat 100): TRY_CONVERT does not exist,
# so any string->int coercion is done in PowerShell and inlined, or guarded in
# T-SQL with a NOT LIKE '%[^0-9]%' pattern test.
$TableCodeInt = 'NULL'
if ($TableCode -match '^[0-9]+$') { $TableCodeInt = $TableCode }

function Invoke-ReadOnlyQuery {
  param([string]$Database, [string]$Sql)
  $cs = "Server=$SqlInstance;Database=$Database;Trusted_Connection=True;Application Name=VerduraCaptureProbe;"
  $conn = New-Object System.Data.SqlClient.SqlConnection $cs
  $conn.Open()
  try {
    # Defence in depth: the session is explicitly read-only, so a typo that
    # is not a SELECT fails rather than mutating a live restaurant database.
    $guard = $conn.CreateCommand()
    $guard.CommandText = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;'
    [void]$guard.ExecuteNonQuery()

    $cmd = $conn.CreateCommand(); $cmd.CommandText = $Sql; $cmd.CommandTimeout = 60
    $ad = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
    $dt = New-Object System.Data.DataTable
    [void]$ad.Fill($dt)
    return $dt
  } finally { $conn.Close() }
}

function Save-Table {
  param([string]$Name, [string]$Database, [string]$Sql)
  try {
    $dt = Invoke-ReadOnlyQuery -Database $Database -Sql $Sql
    $rows = @($dt | Select-Object * -ExcludeProperty RowError, RowState, Table, ItemArray, HasErrors)
    $rows | ConvertTo-Json -Depth 6 | Out-File (Join-Path $runDir "$Name.json") -Encoding utf8
    $rows | Format-Table -AutoSize | Out-String -Width 300 | Out-File (Join-Path $runDir "$Name.txt") -Encoding utf8
    Write-Host ("  {0,-34} {1} row(s)" -f $Name, $dt.Rows.Count)
  } catch {
    "ERROR: $($_.Exception.Message)" | Out-File (Join-Path $runDir "$Name.ERROR.txt") -Encoding utf8
    Write-Host ("  {0,-34} ERROR" -f $Name) -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "=== IdealPOS capture  step=$Step  table=$TableCode  at $stamp ===" -ForegroundColor Cyan

# ---------------------------------------------------------------- processes
# Captured first: if a PID changed between steps, a component restarted and
# every in-memory-state conclusion for that step is suspect.
$procs = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match '^(IPS|Idealpos|POSServer|ipsdeploy)' } |
  Select-Object ProcessId, ParentProcessId, Name, CreationDate
$procs | ConvertTo-Json -Depth 4 | Out-File (Join-Path $runDir 'processes.json') -Encoding utf8
Write-Host ("  {0,-34} {1} process(es)" -f 'processes', $procs.Count)

# ------------------------------------------------------------- IPSTransaction
# The authoritative store. PendingSales is filtered to this table code AND to
# the WBORD anchors, so a Verdura order arriving mid-test is also visible.
Save-Table 'ipstx.PendingSales' 'IPSTransaction' @"
SELECT ID, Code, POS, [Date], CustomerID, ClerkID, Status, OrderState, ReadyForPayment,
       Prepayment, SentOnline, ISNULL(Label,'') AS Label, ISNULL(Reference,'') AS Reference,
       OrderDate
FROM dbo.PendingSales
WHERE Code = '$TableCode' OR Code LIKE 'WBORD%'
ORDER BY ID DESC
"@

# Every line of every candidate sale, with the fields the test hinges on:
# Printed (KOT-sent), OrderedTime (round), Line (stable line id), Col1 (PLU),
# Col3/Col4 (qty/price as IdealPOS resolved them).
Save-Table 'ipstx.PendingSaleLines' 'IPSTransaction' @"
SELECT l.PendingSaleID, l.Line, l.Col0, l.Col1, l.Col2, l.Col3, l.Col4, l.Col5, l.Col6,
       l.Printed, l.OrderedTime, l.Person, l.SeatNumber, l.ClerkID, l.LocationSold,
       l.Balance, l.PayThis, l.QtyPaying, l.SentOnline
FROM dbo.PendingSaleLines l
JOIN dbo.PendingSales s ON s.ID = l.PendingSaleID
WHERE s.Code = '$TableCode' OR s.Code LIKE 'WBORD%'
ORDER BY l.PendingSaleID DESC, l.Line
"@

Save-Table 'ipstx.TableActivity' 'IPSTransaction' @"
SELECT TOP 50 [Table], MapCode, [Date], Guests, SentOnline
FROM dbo.TableActivity
WHERE [Table] = $TableCodeInt
ORDER BY [Date] DESC
"@

# Where a closed sale goes. Transactions is keyed (Cons,POS) and carries no
# PendingSaleID, so the close step is what tells us whether ANY identifier
# survives — TransactionReference is the structural candidate and is empty today.
Save-Table 'ipstx.Transactions.recent' 'IPSTransaction' @"
SELECT TOP 20 Cons, POS, [Date] FROM dbo.Transactions ORDER BY Cons DESC
"@
Save-Table 'ipstx.TransactionsLine.recent' 'IPSTransaction' @"
SELECT TOP 200 tl.*
FROM dbo.TransactionsLine tl
WHERE tl.TransactionID IN (SELECT TOP 5 Cons FROM dbo.Transactions ORDER BY Cons DESC)
ORDER BY tl.TransactionID DESC, tl.Line
"@
Save-Table 'ipstx.TransactionReference' 'IPSTransaction' @"
SELECT TOP 20 Cons, POS, HashString, Reference, RefundReference, UserDefinedText, SentOnline
FROM dbo.TransactionReference ORDER BY Cons DESC
"@
Save-Table 'ipstx.WebPendingOrder' 'IPSTransaction' @"
SELECT ID, Processed, DateRetrieved, DateProcessed, WebReference, Origin, SentOnline
FROM dbo.WebPendingOrder ORDER BY ID DESC
"@

# Proof that IdealPOS resolved the price itself: the configured price levels
# for exactly the PLUs that appear on this table's lines.
Save-Table 'ipstx.PriceConfig.forTablePLUs' 'IPSTransaction' @"
SELECT DISTINCT si.ID AS StockItemID, si.Code AS PluCode, si.Description,
       v.[Type], v.[Level], v.Value
FROM dbo.PendingSaleLines l
JOIN dbo.PendingSales s  ON s.ID = l.PendingSaleID
JOIN dbo.StockItems si   ON si.Code = LTRIM(RTRIM(l.Col1))
JOIN dbo.StockItemsValue v ON v.StockItemID = si.ID
WHERE s.Code = '$TableCode'
ORDER BY si.Code, v.[Type], v.[Level]
"@

# KOT routing config for those same PLUs — which pending printer each goes to.
Save-Table 'ipstx.PrintRouting.forTablePLUs' 'IPSTransaction' @"
SELECT DISTINCT si.ID, si.Code AS PluCode, si.Description,
       si.PrintPend1, si.PrintPend2, si.PrintPend3, si.PrintPend4,
       si.PrintPend5, si.PrintPend6, si.PrintReceipt, si.ComponentsPendPrint
FROM dbo.PendingSaleLines l
JOIN dbo.PendingSales s ON s.ID = l.PendingSaleID
JOIN dbo.StockItems si  ON si.Code = LTRIM(RTRIM(l.Col1))
WHERE s.Code = '$TableCode'
"@

# ------------------------------------------------------------------ POSServer
# The replica/read model the Bridge currently reads. Captured to show what an
# integration reading POSServer alone would and would not have seen.
Save-Table 'posserver.PendingSales' 'POSServer' @"
SELECT ID, Code, Map, POS, DateModified, Customer, ClerkID, Status, Label, OrderDate, ReadyForPayment
FROM dbo.PendingSales ORDER BY ID DESC
"@
Save-Table 'posserver.PendingSaleLines' 'POSServer' @"
SELECT PendingSaleID, Line, Col0, Col1, Col2, Col3, Col4, Col5, Col6, Printed,
       Person, Balance, PayThis, QtyPaying, SeatNumber, ClerkID, LocationSold, OrderedTime
FROM dbo.PendingSaleLines ORDER BY PendingSaleID DESC, Line
"@
Save-Table 'posserver.TableMapSetups' 'POSServer' @"
SELECT Code, ItemType, ItemIndex, Name, Caption, Status, Amount, GuestsSaved, StartTime
FROM dbo.TableMapSetups
WHERE ItemType = 3 AND ItemIndex = $TableCodeInt
"@

# ----------------------------------------------------------------------- logs
# Only the bytes appended since the previous step, so each capture directory
# contains exactly the evidence for one operator action.
$logs = @{
  'POSServerClient'  = 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\POSServerClient.log'
  'IPSClient'        = 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\IPSClient.log'
  'IPSPrinterServer' = 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\IPSPrinterServer.LOG'
  'Printing'         = 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\Printing.log'
  'IPSDeploy'        = 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\IPSDeploy.log'
  'IpsSqlData'       = 'C:\ProgramData\Ideal Business Software\IPS\SqlDataLogs\IpsSqlData.log'
}
$offsets = @{}
if (Test-Path $offsetFile) {
  (Get-Content $offsetFile -Raw | ConvertFrom-Json).PSObject.Properties |
    ForEach-Object { $offsets[$_.Name] = [int64]$_.Value }
}
foreach ($name in $logs.Keys) {
  $path = $logs[$name]
  if (-not (Test-Path $path)) { continue }
  $len = (Get-Item $path).Length
  $prev = if ($offsets.ContainsKey($name)) { $offsets[$name] } else { 0 }
  # A shrunken file means the log rolled; take it from the start.
  if ($len -lt $prev) { $prev = 0 }
  if ($len -gt $prev) {
    $fs = [System.IO.File]::Open($path,'Open','Read','ReadWrite')
    try {
      [void]$fs.Seek($prev, 'Begin')
      $buf = New-Object byte[] ($len - $prev)
      [void]$fs.Read($buf, 0, $buf.Length)
      [System.Text.Encoding]::UTF8.GetString($buf) |
        Out-File (Join-Path $runDir "log.$name.new.txt") -Encoding utf8
    } finally { $fs.Close() }
  }
  $offsets[$name] = $len
  Write-Host ("  {0,-34} +{1} byte(s)" -f "log.$name", ($len - $prev))
}
$offsets | ConvertTo-Json | Out-File $offsetFile -Encoding utf8

# --------------------------------------------------------------------- manifest
[pscustomobject]@{
  Step = $Step; TableCode = $TableCode; CapturedAtLocal = $stamp
  CapturedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  SqlInstance = $SqlInstance
  ReadOnly = $true
  Note = 'SELECT-only. No writes, no protocol transmission, no printer-routing change.'
} | ConvertTo-Json | Out-File (Join-Path $runDir 'manifest.json') -Encoding utf8

Write-Host "=== written to $runDir ===" -ForegroundColor Green
