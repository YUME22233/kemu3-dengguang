@echo off
setlocal
for %%f in ("%~dp0dist\*.html") do (
  start "" "%%~ff"
  exit /b 0
)
echo The exam HTML file was not found in the dist folder.
pause
