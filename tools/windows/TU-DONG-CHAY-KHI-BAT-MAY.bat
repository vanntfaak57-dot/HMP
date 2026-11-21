@echo off
REM Tao loi tat de KhoETC tu chay (chay ngam, khong mo trinh duyet) moi khi dang nhap Windows.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\KhoETC.lnk'); $s.TargetPath='%~dp0KhoETC.exe'; $s.Arguments='--no-browser'; $s.WorkingDirectory='%~dp0'; $s.Save()"
if %errorlevel% neq 0 (
  echo Khong tao duoc loi tat tu khoi dong.
) else (
  echo Da cai: KhoETC se tu chay moi khi bat may / dang nhap Windows.
  echo Muon bo: bam Win+R, go shell:startup roi xoa loi tat KhoETC.
)
echo.
pause
