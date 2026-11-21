# Arsitektur Backend (Fase 2)

Dokumen ini merancang backend untuk ke-19 layanan platform. Kontrak detailnya ada di:

- [`api/openapi.yaml`](api/openapi.yaml): REST `/api/v1`
- [`api/websocket.md`](api/websocket.md): channel realtime `/ws`
- [`postgres/0001_init.sql`](../packages/db/migrations/postgres/0001_init.sql): data relasional (token, user, CMS, API key)
- [`clickhouse/0001_init.sql`](../packages/db/migrations/clickhouse/0001_init.sql): data time-series (swap, candle, transfer, usage)

> **Asumsi yang dipakai** (bisa diubah, lihat bagian 14):
> chain MVP = **Solana, Base, BNB Chain, Robinhood Chain**; sumber data awal = **penyedia pihak ketiga lewat adapter**, lalu indexer sendiri dibangun bertahap per chain. Repo ini belum punya backend apa pun (hasil audit Fase 0: hanya frontend Next.js + mock).

---

## 1. Prinsip desain

1. **Satu domain.** `/` untuk halaman (Next.js), `/api/v1/*` untuk REST, `/ws` untuk WebSocket. Satu cookie sesi untuk semua produk.
2. **Frontend tidak tahu sumber data.** Semua data lewat interface `MarketDataProvider` (sudah ada di `src/lib/data/provider.ts`). Ganti implementasi, bukan halaman.
3. **Ingestion terpisah dari serving.** Indexer boleh lambat atau mati sebentar; API tetap melayani data terakhir dan menandai data basi (*stale*).
4. **Non-custodial.** Server tidak pernah memegang private key user. Server hanya membuat transaksi yang belum ditandatangani; user menandatangani di wallet sendiri.
5. **Idempoten dan tahan reorg.** Setiap event on-chain punya kunci unik `(chain, tx_hash, log_index/instruction_index)`. Writer menolak kunci yang sudah pernah ditulis, dan data baru masuk ClickHouse setelah terkonfirmasi. Data yang belum final hanya mengalir lewat Redis/WS. Alasannya: materialized view ClickHouse terpicu di setiap insert, jadi insert ganda akan menggandakan candle dan PnL (detail di `packages/db/migrations/clickhouse/0001_init.sql`).

---

## 2. Gambaran besar

```
                         ┌──────────────────────── INGESTION ───────────────────────┐
 Solana (Yellowstone/    │  chain-ingestor ──► raw topics ──► dex-decoder ──► swaps  │
  LaserStream gRPC)  ───►│  (per chain)        (Redpanda)     launch-decoder► launches│
 EVM (WS newHeads +      │                                   transfer-decoder►transfers
  eth_getLogs)       ───►│                                                            │
 Hyperliquid API     ───►│  perps-poller ─────────────────────────────────► perps    │
 3rd-party data API  ───►│  provider-bridge (Mode A) ──────────────────────► swaps…  │
                         └──────────────────────────────┬────────────────────────────┘
                                                        ▼
                         ┌──────────────────────── PROCESSING ───────────────────────┐
                         │ price-engine   candle-rollup   token-metrics   holder-tracker│
                         │ wallet-pnl     trenches-fsm    ranker          security-scan │
                         │ alert-evaluator               news/peak workers             │
                         └───────┬───────────────────┬──────────────────┬─────────────┘
                                 ▼                   ▼                  ▼
                           ClickHouse           PostgreSQL            Redis
                     (swaps, candles,      (tokens, pools, users,  (snapshot hot,
                      transfers, pnl,       watchlist, alerts,      leaderboard,
                      usage)                CMS, api keys, deals)   pub/sub, rate limit)
                                 └───────────┬───────┴──────────────────┘
                                             ▼
                         ┌──────────────────────── SERVING ──────────────────────────┐
                         │  api (Fastify)  /api/v1/*      ws-gateway  /ws             │
                         │  public-api gateway (API key, tier, metering)              │
                         └──────────────────────────┬────────────────────────────────┘
                                                    ▼
                    Reverse proxy (Caddy/Nginx) satu domain ──► Next.js (halaman)
```

---

## 3. Strategi sumber data bertahap

Membangun indexer multi-chain sendiri mahal dan lama. Jadi ada dua mode, dan keduanya menghasilkan bentuk data yang sama.

| Mode | Cara kerja | Kapan dipakai |
|---|---|---|
| **A. Provider bridge** | Worker memanggil API pihak ketiga (misal Birdeye Data API, Codex, Moralis, Helius untuk Solana), lalu menormalisasi hasilnya ke tabel dan topic yang sama dengan indexer sendiri. | MVP: semua chain |
| **B. Indexer sendiri** | Ingestor membaca chain langsung dan men-decode DEX/launchpad sendiri. | Bertahap: Solana dulu (volume terbesar), lalu chain lain |

