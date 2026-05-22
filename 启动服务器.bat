@echo off
chcp 65001 >nul
echo Starting server...
start "" http://localhost:3000
node server.js
pause
