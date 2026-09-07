<#
.SYNOPSIS
  READ-ONLY evidence capture for Front / Machine 2 (DESKTOP-70DQTGJ), the
  IdealPOS till that holds the Ideal Handheld entitlement.

.DESCRIPTION
  One run. No transmission. This script answers, from the machine's own
  reporting of itself, the questions that Back / Machine 1 physically cannot
  answer:

    WAITERPAD-BIND-001     is a WaiterPad listener actually bound on Front,
                           on which port, owned by which executable?
    WAITERPAD-CHECKSUM-001 does a genuine <Checksum> value exist in Front's
                           handheld log, with the packet it belonged to?
    WAITERPAD-REGO-001     what does a real device registration look like,
                           and how many handheld slots does Front's licence
                           actually grant?
    WAITERPAD-RECON-001    did a handheld order ever take the POSServer relay
                           path (IH-DATA / ProcessHandheldOrder) rather than
                           the socket path (WPOrder)?

  WHAT THIS SCRIPT WILL NOT DO, EVER
  ----------------------------------
  It opens no socket. There is no Test-NetConnection, no TcpClient, no
  Invoke-WebRequest, no Test-Path against a UNC share, no ping. It does not
  start, stop, restart or configure anything. It writes only inside its own
  output directory. It reads IdealPOS files; it never writes one.

  A grep of this file for the following must return nothing outside this
  comment block: TcpClient, Test-NetConnection, Invoke-WebRequest,
  Invoke-RestMethod, Start-Service, Stop-Service, Restart-Service,
  Stop-Process, Set-ItemProperty, New-ItemProperty, Remove-Item.
  Section 99 asserts exactly that against the script's own text before the
  operator is told the capture succeeded.

  WHY THE LISTENER TABLE IS CAPTURED WHOLE, NOT PROBED FOR 6983
  ------------------------------------------------------------
  TCP 6983 is PROVEN STATIC from the IPS.exe binary and NOTHING MORE. It has
  never been observed bound anywhere. If this script asked "is 6983 open?" it
  would confirm its own expectation and learn nothing about the ports it did
  not think to ask about. So section 01 records every listening socket with
  its owner, and section 90 reports what was found WITHOUT filtering. If the
  handheld listener turns out to be on some other port, this capture will say
  so.

  Equally: do not read a port's mere presence as proof of the handheld
  feature. IPS.exe and IPSWorker.exe are BYTE-IDENTICAL on Back
  (SHA-256 F18475A7...A520E, 40,143,120 bytes, 2023-09-11), so both images
  contain the code for 6983, 7983 and 12183. Which port a process binds is a
  runtime fact about that process, not a property of the file. That is why
  section 03 records PID, path, command line and start time for every
  IdealPOS process, and why section 01 joins listeners to owners by PID.

.PARAMETER OutputRoot
  Parent directory for the timestamped capture folder. Created if absent.

.PARAMETER ExpectedHost
  The machine this capture is meant to run on. A mismatch is reported loudly
  and recorded in the manifest, but does not stop the run -- a read-only
  capture of the wrong machine is still evidence about that machine, and
  silently refusing would be worse than labelling it.

.PARAMETER IdealposRoot
  IdealPOS program directory. Auto-detected when omitted.

.PARAMETER MaxLogCopyMB
  Total budget for copied log files. Files are copied newest-first within
  each glob so a budget overrun loses the oldest history, never the recent
  evidence. What was skipped is recorded.

.PARAMETER SkipDatabaseCopy
  Skip copying ips.mdb / zz.sqlite. Reading them cannot affect IdealPOS, but
  a live Jet database read while the till is running may be internally torn.
  The copies are still worth taking -- the handheld CONFIG KEYS and the
  WaiterPads table name survive a torn read -- so they are on by default and
  flagged as possibly-inconsistent rather than omitted.

.EXAMPLE
  # On DESKTOP-70DQTGJ, in the interactive desktop session of the user that
  # runs IdealPOS, with the till running as it does during service:
  powershell -ExecutionPolicy Bypass -File .\front-passive-capture.ps1

.NOTES
  Windows PowerShell 5.1 compatible. No ternary, no ??, no pipeline chain
  operators.
