-- Pengaturan situs yang diubah admin dari /admin (mis. contract address token resmi untuk hero).
CREATE TABLE IF NOT EXISTS site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
