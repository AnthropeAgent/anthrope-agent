-- =====================================================================
-- PostgreSQL schema (Fase 2 design). Data relasional & konfigurasi.
-- Data time-series (swap, candle, transfer, usage) ada di clickhouse.sql.
-- Target: PostgreSQL 16+. Jalankan lewat tool migrasi di Fase 3.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- CHAINS & INGESTION
-- ---------------------------------------------------------------------
CREATE TYPE chain_kind AS ENUM ('solana', 'evm', 'move');
CREATE TYPE data_mode  AS ENUM ('provider', 'indexer', 'both');

CREATE TABLE chains (
  id              text PRIMARY KEY,               -- 'solana', 'base', 'bsc', 'robinhood'
  name            text NOT NULL,
  kind            chain_kind NOT NULL,
  evm_chain_id    integer,                        -- null untuk non-EVM
  native_symbol   text NOT NULL,
  explorer_url    text NOT NULL,
  data_mode       data_mode NOT NULL DEFAULT 'provider',
  trenches_enabled boolean NOT NULL DEFAULT false,
  enabled         boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0
);

-- Posisi terakhir ingestor per chain (untuk resume & backfill)
CREATE TABLE ingest_cursors (
  chain_id        text NOT NULL REFERENCES chains(id),
  stream          text NOT NULL,                  -- 'blocks', 'provider:tokens', ...
  position        bigint NOT NULL,                -- slot / block number
  position_hash   text,                           -- block hash untuk deteksi reorg
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, stream)
);

-- ---------------------------------------------------------------------
-- TOKENS, POOLS, SECURITY
-- ---------------------------------------------------------------------
CREATE TABLE tokens (
  chain_id        text NOT NULL REFERENCES chains(id),
  address         text NOT NULL,                  -- base58 / 0x lowercase
  symbol          text NOT NULL,
  name            text NOT NULL,
  decimals        smallint NOT NULL,
  logo_url        text,
  total_supply    numeric(78, 0),                 -- raw units
  circulating_supply numeric(78, 0),
  creator         text,
  launchpad       text,                           -- 'pump.fun', 'four.meme', ...
  created_at_chain timestamptz,                   -- waktu token dibuat on-chain
  is_rwa          boolean NOT NULL DEFAULT false,
  verified        boolean NOT NULL DEFAULT false,
  hidden          boolean NOT NULL DEFAULT false, -- moderasi admin
  socials         jsonb NOT NULL DEFAULT '{}',    -- {website, x, telegram, discord}
  banner_url      text,                           -- "Improve appearance" berbayar
  data_source     text NOT NULL DEFAULT 'provider',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address)
);
CREATE INDEX tokens_symbol_trgm ON tokens USING gin (symbol gin_trgm_ops);
CREATE INDEX tokens_name_trgm   ON tokens USING gin (name gin_trgm_ops);
CREATE INDEX tokens_created     ON tokens (chain_id, created_at_chain DESC);

CREATE TABLE pools (
  chain_id        text NOT NULL REFERENCES chains(id),
  address         text NOT NULL,
  dex             text NOT NULL,                  -- 'raydium-cpmm', 'uniswap-v3', ...
  base_token      text NOT NULL,
  quote_token     text NOT NULL,
  fee_bps         integer,
  created_at_chain timestamptz,
  liquidity_usd   double precision NOT NULL DEFAULT 0,   -- diperbarui worker
  is_primary      boolean NOT NULL DEFAULT false,         -- pool acuan harga token
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address),
  FOREIGN KEY (chain_id, base_token) REFERENCES tokens(chain_id, address)
);
CREATE INDEX pools_base ON pools (chain_id, base_token, liquidity_usd DESC);
CREATE UNIQUE INDEX pools_one_primary ON pools (chain_id, base_token) WHERE is_primary;

CREATE TABLE token_security (
  chain_id        text NOT NULL,
  address         text NOT NULL,
  score           smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  mint_revoked    boolean,
  freeze_revoked  boolean,
  lp_burned_pct   real,
  honeypot        boolean,
  buy_tax_pct     real,
  sell_tax_pct    real,
  top10_pct       real,
  dev_holding_pct real,
  flags           text[] NOT NULL DEFAULT '{}',   -- ['transfer_hook', 'proxy', ...]
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address),
  FOREIGN KEY (chain_id, address) REFERENCES tokens(chain_id, address) ON DELETE CASCADE
);

-- Status Trenches (state machine 4.7)
CREATE TYPE trench_stage AS ENUM ('created', 'final_stretch', 'migrated', 'dead');
CREATE TABLE trench_tokens (
  chain_id        text NOT NULL,
  address         text NOT NULL,
  launchpad       text NOT NULL,
  stage           trench_stage NOT NULL DEFAULT 'created',
  bonding_pct     real NOT NULL DEFAULT 0,
  migrated_pool   text,
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address),
  FOREIGN KEY (chain_id, address) REFERENCES tokens(chain_id, address) ON DELETE CASCADE
);
CREATE INDEX trench_stage_idx ON trench_tokens (chain_id, stage, stage_changed_at DESC);

