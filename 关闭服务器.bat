@echo off
echo 正在关闭服务器...
taskkill /f /im node.exe 2>nul
echo 已关闭
pause
