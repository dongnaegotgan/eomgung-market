@echo off
cd /d "D:\경락가데이터서버\eomgung-market"
copy /y "%~dp0install.js" "install_temp.js"
node install_temp.js
del install_temp.js
pm2 restart gotgan-watcher
echo 완료!
pause
