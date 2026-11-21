# Development guide

## Struktur monorepo (npm workspaces)

```
apps/
  web/        Next.js: semua halaman (hub, terminal, peak, research)
  api/        Fastify: REST /api/v1 (dan /ws di langkah 3)
  workers/    Proses latar: provider bridge (GeckoTerminal + DEX Screener → Redis/Postgres)
packages/
  types/      Tipe bersama web + api (@ot/types)
  db/         Klien Postgres/ClickHouse/Redis, migrasi SQL (@ot/db)
  bridge/     Adapter provider data Mode A, normalisasi ke Token, store Redis (@ot/bridge)
  devdb/      Postgres (PGlite) + Redis in-memory untuk dev tanpa Docker
infra/
  docker-compose.yml   Postgres, ClickHouse, Redis (+ Redpanda, Meilisearch via profile)
  Caddyfile            Reverse proxy produksi satu domain
```

## Menjalankan lokal

Butuh Node 20+ dan **Docker Desktop** (untuk database).

```bash
npm install
cp .env.example .env          # isi default cocok dengan docker compose
npm run db:up                 # Postgres, ClickHouse, Redis
npm run db:migrate            # jalankan migrasi SQL
npm run dev                   # web :3000 + api :4000 + workers
```

Buka `http://localhost:3000`. Worker butuh ±1 menit untuk mengisi data pertama (discovery GeckoTerminal), setelah itu Discover dan header token memakai data asli. Cek backend di `http://localhost:3000/api/v1/health`: request ke `/api/v1/*` diproksikan Next.js ke api, jadi browser tetap di satu domain.

Tanpa database sama sekali, set `NEXT_PUBLIC_MARKET_DATA=mock` di `.env` supaya halaman memakai data contoh.

### Sumber data (Fase 3 langkah 1–3)

| Bagian | Sumber sekarang |
|---|---|
| Discover (Top MC, Trending, Trenches→pool baru), header & statistik token, search | Asli: GeckoTerminal + DEX Screener (gratis, tanpa key), di-refresh worker tiap ±30 dtk |
| Chart (1m–1D) dan tab Trades di halaman token | Asli: GeckoTerminal, pool utama token. Diambil worker hanya saat token dibuka; pertama kali butuh ±10–30 dtk |
| Holders, Top Traders, Trenches board, Perps, Research, feed Trackers | Masih data contoh (ditandai di UI), tersambung di langkah berikutnya |
| RWAs | Kosong sampai daftar dikurasi admin (tabel `rwa_assets`) |

Keterbatasan provider gratis: volume/txns = pair paling likuid saja, tidak ada split volume beli/jual, perubahan 4h, holders, dan security scan (tampil "_" / "Belum dipindai"). Chain: Solana, Base, BNB Chain (Robinhood Chain belum dicakup).

AI Agent: halaman /terminal/agent dan tab AI Analyst di halaman token. Pakai API key Claude milikmu sendiri: key disimpan hanya di browser (localStorage) dan permintaan langsung dari browser ke Anthropic (SDK @anthropic-ai/sdk dengan dangerouslyAllowBrowser), tidak lewat server. Agent hanya menjelaskan data pasar; tidak bisa bertransaksi.

Langkah 9–15: Trenches pump.fun (progress bonding curve asli), Perps Hyperliquid, Alerts (panel Alerts + notifikasi browser), CMS di `/admin` (isi `ADMIN_WALLETS`), API key di halaman Data API, modul Peak dengan data asli. Billing berbayar, modul fundamental Peak, dan indexer sendiri belum dikonfigurasi; detail di docs/ARCHITECTURE.md §11.

Wallet & Top Traders (langkah 8): halaman profil wallet (net worth, holdings, PnL, aktivitas) dan Top Traders per token/global. Tanpa indexer, PnL dihitung dari transaksi yang terpantau platform (bukan riwayat penuh), dan ini disebutkan di UI.

Holders & Security (langkah 7): tab Holders dan Security di halaman token memakai data asli (GoPlus, fallback Solana RPC), dipindai otomatis saat token dibuka. Skor 0–100 hanyalah pemeriksaan otomatis, bukan audit.

