@echo off
cd /d "%~dp0"
start "Deposit Campaign Intelligence" http://127.0.0.1:8766/
python -m http.server 8766 --bind 127.0.0.1
