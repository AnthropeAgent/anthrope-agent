-- =====================================================================
-- ClickHouse schema (Fase 2 design). Data time-series bervolume besar.
--
-- ATURAN PENTING (idempotensi & reorg):
-- Materialized view (candle, balance, PnL) terpicu pada SETIAP insert,
-- sehingga ReplacingMergeTree di tabel sumber TIDAK mencegah hitungan
-- ganda di tabel turunan. Karena itu:
--   1. Swap/transfer hanya di-insert ke ClickHouse setelah terkonfirmasi
--      (Solana: commitment 'confirmed'; EVM: kedalaman N blok per chain,
--      misal 3 di Base, 15 di BSC). Data realtime yang belum final hanya
--      lewat Redis/WS, tidak masuk ClickHouse.
--   2. Writer melakukan deduplikasi sebelum insert (Redis set
--      chain:tx_hash:ev_index dengan TTL 7 hari) dan memakai
--      insert_deduplication_token per batch, sehingga batch yang
--      di-retry tidak tertulis dua kali.
--   3. Reorg dalam di luar kedalaman konfirmasi (jarang) ditangani job
--      perbaikan: hapus partisi/jam terdampak di tabel turunan lalu
--      hitung ulang dari tabel sumber.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SWAPS (sumber utama harga, volume, PnL)
-- ---------------------------------------------------------------------
CREATE TABLE swaps
(
    chain        LowCardinality(String),
    block_time   DateTime64(3, 'UTC'),
    slot         UInt64,                    -- slot (Solana) / block number (EVM)
    tx_hash      String,
    ev_index     UInt32,                    -- log index / instruction index
    pool         String,
    dex          LowCardinality(String),
    token        String,                    -- token "base" (yang diperdagangkan)
    quote_token  String,
    side         Enum8('buy' = 1, 'sell' = 2),
    trader       String,
    amount_token Float64,                   -- sudah dibagi decimals
    amount_quote Float64,
    price_usd    Float64,
    value_usd    Float64,
    is_reverted  UInt8 DEFAULT 0,           -- ditandai oleh job perbaikan reorg dalam
    version      UInt64                     -- untuk ReplacingMergeTree (dedup baris sumber)
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(block_time)
ORDER BY (chain, token, block_time, tx_hash, ev_index)
TTL toDateTime(block_time) + INTERVAL 180 DAY
-- Wajib sejak ClickHouse 24.8 agar ReplacingMergeTree boleh punya projection.
SETTINGS deduplicate_merge_projection_mode = 'rebuild';

-- Proyeksi untuk query "trade per wallet"
ALTER TABLE swaps ADD PROJECTION by_trader
(
    SELECT * ORDER BY (chain, trader, block_time)
);

-- ---------------------------------------------------------------------
-- CANDLES: 1s & 1m dari swap, sisanya rollup dari 1m
-- ---------------------------------------------------------------------
CREATE TABLE candles_1s
(
    chain   LowCardinality(String),
    token   String,
    ts      DateTime('UTC'),
    open    AggregateFunction(argMin, Float64, DateTime64(3, 'UTC')),
    high    SimpleAggregateFunction(max, Float64),
    low     SimpleAggregateFunction(min, Float64),
    close   AggregateFunction(argMax, Float64, DateTime64(3, 'UTC')),
    volume  SimpleAggregateFunction(sum, Float64),
    trades  SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toDate(ts)
ORDER BY (chain, token, ts)
TTL ts + INTERVAL 2 DAY;

CREATE MATERIALIZED VIEW mv_candles_1s TO candles_1s AS
SELECT chain, token, toStartOfSecond(block_time) AS ts,
       argMinState(price_usd, block_time) AS open,
       max(price_usd) AS high, min(price_usd) AS low,
       argMaxState(price_usd, block_time) AS close,
       sum(value_usd) AS volume, count() AS trades
FROM swaps
WHERE is_reverted = 0
GROUP BY chain, token, ts;

CREATE TABLE candles_1m AS candles_1s
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (chain, token, ts)
TTL ts + INTERVAL 90 DAY;

CREATE MATERIALIZED VIEW mv_candles_1m TO candles_1m AS
SELECT chain, token, toStartOfMinute(block_time) AS ts,
       argMinState(price_usd, block_time) AS open,
       max(price_usd) AS high, min(price_usd) AS low,
       argMaxState(price_usd, block_time) AS close,
       sum(value_usd) AS volume, count() AS trades
FROM swaps
WHERE is_reverted = 0
GROUP BY chain, token, ts;

-- 1h dan 1d disimpan permanen (tanpa TTL). 5m/15m/4h dihitung saat query dari 1m/1h.
CREATE TABLE candles_1h AS candles_1s
ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(ts) ORDER BY (chain, token, ts);

CREATE MATERIALIZED VIEW mv_candles_1h TO candles_1h AS
SELECT chain, token, toStartOfHour(block_time) AS ts,
       argMinState(price_usd, block_time) AS open,
       max(price_usd) AS high, min(price_usd) AS low,
       argMaxState(price_usd, block_time) AS close,
       sum(value_usd) AS volume, count() AS trades
FROM swaps WHERE is_reverted = 0 GROUP BY chain, token, ts;

CREATE TABLE candles_1d AS candles_1s
ENGINE = AggregatingMergeTree PARTITION BY toYear(ts) ORDER BY (chain, token, ts);

CREATE MATERIALIZED VIEW mv_candles_1d TO candles_1d AS
SELECT chain, token, toStartOfDay(block_time) AS ts,
       argMinState(price_usd, block_time) AS open,
       max(price_usd) AS high, min(price_usd) AS low,
       argMaxState(price_usd, block_time) AS close,
       sum(value_usd) AS volume, count() AS trades
FROM swaps WHERE is_reverted = 0 GROUP BY chain, token, ts;

-- Contoh query OHLCV 15m:
-- SELECT toStartOfInterval(ts, INTERVAL 15 MINUTE) AS t,
--        argMinMerge(open) AS o, max(high) AS h, min(low) AS l, argMaxMerge(close) AS c, sum(volume) AS v
-- FROM candles_1m WHERE chain = {chain:String} AND token = {token:String} AND ts BETWEEN {from:DateTime} AND {to:DateTime}
-- GROUP BY t ORDER BY t;

-- ---------------------------------------------------------------------
-- TRANSFERS & BALANCES (holder tracker)
-- ---------------------------------------------------------------------
CREATE TABLE transfers
(
    chain      LowCardinality(String),
    block_time DateTime64(3, 'UTC'),
    tx_hash    String,
    ev_index   UInt32,
    token      String,
    from_addr  String,
    to_addr    String,
    amount     Float64,
    is_reverted UInt8 DEFAULT 0,
    version    UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(block_time)
ORDER BY (chain, token, block_time, tx_hash, ev_index);

CREATE TABLE balances
(
    chain   LowCardinality(String),
    token   String,
    holder  String,
    balance SimpleAggregateFunction(sum, Float64)
)
ENGINE = AggregatingMergeTree
ORDER BY (chain, token, holder);

CREATE MATERIALIZED VIEW mv_balances_out TO balances AS
SELECT chain, token, from_addr AS holder, -amount AS balance FROM transfers WHERE is_reverted = 0;
CREATE MATERIALIZED VIEW mv_balances_in TO balances AS
SELECT chain, token, to_addr AS holder, amount AS balance FROM transfers WHERE is_reverted = 0;
-- Catatan: hanya transfer terkonfirmasi yang di-insert (lihat aturan di atas).
-- Saldo per holder = sum(balance); holder dengan saldo <= 0 diabaikan saat query.

CREATE TABLE holder_snapshots
(
    chain       LowCardinality(String),
    token       String,
    taken_at    DateTime('UTC'),
    holders     UInt64,
    top10_pct   Float32,
    top         Array(Tuple(address String, pct Float32, amount Float64))
)
ENGINE = ReplacingMergeTree(taken_at)
ORDER BY (chain, token)
TTL taken_at + INTERVAL 30 DAY;

-- ---------------------------------------------------------------------
-- WALLET PnL (average cost)
-- ---------------------------------------------------------------------
CREATE TABLE wallet_token_pnl
(
    chain          LowCardinality(String),
    wallet         String,
    token          String,
    bought_amount  SimpleAggregateFunction(sum, Float64),
    bought_usd     SimpleAggregateFunction(sum, Float64),
    sold_amount    SimpleAggregateFunction(sum, Float64),
    sold_usd       SimpleAggregateFunction(sum, Float64),
    trades         SimpleAggregateFunction(sum, UInt64),
    first_trade    SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_trade     SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
ORDER BY (chain, wallet, token);

CREATE MATERIALIZED VIEW mv_wallet_token_pnl TO wallet_token_pnl AS
SELECT chain, trader AS wallet, token,
       if(side = 'buy', amount_token, 0) AS bought_amount,
       if(side = 'buy', value_usd, 0)    AS bought_usd,
       if(side = 'sell', amount_token, 0) AS sold_amount,
       if(side = 'sell', value_usd, 0)    AS sold_usd,
       toUInt64(1) AS trades, block_time AS first_trade, block_time AS last_trade
FROM swaps WHERE is_reverted = 0;
-- avg_cost = bought_usd / bought_amount
-- realized = sold_usd - sold_amount * avg_cost
-- unrealized = (bought_amount - sold_amount) * (harga_sekarang - avg_cost)

-- ---------------------------------------------------------------------
-- TOKEN METRICS HISTORY (snapshot per menit, untuk Peak & backtest trending)
-- ---------------------------------------------------------------------
CREATE TABLE token_metrics_history
(
    chain        LowCardinality(String),
    token        String,
    ts           DateTime('UTC'),
    price_usd    Float64,
    market_cap   Float64,
    liquidity    Float64,
    volume_24h   Float64,
    txns_24h     UInt64,
    holders      UInt64,
    trending_24h Float32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (chain, token, ts)
TTL ts + INTERVAL 365 DAY;

-- ---------------------------------------------------------------------
-- PERPS SNAPSHOT
-- ---------------------------------------------------------------------
CREATE TABLE perps_positions
(
    taken_at    DateTime('UTC'),
    wallet      String,
    coin        LowCardinality(String),
    size_usd    Float64,                  -- positif long, negatif short
    entry_px    Float64,
    leverage    Float32,
    unrealized  Float64,
    equity      Float64
)
ENGINE = MergeTree
PARTITION BY toDate(taken_at)
ORDER BY (taken_at, wallet, coin)
TTL taken_at + INTERVAL 30 DAY;

-- ---------------------------------------------------------------------
-- API USAGE (metering Public Data API)
-- ---------------------------------------------------------------------
CREATE TABLE api_usage
(
    ts          DateTime64(3, 'UTC'),
    api_key_id  UUID,
    route       LowCardinality(String),
    status      UInt16,
    credits     UInt32,
    latency_ms  UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (api_key_id, ts)
TTL toDateTime(ts) + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW api_usage_daily
ENGINE = SummingMergeTree
ORDER BY (api_key_id, day, route)
AS SELECT api_key_id, toDate(ts) AS day, route, count() AS requests, sum(credits) AS credits
FROM api_usage GROUP BY api_key_id, day, route;