#>
[CmdletBinding()]
param(
  [string]$OutputRoot   = 'C:\verdura-capture',
  [string]$ExpectedHost = 'DESKTOP-70DQTGJ',
  [string]$IdealposRoot,
  [int]$MaxLogCopyMB    = 200,
  [switch]$SkipDatabaseCopy
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# --------------------------------------------------------------------------
# Section 00 -- identity, and the directory everything lands in
# --------------------------------------------------------------------------

$started    = Get-Date
$stamp      = $started.ToString('yyyyMMdd-HHmmss')
$thisHost   = $env:COMPUTERNAME
$captureDir = Join-Path $OutputRoot ("front-capture-{0}-{1}" -f $thisHost, $stamp)

New-Item -ItemType Directory -Path $captureDir -Force | Out-Null
$transcript = Join-Path $captureDir '00-transcript.txt'
try { Start-Transcript -Path $transcript -Force | Out-Null } catch { }

function Write-Section {
  param([string]$Name, [string]$Text)
  $path = Join-Path $captureDir $Name
  $Text | Out-File -LiteralPath $path -Encoding utf8
  Write-Host ("  wrote {0}" -f $Name)
}

function Out-Text {
  param($InputObject)
  if ($null -eq $InputObject) { return '<none>' }
  $s = ($InputObject | Format-Table -AutoSize | Out-String -Width 240)
  if ([string]::IsNullOrWhiteSpace($s)) { return '<none>' }
  return $s
}

function Get-SafeHash {
  param([string]$Path)
  try { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash }
  catch { return '<unreadable>' }
}

Write-Host ''
Write-Host '=========================================================='
Write-Host ' Verdura -- Front / Machine 2 PASSIVE capture'
Write-Host ' READ ONLY. Nothing is transmitted. Nothing is changed.'
Write-Host '=========================================================='
Write-Host ("  host        : {0}" -f $thisHost)
Write-Host ("  expected    : {0}" -f $ExpectedHost)
Write-Host ("  output      : {0}" -f $captureDir)
Write-Host ''

$hostMatches = ($thisHost -eq $ExpectedHost)
if (-not $hostMatches) {
  Write-Warning ("This is {0}, not the expected {1}. The capture will continue and is still" -f $thisHost, $ExpectedHost)
  Write-Warning  "valid evidence ABOUT THIS MACHINE, but it must not be filed as Front evidence."
}

$ipv4 = @()
try {
  $ipv4 = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
          Where-Object { $_.IPAddress -notlike '127.*' } |
          Select-Object IPAddress, InterfaceAlias, PrefixLength
} catch { }

$sessionId = -1
try { $sessionId = (Get-Process -Id $PID).SessionId } catch { }

$osInfo = $null
try { $osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop } catch { }

$identity = @()
$identity += '# 00 -- capture identity'
$identity += ''
$identity += ("hostname            : {0}" -f $thisHost)
$identity += ("expected host       : {0}" -f $ExpectedHost)
$identity += ("host matches        : {0}" -f $hostMatches)
$identity += ("captured at (local) : {0}" -f $started.ToString('yyyy-MM-dd HH:mm:ss zzz'))
$identity += ("captured at (UTC)   : {0}" -f $started.ToUniversalTime().ToString('o'))
$identity += ("windows user        : {0}\{1}" -f $env:USERDOMAIN, $env:USERNAME)
$identity += ("session id          : {0}   (0 = service context; a Session-0 run sees no till UI)" -f $sessionId)
$identity += ("powershell          : {0}" -f $PSVersionTable.PSVersion.ToString())
$identity += ("elevated            : {0}" -f ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
if ($osInfo) {
  $identity += ("os                  : {0} {1}" -f $osInfo.Caption, $osInfo.Version)
  $identity += ("last boot           : {0}" -f $osInfo.LastBootUpTime)
}
$identity += ''
$identity += '## IPv4 addresses'
$identity += (Out-Text $ipv4)
$identity += ''
$identity += 'Known venue machines, for attribution:'
$identity += '  Back  / Machine 1 : DESKTOP-SOKKOQ7  192.168.1.250  POSServer host, no handheld entitlement'
$identity += '  Front / Machine 2 : DESKTOP-70DQTGJ  192.168.1.199  the till, Ideal Handheld 2 / HandheldNumber=2'
Write-Section '01-identity.txt' ($identity -join "`r`n")

# --------------------------------------------------------------------------
# Section 01 -- the COMPLETE TCP listener table, with owners
#
# Captured whole and unfiltered. The port that matters is whichever one turns
# out to be there, not the one we expected.
# --------------------------------------------------------------------------

Write-Host 'Section 01: TCP listener table'

$procCache = @{}
try {
  foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
    if (-not $procCache.ContainsKey($p.Id)) { $procCache[$p.Id] = $p }
  }
} catch { }

$cimProc = @{}
try {
  foreach ($cp in (Get-CimInstance Win32_Process -ErrorAction Stop)) {
    $cimProc[[int]$cp.ProcessId] = $cp
  }
} catch {
  Write-Warning 'Win32_Process unavailable; command lines will be missing.'
}

function Get-OwnerRecord {
  param([int]$ProcessId)
  $name = '<unknown>'; $path = '<unknown>'; $cmd = '<unavailable>'
  $started = '<unknown>'; $sess = '<unknown>'; $ver = '<unknown>'
  if ($procCache.ContainsKey($ProcessId)) {
    $p = $procCache[$ProcessId]
    $name = $p.ProcessName
    try { $path = $p.Path } catch { $path = '<access denied>' }
    if ([string]::IsNullOrEmpty($path)) { $path = '<access denied>' }
    try { $started = $p.StartTime.ToString('s') } catch { }
    try { $sess = $p.SessionId } catch { }
  }
  if ($cimProc.ContainsKey($ProcessId)) {
    $cp = $cimProc[$ProcessId]
    if ($cp.CommandLine) { $cmd = $cp.CommandLine }
    if ($path -eq '<unknown>' -or $path -eq '<access denied>') {
      if ($cp.ExecutablePath) { $path = $cp.ExecutablePath }
    }
  }
  if ($path -and (Test-Path -LiteralPath $path -PathType Leaf -ErrorAction SilentlyContinue)) {
    try {
      $vi = (Get-Item -LiteralPath $path).VersionInfo
      $ver = ("{0} / {1}" -f $vi.FileVersion, $vi.ProductVersion)
    } catch { }
  }
  return [PSCustomObject]@{
    PID = $ProcessId; Name = $name; SessionId = $sess; Started = $started
    Version = $ver; Path = $path; CommandLine = $cmd
  }
}

$listenRows = @()
try {
  $listeners = Get-NetTCPConnection -State Listen -ErrorAction Stop
  foreach ($l in $listeners) {
    $o = Get-OwnerRecord -ProcessId ([int]$l.OwningProcess)
    $listenRows += [PSCustomObject]@{
      Port = $l.LocalPort; Address = $l.LocalAddress; PID = $o.PID
      Process = $o.Name; SessionId = $o.SessionId; Path = $o.Path
    }
  }
} catch {
  Write-Warning ("Get-NetTCPConnection failed: {0}" -f $_.Exception.Message)
}

$netstatRaw = '<netstat unavailable>'
try { $netstatRaw = (& netstat.exe -ano | Out-String) } catch { }

$listenText = @()
$listenText += '# 02 -- COMPLETE TCP listener table (unfiltered)'
$listenText += ''
$listenText += 'Every listening socket on this machine, with its owning process. Nothing'
$listenText += 'here is filtered to a port we expected. Read the whole table before'
$listenText += 'concluding anything about the WaiterPad ingress.'
$listenText += ''
$listenText += (Out-Text ($listenRows | Sort-Object Port, Address))
$listenText += ''
$listenText += '## Owning process detail (one row per distinct PID that is listening)'
$listenText += ''
$ownerRows = @()
foreach ($pidValue in ($listenRows | Select-Object -ExpandProperty PID -Unique)) {
  $ownerRows += Get-OwnerRecord -ProcessId ([int]$pidValue)
}
foreach ($o in ($ownerRows | Sort-Object Name, PID)) {
  $listenText += ("PID {0}  {1}  session {2}  started {3}" -f $o.PID, $o.Name, $o.SessionId, $o.Started)
  $listenText += ("    path    : {0}" -f $o.Path)
  $listenText += ("    version : {0}" -f $o.Version)
  $listenText += ("    cmdline : {0}" -f $o.CommandLine)
  $listenText += ''
}
$listenText += '## Raw netstat -ano, as a cross-check on the cmdlet'
$listenText += ''
$listenText += $netstatRaw
Write-Section '02-tcp-listeners.txt' ($listenText -join "`r`n")

if ($listenRows.Count -gt 0) {
  $listenRows | Sort-Object Port | Export-Csv -LiteralPath (Join-Path $captureDir '02-tcp-listeners.csv') -NoTypeInformation -Encoding UTF8
}

# --------------------------------------------------------------------------
# Section 02b -- established connections
#
# Context, not conclusions. Whether Front holds a connection to Back's
# POSServer (11000) and whether anything is connected to a handheld-looking
# port right now both bear on WAITERPAD-RECON-001.
# --------------------------------------------------------------------------

$connText = @()
$connText += '# 03 -- established TCP connections (context for the relay question)'
$connText += ''
try {
  $conns = Get-NetTCPConnection -State Established -ErrorAction Stop |
           Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess
  $enriched = @()
  foreach ($c in $conns) {
    $nm = '<unknown>'
    if ($procCache.ContainsKey([int]$c.OwningProcess)) { $nm = $procCache[[int]$c.OwningProcess].ProcessName }
    $enriched += [PSCustomObject]@{
      Local = ("{0}:{1}" -f $c.LocalAddress, $c.LocalPort)
      Remote = ("{0}:{1}" -f $c.RemoteAddress, $c.RemotePort)
      PID = $c.OwningProcess; Process = $nm
    }
  }
  $connText += (Out-Text ($enriched | Sort-Object Process, Remote))
} catch {
  $connText += ("<unavailable: {0}>" -f $_.Exception.Message)
}
Write-Section '03-tcp-established.txt' ($connText -join "`r`n")

# --------------------------------------------------------------------------
# Section 03 -- IdealPOS process identity
#
# IPS.exe and IPSWorker.exe are byte-identical, so a process name is not an
# identity and a file hash does not tell you which role a process is playing.
# PID + path + command line + start time is the identity that matters.
# --------------------------------------------------------------------------

Write-Host 'Section 03: IdealPOS process identity'

$idealNamePattern = 'IPS|Ideal|POSServer|VariPad|Handheld|Webit'
$procText = @()
$procText += '# 04 -- IdealPOS process identity'
$procText += ''
$procText += 'NOTE: IPS.exe and IPSWorker.exe were observed BYTE-IDENTICAL on Back'
$procText += '(SHA-256 F18475A784C996351048D4F537CF0CC8E2D5EE9AA7B01B38130CDADCC85A520E).'
$procText += 'Both images therefore contain the listener code for 6983, 7983 and 12183.'
$procText += 'Which port a process actually binds is a RUNTIME fact about that PID.'
$procText += 'Attribute listeners by PID, never by "which binary contains the port".'
$procText += ''

$idealProcs = @()
try {
  foreach ($p in (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $idealNamePattern })) {
    $idealProcs += Get-OwnerRecord -ProcessId $p.Id
  }
} catch { }

