-- Langkah 7: holders & security scan (Mode A: GoPlus + Solana RPC).
-- Hasil scan disimpan walau token belum ada di tabel tokens (token bisa dibuka langsung lewat URL).
ALTER TABLE token_security DROP CONSTRAINT IF EXISTS token_security_chain_id_address_fkey;
ALTER TABLE token_security
  ADD COLUMN report jsonb,
  ADD COLUMN source text;
CREATE INDEX token_security_scanned ON token_security (scanned_at);

-- Snapshot terakhir top 100 holder per token (riwayat penuh nanti di ClickHouse, Mode B).
CREATE TABLE holder_snapshots (
  chain_id     text NOT NULL,
  address      text NOT NULL,
  holder_count bigint,
  top10_pct    real,
  items        jsonb NOT NULL,
  source       text NOT NULL,
  taken_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address)
);
