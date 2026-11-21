/**
 * Gateway WebSocket `/ws` (docs/api/websocket.md, ARCHITECTURE §4.10).
 *
 * Worker mem-publish ke Redis pub/sub dengan nama channel yang sama dengan channel WS; gateway
 * hanya subscribe ke channel yang sedang diikuti klien (ref-count) dan meneruskan pesannya.
 * Untuk channel trades/candles, gateway juga memperpanjang "view" supaya worker terus
 * me-refresh data token itu selama ada yang menonton.
 *
 * Langkah 3: channel price, trades, candles. Dipasang di proses api; bisa dipindah ke proses
 * sendiri tanpa mengubah kontrak karena state-nya hanya daftar subscription per koneksi.
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { geckoterminal, isBridgeChain, isValidAddress, normAddress, type ViewKind } from "@ot/bridge";
import type { Bus } from "./bus";

export const WS_LIMITS = {
  /** Halaman Discover menampilkan hingga 50 token + header/ticker; 100 memberi ruang. */
  channelsPerConn: 100,
  /** Koneksi per IP (alamat loopback dikecualikan: di dev semua lewat proxy lokal). */
  connsPerIp: 5,
  /** Koneksi ditutup bila klien diam selama ini (klien mengirim ping tiap ±25 dtk). */
  idleMs: 60_000,
  maxPayloadBytes: 16 * 1024,
};
const VIEW_TOUCH_MS = 30_000;

type TouchView = (kind: ViewKind, chain: string, address: string) => Promise<void>;

/** Validasi + normalisasi nama channel (alamat EVM jadi huruf kecil). null = tidak didukung. */
export function parseChannel(ch: string): string | null {
  const parts = ch.split(":");
  const [kind, chain, address, iv] = parts;
  if (!chain || !isBridgeChain(chain) || !address || !isValidAddress(chain, address)) return null;
  const addr = normAddress(chain, address);
  if ((kind === "price" || kind === "trades") && parts.length === 3) return `${kind}:${chain}:${addr}`;
  if (kind === "candles" && parts.length === 4 && geckoterminal.isGtInterval(iv)) return `candles:${chain}:${addr}:${iv}`;
  return null;
}

/** Channel yang datanya hanya diambil worker selama ada penonton → kind view-nya. */
function viewOf(ch: string): [ViewKind, string, string] | null {
  const [kind, chain, address, iv] = ch.split(":");
  if (kind === "trades") return ["trades", chain, address];
  if (kind === "candles") return [`ohlcv-${iv}`, chain, address];
  return null;
}

const Channels = z.array(z.string().max(200)).max(200);
const ClientMsg = z.discriminatedUnion("op", [
  z.object({ op: z.literal("subscribe"), channels: Channels }),
  z.object({ op: z.literal("unsubscribe"), channels: Channels }),
  z.object({ op: z.literal("ping") }),
]);

/** Ref-count subscription channel → koneksi, dan nomor urut (seq) per channel. */
export class Hub {
  private subs = new Map<string, Set<WebSocket>>();
  private seq = new Map<string, number>();
  private timer: NodeJS.Timeout;

  constructor(
    private readonly bus: Bus,
    private readonly touchView: TouchView,
    private readonly log: (msg: string) => void,
  ) {
    bus.onMessage((ch, payload) => this.deliver(ch, payload));
    this.timer = setInterval(() => void this.touchAll(), VIEW_TOUCH_MS);
    this.timer.unref();
  }

  get channelCount() {
    return this.subs.size;
  }

  async add(ws: WebSocket, ch: string) {
    let set = this.subs.get(ch);
    if (set) return void set.add(ws);
    set = new Set([ws]); // dicatat sebelum await: subscribe bersamaan ke channel yang sama tidak dobel
    this.subs.set(ch, set);
    await this.bus.subscribe(ch);
    await this.touch(ch);
  }

  async remove(ws: WebSocket, ch: string) {
    const set = this.subs.get(ch);
    if (!set?.delete(ws) || set.size > 0) return;
    this.subs.delete(ch);
    this.seq.delete(ch);
    await this.bus.unsubscribe(ch);
  }