foreach ($o in ($idealProcs | Sort-Object Name, PID)) {
  $procText += ("PID {0}  {1}  session {2}  started {3}" -f $o.PID, $o.Name, $o.SessionId, $o.Started)
  $procText += ("    path    : {0}" -f $o.Path)
  $procText += ("    version : {0}" -f $o.Version)
  $procText += ("    sha256  : {0}" -f (Get-SafeHash $o.Path))
  $procText += ("    cmdline : {0}" -f $o.CommandLine)
  $procText += ''
}
if ($idealProcs.Count -eq 0) { $procText += '<no IdealPOS-shaped process is running on this machine right now>' }

$procText += ''
$procText += '## Every process, for completeness (name / pid / session only)'
$procText += ''
try {
  $procText += (Out-Text (Get-Process -ErrorAction SilentlyContinue |
    Select-Object @{n='Name';e={$_.ProcessName}}, Id, SessionId |
    Sort-Object Name, Id))
} catch { }
Write-Section '04-idealpos-processes.txt' ($procText -join "`r`n")

# --------------------------------------------------------------------------
# Section 04 -- installed IdealPOS files
# --------------------------------------------------------------------------

Write-Host 'Section 04: installed IdealPOS inventory'

if ([string]::IsNullOrWhiteSpace($IdealposRoot)) {
  foreach ($candidate in @(
      'C:\Program Files (x86)\Idealpos Solutions\Idealpos',
      'C:\Program Files\Idealpos Solutions\Idealpos')) {
    if (Test-Path -LiteralPath $candidate) { $IdealposRoot = $candidate; break }
  }
}

