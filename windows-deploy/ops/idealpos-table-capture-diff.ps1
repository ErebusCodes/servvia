<#
.SYNOPSIS
  Offline analysis of two IdealPOS capture steps. Reads JSON only -- it never
  connects to SQL, never touches IdealPOS, and can be run anywhere.

.DESCRIPTION
  idealpos-table-capture.ps1 writes a full snapshot per step. The question the
  live test actually asks is not "what is there" but "what did THAT ONE
  operator action change" -- which rows appeared, which disappeared, and which
  fields moved. This script answers that by keyed row comparison.

  Each dataset is compared on its natural key. A row present only in the later
  step is ADDED, present only in the earlier step is REMOVED, and present in
  both with differing values is CHANGED, listing field-by-field before/after.

  The step pairs that matter for the two-round test:

    00-baseline -> 01-open    Where does an open table sale materialise, and
                              under what key? (Q1, Q5)
    01-open     -> 02-add-A   What does adding a PLU write, and did IdealPOS
                              resolve the price itself? (Q10, Q11)
    02-add-A    -> 03-send-R1 Which lines flip Printed, and does OrderedTime
                              move? (Q7, Q8, Q9)
    03-send-R1  -> 04-add-B   Does round 2 append to the SAME sale? (Q6)
    04-add-B    -> 05-send-R2 Does the second send touch ONLY the new lines?
                              (Q7, Q8, Q15)
    05-send-R2  -> 06-close   Does any identifier survive into Transactions /
                              TransactionReference? (Q5, Q13)

.PARAMETER RunRoot
  The run directory, e.g.
  C:\ProgramData\Verdura\evidence\idealpos-table-capture\run-20260905-114500

.PARAMETER From
  Earlier step name, e.g. 02-add-A.

.PARAMETER To
  Later step name, e.g. 03-send-R1.

.PARAMETER All
  Diff every consecutive pair of steps found in the run, in name order.

.PARAMETER OutFile
  Also write the report to this path.

.EXAMPLE
  .\idealpos-table-capture-diff.ps1 -RunRoot <run> -From 02-add-A -To 03-send-R1
  .\idealpos-table-capture-diff.ps1 -RunRoot <run> -All -OutFile report.txt
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$RunRoot,
  [string]$From,
  [string]$To,
  [switch]$All,
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'

# Natural key per dataset. A dataset with no entry here is compared on the
# whole row, which is correct but noisier -- add a key when one is known.
$Keys = @{
  'ipstx.PendingSales'              = @('ID')
  'ipstx.PendingSaleLines'          = @('PendingSaleID', 'Line')
  'ipstx.TableActivity.recent'      = @('Table', 'Date')
  'ipstx.TableActivity.thisTable'   = @('Table', 'Date')
  'ipstx.Transactions.recent'       = @('Cons', 'POS')
  'ipstx.TransactionsLine.recent'   = @('TransactionID', 'Line')
  'ipstx.TransactionReference'      = @('Cons', 'POS')
  'ipstx.WebPendingOrder'           = @('ID')
  'ipstx.PriceConfig.forRecentPLUs' = @('StockItemID', 'Type', 'Level')
  'ipstx.PrintRouting.forRecentPLUs'= @('ID')
  'posserver.PendingSales'          = @('ID')
  'posserver.PendingSaleLines'      = @('PendingSaleID', 'Line')
  'posserver.TableMapSetups'        = @('Code', 'ItemType', 'ItemIndex')
  'processes'                       = @('ProcessId')
}

$script:Out = New-Object System.Collections.Generic.List[string]
function Emit { param([string]$Text = '') ; $script:Out.Add($Text) ; Write-Host $Text }

function Get-Rows {
  param([string]$Dir, [string]$Name)
  $path = Join-Path $Dir "$Name.json"
  if (-not (Test-Path $path)) { return $null }
  $raw = Get-Content $path -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
  $parsed = $raw | ConvertFrom-Json
  if ($null -eq $parsed) { return @() }
  # A single-row result deserialises as one object, not an array.
  return @($parsed)
}

