@echo off
REM Start GramCare AI website
REM Compiles the C server and launches the site at http://localhost:8080

echo ========================================
echo   GramCare AI - Starting Server
echo ========================================

REM Check if gcc is available
where gcc >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: gcc not found. Please install MinGW/MSYS2 GCC to build the server.
    pause
    exit /b 1
)

REM Compile the server
echo Compiling server.c...
gcc server.c -o gramcare.exe -lsqlite3 -lpthread -lm -ldl -lws2_32

REM Remove any stale database so a new user starts fresh
if exist gramcare.db del gramcare.db

REM Start the server
echo Starting server on http://localhost:8080...
start gramcare.exe

REM Wait for server to be ready
timeout /t 2 >nul

REM Open the browser
start http://localhost:8080

echo.
echo Server is running. Open your browser to: http://localhost:8080
echo Close the gramcare.exe window to stop the server.
pause
