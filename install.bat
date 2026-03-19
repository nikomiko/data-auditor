@echo off
REM ──────────────────────────────────────────────────────────────
REM  DataAuditor — script d'installation (Windows)
REM  Usage : double-cliquez ou lancez depuis une invite de commandes
REM ──────────────────────────────────────────────────────────────
setlocal enabledelayedexpansion

set APP_DIR=%~dp0
set VENV_DIR=%APP_DIR%.venv

echo.
echo   DataAuditor - Installation
echo   %date% %time%
echo.

REM ── 1. Vérification Python ────────────────────────────────────
echo [*] Verification Python...

python --version >nul 2>&1
if errorlevel 1 (
    echo [!] Python introuvable. Installez Python 3.10+ depuis https://python.org
    echo     Cochez "Add Python to PATH" lors de l'installation.
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [OK] Python %PYVER% detecte

REM ── 2. Environnement virtuel ──────────────────────────────────
echo.
echo [*] Environnement virtuel...

if exist "%VENV_DIR%" (
    echo [!] Environnement existant - mise a jour
) else (
    python -m venv "%VENV_DIR%"
    echo [OK] Environnement cree dans .venv\
)

call "%VENV_DIR%\Scripts\activate.bat"

REM ── 3. Dépendances ────────────────────────────────────────────
echo.
echo [*] Installation des dependances...

pip install --upgrade pip --quiet
pip install -r "%APP_DIR%requirements.txt" --quiet
echo [OK] Dependances installees

REM ── 4. Script de lancement ────────────────────────────────────
echo.
echo [*] Creation du script de lancement...

set LAUNCH=%APP_DIR%dataAuditorServer.bat
(
echo @echo off
echo set APP_DIR=%%~dp0
echo call "%%APP_DIR%%.venv\Scripts\activate.bat"
echo echo.
echo echo   DataAuditor
echo echo   Browse to http://localhost:5000
echo echo   Ctrl+C pour arreter
echo echo.
echo cd /d "%%APP_DIR%%"
echo python server.py
echo pause
) > "%LAUNCH%"

echo [OK] Script run.bat cree

REM ── 5. Résumé ─────────────────────────────────────────────────
echo.
echo =================================================
echo   Installation terminee.
echo.
echo   Lancer l'application :
echo     dataAuditorServer.bat
echo.
echo   Ou manuellement avec les deux commandes suivantes 
echo     .venv\Scripts\activate
echo     python server.py
echo =================================================
echo.
pause
