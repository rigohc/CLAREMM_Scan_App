@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reiniciar_backend_qa.ps1"
if errorlevel 1 (
 echo No se pudo reiniciar. Revisa el detalle anterior.
 pause
 exit /b 1
)
echo Backend actualizado. Regresa al navegador y vuelve a descargar para SAZ.
pause
