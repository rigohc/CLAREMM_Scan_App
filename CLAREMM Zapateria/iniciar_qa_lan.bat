@echo off
chcp 65001 >nul
setlocal
title CLAREMM QA - Red local
set "PROJECT_DIR=%~dp0"
set "NODE_EXE="

for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE (
    for /d %%R in ("%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\*") do (
        if not defined NODE_EXE if exist "%%~fR\bin\node.exe" set "NODE_EXE=%%~fR\bin\node.exe"
    )
)
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe"

if not defined NODE_EXE (
    echo ERROR: No se encontro Node.js.
    pause
    exit /b 1
)
if not exist "%PROJECT_DIR%backend\node_modules\express" (
    echo ERROR: Faltan las dependencias del backend.
    pause
    exit /b 1
)
if not exist "%PROJECT_DIR%frontend\node_modules\vite\bin\vite.js" (
    echo ERROR: Faltan las dependencias del frontend.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%configurar_https_qa.ps1"
if errorlevel 1 (
    echo ERROR: No se pudo preparar el certificado HTTPS de QA.
    pause
    exit /b 1
)
set "CLAREMM_HTTPS_PFX=%LOCALAPPDATA%\CLAREMM-QA\certs\qa-server.pfx"

set "BACKEND_READY="
set "FRONTEND_READY="
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%comprobar_qa.ps1" -Kind backend -ProjectDir "%PROJECT_DIR%."
if errorlevel 20 goto puerto_ocupado
if errorlevel 1 if not errorlevel 10 goto puerto_ocupado
if not errorlevel 1 set "BACKEND_READY=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%comprobar_qa.ps1" -Kind frontend -ProjectDir "%PROJECT_DIR%."
if errorlevel 20 goto puerto_ocupado
if errorlevel 1 if not errorlevel 10 goto puerto_ocupado
if not errorlevel 1 set "FRONTEND_READY=1"

powershell -NoProfile -Command "$rule = Get-NetFirewallRule -DisplayName 'CLAREMM_QA_LAN' -ErrorAction SilentlyContinue; if (-not $rule) { Start-Process -FilePath 'netsh.exe' -ArgumentList 'advfirewall firewall add rule name=CLAREMM_QA_LAN dir=in action=allow protocol=TCP localport=5174 remoteip=localsubnet profile=public' -Verb RunAs -Wait }; if (-not (Get-NetFirewallRule -DisplayName 'CLAREMM_QA_LAN' -ErrorAction SilentlyContinue)) { exit 1 }"
if errorlevel 1 (
    echo ERROR: No se pudo crear la regla limitada del Firewall.
    echo Acepta la solicitud de administrador o pide soporte a TI.
    pause
    exit /b 1
)

set "QA_MODE=1"
set "QA_ALLOW_GEMINI=1"
set "PORT=3101"
set "DATABASE_PATH=%PROJECT_DIR%backend\data\database.sqlite"
set "CLAREMM_BACKEND_URL=http://127.0.0.1:3101"

if not defined BACKEND_READY (
    echo Iniciando backend con la base de datos local compartida...
    start "CLAREMM QA Backend" /D "%PROJECT_DIR%backend" cmd /k ""%NODE_EXE%" "%PROJECT_DIR%backend\server.js""
)

for /L %%I in (1,1,30) do (
    if not defined BACKEND_READY (
        powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%comprobar_qa.ps1" -Kind backend -ProjectDir "%PROJECT_DIR%." >nul 2>nul
        if not errorlevel 1 set "BACKEND_READY=1"
        if not defined BACKEND_READY timeout /t 1 /nobreak >nul
    )
)
if not defined BACKEND_READY (
    echo ERROR: El backend QA no respondio en el puerto 3101.
    echo Revisa la ventana "CLAREMM QA Backend".
    pause
    exit /b 1
)

if not defined FRONTEND_READY (
    echo Iniciando frontend QA con HTTPS para la red local...
    start "CLAREMM QA Frontend" /D "%PROJECT_DIR%frontend" cmd /k ""%NODE_EXE%" "%PROJECT_DIR%frontend\node_modules\vite\bin\vite.js" --host 0.0.0.0 --port 5174 --strictPort"
)

for /L %%I in (1,1,30) do (
    if not defined FRONTEND_READY (
        powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%comprobar_qa.ps1" -Kind frontend -ProjectDir "%PROJECT_DIR%." >nul 2>nul
        if not errorlevel 1 set "FRONTEND_READY=1"
        if not defined FRONTEND_READY timeout /t 1 /nobreak >nul
    )
)
if not defined FRONTEND_READY (
    echo ERROR: El frontend QA no respondio en el puerto 5174.
    echo Revisa la ventana "CLAREMM QA Frontend".
    pause
    exit /b 1
)

echo.
echo QA listo. Comparte una de estas direcciones solo con personas de tu red Wi-Fi:
powershell -NoProfile -Command "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address | ForEach-Object { '  https://{0}:5174' -f $_.IPAddress } }"
echo.
echo Base compartida: %DATABASE_PATH%
echo Los cambios de QA afectan directamente la base local.
echo La llave Gemini se usa solo en el servidor; las llamadas consumen cuota.
echo Cada dispositivo QA debe confiar el certificado: %LOCALAPPDATA%\CLAREMM-QA\certs\CLAREMM-QA-Root.cer
echo Para cerrar QA, cierra las ventanas de backend y frontend, y ejecuta detener_qa_lan.bat.
start "" https://localhost:5174
pause
exit /b 0

:puerto_ocupado
echo ERROR: Hay un puerto ocupado por un proceso que no se pudo reutilizar.
echo No se iniciaron procesos duplicados. Revisa el detalle anterior.
pause
exit /b 1
