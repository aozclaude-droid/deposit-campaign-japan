@echo off
setlocal
cd /d "%~dp0"
copy /Y "..\webサイト\campaign_all.json" ".\campaign_all.json" >nul
copy /Y "..\webサイト\tibor_monthly.json" ".\tibor_monthly.json" >nul
if not exist ".\r1_data" mkdir ".\r1_data"
copy /Y "..\webサイト\r1_data\base_rate_history.json" ".\r1_data\base_rate_history.json" >nul
echo Webサイト2の分析データを最新化しました。
pause
