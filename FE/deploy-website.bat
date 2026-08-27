@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM Deploy Firebase website Project (Wrapper)
REM Usage:
REM     deploy-website.bat <ten_project>
REM Example:
REM     deploy-website.bat Amenosa
REM ============================================================

REM Switch to Node 22 (required by Firebase CLI)
call fnm use 22

REM Run Node.js deploy script
node "%~dp0deploy-website.js" %*

exit /b %errorlevel%
