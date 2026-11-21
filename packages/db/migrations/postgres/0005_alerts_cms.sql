-- Langkah 11: alerts. Simbol disimpan untuk tampilan; event dibaca per user lewat rule.
ALTER TABLE alert_rules ADD COLUMN symbol text;
CREATE INDEX alert_rules_user ON alert_rules (user_id, created_at DESC);
CREATE INDEX alert_events_rule ON alert_events (rule_id, fired_at DESC);

-- Langkah 12: CMS. Slug unik sudah ada; tambah indeks daftar admin dan kolom penulis tampilan.
ALTER TABLE articles ADD COLUMN author_name text;
CREATE INDEX articles_updated ON articles (updated_at DESC);

-- Langkah 13: API publik. Paket awal (harga 0 = belum ada billing; Stripe diisi nanti).
INSERT INTO api_plans (id, monthly_credits, rps_limit, ws_enabled, price_usd_cents) VALUES
  ('free', 30000, 1, false, 0)
ON CONFLICT (id) DO NOTHING;
