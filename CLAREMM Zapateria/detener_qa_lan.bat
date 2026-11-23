@echo off
setlocal
echo Primero cierra las ventanas "CLAREMM QA Backend" y "CLAREMM QA Frontend".
powershell -NoProfile -Command "$rule = Get-NetFirewallRule -DisplayName 'CLAREMM_QA_LAN' -ErrorAction SilentlyContinue; if ($rule) { Start-Process -FilePath 'netsh.exe' -ArgumentList 'advfirewall firewall delete rule name=CLAREMM_QA_LAN' -Verb RunAs -Wait }; if (Get-NetFirewallRule -DisplayName 'CLAREMM_QA_LAN' -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
    echo No se pudo quitar la regla del Firewall. Ejecuta este archivo y acepta el permiso de administrador.
    pause
    exit /b 1
)
echo Regla de acceso QA eliminada. Los datos de prueba se conservaron.
pause