$interesting = @(
  'IPS.exe','IPSWorker.exe','IPSPrinterServer.exe','IPSDeploy.EXE','IPSClient.exe',
  'IdealPos.Licensing.exe','VariPad.dll','MTIPADLIB.dll','IPS.Data.SQL.dll',
  'IdealHandheldMenus.xml','IdealHandheldMenuItems.xml',
  'ips.exe.config','IPSWorker.exe.config'
)

$instText = @()
$instText += '# 05 -- installed IdealPOS inventory'
$instText += ''
$instText += ("IdealposRoot : {0}" -f $IdealposRoot)
$instText += ''
if ($IdealposRoot -and (Test-Path -LiteralPath $IdealposRoot)) {
  $instText += '## Files of interest (size / date / version / sha256)'
  $instText += ''
  foreach ($n in $interesting) {
    $p = Join-Path $IdealposRoot $n
    if (Test-Path -LiteralPath $p -PathType Leaf) {
      $it = Get-Item -LiteralPath $p
      $v = ''
      try { $v = $it.VersionInfo.FileVersion } catch { }
      $instText += ("{0,-30} {1,12}  {2}  ver={3}" -f $n, $it.Length, $it.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'), $v)
      $instText += ("{0,-30} sha256 {1}" -f '', (Get-SafeHash $p))
    } else {
      $instText += ("{0,-30} <ABSENT>" -f $n)
    }
  }
  $instText += ''
  $instText += '## IPS.exe vs IPSWorker.exe -- same file?'
  $a = Join-Path $IdealposRoot 'IPS.exe'
  $b = Join-Path $IdealposRoot 'IPSWorker.exe'
  if ((Test-Path -LiteralPath $a) -and (Test-Path -LiteralPath $b)) {
    $ha = Get-SafeHash $a; $hb = Get-SafeHash $b
    $instText += ("IPS.exe       {0}" -f $ha)
    $instText += ("IPSWorker.exe {0}" -f $hb)
    $instText += ("identical     : {0}" -f ($ha -eq $hb))
  }
  $instText += ''
  $instText += '## Full top-level directory listing'
  $instText += ''
  $instText += (Out-Text (Get-ChildItem -LiteralPath $IdealposRoot -File -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime | Sort-Object Name))
} else {
  $instText += '<IdealPOS install directory not found>'
}
Write-Section '05-install-inventory.txt' ($instText -join "`r`n")

# --------------------------------------------------------------------------
# Section 05 -- configuration, including the handheld log watermark
#
# CurrentHandheldLogDate is the single cheapest decisive reading on this
# machine. It is the rotation watermark for the "Ideal Handheld" log
# category. On Back it reads 06/06/2019 -- the install date, alongside
# FuelConsole and Smartlink, features this venue does not use -- which is
# exactly the shape of a category that has never been written. If Front's
# value is recent, the handheld path has been exercised here.
# --------------------------------------------------------------------------

Write-Host 'Section 05: configuration and registry'

$cfgText = @()
$cfgText += '# 06 -- IdealPOS configuration'
$cfgText += ''
$cfgText += '## HKCU\SOFTWARE\VB and VBA Program Settings\Ideal POS System'
$cfgText += '## (per-user: this must be the user that RUNS IdealPOS, or the values are meaningless)'
$cfgText += ''
$vbRoot = 'HKCU:\SOFTWARE\VB and VBA Program Settings\Ideal POS System'
if (Test-Path $vbRoot) {
  foreach ($k in (Get-ChildItem $vbRoot -Recurse -ErrorAction SilentlyContinue)) {
    $cfgText += ("[{0}]" -f $k.Name)
    try {
      (Get-ItemProperty -Path $k.PSPath -ErrorAction Stop).PSObject.Properties |
        Where-Object { $_.Name -notlike 'PS*' } |
        ForEach-Object { $cfgText += ("    {0,-32} = {1}" -f $_.Name, $_.Value) }
    } catch { $cfgText += '    <unreadable>' }
    $cfgText += ''
  }
} else {
  $cfgText += '<key absent for this user -- are you running as the IdealPOS user?>'
  $cfgText += ''
}

$cfgText += '## HKLM / HKCU Idealpos Solutions keys'
$cfgText += ''
foreach ($root in @(
    'HKLM:\SOFTWARE\Idealpos Solutions',
    'HKLM:\SOFTWARE\WOW6432Node\Idealpos Solutions',
    'HKCU:\SOFTWARE\Idealpos Solutions')) {
  if (-not (Test-Path $root)) { continue }
  $cfgText += ("### {0}" -f $root)
  foreach ($k in (Get-ChildItem $root -Recurse -ErrorAction SilentlyContinue)) {
    $props = $null
    try { $props = (Get-ItemProperty -Path $k.PSPath -ErrorAction Stop).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } } catch { }
    if ($props) {
      $cfgText += ("[{0}]" -f $k.Name)
      foreach ($pr in $props) { $cfgText += ("    {0,-32} = {1}" -f $pr.Name, $pr.Value) }
    }
  }
  $cfgText += ''
}

