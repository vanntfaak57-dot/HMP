#!/usr/bin/env bash
# Cài phần mềm Quản lý kho lên VPS Ubuntu/Debian mới, có HTTPS.
#   sudo bash install-vps.sh kho.tencongty.vn
# Yêu cầu: tên miền đã trỏ về IP của VPS, mở cổng 80 và 443.
set -euo pipefail
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then echo "Cách dùng: sudo bash install-vps.sh <ten-mien>"; exit 1; fi
cd "$(dirname "$0")"
if ! command -v docker >/dev/null 2>&1; then
  echo ">> Cài Docker..."
  curl -fsSL https://get.docker.com | sh
fi
if [ ! -f .env ]; then
  PW="Kho$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)9"
  printf 'DOMAIN=%s\nADMIN_PASSWORD=%s\n' "$DOMAIN" "$PW" > .env
  chmod 600 .env
  echo ">> Mật khẩu admin lần đầu: $PW  (ghi lại, phần mềm bắt đổi khi đăng nhập)"
fi
mkdir -p data && chown 1000:1000 data
docker compose up -d --build
echo ">> Xong. Mở https://$DOMAIN (đợi 1-2 phút để cấp chứng chỉ HTTPS lần đầu)."
