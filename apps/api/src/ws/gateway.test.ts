import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebSocket } from "ws";
import { buildApp } from "../app";
import type { Bus } from "./bus";
import { parseChannel } from "./gateway";

const SOL = "So11111111111111111111111111111111111111112";
const WETH = "0x4200000000000000000000000000000000000006";

function fakeBus() {
  const subscribed = new Set<string>();
  let handler: (ch: string, p: string) => void = () => undefined;
  const bus: Bus = {
    async subscribe(ch) { subscribed.add(ch); },
    async unsubscribe(ch) { subscribed.delete(ch); },
    onMessage(h) { handler = h; },
    async close() {},
  };
  return { bus, subscribed, emit: (ch: string, data: unknown) => handler(ch, JSON.stringify(data)) };
}

/** injectWS tidak mengisi socket; trustProxy butuh remoteAddress untuk req.ip. */
const connect = (app: ReturnType<typeof buildApp>) => app.injectWS("/ws", { socket: { remoteAddress: "127.0.0.1" } } as never);

/** Kumpulkan pesan masuk; next() menunggu pesan berikutnya. */
function inbox(ws: WebSocket) {
  const queue: unknown[] = [];
  const waiters: ((m: unknown) => void)[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  return {
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise<unknown>((r) => waiters.push(r))),
    send: (o: object) => ws.send(JSON.stringify(o)),
  };
}

test("parseChannel: validasi chain/alamat/interval dan normalisasi EVM", () => {
  assert.equal(parseChannel(`price:solana:${SOL}`), `price:solana:${SOL}`);
  assert.equal(parseChannel(`trades:base:${WETH.toUpperCase().replace("0X", "0x")}`), `trades:base:${WETH}`);
  assert.equal(parseChannel(`candles:base:${WETH}:15m`), `candles:base:${WETH}:15m`);
  assert.equal(parseChannel(`candles:base:${WETH}:1s`), null);
  assert.equal(parseChannel(`price:robinhood:${WETH}`), null);
  assert.equal(parseChannel(`price:solana:0xabc`), null);
  assert.equal(parseChannel(`wallet:${SOL}`), null);
});

test("/ws: subscribe, terima pesan dengan seq, view disentuh, unsubscribe", async () => {
  const { bus, subscribed, emit } = fakeBus();
  const touched: string[] = [];
  // touchView diambil dari tokenStore → pakai store palsu supaya tidak menyentuh Redis
  const app2 = buildApp({
    bus,
    tokenStore: {
      getToken: async () => null, getTokens: async () => [], getList: async () => [], requestToken: async () => {},
      getCandles: async () => null, getTradeSeries: async () => null,
      touchView: async (kind, c, a) => void touched.push(`${kind}:${c}:${a}`),
    },
  });
  await app2.ready();
  const ws = await connect(app2);
  const box = inbox(ws);

  box.send({ op: "ping" });
  assert.deepEqual(await box.next(), { op: "pong" });

  box.send({ op: "subscribe", channels: [`price:solana:${SOL}`, `candles:solana:${SOL}:1h`, "nope:x"] });
  assert.deepEqual(await box.next(), { op: "subscribed", channels: [`price:solana:${SOL}`, `candles:solana:${SOL}:1h`] });
  assert.equal(((await box.next()) as { code: string }).code, "INVALID_CHANNEL");
  assert.deepEqual([...subscribed], [`price:solana:${SOL}`, `candles:solana:${SOL}:1h`]);
  assert.deepEqual(touched, [`ohlcv-1h:solana:${SOL}`]); // price tidak butuh view

  emit(`price:solana:${SOL}`, { price: 1 });
  emit(`price:solana:${SOL}`, { price: 2 });
  emit(`trades:solana:${SOL}`, []); // tidak di-subscribe → tidak dikirim
  assert.deepEqual(await box.next(), { ch: `price:solana:${SOL}`, seq: 1, data: { price: 1 } });
  assert.deepEqual(await box.next(), { ch: `price:solana:${SOL}`, seq: 2, data: { price: 2 } });

  box.send({ op: "unsubscribe", channels: [`price:solana:${SOL}`] });
  assert.deepEqual(await box.next(), { op: "unsubscribed", channels: [`price:solana:${SOL}`] });
  assert.ok(!subscribed.has(`price:solana:${SOL}`));

  box.send({ op: "bogus" });
  assert.equal(((await box.next()) as { code: string }).code, "BAD_MESSAGE");

  ws.terminate();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(subscribed.size, 0, "koneksi tutup → channel dilepas dari bus");
  await app2.close();
});

test("/ws: batas channel per koneksi", async () => {
  const { bus } = fakeBus();
  const app = buildApp({ bus });
  await app.ready();
  const ws = await connect(app);
  const box = inbox(ws);
  // 101 alamat EVM berbeda yang valid
  const chs = Array.from({ length: 101 }, (_, i) => `price:base:0x${i.toString(16).padStart(40, "0")}`);
  box.send({ op: "subscribe", channels: chs });
  assert.equal(((await box.next()) as { code: string }).code, "CHANNEL_LIMIT");
  assert.equal(((await box.next()) as { channels: string[] }).channels.length, 100);
  ws.terminate();
  await app.close();
});