$cfgText += '## Handheld / WaiterPad configuration keys to look for'
$cfgText += ''
$cfgText += 'These key names were read out of Back''s ips.mdb and IPS.exe. They live in'
$cfgText += 'the IdealPOS configuration store, not the registry, so the copied ips.mdb'
$cfgText += '(section 08) is where their VALUES are. Listed here so the analyst knows'
$cfgText += 'what to search that copy for:'
$cfgText += ''
$cfgText += '  HANDHELDPROTOCOL2       HANDHELDRESETSECONDS    HANDHELDCLOSESECONDS'
$cfgText += '  HANDHELDBACKGROUND      HANDHELDUNICODE         HandheldDefaultMap'
$cfgText += '  HANDHELDTABCOLOUR1..18  HandheldV7Features      HandheldPOSLayout'
$cfgText += '  HandheldItemGraphicLocation                     HandheldItemBackgroundGraphic'
$cfgText += '  HANDHELDWEBITONLY1/2/3  <- per-handheld-number; Front is HandheldNumber=2'
$cfgText += '  HandheldLog             <- gates whether "Ideal Handheld*.log" is written at all'
$cfgText += '  WaiterPadPriceLevel     WaiterPadNotes          WaiterPadCodeOrder'
$cfgText += '  ForceHandheldBillPrinterName'
$cfgText += ''
$cfgText += 'None of these sets a port. TCP 6983 is a compiled constant with no config key.'
Write-Section '06-configuration.txt' ($cfgText -join "`r`n")

# --------------------------------------------------------------------------
# Section 06 -- log inventory
# --------------------------------------------------------------------------

Write-Host 'Section 06: log inventory'

$logDirs = @()
if ($IdealposRoot) { $logDirs += (Join-Path $IdealposRoot 'LOGS') }
$logDirs += 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS'
$logDirs += 'C:\ProgramData\Idealpos Solutions\logs'
$logDirs += 'C:\ProgramData\Idealpos Solutions\POSServer\logs'
$logDirs = $logDirs | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

$invText = @()
$invText += '# 07 -- log inventory (listing only; copies are in 09-logs/)'
$invText += ''
$invText += 'The handheld log file glob is "Ideal Handheld*.*" inside the LOGS directory'
$invText += '-- read out of IPS.exe''s own log-housekeeping table at VA 0x0153a0e2, where'
$invText += 'it sits beside POSWorker*.*, POSActivity*.*, Printing*.*, Webit*.* and'
$invText += 'PrintJobs*.*. If no such file exists here, record that as the finding.'
$invText += ''
foreach ($d in $logDirs) {
  $invText += ("## {0}" -f $d)
  $invText += ''
  $files = Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue
  $invText += ("total files: {0}   total bytes: {1}" -f $files.Count, (($files | Measure-Object Length -Sum).Sum))
  $invText += ''
  $invText += (Out-Text ($files | Select-Object Name, Length, LastWriteTime | Sort-Object Name))
  $invText += ''
  $hh = $files | Where-Object { $_.Name -like 'Ideal Handheld*' }
  if ($hh) {
    $invText += '### *** Ideal Handheld log files PRESENT here ***'
    $invText += (Out-Text ($hh | Select-Object Name, Length, LastWriteTime))
  } else {
    $invText += '### no "Ideal Handheld*" file in this directory'
  }
  $invText += ''
}
Write-Section '07-log-inventory.txt' ($invText -join "`r`n")

# --------------------------------------------------------------------------
# Section 07 -- copy the logs (newest first, within a budget)
# --------------------------------------------------------------------------

Write-Host 'Section 07: copying logs'

$logCopyDir = Join-Path $captureDir '09-logs'
New-Item -ItemType Directory -Path $logCopyDir -Force | Out-Null

# Ordered by evidential value: the handheld log first, so a budget overrun
# can never be the reason it was not collected.
$globs = @(
  'Ideal Handheld*.*',
  'IPS.log', 'IPS*.log',
  'POSWorker*.*',
  'POSActivity*.*',
  'Printing*.*',
  'PrintJobs*.*',
  'Webit*.*',
  'POSServerClient*.*',
  'IPSError*.*',
  'IPSObjects*.*',
  'IPSData*.*'
)

$budgetBytes = [int64]$MaxLogCopyMB * 1MB
$copied = @(); $skipped = @(); $usedBytes = [int64]0
$seenSources = @{}

# Each source directory gets a short numbered subfolder and the file keeps its
# own name. Encoding the source path into the FILENAME blows past MAX_PATH on
# a nested output root and silently loses most of the corpus -- which is
# exactly what the first Back rehearsal of this script did.
$dirIndex = 0
$dirMap = @()

foreach ($d in $logDirs) {
  $dirIndex++
  $subName = ("dir{0}" -f $dirIndex)
  $subDir = Join-Path $logCopyDir $subName
  New-Item -ItemType Directory -Path $subDir -Force | Out-Null
  $dirMap += ("{0} = {1}" -f $subName, $d)

  foreach ($g in $globs) {
    $matched = Get-ChildItem -LiteralPath $d -File -Filter $g -ErrorAction SilentlyContinue |
               Sort-Object LastWriteTime -Descending
    foreach ($f in $matched) {
      if ($seenSources.ContainsKey($f.FullName)) { continue }
      $seenSources[$f.FullName] = $true
      $dest = Join-Path $subDir $f.Name
      if (($usedBytes + $f.Length) -gt $budgetBytes) {
        $skipped += [PSCustomObject]@{ Path = $f.FullName; Bytes = $f.Length; Reason = 'budget' }
        continue
      }
      try {
        Copy-Item -LiteralPath $f.FullName -Destination $dest -ErrorAction Stop
        $usedBytes += $f.Length
        $copied += [PSCustomObject]@{ Source = $f.FullName; Bytes = $f.Length; Modified = $f.LastWriteTime }
      } catch {
        $skipped += [PSCustomObject]@{ Path = $f.FullName; Bytes = $f.Length; Reason = ("copy failed: {0}" -f $_.Exception.Message) }
      }
    }
  }
}

($dirMap -join "`r`n") | Out-File -LiteralPath (Join-Path $logCopyDir '00-source-directories.txt') -Encoding utf8

