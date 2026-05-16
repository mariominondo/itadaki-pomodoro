@echo off
cd /d %~dp0
echo Starting Itadaki Pomodoro Server...
start "" "http://localhost:8020"
start powershell -NoExit -Command "Write-Host 'Starting Itadaki Pomodoro Server...' -ForegroundColor Green; python server.py"