-- RWA / tokenized stocks (dikurasi admin)
CREATE TABLE rwa_assets (
  chain_id        text NOT NULL,
  address         text NOT NULL,
  asset_class     text NOT NULL,                  -- 'equity', 'etf', 'treasury', 'commodity'
  underlying      text NOT NULL,                  -- 'TSLA', 'SPY', 'XAU', ...
  issuer          text NOT NULL,
  reference_url   text,
  PRIMARY KEY (chain_id, address),
  FOREIGN KEY (chain_id, address) REFERENCES tokens(chain_id, address) ON DELETE CASCADE
);

-- Label alamat (LP, CEX, KOL, smart money, burn, deployer)
CREATE TABLE address_labels (
  chain_id        text NOT NULL,
  address         text NOT NULL,
  label           text NOT NULL,
  category        text NOT NULL,                  -- 'cex', 'lp', 'kol', 'smart_money', 'fund', 'burn'
  source          text NOT NULL DEFAULT 'manual', -- 'manual' | 'auto'
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address, label)
);

-- ---------------------------------------------------------------------
-- USERS, SESSIONS, PREFERENCES
-- ---------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('user', 'pro', 'peak', 'admin');

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE,
  display_name    text,
  role            user_role NOT NULL DEFAULT 'user',
  totp_secret_enc bytea,                          -- wajib untuk admin; terenkripsi
  preferences     jsonb NOT NULL DEFAULT '{}',    -- kolom tabel, layout token, preset swap
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

CREATE TABLE user_wallets (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_kind      chain_kind NOT NULL,
  address         text NOT NULL,
  verified_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_kind, address)
);
CREATE INDEX user_wallets_user ON user_wallets (user_id);

CREATE TABLE sessions (
  id_hash         bytea PRIMARY KEY,              -- sha256 dari session id di cookie
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  ip              inet,
  user_agent      text
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE watchlist_items (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('token', 'wallet')),
  chain_id        text NOT NULL,
  address         text NOT NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, chain_id, address)
);

-- ---------------------------------------------------------------------
-- ALERTS
-- ---------------------------------------------------------------------
CREATE TYPE alert_kind AS ENUM ('price_above', 'price_below', 'pct_change', 'volume_spike', 'wallet_activity', 'new_listing');

CREATE TABLE alert_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            alert_kind NOT NULL,
  chain_id        text NOT NULL,
  target          text NOT NULL,                  -- alamat token / wallet
  params          jsonb NOT NULL,                 -- {"threshold": 1.5, "window": "1h"}
  channels        text[] NOT NULL DEFAULT '{web}',-- 'web', 'telegram', 'email'
  cooldown_sec    integer NOT NULL DEFAULT 300,
  active          boolean NOT NULL DEFAULT true,
  last_fired_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_rules_target ON alert_rules (chain_id, target) WHERE active;

CREATE TABLE alert_events (
  id              bigserial PRIMARY KEY,
  rule_id         uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  fired_at        timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL,
  delivered       jsonb NOT NULL DEFAULT '{}'     -- {"telegram": "ok", "email": "failed"}
);

CREATE TABLE notification_targets (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel         text NOT NULL,                  -- 'web' (push subscription), 'telegram', 'email'
  value           jsonb NOT NULL,
  PRIMARY KEY (user_id, channel)
);

-- ---------------------------------------------------------------------
-- SWAP ORDERS (catatan, bukan dana; non-custodial)
-- ---------------------------------------------------------------------
CREATE TABLE swap_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id),
  chain_id        text NOT NULL,
  wallet          text NOT NULL,
  input_token     text NOT NULL,
  output_token    text NOT NULL,
  amount_in       numeric(78, 0) NOT NULL,
  min_amount_out  numeric(78, 0) NOT NULL,
  aggregator      text NOT NULL,                  -- 'jupiter', '0x', '1inch'
  fee_bps         integer NOT NULL DEFAULT 0,
  tx_signature    text,
  status          text NOT NULL DEFAULT 'built',  -- built | submitted | confirmed | failed
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX swap_orders_wallet ON swap_orders (chain_id, wallet, created_at DESC);

-- ---------------------------------------------------------------------
-- PUBLIC DATA API
-- ---------------------------------------------------------------------
CREATE TABLE api_plans (
  id              text PRIMARY KEY,               -- 'free', 'builder', 'business', 'enterprise'
  monthly_credits bigint NOT NULL,
  rps_limit       integer NOT NULL,
  ws_enabled      boolean NOT NULL DEFAULT false,
  price_usd_cents integer NOT NULL
);

CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  prefix          text NOT NULL,                  -- 8 karakter pertama, untuk ditampilkan
  key_hash        bytea NOT NULL UNIQUE,          -- sha256(key); key asli tidak pernah disimpan
  plan_id         text NOT NULL REFERENCES api_plans(id),
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_endpoint_costs (
  route           text PRIMARY KEY,               -- 'GET /tokens/{chain}/{address}/ohlcv'
  credits         integer NOT NULL
);

CREATE TABLE billing_periods (
  api_key_id      uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  credits_used    bigint NOT NULL DEFAULT 0,      -- diagregasi dari ClickHouse api_usage
  stripe_item_id  text,
  PRIMARY KEY (api_key_id, period_start)
);