$copyText = @()
$copyText += '# 08 -- log copy report'
$copyText += ''
$copyText += ("budget       : {0} MB" -f $MaxLogCopyMB)
$copyText += ("copied       : {0} files, {1} bytes" -f $copied.Count, $usedBytes)
$copyText += ("skipped      : {0} files" -f $skipped.Count)
$copyText += ''
$copyText += '## Copied'
$copyText += (Out-Text ($copied | Sort-Object Source))
$copyText += ''
$copyText += '## Skipped (a skipped file is a fact worth recording, not a silent gap)'
$copyText += (Out-Text ($skipped | Sort-Object Path))
Write-Section '08-log-copy-report.txt' ($copyText -join "`r`n")

# --------------------------------------------------------------------------
# Section 08 -- configuration / database copies
# --------------------------------------------------------------------------

if (-not $SkipDatabaseCopy) {
  Write-Host 'Section 08: configuration and database copies'
  $cfgCopyDir = Join-Path $captureDir '10-config'
  New-Item -ItemType Directory -Path $cfgCopyDir -Force | Out-Null
  $cfgCopied = @(); $cfgFailed = @()

  $cfgCandidates = @()
  if ($IdealposRoot) {
    $cfgCandidates += (Get-ChildItem -LiteralPath $IdealposRoot -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -match '^\.(config|ini)$' -or $_.Name -like 'IdealHandheld*' } |
      Select-Object -ExpandProperty FullName)
  }
  $cfgCandidates += 'C:\ProgramData\Idealpos Solutions\Idealpos\ips.mdb'
  $cfgCandidates += 'C:\ProgramData\Idealpos Solutions\Idealpos\zz.sqlite'

  foreach ($c in ($cfgCandidates | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $c -PathType Leaf)) { continue }
    try {
      Copy-Item -LiteralPath $c -Destination $cfgCopyDir -ErrorAction Stop
      $cfgCopied += $c
    } catch {
      $cfgFailed += ("{0} -- {1}" -f $c, $_.Exception.Message)
    }
  }

  $dbText = @()
  $dbText += '# 10 -- configuration / database copies'
  $dbText += ''
  $dbText += 'ips.mdb was copied from a RUNNING system. The copy may be internally torn'
  $dbText += 'and must never be treated as a consistent database snapshot. It is taken'
  $dbText += 'because the handheld CONFIG KEY VALUES and the presence of the WaiterPads'
  $dbText += 'table survive a torn read, and those are what we need. Reading it cannot'
  $dbText += 'affect IdealPOS; nothing was written back.'
  $dbText += ''
  $dbText += '## Copied'
  foreach ($c in $cfgCopied) { $dbText += ("  {0}" -f $c) }
  $dbText += ''
  $dbText += '## Failed (usually an exclusive lock -- that is itself a fact)'
  foreach ($c in $cfgFailed) { $dbText += ("  {0}" -f $c) }
  Write-Section '10-config-copy-report.txt' ($dbText -join "`r`n")
}

# --------------------------------------------------------------------------
# Section 09 -- token sweep over the copied corpus, WITH CONTEXT
#
# Runs against the COPIES, never the originals, so a long-running scan can
# never hold a handle on a file IdealPOS is writing.
# --------------------------------------------------------------------------

Write-Host 'Section 09: token sweep with context'

$tokens = @(
  # protocol vocabulary
  'WPPacket','WPOrder','WPType','WaiterPad','Waiter Pad','Ideal Handheld','Handheld',
  'REQUESTPROGRAM','REQUESTTABLESTATUS','PRINTBILL','ORDER2','LOGOUT',
  'NAKREGO','NAKPRINT','DUPLICATE','BAD REGO','LOCK1',
  # the acceptance / registration machinery
  'Checksum','DeviceID','WP Current Count','Waiters=','current devices',
  'Startup Listener','Setting Socket Index','Accepted connection on Socket Index',
  'HandheldLicensed','NoReceiving','HandheldProcessing',
  'Buffered packet index','Parsing from Index','DISCARDING PACKET',
  # order processing and the relay fork
  'WPOrder Processing STARTED','ProcessHandheldOrder','IdealHandheldProcessing',
  'Ready to Print','Finished sending to IKM','Printed : Table',
  'IH-DATA','IH-PRINT','IH-CMD','IH-ERROR','POSServerMessages',
  'Table is locked by','LOCKED BY','Sending UNLOCK command',
  # pricing
  '-9999','PriceLevel','Item Not Found','OPEN STOCK ITEM',
  # licence / identity
  'License Enabled','Options=','HandheldNumber','POSNumber','Ideal Handheld 2',
  # ports, as literals in case any of them is ever logged
  '6983','7983','11183','12183','13184','11000'
)

$sweepPath = Join-Path $captureDir '11-token-sweep.txt'
$sweepSummaryPath = Join-Path $captureDir '11-token-summary.txt'
$sweepFiles = Get-ChildItem -LiteralPath $logCopyDir -File -Recurse -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -ne '00-source-directories.txt' }

$summary = @()
$summary += '# 11 -- token sweep summary (counts per token across the copied corpus)'
$summary += ''
$summary += ("files scanned : {0}" -f $sweepFiles.Count)
$summary += ''

"# 11 -- token sweep, with 6 lines of context either side" | Out-File -LiteralPath $sweepPath -Encoding utf8
"" | Out-File -LiteralPath $sweepPath -Encoding utf8 -Append
"Matches are quoted from COPIES in 09-logs/. Line numbers refer to the copy." | Out-File -LiteralPath $sweepPath -Encoding utf8 -Append
"" | Out-File -LiteralPath $sweepPath -Encoding utf8 -Append

