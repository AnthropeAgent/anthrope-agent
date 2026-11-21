-- Langkah 6: detail order swap untuk riwayat & tracker status.
ALTER TABLE swap_orders
  ADD COLUMN side            text CHECK (side IN ('buy', 'sell')),
  ADD COLUMN expected_out    numeric(78, 0),
  ADD COLUMN input_decimals  smallint,
  ADD COLUMN output_decimals smallint,
  ADD COLUMN error           text;
CREATE INDEX swap_orders_user ON swap_orders (user_id, created_at DESC);
CREATE INDEX swap_orders_pending ON swap_orders (status, updated_at) WHERE status = 'submitted';
CREATE UNIQUE INDEX swap_orders_tx ON swap_orders (chain_id, tx_signature) WHERE tx_signature IS NOT NULL;
