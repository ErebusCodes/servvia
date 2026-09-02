@echo off
REM Verdura IPS passive control-tree capture - READ ONLY.
REM TRACER_MODE=capture performs no click, no keystroke, no transaction. It
REM walks the UI Automation tree of IPS.exe and writes a sanitized snapshot.
REM
REM Paths are relative to this script, so the file is portable across
REM checkouts. Output lands in apps\venue-connector\.captures\ (gitignored),
REM timestamped so repeated runs never clobber an earlier capture.
setlocal
set "CONNECTOR=%~dp0.."
set "STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
set "STAMP=%STAMP: =0%"
if not exist "%CONNECTOR%\.captures" mkdir "%CONNECTOR%\.captures"

set TRACER_MODE=capture
set "TRACER_STORE_PATH=%CONNECTOR%\.captures\cap-store-%STAMP%.ndjson"
set "TRACER_PROFILE_PATH=%CONNECTOR%\docs\discovery-profile.sample.json"
set "TRACER_CAPTURE_OUT=%CONNECTOR%\.captures\ips-capture-%STAMP%.json"

dotnet "%CONNECTOR%\src\VerduraIdealposTracer.Cli\bin\Release\net8.0-windows\VerduraIdealposTracer.Cli.dll"

echo.
echo Capture exit code: %ERRORLEVEL%
echo Output: %TRACER_CAPTURE_OUT%
endlocal
