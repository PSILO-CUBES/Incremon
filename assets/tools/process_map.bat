@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem --- Paths ---
set "ROOT=%~dp0"
set "SCRIPT=%ROOT%fix_pixel_art.py"
set "INPUT_DIR=%ROOT%..\assets\gameplay\maps\img\_pre_processed"

if not exist "%SCRIPT%" (
  echo [ERROR] Missing: %SCRIPT%
  pause
  exit /b 1
)

if not exist "%INPUT_DIR%" (
  echo [ERROR] Missing input folder:
  echo   %INPUT_DIR%
  echo Create it and drop images there.
  pause
  exit /b 1
)

echo.
echo ===== Pre-Processed Images =====
dir /b "%INPUT_DIR%\*.png" "%INPUT_DIR%\*.jpg" "%INPUT_DIR%\*.jpeg"
echo =================================
echo.

set /p IMG="Enter filename to process (including extension): "

if not exist "%INPUT_DIR%\%IMG%" (
  echo [ERROR] File not found: %INPUT_DIR%\%IMG%
  pause
  exit /b 1
)

echo.
set /p MODE="Choose mode: (C)oarsen or (T)arget? "

rem --- Common optional shading args ---
set "ARGS="
set /p PAL="Palette colors K (optional, e.g., 16) ^> "
if defined PAL set "ARGS=!ARGS! --palette !PAL!"

set /p PZ="Posterize bits (optional, e.g., 4) ^> "
if defined PZ set "ARGS=!ARGS! --posterize-bits !PZ!"

set /p VS="Value steps (optional, e.g., 5) ^> "
if defined VS set "ARGS=!ARGS! --value-steps !VS!"

set /p PF="Palette-from image path (optional, quotes OK) ^> "
if defined PF set "ARGS=!ARGS! --palette-from "!PF!""

echo.

if /I "!MODE!"=="C" (
    set /p CO="Enter coarsen factor (e.g., 2 or 3): "
    echo Running:
    echo py "%SCRIPT%" "%INPUT_DIR%\%IMG%" --coarsen !CO! !ARGS!
    py "%SCRIPT%" "%INPUT_DIR%\%IMG%" --coarsen !CO! !ARGS!
) else if /I "!MODE!"=="T" (
    set /p SIZE="Enter target size (e.g., 3840x2160): "
    set /p SCALE="Enter scale factor (integer, e.g., 2 or 3): "
    echo Running:
    echo py "%SCRIPT%" "%INPUT_DIR%\%IMG%" --target !SIZE! --scale !SCALE! !ARGS!
    py "%SCRIPT%" "%INPUT_DIR%\%IMG%" --target !SIZE! --scale !SCALE! !ARGS!
) else (
    echo [ERROR] Invalid mode. Choose C or T.
    pause
    exit /b 1
)

pause