@echo off
REM Mo tuong lua Windows cho phan mem KhoETC de may khac trong mang noi bo truy cap duoc.
REM Can quyen quan tri: file tu hoi quyen (bam Yes).
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="KhoETC" >nul 2>&1
netsh advfirewall firewall add rule name="KhoETC" dir=in action=allow program="%~dp0KhoETC.exe" enable=yes profile=private,domain
if %errorlevel% neq 0 (
  echo Khong mo duoc tuong lua. Hay chay lai file nay bang quyen quan tri.
) else (
  echo Da mo tuong lua cho KhoETC.exe ^(mang Private / Domain^).
  echo.
  echo Neu may khac van khong vao duoc: vao Settings - Network ^& Internet,
  echo chon mang dang dung va dat Network profile la PRIVATE.
)
echo.
pause
