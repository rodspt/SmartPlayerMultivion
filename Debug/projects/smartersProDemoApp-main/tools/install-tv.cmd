@echo off
rem Atalho para install-tv.ps1 (dispensa ajustar a ExecutionPolicy)
rem Uso: tools\install-tv.cmd -Device 192.168.0.194:26101
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-tv.ps1" %*
exit /b %ERRORLEVEL%
