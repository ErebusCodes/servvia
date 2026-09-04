@echo off
REM Verdura IPS passive control-tree capture, bound to the POS SALE SCREEN.
REM READ ONLY: TRACER_MODE=capture performs no click, no keystroke, no
REM transaction. It walks the UI tree and writes a sanitized snapshot.
REM
REM WHY THIS EXISTS (2026-09-04)
REM ---------------------------
REM Round 1 (13:07:59) bound the WRONG window. The title hint "Idealpos"
REM matches "Idealpos v7.1 ... DUNEDIN - BACKOFFICE(1)" (a non-visible
REM ThunderRT6MDIForm) while the real sale window "POS Screen"
REM (ThunderRT6FormDC, 0x1405F6, Visible=True) does NOT contain that word,
REM so a hint-based rule could only ever pick wrong.
REM   FIXED: WindowSelection now scores declaratively. The 14:10:32 run
REM   selected POS Screen at score 1070 vs next-best 130, and logged it.
REM
REM Round 2 (14:10:32) bound the RIGHT window but returned only 3 UIA nodes:
REM the ThunderRT6FormDC root, a TitleBar, and ONE EMPTY
REM ThunderRT6PictureBoxDC pane. The real VB6 sale controls are native child
REM HWNDs beneath that pane, and the Win32 EnumChildWindows fallback never
REM ran because it was gated on "UIA produced nothing" -- and UIA had
REM produced that one pane.
REM   FIXED: the Win32 child tree is now enumerated UNCONDITIONALLY and
REM   emitted as snapshot.Win32Controls, whatever UIA returns.
REM
REM RUN THIS AT THE PHYSICAL CONSOLE (session 1), with the terminal on a
REM logged-in, VISIBLE sale/table screen.
setlocal
set "CONNECTOR=%~dp0.."
set "STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
set "STAMP=%STAMP: =0%"
if not exist "%CONNECTOR%\.captures" mkdir "%CONNECTOR%\.captures"

set TRACER_MODE=capture
set "TRACER_STORE_PATH=%CONNECTOR%\.captures\cap-store-posscreen-%STAMP%.ndjson"
set "TRACER_PROFILE_PATH=%CONNECTOR%\docs\discovery-profile.pos-screen-capture.json"
set "TRACER_CAPTURE_OUT=%CONNECTOR%\.captures\ips-capture-posscreen-%STAMP%.json"

dotnet "%CONNECTOR%\src\VerduraIdealposTracer.Cli\bin\Release\net8.0-windows\VerduraIdealposTracer.Cli.dll"

echo.
echo Capture exit code: %ERRORLEVEL%
echo Output: %TRACER_CAPTURE_OUT%
echo.
echo A run is USABLE FOR SELECTOR DERIVATION only if ALL of:
echo   SessionMismatch : false
echo   HasRoot         : true
echo   RootWindowTitle : POS Screen      ^<-- NOT "... BACKOFFICE(1)"
echo   Win32Controls   : MORE THAN ZERO  ^<-- this is the one that matters now
echo And the Diagnostics list must NOT contain "This is a FAILED capture".
echo.
echo ClientNodeCount greater than zero is NOT sufficient on its own: the
echo 14:10:32 run had ClientNodeCount=1 (a single empty container pane) and
echo still carried nothing a selector could be built from. The exit code now
echo reflects this - a capture with zero Win32 controls exits 1.
endlocal
