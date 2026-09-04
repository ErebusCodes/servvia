<#
.SYNOPSIS
  READ-ONLY evidence capture for the native IdealPOS Table two-round test.

.DESCRIPTION
  Takes a timestamped, SELECT-only snapshot of every native structure that
  changes when a cashier opens a table, adds a PLU, sends a round, adds
  another PLU and sends again -- plus the new tail of every relevant log since
  the previous step, and the PIDs of every IdealPOS process so a restart
  between steps is obvious.

  THIS SCRIPT NEVER WRITES. Every SQL statement is a SELECT; the connection
  carries Application Name=VerduraCaptureProbe so its activity is
  attributable. It does not touch printer routing, does not start a packet
  capture, and does not send anything to any IdealPOS port.

  It is driven one STEP at a time by a human operator at the console, so the
  restaurant workflow is never blocked waiting on automation.

  WHY THE SALE QUERIES ARE DELIBERATELY UNFILTERED (2026-09-04 correction)
  An earlier revision filtered IPSTransaction.PendingSales to
  `Code = <table> OR Code LIKE 'WBORD%'`. Read-only measurement that night
  showed that premise is unproven and probably wrong:

    * The real table map is TableMapSetups Code 1, ItemType 3,
      ItemIndex 1..19, and TableActivity records real table use as
      (Table 1..19, MapCode 1). Table 5 has 197 recorded activities.
    * Every numeric IPSTransaction.PendingSales.Code present (343, 190, 537,
      328, 272, 32, 995, 994, 885, 608, 579, 550) is OUTSIDE 1..19, carries a
      customer-name / "TAKEAWAY" Label, and its POSServer counterpart sits at
      Map 0 -- the same map as the WBORD web rows. These are ticket numbers,
      not table numbers.
    * IPSTransaction.PendingSales has NO Map column at all, so it cannot by
      itself express which table map a sale belongs to.
    * No PendingSales row for ANY table exists in either store right now,
      although tables are used daily -- so a native table sale is transient in
      PendingSales and we have never yet observed one at rest.

  We therefore do not know how an open Table 5 sale is keyed. A filter built
  on a guess would return zero rows tomorrow and waste a one-shot live window.
  Both PendingSales stores are tiny (47 and 3 rows), so every row is captured
  and the filtering is left to analysis time, where a wrong guess is
  recoverable.

.PARAMETER Step
  A label for this capture point, e.g. 00-baseline, 01-open, 02-add-A,
  03-send-R1, 04-add-B, 05-send-R2, 06-close.

.PARAMETER TableCode
  The native table code under test as it appears on the table map (e.g. '5').
  Used to annotate and to pull table-specific history, never to gate the
  capture of the sale stores themselves.

.PARAMETER RunId
  Groups the steps of one sitting. Defaults to the run recorded in
  <OutRoot>\current-run.txt, or a new date-stamped run if there is none.
  Log byte-offsets are scoped to the run, so a new sitting always re-reads
  from its own baseline instead of inheriting a previous sitting's offsets.

.PARAMETER NewRun
  Force a new RunId even if a current run is recorded.

.PARAMETER Preflight
  Run every query and path check against the current idle state and report a
  pass/fail checklist. Requires no operator action at the till. Writes to the
  step directory '00-preflight'.

.PARAMETER OutRoot
  Directory to write evidence into. A per-run, per-step subdirectory is made.

.EXAMPLE
  .\idealpos-table-capture.ps1 -Preflight -TableCode 5
  # tomorrow, at the venue:
  .\idealpos-table-capture.ps1 -NewRun -Step 00-baseline -TableCode 5
  # ... operator opens Table 5 on the till ...
  .\idealpos-table-capture.ps1 -Step 01-open -TableCode 5
#>
[CmdletBinding()]
param(
  [string]$Step,
  [Parameter(Mandatory)][string]$TableCode,
  [string]$RunId,
  [switch]$Preflight,
  [switch]$NewRun,
  [string]$OutRoot = 'C:\ProgramData\Verdura\evidence\idealpos-table-capture',
  [string]$SqlInstance = 'localhost\IDEALSQL'
)

