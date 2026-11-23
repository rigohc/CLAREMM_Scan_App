@echo off
setlocal
title CLAREMM Zapateria - Panel VIP
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
    echo Instala Node.js desde https://nodejs.org/ y vuelve a iniciar este archivo.
    pause
    exit /b 1
)

if not exist "%PROJECT_DIR%backend\node_modules\express" (
    echo ERROR: Faltan dependencias del backend en backend\node_modules.
    echo Ejecuta: cd /d "%PROJECT_DIR%backend" ^&^& npm install
    pause
    exit /b 1
)

if not exist "%PROJECT_DIR%frontend\node_modules\vite\bin\vite.js" (
    echo ERROR: Faltan dependencias del frontend en frontend\node_modules.
    echo Ejecuta: cd /d "%PROJECT_DIR%frontend" ^&^& npm install
    pause
    exit /b 1
)

set "BACKEND_READY="
curl.exe -fsS http://127.0.0.1:3001/api/stats -o NUL >nul 2>nul && set "BACKEND_READY=1"
if not defined BACKEND_READY (
    echo Iniciando backend con "%NODE_EXE%"...
    start "CLAREMM Backend (Node.js y SQLite)" /D "%PROJECT_DIR%backend" cmd /k ""%NODE_EXE%" "%PROJECT_DIR%backend\server.js""
)

for /L %%I in (1,1,30) do (
    if not defined BACKEND_READY (
        curl.exe -fsS http://127.0.0.1:3001/api/stats -o NUL >nul 2>nul && set "BACKEND_READY=1"
        if not defined BACKEND_READY timeout /t 1 /nobreak >nul
    )
)

set "FRONTEND_READY="
curl.exe -fsS http://127.0.0.1:5173/ -o NUL >nul 2>nul && set "FRONTEND_READY=1"
if not defined FRONTEND_READY (
    echo Iniciando frontend...
    start "CLAREMM Frontend (Vite y React)" /D "%PROJECT_DIR%frontend" cmd /k ""%NODE_EXE%" "%PROJECT_DIR%frontend\node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173"
)

for /L %%I in (1,1,30) do (
    if not defined FRONTEND_READY (
        curl.exe -fsS http://127.0.0.1:5173/ -o NUL >nul 2>nul && set "FRONTEND_READY=1"
        if not defined FRONTEND_READY timeout /t 1 /nobreak >nul
    )
)

if not defined BACKEND_READY (
    echo ERROR: El backend no respondio en http://127.0.0.1:3001
    echo Revisa la ventana "CLAREMM Backend" para ver el error.
    pause
    exit /b 1
)

if not defined FRONTEND_READY (
    echo ERROR: El frontend no respondio en http://127.0.0.1:5173
    echo Revisa la ventana "CLAREMM Frontend" para ver el error.
    pause
    exit /b 1
)

echo.
echo CLAREMM esta listo:
echo Frontend: http://127.0.0.1:5173
echo Backend:  http://127.0.0.1:3001
start "" http://127.0.0.1:5173
echo.
echo No cierres las ventanas del backend ni frontend mientras uses el sistema.
pause
