@echo off
REM ──────────────────────────────────────────────────────────────
REM  DataAuditor — script d'installation (Windows)
REM ──────────────────────────────────────────────────────────────
setlocal

set APP_DIR=%~dp0
set VENV_DIR=%APP_DIR%.venv
set REQ_FILE=%APP_DIR%requirements.txt
set LAUNCH=%APP_DIR%dataAuditorServer.bat

echo.
echo   DataAuditor - Installation
echo   %date% %time%
echo.

REM ── 1. Vérification Python ────────────────────────────────────
echo [*] Verification Python...

python --version >nul 2>&1
if errorlevel 1 (
    echo [!] Python introuvable.
    echo     Installez Python 3.10+ depuis https://python.org
    echo     Cochez "Add Python to PATH"
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [OK] Python %PYVER% detecte

REM ── 2. Environnement virtuel ──────────────────────────────────
echo.
echo [*] Environnement virtuel...

if not exist "%VENV_DIR%" (
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [!] Erreur creation environnement virtuel
        exit /b 1
    )
    echo [OK] Environnement cree
) else (
    echo [OK] Environnement existant
)

REM ── 3. Dépendances ────────────────────────────────────────────
echo.
echo [*] Installation des dependances...

if not exist "%REQ_FILE%" (
    echo [!] requirements.txt introuvable
    exit /b 1
)

"%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip 
"%VENV_DIR%\Scripts\python.exe" -m pip install -r "%REQ_FILE%" 

if errorlevel 1 (
    echo [!] Erreur lors de l'installation des dependances
    exit /b 1
)

echo [OK] Dependances installees

REM ── 4. Script de lancement ────────────────────────────────────
echo.
echo [*] Creation du script de lancement...

(
echo @echo off
echo set APP_DIR=%%~dp0
echo call "%%APP_DIR%%.venv\Scripts\activate.bat"
echo echo.
echo echo   DataAuditor
echo echo   Ouvrir http://localhost:5000
echo echo   Ctrl+C pour arreter
echo echo.
echo cd /d "%%APP_DIR%%"
echo python src\server.py
echo pause
) > "%LAUNCH%"

echo [OK] Script dataAuditorServer.bat cree


REM ── 5. Résumé ─────────────────────────────────────────────────
echo.
echo =================================================
echo   Installation terminee.
echo.
echo   Lancer l'application :
echo     dataAuditorServer.bat
echo =================================================
echo.
pause
endlocal