$ErrorActionPreference = 'Stop'
if ($Preflight -and -not $Step) { $Step = '00-preflight' }
if (-not $Step) { throw '-Step is required unless -Preflight is used.' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss.fff'
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null

# ------------------------------------------------------------------ run scope
# Steps of one sitting share a RunId. Offsets live inside the run directory so
# a fresh sitting never inherits a previous sitting's log positions -- that
# would silently blank out the first step's log evidence.
$runPointer = Join-Path $OutRoot 'current-run.txt'
if (-not $RunId) {
  if ($NewRun -or -not (Test-Path $runPointer)) {
    $RunId = 'run-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Set-Content -Path $runPointer -Value $RunId -Encoding utf8
  } else {
    $RunId = (Get-Content $runPointer -Raw).Trim()
  }
}
$runRoot = Join-Path $OutRoot $RunId
$runDir  = Join-Path $runRoot $Step
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$offsetFile = Join-Path $runRoot 'log-offsets.json'

# SQL Server here is 10.50 (2008 R2, compat 100): TRY_CONVERT does not exist,
# so any string->int coercion is done in PowerShell and inlined, or guarded in
# T-SQL with a NOT LIKE '%[^0-9]%' pattern test.
$TableCodeInt = '-1'
if ($TableCode -match '^[0-9]+$') { $TableCodeInt = $TableCode }

$script:Failures = 0

function Invoke-ReadOnlyQuery {
  param([string]$Database, [string]$Sql)
  $cs = "Server=$SqlInstance;Database=$Database;Trusted_Connection=True;Application Name=VerduraCaptureProbe;"
  $conn = New-Object System.Data.SqlClient.SqlConnection $cs
  $conn.Open()
  try {
    # Read-uncommitted so the capture can never block a live cashier, and so a
    # half-committed round is still visible rather than waited on.
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
    Write-Host ("  {0,-36} {1} row(s)" -f $Name, $dt.Rows.Count)
  } catch {
    $script:Failures++
    "ERROR: $($_.Exception.Message)" | Out-File (Join-Path $runDir "$Name.ERROR.txt") -Encoding utf8
    Write-Host ("  {0,-36} ERROR  {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
  }
}

Write-Host ''
Write-Host "=== IdealPOS capture  run=$RunId  step=$Step  table=$TableCode  at $stamp ===" -ForegroundColor Cyan

# ---------------------------------------------------------------- processes
# Captured first: if a PID changed between steps, a component restarted and
# every in-memory-state conclusion for that step is suspect.
$procs = @(Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match '^(IPS|Idealpos|POSServer|ipsdeploy)' } |
  Select-Object ProcessId, ParentProcessId, Name, CreationDate)
$procs | ConvertTo-Json -Depth 4 | Out-File (Join-Path $runDir 'processes.json') -Encoding utf8
Write-Host ("  {0,-36} {1} process(es)" -f 'processes', $procs.Count)

# ------------------------------------------------------------- IPSTransaction
# UNFILTERED -- see the header note. 47 rows total on this installation.
Save-Table 'ipstx.PendingSales' 'IPSTransaction' @"
SELECT ID, Code, POS, [Date], CustomerID, ClerkID, Status, OrderState, ReadyForPayment,
       Prepayment, SentOnline, ISNULL(Label,'') AS Label, ISNULL(Reference,'') AS Reference,
       OrderDate
FROM dbo.PendingSales
ORDER BY ID DESC
"@

# Every line of every recent sale, with the fields the test hinges on:
# Printed (KOT-sent), OrderedTime (round), Line (stable line id), Col1 (PLU
# CODE -- NOT StockItems.ID; verified on sale 4527), Col3/Col4 (qty/price as
# IdealPOS resolved them). Scoped to the 60 newest sales, which on this
# installation is the entire store.
Save-Table 'ipstx.PendingSaleLines' 'IPSTransaction' @"
SELECT l.PendingSaleID, l.Line, l.Col0, l.Col1, l.Col2, l.Col3, l.Col4, l.Col5, l.Col6,
       l.Printed, l.OrderedTime, l.Person, l.SeatNumber, l.ClerkID, l.LocationSold,
       l.Balance, l.PayThis, l.QtyPaying, l.SentOnline
FROM dbo.PendingSaleLines l
WHERE l.PendingSaleID IN (SELECT TOP 60 ID FROM dbo.PendingSales ORDER BY ID DESC)
ORDER BY l.PendingSaleID DESC, l.Line
"@

# TableActivity is, on this installation, the only durable record that ties a
# real table number to a moment in time. Captured for every table, not just
# the one under test, so the open event is visible however the sale is keyed
# and so concurrent activity on other tables is attributable.
Save-Table 'ipstx.TableActivity.recent' 'IPSTransaction' @"
SELECT TOP 60 [Table], MapCode, [Date], Guests, SentOnline
FROM dbo.TableActivity
ORDER BY [Date] DESC
"@
Save-Table 'ipstx.TableActivity.thisTable' 'IPSTransaction' @"
SELECT TOP 30 [Table], MapCode, [Date], Guests, SentOnline
FROM dbo.TableActivity
WHERE [Table] = $TableCodeInt
ORDER BY [Date] DESC
"@

# Where a closed sale goes. Transactions is keyed (Cons,POS) and carries no
# PendingSaleID, so the close step is what tells us whether ANY identifier
# survives -- TransactionReference is the structural candidate and is empty today.
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
# for exactly the PLUs on the sales we captured lines for. Joined on
# StockItems.Code, because PendingSaleLines.Col1 is the PLU CODE -- joining on
# StockItems.ID returns entirely different products (verified on sale 4527).
Save-Table 'ipstx.PriceConfig.forRecentPLUs' 'IPSTransaction' @"
SELECT DISTINCT si.ID AS StockItemID, si.Code AS PluCode, si.Description,
       v.[Type], v.[Level], v.Value
FROM dbo.PendingSaleLines l
JOIN dbo.StockItems si     ON si.Code = LTRIM(RTRIM(l.Col1))
JOIN dbo.StockItemsValue v ON v.StockItemID = si.ID
WHERE l.PendingSaleID IN (SELECT TOP 10 ID FROM dbo.PendingSales ORDER BY ID DESC)
ORDER BY si.Code, v.[Type], v.[Level]
"@

# KOT routing config for those same PLUs -- which pending printer each goes to.
Save-Table 'ipstx.PrintRouting.forRecentPLUs' 'IPSTransaction' @"
SELECT DISTINCT si.ID, si.Code AS PluCode, si.Description,
       si.PrintPend1, si.PrintPend2, si.PrintPend3, si.PrintPend4,
       si.PrintPend5, si.PrintPend6, si.PrintReceipt, si.ComponentsPendPrint
FROM dbo.PendingSaleLines l
JOIN dbo.StockItems si ON si.Code = LTRIM(RTRIM(l.Col1))
WHERE l.PendingSaleID IN (SELECT TOP 10 ID FROM dbo.PendingSales ORDER BY ID DESC)
"@

# ------------------------------------------------------------------ POSServer
# The replica/read model the Bridge currently reads. Captured to show what an
# integration reading POSServer alone would and would not have seen. Map is
# the column that separates a real table-map sale (Map 1 here) from a
# takeaway/web ticket (Map 0) -- IPSTransaction has no equivalent column.
Save-Table 'posserver.PendingSales' 'POSServer' @"
SELECT ID, Code, Map, POS, DateModified, Customer, ClerkID, Status, Label, OrderDate, ReadyForPayment
FROM dbo.PendingSales ORDER BY ID DESC
"@
Save-Table 'posserver.PendingSaleLines' 'POSServer' @"
SELECT PendingSaleID, Line, Col0, Col1, Col2, Col3, Col4, Col5, Col6, Printed,
       Person, Balance, PayThis, QtyPaying, SeatNumber, ClerkID, LocationSold, OrderedTime
FROM dbo.PendingSaleLines ORDER BY PendingSaleID DESC, Line
"@

# The WHOLE table map, every step. Table 5 changing Status/Amount/GuestsSaved
# here is the most direct signal that the till action landed, and capturing
# all 19 shows that nothing else moved at the same moment.
Save-Table 'posserver.TableMapSetups' 'POSServer' @"
SELECT Code, ItemType, ItemIndex, Name, Caption, Status, Amount, GuestsSaved, StartTime
FROM dbo.TableMapSetups
ORDER BY Code, ItemType, ItemIndex
"@

# ----------------------------------------------------------------------- logs
# Only the bytes appended since the previous step of THIS run, so each capture
# directory contains exactly the evidence for one operator action.
$logs = [ordered]@{
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
$missingLogs = @()
foreach ($name in $logs.Keys) {
  $path = $logs[$name]
  if (-not (Test-Path $path)) {
    $missingLogs += $name
    Write-Host ("  {0,-36} MISSING" -f "log.$name") -ForegroundColor Yellow
    continue
  }
  $len = (Get-Item $path).Length
  $prev = 0
  if ($offsets.ContainsKey($name)) { $prev = $offsets[$name] }
  # A shrunken file means the log rolled; take it from the start.
  if ($len -lt $prev) { $prev = 0 }
  if ($len -gt $prev) {
    $fs = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
      [void]$fs.Seek($prev, 'Begin')
      $buf = New-Object byte[] ($len - $prev)
      [void]$fs.Read($buf, 0, $buf.Length)
      [System.Text.Encoding]::UTF8.GetString($buf) |
        Out-File (Join-Path $runDir "log.$name.new.txt") -Encoding utf8
    } finally { $fs.Close() }
  }
  Write-Host ("  {0,-36} +{1} byte(s)" -f "log.$name", ($len - $prev))
  $offsets[$name] = $len
}
$offsets | ConvertTo-Json | Out-File $offsetFile -Encoding utf8

# --------------------------------------------------------------------- manifest
[pscustomobject]@{
  RunId           = $RunId
  Step            = $Step
  TableCode       = $TableCode
  CapturedAtLocal = $stamp
  CapturedAtUtc   = (Get-Date).ToUniversalTime().ToString('o')
  SqlInstance     = $SqlInstance
  ReadOnly        = $true
  QueryFailures   = $script:Failures
  MissingLogs     = $missingLogs
  IdealposPids    = (($procs | ForEach-Object { "$($_.Name)=$($_.ProcessId)" }) -join ',')
  Note            = 'SELECT-only. No writes, no protocol transmission, no printer-routing change.'
} | ConvertTo-Json | Out-File (Join-Path $runDir 'manifest.json') -Encoding utf8

if ($Preflight) {
  $ok = ($script:Failures -eq 0)
  Write-Host ''
  Write-Host '--- PREFLIGHT ---' -ForegroundColor Cyan
  Write-Host ("  query failures : {0}" -f $script:Failures) -ForegroundColor $(if ($script:Failures) { 'Red' } else { 'Green' })
  Write-Host ("  missing logs   : {0}" -f $(if ($missingLogs.Count) { $missingLogs -join ', ' } else { 'none' })) -ForegroundColor $(if ($missingLogs.Count) { 'Yellow' } else { 'Green' })
  Write-Host ("  idealpos procs : {0}" -f $procs.Count) -ForegroundColor $(if ($procs.Count -ge 4) { 'Green' } else { 'Yellow' })
  Write-Host ("  verdict        : {0}" -f $(if ($ok) { 'READY' } else { 'NOT READY' })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
}

Write-Host "=== written to $runDir ===" -ForegroundColor Green
if ($script:Failures -gt 0) {
  Write-Host "!!! $($script:Failures) query error(s) -- see *.ERROR.txt" -ForegroundColor Red
}