-- ---------------------------------------------------------------------
-- CMS (Research & Blog)
-- ---------------------------------------------------------------------
CREATE TYPE article_category AS ENUM ('blog', 'flagship-reports', 'insight-articles');

CREATE TABLE articles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  category        article_category NOT NULL,
  title           text NOT NULL,
  excerpt         text NOT NULL,
  body_md         text NOT NULL,
  cover_url       text,
  pdf_url         text,
  tags            text[] NOT NULL DEFAULT '{}',
  featured        boolean NOT NULL DEFAULT false,
  read_minutes    smallint,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  author_id       uuid REFERENCES users(id),
  published_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX articles_pub ON articles (category, published_at DESC) WHERE status = 'published';

-- ---------------------------------------------------------------------
-- LEADS
-- ---------------------------------------------------------------------
CREATE TABLE leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('contact_sales', 'commission_report', 'careers', 'peak_demo')),
  full_name       text NOT NULL,
  email           citext NOT NULL,
  company         text,
  company_type    text,
  job_title       text,
  website         text,
  message         text,
  ip              inet,
  status          text NOT NULL DEFAULT 'new',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- PEAK (institusional)
-- ---------------------------------------------------------------------
CREATE TABLE token_unlocks (
  id              bigserial PRIMARY KEY,
  chain_id        text NOT NULL,
  address         text NOT NULL,
  unlock_at       timestamptz NOT NULL,
  amount          numeric(78, 0) NOT NULL,
  category        text NOT NULL,                  -- 'team', 'investors', 'ecosystem', ...
  source          text NOT NULL,
  FOREIGN KEY (chain_id, address) REFERENCES tokens(chain_id, address) ON DELETE CASCADE
);
CREATE INDEX token_unlocks_time ON token_unlocks (unlock_at);

CREATE TABLE indices (
  id              text PRIMARY KEY,               -- 'defi-top10', 'ai-agents', ...
  name            text NOT NULL,
  methodology_version integer NOT NULL DEFAULT 1,
  methodology     jsonb NOT NULL                  -- bobot, cap, aturan rebalance
);

CREATE TABLE index_constituents (
  index_id        text NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
  effective_from  date NOT NULL,
  chain_id        text NOT NULL,
  address         text NOT NULL,
  weight          real NOT NULL,
  PRIMARY KEY (index_id, effective_from, chain_id, address)
);

CREATE TABLE deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name    text NOT NULL,
  round           text NOT NULL,                  -- 'seed', 'series-a', ...
  target_usd      bigint,
  status          text NOT NULL DEFAULT 'draft',  -- draft | open | closed
  owner_user_id   uuid REFERENCES users(id),      -- tim proyek
  summary         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deal_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  title           text NOT NULL,
  storage_key     text NOT NULL,                  -- key di object storage, diakses via signed URL
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deal_access (
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'requested', -- requested | approved | denied
  decided_at      timestamptz,
  PRIMARY KEY (deal_id, user_id)
);

CREATE TABLE news_items (
  id              bigserial PRIMARY KEY,
  source          text NOT NULL,
  url             text NOT NULL UNIQUE,
  title           text NOT NULL,
  summary         text,                           -- ringkasan otomatis
  entities        text[] NOT NULL DEFAULT '{}',   -- 'solana:So111..', 'org:sec'
  category        text,                           -- 'regulation', 'filing', 'protocol', 'macro'
  published_at    timestamptz NOT NULL,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_published ON news_items (published_at DESC);
CREATE INDEX news_entities ON news_items USING gin (entities);

-- ---------------------------------------------------------------------
-- ADMIN
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  actor_id        uuid REFERENCES users(id),
  action          text NOT NULL,                  -- 'token.verify', 'article.publish', ...
  target          text,
  diff            jsonb,
  ip              inet,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_config (
  key             text PRIMARY KEY,               -- 'trending.weights', 'staleness.thresholds'
  value           jsonb NOT NULL,
  updated_by      uuid REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- SEED MINIMAL
-- ---------------------------------------------------------------------
INSERT INTO chains (id, name, kind, evm_chain_id, native_symbol, explorer_url, trenches_enabled, sort_order) VALUES
  ('solana',    'Solana',          'solana', NULL, 'SOL', 'https://solscan.io/token/',    true,  1),
  ('base',      'Base',            'evm',    8453, 'ETH', 'https://basescan.org/token/',  false, 2),
  ('bsc',       'BNB Chain',       'evm',    56,   'BNB', 'https://bscscan.com/token/',   true,  3),
  ('robinhood', 'Robinhood Chain', 'evm',    NULL, 'ETH', '',                             true,  4);
-- evm_chain_id & explorer Robinhood Chain diisi saat implementasi dari dokumentasi resminya.

INSERT INTO app_config (key, value) VALUES
  ('trending.weights', '{"volume":0.4,"traders":0.3,"price":0.002,"txns":0.2,"lowSecurityPenalty":0.5}'),
  ('staleness.thresholds', '{"activeSec":30,"idleSec":300}');
