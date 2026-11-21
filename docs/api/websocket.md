# WebSocket `/ws`

> **Status (Fase 3 langkah 3):** channel `price`, `trades`, `candles` sudah jalan. Gateway ada di proses `apps/api`
> (`src/ws/gateway.ts`); worker mem-publish ke Redis pub/sub dengan nama channel yang sama, gateway hanya
> subscribe ke channel yang sedang diikuti klien. Channel lain di tabel bawah masih rencana.
>
> Di Mode A data berubah setiap kali worker selesai mengambil dari provider: harga ±30 dtk, trades ±30 dtk,
> candle 1–5 menit. Jadi stream mengirim lebih jarang daripada batas frekuensi di bawah; batas itu untuk Mode B.

Satu koneksi WebSocket per tab browser, di domain yang sama (`wss://{domain}/ws`). Sesi login dibaca dari cookie; klien Public Data API mengirim `?apiKey=` (tier yang mengizinkan WS saja).

## Pesan klien → server

```jsonc
{ "op": "subscribe",   "channels": ["price:solana:So111...", "trades:solana:So111..."] }
{ "op": "unsubscribe", "channels": ["trades:solana:So111..."] }
{ "op": "ping" }
```

## Pesan server → klien

```jsonc
{ "ch": "price:solana:So111...", "seq": 1042, "data": { ... } }
{ "op": "subscribed", "channels": [...] }
{ "op": "error", "code": "CHANNEL_LIMIT", "message": "max 50 channels" }
{ "op": "pong" }
```

`seq` naik per channel. Jika klien melihat lompatan `seq`, klien mengambil ulang snapshot lewat REST lalu melanjutkan stream.

## Channel

| Channel | Isi `data` | Frekuensi | Dipakai di |
|---|---|---|---|
| `price:{chain}:{addr}` ✅ | `{ price, priceNative, marketCap, fdv, liquidity, change, volume24h, txns24h, buys24h, sells24h, traders24h, updatedAt }` | maks 4/detik (coalesced) | Header token, tabel, ticker |
| `candles:{chain}:{addr}:{interval}` ✅ | `Candle` (bar berjalan, `time` sama sampai bar tutup). Interval: 1m, 5m, 15m, 1h, 4h, 1d | maks 4/detik | Chart |
| `trades:{chain}:{addr}` ✅ | `Trade[]` (batch, terbaru dulu) | tiap 250 ms jika ada trade | Tab Trades |
| `discover:{chain}:{tab}:{tf}` | `{ upsert: Token[], remove: string[], order: string[] }` (diff) | 1/detik | Tabel Discover |
| `new-pairs:{chain}` | `Token` | saat pool baru dibuat | Strip "New", Trenches |
| `trenches:{chain}` | `{ address, stage, bondingPct, marketCap, ... }` | saat berubah, maks 2/detik per token | Halaman Trenches |
| `wallet:{addr}` | `Trade` milik wallet | saat terjadi | Trackers → Monitor |
| `ticker` | `{ BTC, ETH, SOL }` harga | 1/3 detik | Footer ticker |
| `alerts` *(privat, butuh login)* | `AlertEvent` | saat alert terpicu | Notifikasi in-app |

Data yang belum final (belum terkonfirmasi) ditandai `final: false`. Data ini hanya lewat WS dan belum masuk ClickHouse.

## Batas

- Maks 100 channel per koneksi (anonim; Discover menampilkan hingga 60 token), 200 (login), sesuai tier untuk API key.
- Maks 5 koneksi per IP anonim (alamat loopback dikecualikan).
- Pesan klien maks 16 KB. Alamat EVM di nama channel dinormalisasi ke huruf kecil; balasan `subscribed` berisi nama yang sudah dinormalisasi.
- Error: `BAD_MESSAGE`, `INVALID_CHANNEL`, `CHANNEL_LIMIT`, `CONNECTION_LIMIT`, `UNAVAILABLE`.
- Server menutup koneksi yang tidak mengirim `ping` selama 60 detik.

## Pemetaan ke frontend

- Klien bersama: `apps/web/src/lib/data/ws.ts` (satu koneksi per tab, ref-count subscription, reconnect dengan backoff, ping tiap 25 dtk). Hook `useChannels(channels, onData, onResync)`.
- `useLiveTokens`: subscribe `price:{chain}:{addr}` untuk tiap token yang tampil. Bentuk return `{ tokens, flash }` tetap sama.
- Chart: `candles:…`; tab Trades: `trades:…`. Selama ada yang subscribe, gateway memperpanjang key `view:*` supaya worker terus me-refresh data token itu.
- Setelah reconnect atau lompatan `seq`, komponen mengambil ulang snapshot lewat REST.