  private deliver(ch: string, payload: string) {
    const set = this.subs.get(ch);
    if (!set?.size) return;
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    const seq = (this.seq.get(ch) ?? 0) + 1;
    this.seq.set(ch, seq);
    const frame = JSON.stringify({ ch, seq, data });
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(frame);
  }

  private async touch(ch: string) {
    const v = viewOf(ch);
    if (!v) return;
    try {
      await this.touchView(...v);
    } catch (e) {
      this.log(`touchView ${ch}: ${(e as Error).message}`);
    }
  }

  private async touchAll() {
    await Promise.all([...this.subs.keys()].map((ch) => this.touch(ch)));
  }

  async close() {
    clearInterval(this.timer);
    await this.bus.close();
  }
}

const isLoopback = (ip: string) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

/** Butuh plugin @fastify/websocket terdaftar di root (lihat app.ts). */
export async function wsRoutes(app: FastifyInstance, opts: { bus: Bus | null; touchView: TouchView }) {
  const hub = opts.bus ? new Hub(opts.bus, opts.touchView, (m) => app.log.warn(m)) : null;
  app.addHook("onClose", async () => {
    await hub?.close();
  });
  const perIp = new Map<string, number>();

  app.get("/ws", { websocket: true }, (socket, req) => {
    const send = (o: object) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(o));
    const ip = req.ip;
    if (!isLoopback(ip) && (perIp.get(ip) ?? 0) >= WS_LIMITS.connsPerIp) {
      send({ op: "error", code: "CONNECTION_LIMIT", message: `maks ${WS_LIMITS.connsPerIp} koneksi per IP` });
      socket.close(1008, "connection limit");
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);

    const mine = new Set<string>();
    let idle = setTimeout(() => socket.close(1000, "idle"), WS_LIMITS.idleMs);

    socket.on("message", async (raw) => {
      clearTimeout(idle);
      idle = setTimeout(() => socket.close(1000, "idle"), WS_LIMITS.idleMs);

      let msg: z.infer<typeof ClientMsg>;
      try {
        msg = ClientMsg.parse(JSON.parse(String(raw)));
      } catch {
        return send({ op: "error", code: "BAD_MESSAGE", message: "format pesan tidak dikenal" });
      }
      if (msg.op === "ping") return send({ op: "pong" });
      if (!hub) return send({ op: "error", code: "UNAVAILABLE", message: "stream realtime tidak tersedia (Redis belum dikonfigurasi)" });

      try {
        if (msg.op === "subscribe") {
          const ok: string[] = [];
          const bad: string[] = [];
          for (const raw of msg.channels) {
            const ch = parseChannel(raw);
            if (!ch) {
              bad.push(raw);
              continue;
            }
            if (!mine.has(ch)) {
              if (mine.size >= WS_LIMITS.channelsPerConn) {
                send({ op: "error", code: "CHANNEL_LIMIT", message: `maks ${WS_LIMITS.channelsPerConn} channel` });
                break;
              }
              mine.add(ch);
              await hub.add(socket, ch);
            }
            ok.push(ch);
          }
          send({ op: "subscribed", channels: ok });
          if (bad.length) send({ op: "error", code: "INVALID_CHANNEL", message: `channel tidak didukung: ${bad.slice(0, 5).join(", ")}` });
        } else {
          const gone: string[] = [];
          for (const raw of msg.channels) {
            const ch = parseChannel(raw);
            if (!ch || !mine.delete(ch)) continue;
            await hub.remove(socket, ch);
            gone.push(ch);
          }
          send({ op: "unsubscribed", channels: gone });
        }
      } catch (e) {
        app.log.warn(`ws: ${(e as Error).message}`);
        send({ op: "error", code: "UNAVAILABLE", message: "stream realtime sementara tidak tersedia" });
      }
    });

    socket.on("close", () => {
      clearTimeout(idle);
      for (const ch of mine) void hub?.remove(socket, ch).catch(() => undefined);
      mine.clear();
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
    });
  });
}