foreach ($t in $tokens) {
  $hits = @()
  try {
    $hits = $sweepFiles | Select-String -SimpleMatch -Pattern $t -Context 6, 6 -ErrorAction SilentlyContinue
  } catch { }
  $count = 0
  if ($hits) { $count = @($hits).Count }
  $summary += ("{0,-34} {1}" -f $t, $count)
  if ($count -gt 0) {
    ("=" * 78) | Out-File -LiteralPath $sweepPath -Encoding utf8 -Append
    ("TOKEN: {0}   ({1} matches)" -f $t, $count) | Out-File -LiteralPath $sweepPath -Encoding utf8 -Append
    ("=" * 78) | Out-File -LiteralPath $sweepPath -Encoding utf8 -Append
    # Cap per token so one noisy token cannot bury the rest.
    $shown = @($hits) | Select-Object -First 60
    foreach ($h in $shown) {
      ("--- {0}:{1}" -f $h.Filename, $h.LineNumber) | Out-File -LiteralPath $sweepPath -Encoding utf8 -Append
      ($h | Out-String) | Out-File -LiteralPath $sweepPath -Encoding utf8 -Append
    }
    if ($count -gt 60) {
      ("... {0} further matches not shown; grep the copies in 09-logs/" -f ($count - 60)) |
        Out-File -LiteralPath $sweepPath -Encoding utf8 -Append
    }
  }
}
$summary -join "`r`n" | Out-File -LiteralPath $sweepSummaryPath -Encoding utf8
Write-Host '  wrote 11-token-sweep.txt / 11-token-summary.txt'

# --------------------------------------------------------------------------
# Section 10 -- licence lines, pulled out on their own
# --------------------------------------------------------------------------

$licText = @()
$licText += '# 12 -- licence lines from this machine''s own logs'
$licText += ''
$licText += 'Back logs: "UserName=Sila Restaurant  POSNumber=1  Options=Pack 2  License'
$licText += 'Enabled=True : Type=2" -- no handheld entitlement. Front is expected to'
$licText += 'differ. Whatever this machine logs is the first-party record of its'
$licText += 'entitlement, and it supersedes any operator-transcribed value.'
$licText += ''
$licText += 'The handheld device-registration cap is the licensed handheld count: IPS.exe'
$licText += 'reads it from the licensing object into a global, logs it as " - Waiters=",'
$licText += 'and refuses a new DeviceID with BAD REGO / NAKREGO once the count of'
$licText += 'currently registered devices reaches it. So this number is also the number'
$licText += 'of handheld slots available -- and any device Verdura registered would'
$licText += 'consume one of them.'
$licText += ''
foreach ($pat in @('License Enabled','Options=','HandheldNumber','Waiters=','WP Current Count')) {
  $licText += ("## {0}" -f $pat)
  $found = $null
  try { $found = $sweepFiles | Select-String -SimpleMatch -Pattern $pat -ErrorAction SilentlyContinue | Select-Object -First 40 } catch { }
  if ($found) {
    foreach ($f in $found) { $licText += ("  {0}:{1}: {2}" -f $f.Filename, $f.LineNumber, $f.Line.Trim()) }
  } else {
    $licText += '  <no match in the copied corpus>'
  }
  $licText += ''
}
Write-Section '12-licence-lines.txt' ($licText -join "`r`n")

# --------------------------------------------------------------------------
# Section 90 -- observations, stated without concluding
# --------------------------------------------------------------------------

$obs = @()
$obs += '# 90 -- observations'
$obs += ''
$obs += 'Read this WITH 02-tcp-listeners.txt open. Nothing below is a conclusion; it'
$obs += 'is a restatement of what the machine reported, next to what was expected.'
$obs += ''
$obs += '## Ports found listening on this machine'
$obs += ''
if ($listenRows.Count -eq 0) {
  $obs += '  <the listener table could not be read -- that is the finding>'
} else {
  foreach ($r in ($listenRows | Sort-Object Port, Address | Group-Object Port)) {
    $first = $r.Group[0]
    $obs += ("  {0,-6} {1,-20} pid {2}" -f $first.Port, $first.Process, $first.PID)
  }
}
$obs += ''
$obs += '## The expected role of each port, from STATIC analysis of the binaries'
$obs += ''
$obs += '  6983   IPS.exe  wsWaiterPad LocalPort + Listen. PROVEN STATIC only.'
$obs += '         Never observed bound on any machine. If it is absent here, that is'
$obs += '         a finding -- not proof the feature is unlicensed, and not proof it'
$obs += '         is unreachable at other times.'
$obs += '  7983   the POSWorker listener (frmPOSWorkerListener).'
$obs += '  11183  IPSPrinterServer LocalPort + Listen; IPS.exe dials it as RemotePort'
$obs += '         for printing. A bidirectional pair with 12183.'
$obs += '  12183  IPS.exe wsPrinterError LocalPort + Listen. IPSPrinterServer dials it'
$obs += '         as RemotePort. Its BIND FAILURE branch raises "Idealpos is already'
$obs += '         running" -- so the bind doubles as a single-instance guard. It is'
$obs += '         NOT the WaiterPad ingress.'
$obs += '  13184  IPSDeploy, both LocalPort and RemotePort. Note 13184, not 13183 --'
$obs += '         which is why there is no terminal-indexed 1<n>183 scheme.'
$obs += '  11000  POSServer.'
$obs += ''
$obs += '## Questions this capture was taken to answer'
$obs += ''
$obs += '  WAITERPAD-BIND-001'
$obs += '    Is any port listening that is owned by an IdealPOS process and is not'
$obs += '    one of 7983 / 11183 / 12183 / 13184 / 11000 / 5501 / 5502 / 808?'
$obs += '    Answer it from 02-tcp-listeners.txt, not from expectation.'
$obs += ''
$obs += '  WAITERPAD-CHECKSUM-001'
$obs += '    Does 11-token-sweep.txt contain a "Checksum=" line with a real value and'
$obs += '    the packet it belonged to? One such pair is a test vector. Several are'
$obs += '    an algorithm. Zero means the blocker stands.'
$obs += ''
$obs += '  WAITERPAD-REGO-001'
$obs += '    Does the sweep contain "WP Current Count=" / " - Waiters=" / "Adding ...'
$obs += '    to current devices." / "BAD REGO"? Those four lines are the whole'
$obs += '    registration protocol as the till logs it.'
$obs += ''
$obs += '  WAITERPAD-RECON-001'
$obs += '    Does the sweep contain IH-DATA, IH-PRINT or ProcessHandheldOrder lines?'
$obs += '    A handheld order that went through ProcessHandheldOrder took the'
$obs += '    delete-and-rewrite relay path. One that logged "WPOrder Processing'
$obs += '    STARTED" took the appending socket path. Which one this venue produces'
$obs += '    is the open question, and it is answered by these log lines or not at'
$obs += '    all.'
$obs += ''
$obs += '## What this capture CANNOT establish, no matter what it found'
$obs += ''
$obs += '  * that a Verdura packet would be accepted -- nothing was sent;'
$obs += '  * that the protocol is supported for third-party use -- a vendor question;'
$obs += '  * what the 200-slot ACK-on-full hazard does under service load;'
$obs += '  * whether an ORDER appends or replaces, unless a real order appears in the'
$obs += '    logs with its before/after table state.'
Write-Section '90-observations.txt' ($obs -join "`r`n")