Swap (langkah 6): panel Buy/Sell di halaman token (Solana lewat Jupiter, Base/BNB Chain lewat KyberSwap). Non-custodial: server membangun transaksi, memeriksa isinya, dan mensimulasikannya; kamu menandatangani di wallet sendiri. Fee platform 0%. Mulailah dengan jumlah kecil. RPC publik dipakai secara default (bisa diganti di `.env`).

Akun (langkah 5): login dengan wallet Solana (Phantom, Solflare, Backpack, …) atau EVM (MetaMask, Rabby, …) lewat tanda tangan pesan (SIWS/SIWE), tanpa transaksi dan tanpa biaya. ★ di tabel/halaman token disimpan ke watchlist akun (panel Watchlist), kolom Discover dan interval chart ikut tersimpan. Belum login → ★ mengarah ke halaman login lalu kembali. Email login belum aktif.

Search (langkah 4): simbol, nama (tahan typo), atau alamat token. Mesin: Meilisearch bila `MEILI_URL` diisi, kalau tidak Postgres pg_trgm (jalan di `npm run db:local` tanpa Docker). Urutan hasil: kecocokan persis dulu, lalu likuiditas (token tiruan berlikuiditas kecil turun). Alamat yang belum dikenal otomatis diambil worker dan muncul di search bar dalam ±30–60 dtk.

Realtime (langkah 3): harga di tabel/header, trades, dan bar chart masuk lewat WebSocket `/ws` tanpa reload (indikator "● Live" di footer terminal). Kecepatannya mengikuti worker: harga & trades ±30 dtk, candle 1–5 menit. Di dev, Next meneruskan `/ws` ke api; di produksi Caddy.

Chart & trades: hanya dari satu pool (yang paling likuid), maks 300 candle per interval dan 300 transaksi terakhir (24 jam); interval 1s/5s tidak tersedia. Semua panggilan GeckoTerminal berbagi kuota ±9/menit, jadi bila banyak token dibuka bersamaan, datanya di-refresh lebih jarang (ditandai `stale`).

### Tanpa Docker (Windows tanpa WSL)

```bash
npm run db:local              # terminal 1: Postgres :5432 (PGlite) + Redis :6379 (in-memory)
npm run db:migrate -- postgres
npm run dev                   # terminal 2
```

Di `.env`, kosongkan `CLICKHOUSE_URL=`: ClickHouse tidak punya build Windows, jadi health check melaporkan `not_configured` dan migrasinya dilewati. `packages/devdb` hanya untuk dev: PGlite mengantre semua kueri jadi satu koneksi, Redis-nya cuma perintah dasar + pub/sub sederhana dan datanya hilang saat berhenti. Data Postgres tersimpan di `.devdb/` (di-gitignore).

## Perintah lain

| Perintah | Fungsi |
|---|---|
| `npm run typecheck` | Typecheck semua paket |
| `npm run lint` | ESLint web |
| `npm test` | Semua tes (api, bridge, devdb) |
| `npm run build` | Build web + cek api |
| `npm run db:down` | Matikan database lokal |
| `docker compose -f infra/docker-compose.yml --profile stream --profile search up -d` | Ikut nyalakan Redpanda & Meilisearch |

## Lokasi penting

- `apps/web/src/config/brand.ts`: nama brand dan semua route.
- `apps/web/src/lib/data/provider.ts`: data adapter frontend (`apiProvider` ke `/api/v1`, sisanya mock sampai langkahnya selesai).
- `apps/workers/src/bridge.ts`: jadwal discovery/metrics dan aturan daftar Discover.
- `packages/db/migrations/`: skema Postgres & ClickHouse (file SQL berurutan).


## MCP server (apps/mcp)

Server MCP read-only yang membungkus Data API untuk Claude Desktop, Claude Code, Cursor, dll. 13 tools (search_tokens, get_token, get_token_security, get_wallet, top_traders, pump_trenches, perps_overview, …) dan 2 prompt (token_due_diligence, market_brief). Panduan pasang ada di halaman `/mcp`.

```bash
claude mcp add anthrope-agent -e ANTHROPE_API_KEY=ak_... -e ANTHROPE_API_URL=http://localhost:4000/api/v1 -- npx tsx apps/mcp/src/index.ts
npm test -w anthrope-agent-mcp
```
