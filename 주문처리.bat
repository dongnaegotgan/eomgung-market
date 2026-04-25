@echo off
echo.
echo ================================
echo   Order Processing System
echo ================================
echo.
echo  1. Auto (Download + Excel + Print)
echo  2. Auto (Download + Excel, No Print)
echo  3. Manual (order_output folder)
echo.
set /p choice=Select (1/2/3): 
if "%choice%"=="1" node "%~dp0order_process.js"
if "%choice%"=="2" node "%~dp0order_process.js" --no-print
if "%choice%"=="3" node "%~dp0order_process.js" --local
echo.
echo Done!
pause