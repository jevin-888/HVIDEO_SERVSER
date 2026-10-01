@echo off
cd /d "%~dp0"
echo 启动 HVideo 服务器...
target\release\hvideo-server.exe
pause
