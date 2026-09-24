@echo off
chcp 65001 >nul
echo ===================================================
echo             KHOI DONG 9ROUTER DOCKER
echo ===================================================

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Docker tren may!
    echo Vui long cai dat Docker Desktop va dam bao Docker dang chay:
    echo https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

echo [1/2] Dang build va khoi chay cac container (9router + headroom)...
docker compose up -d --build

if %errorlevel% equ 0 (
    echo.
    echo ===================================================
    echo [THANH CONG] 9Router dang chay thanh cong!
    echo Dashboard: http://localhost:20128
    echo Tai khoan mac dinh: xem trong file .env
    echo ===================================================
) else (
    echo.
    echo [LOI] Co loi xay ra khi khoi chay Docker Compose.
)

echo.
pause