Aturan:
- Tabel `tokens.data_source` dan `chains.data_mode` mencatat sumber tiap chain.
- Perpindahan A → B per chain: jalankan keduanya paralel 1 sampai 2 minggu, bandingkan harga/volume (selisih < 0.5%), lalu matikan bridge.
- **Biaya Mode A** dihitung per request. Cache agresif di Redis dan jangan pernah memanggil provider langsung dari request user; selalu dari worker terjadwal.
- **Chart & trades Mode A (langkah 2):** api menandai key `view:{kind}:{chain}:{addr}` (TTL 90 dtk) tiap kali chart/trades diminta; worker `charts` (tiap 10 dtk) mengambil OHLCV/trades GeckoTerminal untuk pool utama token (`Token.mainPool`) hanya selama view itu hidup. Refresh: trades 30 dtk, candle 60 dtk–5 menit sesuai interval; maks 2 panggilan per siklus, berbagi limiter dengan discovery. Belum ada data → `pending: true`. Mode B menggantinya dengan candle ClickHouse (§4.3) tanpa mengubah kontrak.

---

## 4. Layanan (19 modul)

Setiap layanan ditulis sebagai modul di monorepo. Layanan yang ringan bisa digabung dalam satu proses di awal (`apps/api` dan `apps/workers`), lalu dipecah saat beban naik.

### 4.1 Chain ingestor (layanan #1)
- **Solana:** stream transaksi dari Yellowstone gRPC (Geyser) atau Helius LaserStream, difilter berdasarkan program ID DEX/launchpad yang didukung. Commitment `confirmed` untuk realtime, lalu ditandai `final` saat `finalized`.
- **EVM (Base, BSC, Robinhood Chain):** subscribe `newHeads` lewat WS; untuk tiap blok ambil `eth_getLogs` dengan filter topic event Swap/PairCreated/Transfer. Simpan `block_hash`; jika parent hash berbeda (reorg), kirim event `revert` untuk blok yang terdampak. Event dikirim dua kali: segera sebagai *pending* (untuk WS realtime) dan sekali lagi sebagai *final* setelah kedalaman konfirmasi per chain tercapai (untuk ClickHouse).
- Output ke topic Redpanda `raw.{chain}` (key = tx hash, sehingga urutan per transaksi terjaga).
- **Checkpoint** slot/blok terakhir per chain di Postgres (`ingest_cursors`), supaya bisa lanjut setelah restart dan backfill celah.

### 4.2 DEX & launchpad decoder (#2)
- Satu *decoder* per protokol, dengan interface yang sama: `decode(rawTx) → SwapEvent[] | PoolEvent[] | LaunchEvent[]`.
- Prioritas: Solana (Raydium AMM/CPMM/CLMM, Orca Whirlpool, Meteora DLMM/DAMM, Pump.fun, PumpSwap), Base (Uniswap v2/v3/v4, Aerodrome), BSC (PancakeSwap v2/v3, Four.meme), Robinhood Chain (DEX utama yang tersedia saat implementasi).
- `SwapEvent`: chain, pool, token_in/out, amount_in/out, trader, tx_hash, index, block_time, slot/block.
- Event pool baru → upsert `pools` dan `tokens` (token baru masuk antrean metadata & security).

### 4.3 Price & OHLCV engine (#3)
- **Harga per swap:** `price_quote = amount_quote / amount_base`. Harga USD = harga quote × harga USD quote token (SOL, WETH, WBNB, USDC).
- **Harga USD token referensi** (SOL, ETH, BNB) diambil dari pool stablecoin paling likuid dengan *median* beberapa pool, untuk menahan manipulasi.
- **Harga resmi token** = harga dari pool dengan likuiditas terbesar (bukan swap terakhir di pool kecil). Swap dari pool dengan likuiditas < ambang (misal $1K) tidak menggerakkan harga utama.
- **Candle:** ClickHouse menyimpan swap mentah; materialized view menghasilkan candle 1s dan 1m. Interval lebih besar (5m, 15m, 1h, 4h, 1D) dibuat dengan rollup dari 1m. Candle 1s hanya disimpan 48 jam (TTL).
- **Bar terakhir** dikirim langsung lewat Redis pub/sub ke WS (tidak menunggu ClickHouse).
- **MCap = harga × circulating supply**, **FDV = harga × total supply**. Supply diperbarui oleh layanan metadata.

