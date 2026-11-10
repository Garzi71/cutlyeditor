@echo off
REM Spusti editor Cutly (vyvojova verze). Staci na tento soubor dvakrat kliknout.
cd /d "%~dp0"
if not exist node_modules (
  echo Instaluji knihovny, poprve to chvili trva...
  call npm install
)
if not exist node_modules\electron\dist (
  echo Stahuji Electron...
  node node_modules\electron\install.js
)
call npm run dev