function Get-KeyValue {
  param($Row, [string[]]$KeyFields)
  if (-not $KeyFields) {
    return (($Row.PSObject.Properties | Sort-Object Name |
             ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '|')
  }
  return (($KeyFields | ForEach-Object {
             $v = $Row.PSObject.Properties[$_]
             if ($null -eq $v) { '<missing>' } else { "$($v.Value)" }
           }) -join '|')
}

function Format-Row {
  param($Row, [int]$MaxFields = 12)
  $parts = @()
  $n = 0
  foreach ($p in $Row.PSObject.Properties) {
    if ($n -ge $MaxFields) { $parts += '...'; break }
    $val = "$($p.Value)".Trim()
    if ($val -eq '') { $val = '-' }
    $parts += "$($p.Name)=$val"
    $n++
  }
  return ($parts -join '  ')
}

function Compare-Dataset {
  param([string]$Name, $FromRows, $ToRows)

  if ($null -eq $FromRows -and $null -eq $ToRows) { return }
  if ($null -eq $FromRows) { Emit "  [$Name] not captured in FROM step" ; return }
  if ($null -eq $ToRows)   { Emit "  [$Name] not captured in TO step"   ; return }

  $keyFields = $Keys[$Name]
  $fromMap = @{}
  foreach ($r in $FromRows) { $fromMap[(Get-KeyValue $r $keyFields)] = $r }
  $toMap = @{}
  foreach ($r in $ToRows) { $toMap[(Get-KeyValue $r $keyFields)] = $r }

  $added   = @($toMap.Keys   | Where-Object { -not $fromMap.ContainsKey($_) })
  $removed = @($fromMap.Keys | Where-Object { -not $toMap.ContainsKey($_) })
  $changed = New-Object System.Collections.Generic.List[object]

  foreach ($k in $toMap.Keys) {
    if (-not $fromMap.ContainsKey($k)) { continue }
    $a = $fromMap[$k]; $b = $toMap[$k]
    $deltas = @()
    foreach ($p in $b.PSObject.Properties) {
      $old = $a.PSObject.Properties[$p.Name]
      $oldVal = if ($null -eq $old) { '<absent>' } else { "$($old.Value)" }
      $newVal = "$($p.Value)"
      if ($oldVal -ne $newVal) { $deltas += "$($p.Name): '$oldVal' -> '$newVal'" }
    }
    if ($deltas.Count) { $changed.Add([pscustomobject]@{ Key = $k; Deltas = $deltas }) }
  }

  if (-not $added.Count -and -not $removed.Count -and -not $changed.Count) {
    Emit ("  [{0}] unchanged ({1} row(s))" -f $Name, $ToRows.Count)
    return
  }

  Emit ("  [{0}] +{1} added  -{2} removed  ~{3} changed" -f $Name, $added.Count, $removed.Count, $changed.Count)
  foreach ($k in ($added | Sort-Object)) {
    Emit ("      + {0}" -f (Format-Row $toMap[$k]))
  }
  foreach ($k in ($removed | Sort-Object)) {
    Emit ("      - {0}" -f (Format-Row $fromMap[$k]))
  }
  foreach ($c in $changed) {
    Emit ("      ~ key {0}" -f $c.Key)
    foreach ($d in $c.Deltas) { Emit ("          {0}" -f $d) }
  }
}

# -------------------------------------------------------- candidate summary
# A flat roll-up of the structural changes this one action produced, gathered
# from the SAME keyed comparison the detail section uses.
#
# It deliberately does NOT nominate which row "is Table 5". The whole point of
# removing the Code filter was to stop the tooling asserting a keying premise;
# reintroducing a guess here in friendlier wording would be the same mistake
# with a nicer face. It reports what appeared and what changed, simultaneously,
# and the human decides what that means against the physical action they just
# performed and the docket in their hand.
function Get-DeltaKeys {
  param($FromRows, $ToRows, [string[]]$KeyFields)
  $added = New-Object System.Collections.Generic.List[object]
  $changed = New-Object System.Collections.Generic.List[object]
  if ($null -eq $FromRows -or $null -eq $ToRows) {
    return @{ Added = @(); Changed = @() }
  }
  $fromMap = @{}
  foreach ($r in $FromRows) { $fromMap[(Get-KeyValue $r $KeyFields)] = $r }
  foreach ($r in $ToRows) {
    $k = Get-KeyValue $r $KeyFields
    if (-not $fromMap.ContainsKey($k)) { [void]$added.Add($r); continue }
    $a = $fromMap[$k]
    foreach ($p in $r.PSObject.Properties) {
      $old = $a.PSObject.Properties[$p.Name]
      $oldVal = if ($null -eq $old) { '<absent>' } else { "$($old.Value)" }
      if ($oldVal -ne "$($p.Value)") { [void]$changed.Add($r); break }
    }
  }
  return @{ Added = @($added.ToArray()); Changed = @($changed.ToArray()) }
}

function Write-CandidateSummary {
  param([string]$FromDir, [string]$ToDir)

  $sections = @(
    @{ Label = 'NEW IPSTransaction PendingSales';     Name = 'ipstx.PendingSales';        Key = @('ID');                                Show = @('ID','Code','POS','Status','OrderState','Label','Reference','Date'); Part = 'Added' }
    @{ Label = 'CHANGED IPSTransaction PendingSales'; Name = 'ipstx.PendingSales';        Key = @('ID');                                Show = @('ID','Code','POS','Status','OrderState','Label','Reference'); Part = 'Changed' }
    @{ Label = 'NEW POSServer PendingSales';          Name = 'posserver.PendingSales';    Key = @('ID');                                Show = @('ID','Code','Map','POS','Status','DateModified'); Part = 'Added' }
    @{ Label = 'CHANGED POSServer PendingSales';      Name = 'posserver.PendingSales';    Key = @('ID');                                Show = @('ID','Code','Map','POS','Status','DateModified'); Part = 'Changed' }
    @{ Label = 'CHANGED TableMapSetups rows';         Name = 'posserver.TableMapSetups';  Key = @('Code','ItemType','ItemIndex');       Show = @('Code','ItemType','ItemIndex','Status','Amount','GuestsSaved','StartTime'); Part = 'Changed' }
    @{ Label = 'NEW IPSTransaction PendingSaleLines'; Name = 'ipstx.PendingSaleLines';    Key = @('PendingSaleID','Line');              Show = @('PendingSaleID','Line','Col1','Col2','Col3','Col4','Printed','OrderedTime'); Part = 'Added' }
    @{ Label = 'CHANGED IPSTransaction PendingSaleLines'; Name = 'ipstx.PendingSaleLines'; Key = @('PendingSaleID','Line');             Show = @('PendingSaleID','Line','Col1','Col3','Col4','Printed','OrderedTime'); Part = 'Changed' }
    @{ Label = 'NEW POSServer PendingSaleLines';      Name = 'posserver.PendingSaleLines'; Key = @('PendingSaleID','Line');             Show = @('PendingSaleID','Line','Col1','Col2','Col3','Col4','Printed','OrderedTime'); Part = 'Added' }
    @{ Label = 'CHANGED POSServer PendingSaleLines';  Name = 'posserver.PendingSaleLines'; Key = @('PendingSaleID','Line');             Show = @('PendingSaleID','Line','Col1','Col3','Col4','Printed','OrderedTime'); Part = 'Changed' }
    @{ Label = 'NEW TableActivity rows';              Name = 'ipstx.TableActivity.recent'; Key = @('Table','Date');                     Show = @('Table','MapCode','Date','Guests'); Part = 'Added' }
    @{ Label = 'NEW Transactions rows';               Name = 'ipstx.Transactions.recent'; Key = @('Cons','POS');                        Show = @('Cons','POS','Date'); Part = 'Added' }
    @{ Label = 'NEW TransactionReference rows';       Name = 'ipstx.TransactionReference'; Key = @('Cons','POS');                       Show = @('Cons','POS','Reference','UserDefinedText'); Part = 'Added' }
  )

  $lines = New-Object System.Collections.Generic.List[string]
  $anything = $false
  foreach ($s in $sections) {
    $delta = Get-DeltaKeys (Get-Rows $FromDir $s['Name']) (Get-Rows $ToDir $s['Name']) $s['Key']
    $rows = @($delta[$s['Part']])
    if (-not $rows.Count) { continue }
    $anything = $true
    [void]$lines.Add(("  {0} ({1}):" -f $s['Label'], $rows.Count))
    foreach ($r in $rows) {
      $parts = @()
      foreach ($f in $s['Show']) {
        $p = $r.PSObject.Properties[$f]
        if ($null -eq $p) { continue }
        $v = "$($p.Value)".Trim(); if ($v -eq '') { $v = '-' }
        $parts += "$f=$v"
      }
      [void]$lines.Add('      ' + ($parts -join '  '))
    }
  }

  Emit ''
  Emit '  ---------------- candidate-new-sale (delta only) ----------------'
  if (-not $anything) {
    Emit '  No structural change in any sale, line, map or activity dataset.'
  } else {
    foreach ($l in $lines) { Emit $l }
    Emit ''
    Emit '  This section reports WHAT CHANGED, simultaneously, and nominates'
    Emit '  nothing as "the Table 5 sale". Decide that from the action you just'
    Emit '  performed and the physical docket, not from this tool.'
  }
}

function Compare-Step {
  param([string]$FromStep, [string]$ToStep)

  $fromDir = Join-Path $RunRoot $FromStep
  $toDir   = Join-Path $RunRoot $ToStep
  if (-not (Test-Path $fromDir)) { Emit "SKIP: no step directory '$FromStep'" ; return }
  if (-not (Test-Path $toDir))   { Emit "SKIP: no step directory '$ToStep'"   ; return }

  Emit ''
  Emit ('=' * 78)
  Emit "STEP DELTA:  $FromStep  ->  $ToStep"
  Emit ('=' * 78)

  foreach ($m in @($fromDir, $toDir)) {
    $mf = Join-Path $m 'manifest.json'
    if (Test-Path $mf) {
      $man = Get-Content $mf -Raw | ConvertFrom-Json
      Emit ("  {0,-12} captured {1}   failures={2}   pids={3}" -f $man.Step, $man.CapturedAtLocal, $man.QueryFailures, $man.IdealposPids)
    }
  }

  # A PID change between steps invalidates every in-memory conclusion drawn
  # across that boundary, so it is called out before any data delta.
  $pFrom = Get-Rows $fromDir 'processes'
  $pTo   = Get-Rows $toDir   'processes'
  if ($pFrom -and $pTo) {
    $idsFrom = ($pFrom | ForEach-Object { "$($_.Name):$($_.ProcessId)" } | Sort-Object) -join ','
    $idsTo   = ($pTo   | ForEach-Object { "$($_.Name):$($_.ProcessId)" } | Sort-Object) -join ','
    if ($idsFrom -ne $idsTo) {
      Emit ''
      Emit '  *** WARNING: IdealPOS process set changed between these steps. ***'
      Emit '  *** A component restarted; treat in-memory-state conclusions   ***'
      Emit '  *** across this boundary as unsafe.                            ***'
    }
  }

  Write-CandidateSummary -FromDir $fromDir -ToDir $toDir

  Emit ''
  $names = @(Get-ChildItem -Path $toDir -Filter '*.json' |
             ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) } |
             Where-Object { $_ -ne 'manifest' } | Sort-Object)
  foreach ($n in $names) {
    Compare-Dataset -Name $n -FromRows (Get-Rows $fromDir $n) -ToRows (Get-Rows $toDir $n)
  }

  # Log tails belong to the TO step by construction: the capture emits only
  # bytes appended since the previous step.
  $logFiles = @(Get-ChildItem -Path $toDir -Filter 'log.*.new.txt' -ErrorAction SilentlyContinue)
  if ($logFiles.Count) {
    Emit ''
    Emit '  --- log bytes produced by this action ---'
    foreach ($lf in $logFiles) {
      $lines = @(Get-Content $lf.FullName | Where-Object { $_.Trim() -ne '' })
      Emit ("  [{0}] {1} line(s)" -f $lf.Name, $lines.Count)
      foreach ($l in ($lines | Select-Object -First 40)) { Emit "      $l" }
      if ($lines.Count -gt 40) { Emit ("      ... {0} more line(s)" -f ($lines.Count - 40)) }
    }
  }
}

