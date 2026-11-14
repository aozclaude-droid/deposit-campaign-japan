@echo off
setlocal

cd /d "%~dp0"
set "WEB_PORT=8000"
set "WEB_URL=http://127.0.0.1:%WEB_PORT%/"

where py >nul 2>nul
if %errorlevel%==0 goto use_py

where python >nul 2>nul
if %errorlevel%==0 goto use_python

where python3 >nul 2>nul
if %errorlevel%==0 goto use_python3

echo.
echo Python could not be found.
echo Install Python, then run this file again.
echo.
pause
exit /b 1

:use_py
start "" "%WEB_URL%"
py -3 -m http.server %WEB_PORT% --bind 127.0.0.1
goto finished

:use_python
start "" "%WEB_URL%"
python -m http.server %WEB_PORT% --bind 127.0.0.1
goto finished

:use_python3
start "" "%WEB_URL%"
python3 -m http.server %WEB_PORT% --bind 127.0.0.1

:finished
echo.
echo The local web server has stopped.
pause

