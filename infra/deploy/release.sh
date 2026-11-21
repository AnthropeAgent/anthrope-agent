#!/usr/bin/env bash
# Rilis kode baru di VPS (sebagai root). Tarball source dibuat dari git di komputer lokal:
#   git archive --format=tar.gz -o release.tgz HEAD   lalu scp ke /tmp/release.tgz
#   bash release.sh /tmp/release.tgz anthropeagent.com
# .env produksi dibuat sekali (secret acak) dan dipertahankan antar rilis.
set -euo pipefail
TARBALL="${1:?pakai: bash release.sh <release.tgz> <domain>}"
DOMAIN="${2:?pakai: bash release.sh <release.tgz> <domain>}"
APP=/opt/anthrope/app
ENVF=/opt/anthrope/app.env

if [ ! -f "$ENVF" ]; then
  # shellcheck disable=SC1091
  . /opt/anthrope/db.env
  cat > "$ENVF" <<EOF
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=4000
LOG_LEVEL=info
API_INTERNAL_URL=http://127.0.0.1:4000
NEXT_PUBLIC_MARKET_DATA=api
NEXT_PUBLIC_WS_URL=
DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}
CLICKHOUSE_URL=
REDIS_URL=redis://127.0.0.1:6379
APP_ORIGIN=https://${DOMAIN}
APP_NAME="Anthrope Agent"
SWAP_ENABLED=true
# ADMIN_WALLETS=alamat_wallet_admin
EOF
  chmod 600 "$ENVF"
fi

echo "== ekstrak source"
find "$APP" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .env -exec rm -rf {} +
tar -xzf "$TARBALL" -C "$APP"
cp "$ENVF" "$APP/.env"
cp "$ENVF" "$APP/apps/web/.env.production"
chown -R anthrope:anthrope "$APP"

echo "== install & build"
cd "$APP"
sudo -u anthrope -H npm ci --no-audit --no-fund
sudo -u anthrope -H npm run build -w @ot/web

echo "== migrasi database"
sudo -u anthrope -H npm run db:migrate -- postgres

echo "== restart layanan"
systemctl enable anthrope@api anthrope@workers anthrope@web >/dev/null
systemctl restart anthrope@api anthrope@workers anthrope@web
sleep 6
systemctl --no-pager --lines=0 status anthrope@api anthrope@workers anthrope@web | grep -E "●|Active:"
curl -fsS http://127.0.0.1:4000/api/v1/health && echo
