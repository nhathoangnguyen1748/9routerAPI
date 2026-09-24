@echo off
chcp 65001 >nul
echo ===================================================
echo             DUNG 9ROUTER DOCKER
echo ===================================================

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Docker tren may!
    pause
    exit /b 1
)

echo Dang dung cac container 9router va headroom...
docker compose down

echo.
echo Da dung tat ca cac dich vu 9Router.
pause
