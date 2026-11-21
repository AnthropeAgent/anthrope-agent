#!/usr/bin/env bash
# Persiapan VPS sekali jalan (Ubuntu 22.04/24.04 atau Debian 12), dijalankan sebagai root:
#   bash setup-server.sh anthropeagent.com
# Memasang Node 22, Docker, Caddy, firewall, user "anthrope", database (Postgres + Redis) dan unit systemd.
# Aman diulang: langkah yang sudah selesai dilewati, password database tidak diganti.
set -euo pipefail
DOMAIN="${1:?pakai: bash setup-server.sh <domain>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "== paket dasar"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw debian-keyring debian-archive-keyring apt-transport-https openssl

echo "== swap 2G (kalau RAM kecil dan belum ada swap)"
if [ "$(swapon --show | wc -l)" = "0" ] && [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 4000000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "== Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== firewall (SSH tetap terbuka)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== user & folder"
id anthrope >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/anthrope --shell /usr/sbin/nologin anthrope
mkdir -p /opt/anthrope/app /var/log/caddy
chown -R anthrope:anthrope /opt/anthrope

echo "== database"
if [ ! -f /opt/anthrope/db.env ]; then
  PG_PASS="$(openssl rand -hex 24)"
  printf 'POSTGRES_USER=ot\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=ot\n' "$PG_PASS" > /opt/anthrope/db.env
  chmod 600 /opt/anthrope/db.env
fi
cp "$HERE/docker-compose.prod.yml" /opt/anthrope/docker-compose.yml
docker compose -f /opt/anthrope/docker-compose.yml up -d

echo "== systemd & Caddy"
cp "$HERE/anthrope@.service" /etc/systemd/system/anthrope@.service
systemctl daemon-reload
sed "s/__DOMAIN__/$DOMAIN/g" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "== selesai: node $(node -v), $(docker --version), $(caddy version | cut -d' ' -f1)"