### 4.4 Token metadata & security (#4)
- Metadata: nama, simbol, decimals, logo, sosial (Metaplex di Solana, ERC-20 + sumber eksternal di EVM). Logo di-cache ke object storage (S3/R2) dan dilayani lewat CDN.
- **Security scan** (dijalankan saat token baru muncul, diulang tiap 6 jam dan saat ada event authority):
  - Solana: mint authority, freeze authority, LP burned/locked, Token-2022 extensions berbahaya (transfer hook, transfer fee, permanent delegate).
  - EVM: owner/renounced, fungsi mint, blacklist, proxy upgradeable, pajak beli/jual dan honeypot lewat **simulasi** beli lalu jual di fork (`eth_call` dengan state override, atau layanan simulasi).
  - Konsentrasi holder (dari #5), dev holdings, dev tokens (token lain yang dibuat wallet deployer).
- Hasilnya di `token_security` dengan `score` 0 sampai 100 dan daftar `flags`.

### 4.5 Holder tracker (#5)
- Saldo dihitung dari event transfer (ClickHouse `transfers` → `balances` dengan `SummingMergeTree`).
- Snapshot top 100 holder per token tiap 5 menit untuk token aktif (volume 24h > ambang), tiap 1 jam untuk sisanya, disimpan di `holder_snapshots`.
- Label alamat (LP, CEX, burn, deployer) dari tabel `address_labels`.
- Mode A: ambil dari provider untuk token yang belum diindeks.
- **Status (langkah 7):** holders & security satu pindaian. Sumber utama **GoPlus Security API** (gratis, tanpa key, Solana + EVM); fallback Solana RPC (mint/freeze authority, ekstensi Token-2022, 20 akun terbesar; RPC publik kadang menolak daftar holder token raksasa, hasil authority tetap dipakai). Api menandai view `holders` tiap request tab/endpoint; worker `scans` (tiap 5 dtk, maks 3 token/siklus, limiter GoPlus 1 per 2,5 dtk) memindai token yang dilihat bila snapshot > 5 menit. Hasil di Postgres: `token_security` (+kolom `report` jsonb, migrasi 0004, FK ke `tokens` dilepas) dan `holder_snapshots` (snapshot terakhir top 100). Detail token menimpa `security`, `top10Pct`, `holders` dari hasil scan. Skor 0–100 transparan (`scoreFacts` di `@ot/bridge`): tiap pemeriksaan punya penalti tetap; honeypot = 0; risiko rendah ≥ 70, sedang 40–69, tinggi < 40. Top 10 tidak menghitung LP, burn, dan saldo terkunci. Belum: dev tokens (butuh indexer, Mode B), simulasi honeypot sendiri di fork.

### 4.6 Ranking & discovery (#6)
- **Token metrics** (per token, per jendela 5m/1h/4h/24h): volume, txns, buys/sells, unique traders, perubahan harga. Dihitung di ClickHouse tiap 5 detik untuk token "panas", tiap 1 menit untuk sisanya, lalu ditulis ke Redis hash `tok:{chain}:{addr}`.
- **Top MC:** sorted set Redis `rank:mc:{chain}` dengan filter likuiditas minimal (misal > $10K) agar token palsu dengan MC raksasa tidak naik.
- **Trending score** (per timeframe):
  `score = log10(volume) × 0.4 + log10(unique_traders) × 0.3 + clamp(|Δprice|, 0, 200%) × 0.002 + log10(txns) × 0.2 + freshness_bonus`
  dikali penalti security (score < 40 → ×0.5) dan penalti wash-trading (rasio volume/unique trader ekstrem). Bobot disimpan di config supaya bisa di-tuning.
- **RWAs:** daftar token dari tabel `rwa_assets` (dikurasi admin): token saham tokenized, emas, T-bill, beserta penerbit dan aset dasarnya.

### 4.7 Trenches state machine (bagian dari #6)
```
created ──(bonding ≥ 60%)──► final_stretch ──(event migrate / pool DEX dibuat)──► migrated
   │                               │
   └────────(tidak aktif 24 jam, bonding < 5%)────────► dead (disembunyikan)
```
- **Bonding %** dihitung dari reserve kurva launchpad (misal virtual reserves Pump.fun) relatif terhadap target migrasi.
- Setiap transisi dikirim ke channel WS `trenches:{chain}`, sehingga kartu berpindah kolom secara realtime.

### 4.8 Wallet analytics (#7)
- **PnL** per wallet per token memakai metode *average cost*: realized PnL dari tiap jual, unrealized = (harga sekarang − avg cost) × sisa saldo.
- Tabel ClickHouse `wallet_token_pnl` diperbarui dari stream swap. Net worth = Σ saldo × harga.
- **Top Traders** (global dan per token): sorted set dari PnL 7d/30d, dengan filter minimal jumlah trade dan volume.
- **Label smart money:** aturan otomatis (winrate > 60%, PnL 30d > $50K, trade ≥ 20) plus label manual (KOL, fund, CEX).
- **Status (langkah 8, Mode A):** tanpa indexer, PnL dihitung dari transaksi yang **terpantau** platform (deret trades GeckoTerminal ±300 transaksi terakhir pool utama), average cost; jual tanpa beli terpantau tidak masuk realized. Worker `traders` (60 dtk) menghitung Top Traders per token dan global (`traders:{scope}` di Redis; filter ≥ 2 trade, volume ≥ $100; label Smart Money sementara: PnL > $10K, ≥ 3 token, win rate > 60%) dan menandai 3 token trending teratas per chain sebagai dilihat supaya data global tidak hanya dari token yang dibuka. Worker `wallets` (5 dtk, maks 2 wallet/siklus, refresh 60 dtk selama dibuka): saldo lewat RPC (Solana: SOL + semua akun SPL/Token-2022; EVM: native + **Multicall3** `balanceOf`/`decimals` untuk token yang dipantau, 100 token per `eth_call`), harga dari cache atau DexScreener (likuiditas ≥ $1K), PnL & aktivitas dari deret trades. Profil di `wallet:{addr}` (Redis). Halaman `/terminal/wallet/{address}` (Holdings, PnL, Activity) dan tab Top Traders/Trackers memakai data ini. Mode B menggantinya dengan riwayat penuh (ClickHouse `wallet_token_pnl`) tanpa mengubah kontrak.

### 4.9 Perps aggregator (#8)
- Sumber: API publik Hyperliquid (endpoint `info`: state clearinghouse per wallet, meta pasar, open interest). Verifikasi format terbaru di dokumentasi resmi Hyperliquid saat implementasi.
- Daftar wallet yang dipantau dibangun dari trade publik dan leaderboard, lalu di-poll bergilir dengan batas rate yang sopan.
- Bucketing (PnL, equity, winrate) dihitung tiap 5 menit dan disimpan sebagai snapshot, sehingga halaman Perps cukup membaca 1 dokumen.

### 4.10 Realtime gateway (#9)
- Proses terpisah `ws-gateway` (Node + uWebSockets.js atau `ws`). **Langkah 3:** sementara berjalan di dalam `apps/api` (`@fastify/websocket`, `src/ws/gateway.ts`); dipisah saat trafik WS perlu diskalakan sendiri.
- Worker mem-publish ke Redis pub/sub; gateway meneruskan ke klien yang subscribe channel tersebut. Detail channel di [`api/websocket.md`](api/websocket.md).
- **Coalescing:** update harga per token dikirim maksimal 4x per detik; update tabel Discover dikirim sebagai *diff* tiap 1 detik. (Belum diperlukan di Mode A karena worker mem-publish paling cepat tiap ±30 dtk; Discover sekarang memakai channel `price` per baris.)
- Bisa diskalakan horizontal karena tidak menyimpan state selain daftar subscription per koneksi.

### 4.11 Search (#10)
- **Meilisearch** (atau Typesense) dengan index `tokens` (simbol, nama, alamat, chain, liquidity untuk ranking) dan index `wallets` (alamat berlabel).
- Alamat persis (base58 / 0x) dideteksi dengan regex dan langsung dicari di Postgres; teks bebas ke Meilisearch.
- Hasil diurutkan: kecocokan persis > likuiditas > volume 24h. Token dengan security score rendah tetap tampil tetapi diberi badge peringatan.
- **Status (langkah 4):** paket `@ot/search` (antarmuka `SearchEngine`). Meilisearch dipakai bila `MEILI_URL` diisi (worker mengirim dokumen tiap siklus metrics); kalau tidak, fallback **Postgres pg_trgm** pada tabel `tokens` (diisi worker, `decimals` boleh NULL sejak migrasi 0002). Mesin hanya memberi kandidat; data pasar dari Redis dan ranking akhir (`rankTokens`) sama untuk keduanya: alamat persis > simbol persis > awalan simbol > nama > mengandung > fuzzy, lalu likuiditas, lalu volume. Alamat yang belum di-cache dicatat sebagai permintaan ke worker dan dibalas di `pending`; search bar mencari ulang tiap 5 dtk sampai token muncul. Index `wallets` menyusul bersama Trackers (langkah 8).

### 4.12 Swap & execution (#11)
- **Solana:** Jupiter Swap API (quote → swap transaction). **EVM:** 0x Swap API atau 1inch, dengan fallback ke router Uniswap/PancakeSwap langsung.
- Alur aman:
  1. `POST /api/v1/swap/quote` → server meminta quote, menyimpan `quote_id` di Redis (TTL 30 detik).
  2. `POST /api/v1/swap/build` → server membangun transaksi **belum ditandatangani** untuk alamat user, lalu **mensimulasikannya** (`simulateTransaction` di Solana, `eth_call`/`eth_estimateGas` di EVM). Jika simulasi gagal atau hasil < `minOut`, transaksi tidak dikembalikan.
  3. Klien menandatangani dan mengirim lewat wallet user.
  4. `POST /api/v1/swap/track` mencatat signature untuk riwayat dan PnL.
- Fee platform (opsional) memakai parameter fee bawaan aggregator, dicatat di `swap_orders`.
- **Limit order:** Fase lanjut, memakai fitur limit order aggregator (non-custodial) alih-alih menyimpan dana di server.
- Slippage default otomatis, dibatasi maksimal 50%; priority fee dari estimasi jaringan.
- **Status (langkah 6):** paket `@ot/swap`. Solana: Jupiter (lite-api, tanpa key). EVM (Base, BNB Chain): **KyberSwap Aggregator** (gratis, tanpa key; 0x/1inch butuh API key, bisa ditambah sebagai adapter). Pemeriksaan sebelum transaksi dikembalikan: Solana fee payer = wallet user, 1 penanda tangan, hanya program allowlist (Jupiter v6, Token, Token-2022, ATA, System, ComputeBudget, Memo); EVM router = alamat resmi KyberSwap, `value` = jumlah swap native. Simulasi wajib (`simulateTransaction` / `eth_call`+`eth_estimateGas`); minimum hasil ditegakkan kontrak aggregator on-chain. Saldo dicek dulu. ERC-20: approve sejumlah swap saja (bukan unlimited). Order dicatat di `swap_orders` (migrasi 0003); worker `swaps` memperbarui status submitted → confirmed/failed (drop setelah 2 jam). Fee platform 0%. **Catatan:** Jupiter & KyberSwap tidak mendukung devnet/testnet, jadi uji otomatis memakai fetch palsu + probe read-only (build untuk wallet kosong, tidak pernah ditandatangani); swap sungguhan pertama dilakukan user sendiri dengan jumlah kecil. Limit order menyusul.

### 4.13 User service (#12)
- **Auth:** Sign-In With Solana / Sign-In With Ethereum (pesan format EIP-4361) dengan nonce sekali pakai di Redis (TTL 5 menit), plus email magic link.
- Sesi: cookie `HttpOnly; Secure; SameSite=Lax` di domain yang sama, isi ID sesi acak (data sesi di Redis/Postgres). Tidak memakai JWT panjang di localStorage.
- **Roles:** `user`, `pro`, `peak` (institusi), `admin`. Middleware Next.js melindungi `/peak/app/*` dan `/account/*`.
- Data: profil, wallet terhubung (bisa lebih dari satu), watchlist token/wallet, preset swap, preferensi layout & kolom tabel.
- **Status (langkah 5):** SIWS/SIWE jalan (`apps/api/src/auth`, `routes/account.ts`). Server menyusun pesan EIP-4361 (domain & URI dari `APP_ORIGIN`), menyimpannya di Redis bersama nonce (TTL 5 menit, sekali pakai, ikut hangus bila verify gagal); verify mensyaratkan pesan sama persis. Tanda tangan: ed25519 (Solana) / personal_sign + recover secp256k1 (EVM, `@noble/curves`); wallet smart contract (EIP-1271) belum. Sesi: cookie `session` HttpOnly + SameSite=Lax (+Secure di https), 30 hari, yang disimpan di Postgres hanya sha256-nya, ID baru tiap login. CSRF: request yang mengubah data ditolak bila `Origin` bukan `APP_ORIGIN` atau `Sec-Fetch-Site: cross-site`. Rate limit nonce/verify 30 per 5 menit per IP. Web: deteksi wallet tanpa SDK (EIP-6963 untuk EVM, Wallet Standard untuk Solana). Watchlist maks 200 item; preferensi yang disimpan (whitelist): `discoverColumns`, `chartInterval`. Email magic link, role middleware (`/account`, `/peak/app`) menyusul.

### 4.14 Alert & notification (#13)
- Aturan di Postgres `alert_rules`: tipe (`price_above`, `price_below`, `pct_change`, `volume_spike`, `wallet_activity`, `new_listing`), target, ambang, channel, cooldown.
- `alert-evaluator` membaca stream metrics/swap, mengevaluasi aturan yang diindeks per token (bukan memindai semua aturan), menulis `alert_events`, lalu mengirim lewat web push (VAPID), bot Telegram, atau email.
- Deduplikasi dengan cooldown per aturan; batas jumlah aturan per tier.

### 4.15 Peak data (#14)
| Modul | Sumber & proses |
|---|---|
| Asset fundamentals | Supply on-chain + jadwal unlock/vesting/alokasi (input analis di admin, opsional vendor) |
| Market intelligence | Agregasi dari #3/#6, ditambah data CEX dan ETF flow dari vendor |
| Protocol analytics | TVL, fee, revenue, user aktif (DefiLlama API + indexer sendiri) |
| Wallet analytics | Dari #8, plus entitas (cluster wallet) dan net worth lintas chain |
| Indices | Worker harian/per jam menghitung indeks sektor dengan bobot market cap ber-cap; metodologi disimpan versi |
| Deals (investment hub) | Tabel deal, dokumen di S3 dengan signed URL berumur pendek, log akses per user, permintaan akses yang disetujui tim proyek |
| News & research | Ingest RSS/API berita dan filing, deduplikasi, tag entitas, ringkasan otomatis memakai Claude |
| **Peak AI** | Asisten dengan *tool use*: model Claude memanggil endpoint internal (harga, fundamental, unlock, wallet) sebagai tools, sehingga jawaban berdasar data, bukan hafalan. Log setiap pertanyaan dan tool call untuk audit. |

### 4.16 CMS (#15)
- Tabel `articles` di Postgres (kategori `blog`, `flagship-reports`, `insight-articles`; status draft/published; featured; tag; cover; file PDF).
- Editor di admin panel (#19). Halaman publik di-render statis dengan revalidasi on-demand saat artikel dipublikasikan.
- Alternatif jika butuh editor kaya: Payload CMS di dalam Next.js, memakai Postgres yang sama.

### 4.17 Public Data API (#16)
- Prefix publik `/api/v1/public/*` (atau header `X-API-KEY` pada endpoint yang sama).
- **API key:** dibuat di `/account/api`, hanya ditampilkan sekali; yang disimpan hanya hash SHA-256 + prefix untuk identifikasi.
- **Tier & kredit:** tiap endpoint punya biaya kredit (misal token overview = 1, OHLCV = 5, wallet PnL = 10). Rate limit token-bucket di Redis per key; kuota bulanan per tier.
- **Metering:** setiap request dicatat (key, endpoint, kredit, status, latency) ke ClickHouse `api_usage`, diagregasi harian untuk tagihan (Stripe metered billing).
- Docs dibangkitkan dari `openapi.yaml` (misal Scalar atau Redoc) di `/docs`.

### 4.18 Leads & forms (#17)
- `POST /api/v1/leads` dengan tipe `contact_sales`, `commission_report`, `careers`, `peak_demo`.
- Validasi schema, CAPTCHA tak terlihat (Cloudflare Turnstile), rate limit per IP, notifikasi ke Slack/email tim.

### 4.19 Embed widget (#18)
- Route `/embed/chart/{chain}/{address}?theme=&interval=&hide=` yang merender chart saja, tanpa shell.
- Header `Content-Security-Policy: frame-ancestors *` hanya untuk route ini; route lain tetap `frame-ancestors 'self'`.
- Builder di `/terminal/embed` menghasilkan snippet `<iframe>`.

### 4.20 Admin panel (#19)
- Route `/admin/*` (role `admin`, wajib 2FA).
- Fungsi: moderasi & verifikasi token, edit metadata/sosial, banner berbayar "Improve appearance" (dengan status pembayaran), kurasi RWA, label wallet, CMS, persetujuan deal Peak, manajemen user & API key, bobot trending.
- Semua aksi admin tercatat di `audit_log`.

---

## 5. Penyimpanan

| Store | Isi | Alasan |
|---|---|---|
| **PostgreSQL** | chains, tokens, pools, token_security, rwa_assets, address_labels, users, sessions, wallets, watchlists, alert_rules, api_keys, articles, leads, deals, audit_log, ingest_cursors | Relasional, transaksi, constraint |
| **ClickHouse** | swaps, transfers, candles_1s/1m/1h/1d, balances, wallet_token_pnl, token_metrics_history, api_usage, holder_snapshots | Volume besar, agregasi cepat, TTL |
| **Redis** | snapshot token panas, leaderboard (sorted set), quote swap, nonce auth, sesi, rate limit, pub/sub WS | Latensi rendah |
| **Redpanda** (Kafka API) | raw.{chain}, swaps, transfers, launches, token-updates | Buffer antar tahap, replay |
| **Object storage** (S3/R2) | logo token, cover artikel, PDF laporan, dokumen deal | File besar via CDN |
| **Meilisearch** | index token & wallet | Pencarian fuzzy |

Skema lengkap: [`postgres/0001_init.sql`](../packages/db/migrations/postgres/0001_init.sql) dan [`clickhouse/0001_init.sql`](../packages/db/migrations/clickhouse/0001_init.sql).

**Retensi:** candle 1s 48 jam, 1m 90 hari, 1h dan 1d selamanya; swap mentah 180 hari di ClickHouse (lebih lama di cold storage Parquet di S3).

---

## 6. Kontrak API

REST lengkap di [`api/openapi.yaml`](api/openapi.yaml). Pemetaan ke frontend yang sudah ada:

| Method `MarketDataProvider` | Endpoint |
|---|---|
| `listTokens({tab, chain, timeframe, limit})` | `GET /api/v1/tokens?tab=&chain=&tf=&limit=&cursor=` |
| `getToken(chain, address)` | `GET /api/v1/tokens/{chain}/{address}` |
| `getCandles(token, intervalSec)` | `GET /api/v1/tokens/{chain}/{address}/ohlcv?interval=&from=&to=` |
| `getTrades(token)` | `GET /api/v1/tokens/{chain}/{address}/trades?cursor=` |
| `getHolders(token)` | `GET /api/v1/tokens/{chain}/{address}/holders` |
| `getTopTraders(scope)` | `GET /api/v1/traders/top?token=&period=` |
| `getTrenches(chain)` | `GET /api/v1/trenches/{chain}?launchpad=` |
| `getPerpsDistribution()` | `GET /api/v1/perps/distribution` |
| `listArticles(category)` | `GET /api/v1/articles?category=` |
| `search(q)` | `GET /api/v1/search?q=` |

Konvensi:
- Angka uang dikirim sebagai **number** dalam USD; jumlah token mentah (raw amount) sebagai **string** desimal untuk menghindari kehilangan presisi.
- Pagination berbasis **cursor** (bukan offset).
- Setiap respons data pasar menyertakan `updatedAt` (ISO) dan `stale: boolean`.
- Error mengikuti format `{ "error": { "code": "TOKEN_NOT_FOUND", "message": "..." } }`.

**Penyesuaian tipe frontend di Fase 3** (kontrak API sengaja sedikit berbeda dari mock):

| Field | Mock sekarang (`packages/types/src/market.ts`) | Kontrak API |
|---|---|---|
| `Token.socials.*` | `boolean` | `string` (URL) |
| `Token.logoColor` | warna untuk avatar placeholder | diganti `logoUrl` (avatar warna jadi fallback) |
| `Token.updatedAt`, `Token.stale` | belum ada | wajib, untuk indikator data basi |
| `TrenchStage` | `new` / `final` / `migrated` | `created` / `final_stretch` / `migrated` |
| `Trade.final` | belum ada | `true` jika sudah terkonfirmasi |

Tipe bersama dipindah ke `packages/types` dan dibangkitkan dari `openapi.yaml`, supaya web dan api tidak bisa berbeda lagi.

WebSocket di [`api/websocket.md`](api/websocket.md): `price:{chain}:{addr}`, `trades:{chain}:{addr}`, `candles:{chain}:{addr}:{interval}`, `new-pairs:{chain}`, `trenches:{chain}`, `discover:{chain}:{tab}:{tf}`, `wallet:{addr}`, `alerts` (privat).

---

## 7. Keamanan

1. **Tidak ada secret di repo.** `.env.example` hanya berisi nama variabel; nilai di secret manager (Doppler, 1Password, atau secret platform hosting). Pre-commit hook `gitleaks`.
2. **Non-custodial:** server tidak menyimpan private key user. Kunci milik platform (misal wallet penerima fee) hanya alamat publik; tidak ada hot wallet yang menandatangani atas nama user.
3. **Simulasi wajib** sebelum transaksi swap dikembalikan ke klien (lihat 4.12).
4. **Auth:** nonce sekali pakai, verifikasi tanda tangan di server, domain & chain ID di pesan SIWE/SIWS harus cocok dengan domain ini, cookie HttpOnly, rotasi sesi saat login, CSRF token untuk request yang mengubah data.
5. **Validasi input** dengan Zod di setiap endpoint (alamat per format chain, batas angka, enum).
6. **Rate limit** berlapis: per IP (anonim), per user, per API key; proteksi bot di endpoint publik berat.
7. **Header:** CSP ketat, `frame-ancestors 'self'` (kecuali `/embed`), HSTS, `X-Content-Type-Options`.
8. **Data pihak ketiga dianggap tidak tepercaya:** nama/simbol token disanitasi (bisa berisi HTML, emoji palsu, atau karakter RTL untuk menipu).
9. **Admin:** 2FA wajib, audit log, prinsip least privilege untuk koneksi DB (user DB terpisah untuk API read-only vs worker).

---

## 8. Observability

- **Tracing & logging:** OpenTelemetry di semua layanan, log JSON terstruktur, korelasi `trace_id` dari request sampai query DB.
- **Metrics (Prometheus/Grafana):**
  - `ingest_lag_seconds{chain}`: selisih waktu blok terakhir chain vs yang sudah diproses.
  - `price_staleness_seconds{chain}`: umur harga referensi.
  - `ws_connections`, `ws_messages_per_sec`, `api_latency_p95{route}`, `provider_errors_total{provider}`.
- **Staleness di UI:** jika `updatedAt` lebih tua dari 30 detik (token aktif) atau 5 menit (token sepi), respons berisi `stale: true` dan UI menampilkan ikon jam abu-abu.
- **Alert ops:** ingest lag > 60 detik, error provider > 5%, ClickHouse insert gagal, kuota provider > 80%.
- **Status page** publik per chain.

---

## 9. Deployment

```
Internet ──► Cloudflare (CDN, WAF, DDoS) ──► Caddy/Nginx (satu domain)
                                              ├── /            → web (Next.js)
                                              ├── /api/v1/*    → api (Fastify)
                                              ├── /ws          → ws-gateway
                                              └── /embed/*     → web
```

- **Dev lokal:** `docker compose` berisi Postgres, ClickHouse, Redis, Redpanda, Meilisearch.
- **Produksi awal:** web di Vercel atau container; api, ws-gateway, workers sebagai container (Fly.io/Railway/Render atau Kubernetes); database terkelola (Neon/RDS, ClickHouse Cloud, Upstash/ElastiCache, Redpanda Cloud).
- **CI:** lint, typecheck, test, build image; migrasi DB dijalankan otomatis dengan tool migrasi (Drizzle/Atlas untuk Postgres, file SQL berurutan untuk ClickHouse).

---

## 10. Struktur monorepo (target Fase 3)

```
apps/
  web/            # Next.js yang sekarang di root, dipindah ke sini
  api/            # Fastify: REST /api/v1, auth, swap, leads, admin API
  ws-gateway/     # WebSocket /ws
  workers/        # ingestor, decoder, price, candle, metrics, holders, pnl,
                  # trenches, ranker, security, perps, alerts, news, peak
packages/
  types/          # tipe bersama (Token, Candle, Trade, ...) (sudah dibuat di langkah 0)
  sdk/            # klien /api/v1 + /ws, dipakai web sebagai apiProvider
  db/             # skema & migrasi Postgres/ClickHouse, query helper
  chains/         # config chain, decoder per protokol
  config/         # eslint, tsconfig
infra/
  docker-compose.yml
docs/
```

---

## 11. Urutan implementasi Fase 3

Setiap langkah selesai = halaman terkait sudah memakai data asli, bukan mock.

| # | Langkah | Selesai jika |
|---|---|---|
| 0 ✅ | Ubah ke monorepo, docker compose, migrasi awal | `npm run dev` menjalankan web + api + DB lokal |
| 1 ✅ | Provider bridge (Mode A) + `GET /tokens`, `/tokens/{chain}/{addr}` | Discover & header token memakai data asli |
| 2 ✅ | OHLCV + trades | Chart dan tab Trades asli |
| 3 ✅ | WS gateway + price/trades channel | Tabel dan chart bergerak dari data asli |
| 4 ✅ | Search (Meilisearch, fallback Postgres pg_trgm) | Search bar asli |
| 5 ✅ | Auth SIWS/SIWE + watchlist + preferensi | Login, ★ tersimpan |
| 6 ✅ | Swap (quote, build + simulasi, track) | Buy/Sell jalan non-custodial |
| 7 ✅ | Holders + security scan | Tab Holders & Security asli |
| 8 ✅ | Wallet PnL + Top Traders + profil wallet | Trackers asli |
| 9 ✅ | Trenches FSM (Solana dulu) | Halaman Trenches asli |
| 10 ✅ | Perps aggregator (Hyperliquid) | Halaman Perps asli |
| 11 ✅ | Alerts + notifikasi (in-app & browser) | Alert terkirim |
| 12 ✅ | CMS + admin | Research & Blog dari DB |
| 13 ◐ | Public Data API + billing | API key & kuota ✅; billing berbayar belum dikonfigurasi |
| 14 ◐ | Modul Peak + Peak AI | Overview/Markets/Wallets/News/AI asli; modul fundamental belum ada sumber data |
| 15 ◐ | Indexer sendiri Solana (Mode B), lalu chain lain | Status per chain di `/status/data-sources`; indexer belum dikonfigurasi (butuh RPC/Geyser berbayar) |

---

### Catatan status langkah 9–15

- **9 Trenches (Mode A):** worker `trenches` (40 dtk) mengambil pool baru Solana (DEX pump.fun), pool pump.fun & PumpSwap teraktif dari GeckoTerminal, lalu membaca akun bonding curve lewat RPC (`getMultipleAccounts`) untuk progress dan flag `complete`. FSM: created → final_stretch (≥ 60%) → migrated (curve complete / pool PumpSwap); dead bila sepi 24 jam dengan progress < 5%. State di Redis `trench:state:solana`, tampilan di `trenches:solana`; `GET /trenches/solana`. Chain lain belum (Trenches hanya Solana).
- **10 Perps (Hyperliquid):** pasar (`metaAndAssetCtxs`) tiap 60 dtk; populasi akun dari leaderboard publik (±46K akun) tiap 30 menit; posisi `clearinghouseState` untuk sampel maks. 300 akun teraktif per segmen equity, 100 akun per siklus. Total wallet = populasi; kolom posisi = sampel (ditampilkan di UI). `GET /perps`.
- **11 Alerts:** rule di `alert_rules` (price_above, price_below, pct_change 1 jam), worker `alerts` 15 dtk, cooldown per rule (klaim bersyarat supaya tidak dobel), event di `alert_events`. Kanal: in-app (panel Alerts) + Notification browser. Telegram/email belum.
- **12 CMS:** `articles` (Markdown) + `/admin` untuk wallet di `ADMIN_WALLETS` atau role admin; semua perubahan dicatat di `audit_log`. Web merender Markdown tanpa HTML mentah. Selama belum ada artikel terbit, situs menampilkan artikel contoh.
- **13 Data API:** API key (`ak_…`, yang disimpan hanya sha256) lewat `/me/api-keys`; header `x-api-key` divalidasi di semua `/api/v1`, 1 kredit/request, batas per detik & bulanan sesuai paket (Free: 30K/bulan, 1 rps). `STRIPE_SECRET_KEY` belum diisi → `/billing` = not configured.
- **14 Peak:** Overview, Markets, Wallets, News, Peak AI (BYOK Claude, sama dengan AI Agent) memakai data asli; Assets/Protocols/Indices/Deals menunggu sumber data fundamental.
- **15 Indexer:** belum diimplementasikan; `SOLANA_GEYSER_URL` hanya mengubah status menjadi `configured_not_implemented`.

## 12. Testing

- **Unit:** decoder diuji dengan fixture transaksi asli (simpan JSON tx di `packages/chains/fixtures`), rumus harga/PnL/trending.
- **Kontrak:** respons API divalidasi terhadap `openapi.yaml` di CI.
- **Integrasi:** docker compose + data seed; tes end-to-end ingestion → API.
- **E2E UI:** Playwright untuk alur utama (discover → token → connect wallet → quote).
- **Swap:** hanya di devnet/testnet; tidak ada tes otomatis yang menandatangani transaksi mainnet.

---

## 13. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Biaya provider data membengkak | Cache di worker, batasi token yang di-refresh cepat, migrasi ke indexer sendiri per chain |
| Manipulasi harga (pool kecil, wash trading) | Harga dari pool terlikuid, ambang likuiditas, penalti trending |
| Reorg / data ganda | Kunci idempoten, status `final`, event revert |
| Lonjakan trafik WS saat pasar ramai | Coalescing, scale horizontal gateway, batas subscription per koneksi |
| Token scam tampil di trending | Security score sebagai penalti, badge peringatan, moderasi admin |
| Regulasi (swap, tokenized stock/RWA) | Non-custodial, disclaimer, geofencing jika diperlukan; konsultasi hukum sebelum mainnet |

---

## 14. Keputusan yang masih terbuka

1. **Chain MVP final** (asumsi saat ini: Solana, Base, BNB Chain, Robinhood Chain).
2. ~~**Provider data Mode A** dan budget bulanannya.~~ Diputuskan: GeckoTerminal (discovery) + DEX Screener (metrik per token), gratis tanpa key, budget $0. Keterbatasan: volume/txns hanya pair paling likuid, tanpa split beli/jual, 4h, holders, security; GeckoTerminal ±10 panggilan/menit. Adapter di `packages/bridge`, bisa ditambah provider berbayar (Birdeye/Codex) tanpa ubah api/web.
3. **Integrasi dengan proyek lain milikmu** (misal launchpad Solana atau sistem token saham): apakah datanya perlu masuk ke Trenches/RWAs, dan lewat API atau database bersama.
4. **Hosting** (managed cloud vs VPS sendiri).
5. **Model bisnis:** fee swap, langganan Pro, tier Data API, banner berbayar.
