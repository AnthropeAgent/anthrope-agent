-- Mode A (provider bridge): decimals tidak selalu diketahui (DexScreener tidak memberinya).
-- NULL = belum diketahui; diisi saat sumber yang tahu (GeckoTerminal / indexer) melihat token itu.
-- Dibutuhkan supaya semua token yang dipantau masuk tabel `tokens` dan bisa dicari (langkah 4).
ALTER TABLE tokens ALTER COLUMN decimals DROP NOT NULL;
