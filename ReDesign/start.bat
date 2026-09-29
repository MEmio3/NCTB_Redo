@echo off
rem ===========================================================================
rem  The Shelf - start the reader
rem
rem  Double-click this, or run it from any directory. It finds Python, starts
rem  the site, and opens a browser at it.
rem
rem  Stop the server with Ctrl+C in this window.
rem
rem  Note for anyone editing this: %errorlevel% inside a parenthesised block is
rem  expanded when the block is *parsed*, not when it runs, so a check written
rem  that way reads a stale value and silently does the wrong thing. Everything
rem  below uses `if errorlevel N` with labels, which is evaluated at run time.
rem ===========================================================================

setlocal
title The Shelf
chcp 65001 >nul 2>&1

rem Everything is relative to this file, not to wherever it was launched from.
cd /d "%~dp0"

rem The banner and the book titles are Bengali; without this a cp1252 console
rem kills the server on its first print.
set PYTHONIOENCODING=utf-8

set "PORT=8899"
set "URL=http://localhost:%PORT%/"

rem --- Find Python ----------------------------------------------------------
set "PY="
where py >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto :have_python

where python >nul 2>&1
if not errorlevel 1 set "PY=python"

:have_python
if defined PY goto :check_running
echo.
echo   Python 3 was not found on PATH.
echo   Install it from https://www.python.org/downloads/ and tick
echo   "Add python.exe to PATH" during setup.
echo.
pause
exit /b 1

rem --- Already running? -----------------------------------------------------
rem Starting a second server on a taken port fails with WinError 10048, which
rem reads like the command is wrong. Ask the port what is true first.
rem
rem curl, not PowerShell's Invoke-WebRequest: that cmdlet spends several seconds
rem on proxy detection before its first request in a fresh process, so a short
rem timeout reports "not running" for a server that is answering fine.
:check_running
where curl >nul 2>&1
if errorlevel 1 goto :check_port

curl.exe -s -o nul -m 3 "%URL%"
if errorlevel 1 goto :check_port

echo.
echo   The Shelf is already running.  Opening %URL%
echo.
start "" "%URL%"
exit /b 0

rem --- Port held by something that is not us --------------------------------
:check_port
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort %PORT% -State Listen -EA SilentlyContinue; if($c){exit 0}else{exit 1}"
if errorlevel 1 goto :launch

echo.
echo   Port %PORT% is already in use:
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort %PORT% -State Listen -EA SilentlyContinue; $p=Get-Process -Id $c[0].OwningProcess -EA SilentlyContinue; Write-Host ('     PID ' + $p.Id + '   ' + $p.ProcessName)"
echo.
echo   Close that program, or free the port with:
echo     powershell "Stop-Process -Id (Get-NetTCPConnection -LocalPort %PORT% -State Listen).OwningProcess -Force"
echo.
pause
exit /b 1

rem --- Go -------------------------------------------------------------------
rem The browser waits in a side process while the server binds, so the server
rem itself stays in the foreground where Ctrl+C reaches it.
:launch
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

echo.
echo   The Shelf   %URL%
echo   Ctrl+C to stop.
echo.

%PY% tools\serve.py
set "RC=%errorlevel%"

rem Only reached if the server exits on its own, which means something failed.
if "%RC%"=="0" goto :done
echo.
echo   The server stopped with an error ^(exit %RC%^).
echo.
pause

:done
endlocal