# --------------------------------------------------------------------------
# Section 99 -- self-check, manifest, and close
# --------------------------------------------------------------------------

Write-Host 'Section 99: self-check and manifest'

$selfPath = $MyInvocation.MyCommand.Path
$selfText = ''
if ($selfPath -and (Test-Path -LiteralPath $selfPath)) {
  $selfText = Get-Content -LiteralPath $selfPath -Raw
}

# The banned tokens are assembled from fragments so that this list does not
# itself trip the check it performs.
$banned = @(
  ('Tcp' + 'Client'), ('Test-Net' + 'Connection'), ('Invoke-Web' + 'Request'),
  ('Invoke-Rest' + 'Method'), ('Start-Ser' + 'vice'), ('Stop-Ser' + 'vice'),
  ('Restart-Ser' + 'vice'), ('Stop-Pro' + 'cess'), ('Set-Item' + 'Property'),
  ('New-Item' + 'Property'), ('Remove-It' + 'em'), ('Net.' + 'Sockets')
)
$violations = @()
if ($selfText) {
  # Ignore the .DESCRIPTION block, which names the banned tokens on purpose.
  $body = $selfText
  $marker = 'param('
  $idx = $body.IndexOf($marker)
  if ($idx -gt 0) { $body = $body.Substring($idx) }
  foreach ($b in $banned) {
    if ($body -match [regex]::Escape($b)) { $violations += $b }
  }
}

$manifest = @()
$manifest += '# 99 -- manifest and self-check'
$manifest += ''
$manifest += ("host           : {0}" -f $thisHost)
$manifest += ("expected host  : {0}  (match: {1})" -f $ExpectedHost, $hostMatches)
$manifest += ("started        : {0}" -f $started.ToString('o'))
$manifest += ("finished       : {0}" -f (Get-Date).ToString('o'))
$manifest += ("script         : {0}" -f $selfPath)
if ($selfPath -and (Test-Path -LiteralPath $selfPath)) {
  $manifest += ("script sha256  : {0}" -f (Get-SafeHash $selfPath))
}
$manifest += ''
$manifest += '## Passivity self-check'
if ($violations.Count -eq 0) {
  $manifest += '  PASS -- no transmission or mutation primitive appears in the script body.'
} else {
  $manifest += ('  FAIL -- banned primitives present: {0}' -f ($violations -join ', '))
  $manifest += '  Treat this capture as UNTRUSTED and do not file it as passive evidence.'
}
$manifest += ''
$manifest += '## Files collected (sha256)'
$manifest += ''
foreach ($f in (Get-ChildItem -LiteralPath $captureDir -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName)) {
  if ($f.Name -eq '99-manifest.txt') { continue }
  $rel = $f.FullName.Substring($captureDir.Length).TrimStart('\')
  $manifest += ("{0,-70} {1,12}  {2}" -f $rel, $f.Length, (Get-SafeHash $f.FullName))
}
Write-Section '99-manifest.txt' ($manifest -join "`r`n")

try { Stop-Transcript | Out-Null } catch { }

Write-Host ''
Write-Host '=========================================================='
if ($violations.Count -eq 0) {
  Write-Host ' CAPTURE COMPLETE -- passivity self-check PASSED'
} else {
  Write-Warning ' CAPTURE COMPLETE -- passivity self-check FAILED, see 99-manifest.txt'
}
Write-Host ("  output: {0}" -f $captureDir)
Write-Host ''
Write-Host ' Read in this order:'
Write-Host '   02-tcp-listeners.txt   <- the whole table, before any expectation'
Write-Host '   07-log-inventory.txt   <- does "Ideal Handheld*" exist at all?'
Write-Host '   06-configuration.txt   <- CurrentHandheldLogDate is the cheap tell'
Write-Host '   11-token-summary.txt   <- what the corpus actually contains'
Write-Host '   90-observations.txt    <- what each of the above does and does not mean'
Write-Host ''
Write-Host ' Nothing was transmitted. Nothing was changed. Copy the folder off and'
Write-Host ' leave the till exactly as you found it.'
Write-Host '=========================================================='
