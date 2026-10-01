@echo off
taskkill /F /IM "HVideo Admin.exe" >nul 2>&1
echo 正在启动 HVideo Admin (调试模式)...
echo ------------------------------------------

"HVideo Admin.exe"

echo ------------------------------------------
echo 程序已退出。如果有报错，请查看上方信息。
pause
