@echo off
chcp 65001 > nul
cd /d "%~dp0"
node scripts\update-question-csv.mjs
set EXIT_CODE=%ERRORLEVEL%
echo.
pause
exit /b %EXIT_CODE%