if (-not (Test-Path $RunRoot)) { throw "Run directory not found: $RunRoot" }

if ($All) {
  # Order by capture time, not by name. PowerShell's default Sort-Object is
  # culture-aware and ignores punctuation, so '00b-idle' sorts BEFORE
  # '00-preflight' -- which silently reverses a step pair and inverts every
  # delta in the report. Capture time is the only ordering that cannot lie;
  # ordinal name is the fallback for a directory missing its manifest.
  $steps = @(Get-ChildItem -Path $RunRoot -Directory | ForEach-Object {
      $mf = Join-Path $_.FullName 'manifest.json'
      $when = $null
      if (Test-Path $mf) {
        try { $when = [datetime]::Parse((Get-Content $mf -Raw | ConvertFrom-Json).CapturedAtUtc) } catch { $when = $null }
      }
      [pscustomobject]@{ Name = $_.Name; When = $when }
    } | Sort-Object @{ Expression = { $_.When } }, @{ Expression = { $_.Name } } |
    Select-Object -ExpandProperty Name)
  if ($steps.Count -lt 2) { throw "Need at least two step directories under $RunRoot; found $($steps.Count)." }
  Emit "Run: $RunRoot"
  Emit ("Steps: {0}" -f ($steps -join ' -> '))
  for ($i = 0; $i -lt $steps.Count - 1; $i++) {
    Compare-Step -FromStep $steps[$i] -ToStep $steps[$i + 1]
  }
} else {
  if (-not $From -or -not $To) { throw 'Provide -From and -To, or use -All.' }
  Emit "Run: $RunRoot"
  Compare-Step -FromStep $From -ToStep $To
}

if ($OutFile) {
  $script:Out | Out-File $OutFile -Encoding utf8
  Write-Host ""
  Write-Host "report written to $OutFile" -ForegroundColor Green
}
