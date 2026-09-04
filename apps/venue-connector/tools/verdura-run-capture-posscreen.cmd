@echo off
REM Verdura IPS passive control-tree capture, bound to the POS SALE SCREEN.
REM READ ONLY: TRACER_MODE=capture performs no click, no keystroke, no
REM transaction. It walks the UI tree and writes a sanitized snapshot.
REM
REM WHY THIS EXISTS (2026-09-04):
REM   The 13:07:59 capture ran correctly in session 1 but bound the WRONG
REM   window. WindowSelection.Choose picks a title-hint match first, and the
REM   hint in discovery-profile.sample.json is "Idealpos", which matches
REM     "Idealpos v7.1 Build 33  Sila Restaurant  DUNEDIN - BACKOFFICE(1)"
REM   (a non-visible ThunderRT6MDIForm back-office dashboard). The real sale
REM   window is titled "POS Screen" (ThunderRT6FormDC, hwnd 0x1405F6,
REM   Visible=True) and does NOT contain the word "Idealpos", so it was
REM   never selected.
REM
REM   This runner uses discovery-profile.pos-screen-capture.json, whose
REM   title hint is "POS Screen". That profile keeps the PENDING
REM   ProfileVersion on purpose so it can never be mistaken for a
REM   live-ready profile.
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
echo A run is USABLE only if the JSON shows ALL of:
echo   SessionMismatch : false
echo   HasRoot         : true
echo   ClientNodeCount : greater than 0
echo   RootWindowTitle : POS Screen      ^<-- NOT "... BACKOFFICE(1)"
echo And the Diagnostics list must NOT contain "This is a FAILED capture".
endlocal
