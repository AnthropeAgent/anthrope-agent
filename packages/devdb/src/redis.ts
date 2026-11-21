/**
 * Server Redis-compatible (RESP2) minimal di memori, hanya untuk dev lokal tanpa Docker.
 * Mendukung perintah string/key dasar yang dipakai app (cache, dedup key, rate limit)
 * dan pub/sub sederhana (SUBSCRIBE/UNSUBSCRIBE/PUBLISH, tanpa pola) untuk gateway WebSocket.
 * Data hilang saat proses berhenti. Perintah lain dibalas error "unsupported".
 */
import { createServer, type Server, type Socket } from "node:net";

type Entry = { value: string; expiresAt: number | null };
const store = new Map<string, Entry>();

function get(key: string): Entry | undefined {
  const e = store.get(key);
  if (e && e.expiresAt !== null && e.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return e;
}

// ---- encoder RESP2 ----
const ok = "+OK\r\n";
const nil = "$-1\r\n";
const int = (n: number) => `:${n}\r\n`;
const err = (m: string) => `-ERR ${m}\r\n`;
const bulk = (s: string | null | undefined) => (s == null ? nil : `$${Buffer.byteLength(s)}\r\n${s}\r\n`);
const arr = (items: (string | null)[]) => `*${items.length}\r\n${items.map(bulk).join("")}`;

// ---- parser RESP2 (array of bulk strings + inline) ----
function parse(buf: Buffer): { args: string[]; rest: Buffer } | null {
  if (buf.length === 0) return null;
  const lineEnd = (from: number) => buf.indexOf("\r\n", from);
  if (buf[0] !== 0x2a /* '*' */) {
    const e = lineEnd(0);
    if (e < 0) return null;
    const args = buf.subarray(0, e).toString().trim().split(/\s+/).filter(Boolean);
    return { args, rest: buf.subarray(e + 2) };
  }
  let e = lineEnd(0);
  if (e < 0) return null;
  const n = Number(buf.subarray(1, e).toString());
  let pos = e + 2;
  const args: string[] = [];
  for (let i = 0; i < n; i++) {
    e = lineEnd(pos);
    if (e < 0) return null;
    const len = Number(buf.subarray(pos + 1, e).toString());
    const start = e + 2;
    if (buf.length < start + len + 2) return null;
    args.push(buf.subarray(start, start + len).toString());
    pos = start + len + 2;
  }
  return { args, rest: buf.subarray(pos) };
}

// ---- pub/sub (tanpa pola) ----
const channels = new Map<string, Set<Socket>>(); // channel → subscriber
const subsOf = new Map<Socket, Set<string>>(); // subscriber → channel

const push = (kind: string, ch: string | null, tail: string) => `*3\r\n${bulk(kind)}${bulk(ch)}${tail}`;

function subscribe(socket: Socket, chs: string[]): string {
  const mine = subsOf.get(socket) ?? new Set<string>();
  subsOf.set(socket, mine);
  return chs
    .map((ch) => {
      mine.add(ch);
      let set = channels.get(ch);
      if (!set) channels.set(ch, (set = new Set()));
      set.add(socket);
      return push("subscribe", ch, int(mine.size));
    })
    .join("");
}

function unsubscribe(socket: Socket, chs: string[]): string {
  const mine = subsOf.get(socket) ?? new Set<string>();
  const list = chs.length ? chs : [...mine];
  if (!list.length) return push("unsubscribe", null, int(0));
  return list
    .map((ch) => {
      mine.delete(ch);
      const set = channels.get(ch);
      set?.delete(socket);
      if (set?.size === 0) channels.delete(ch);
      return push("unsubscribe", ch, int(mine.size));
    })
    .join("");
}

function publish(ch: string, msg: string): number {
  const set = channels.get(ch);
  if (!set) return 0;
  const frame = push("message", ch, bulk(msg));
  for (const s of set) s.write(frame);
  return set.size;
}

function globToRegex(glob: string) {
  const esc = glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`);
}

function setExpiry(key: string, ms: number): number {
  const e = get(key);
  if (!e) return 0;
  e.expiresAt = Date.now() + ms;
  return 1;
}

function incrBy(key: string, by: number): string {
  const e = get(key);
  const cur = e ? Number(e.value) : 0;
  if (!Number.isInteger(cur)) return err("value is not an integer or out of range");
  const next = cur + by;
  store.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
  return int(next);
}

function exec(args: string[], socket: Socket): string {
  const [rawCmd, ...a] = args;
  const cmd = (rawCmd ?? "").toUpperCase();
  const subscribed = (subsOf.get(socket)?.size ?? 0) > 0;
  if (subscribed && !["SUBSCRIBE", "UNSUBSCRIBE", "PING", "QUIT"].includes(cmd))
    return err(`Can't execute '${rawCmd}': only SUBSCRIBE / UNSUBSCRIBE / PING / QUIT are allowed in this context`);
  switch (cmd) {
    case "PING":
      if (subscribed) return `*2\r\n${bulk("pong")}${bulk(a[0] ?? "")}`;
      return a[0] ? bulk(a[0]) : "+PONG\r\n";
    case "SUBSCRIBE":
      return a.length ? subscribe(socket, a) : err("wrong number of arguments for 'subscribe'");
    case "UNSUBSCRIBE":
      return unsubscribe(socket, a);
    case "PUBLISH":
      return a.length === 2 ? int(publish(a[0], a[1])) : err("wrong number of arguments for 'publish'");
    case "ECHO":
      return bulk(a[0]);
    case "SELECT":
    case "CLIENT":
      return ok;
    case "INFO":
      return bulk("# Server\r\nredis_version:7.4.0-devdb\r\nredis_mode:standalone\r\n# Persistence\r\nloading:0\r\n");
    case "COMMAND":
      return "*0\r\n";
    case "DBSIZE":
      return int(store.size);
    case "FLUSHDB":
    case "FLUSHALL":
      store.clear();
      return ok;
    case "GET":
      return bulk(get(a[0])?.value);
    case "MGET":
      return arr(a.map((k) => get(k)?.value ?? null));
    case "SET": {
      const [key, value, ...opts] = a;
      if (key === undefined || value === undefined) return err("wrong number of arguments for 'set'");
      let expiresAt: number | null = null;
      let nx = false;
      let xx = false;
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i].toUpperCase();
        if (o === "EX") expiresAt = Date.now() + Number(opts[++i]) * 1000;
        else if (o === "PX") expiresAt = Date.now() + Number(opts[++i]);
        else if (o === "NX") nx = true;
        else if (o === "XX") xx = true;
        else return err(`unsupported SET option ${o}`);
      }
      const exists = get(key) !== undefined;
      if ((nx && exists) || (xx && !exists)) return nil;
      store.set(key, { value, expiresAt });
      return ok;
    }
    case "DEL":
      return int(a.filter((k) => get(k) !== undefined && store.delete(k)).length);
    case "EXISTS":
      return int(a.filter((k) => get(k) !== undefined).length);
    case "EXPIRE":
      return int(setExpiry(a[0], Number(a[1]) * 1000));
    case "PEXPIRE":
      return int(setExpiry(a[0], Number(a[1])));
    case "TTL":
    case "PTTL": {
      const e = get(a[0]);
      if (!e) return int(-2);
      if (e.expiresAt === null) return int(-1);
      const ms = e.expiresAt - Date.now();
      return int(cmd === "TTL" ? Math.ceil(ms / 1000) : ms);
    }
    case "INCR":
      return incrBy(a[0], 1);
    case "DECR":
      return incrBy(a[0], -1);
    case "INCRBY":
      return incrBy(a[0], Number(a[1]));
    case "KEYS": {
      const re = globToRegex(a[0] ?? "*");
      return arr([...store.keys()].filter((k) => get(k) && re.test(k)));
    }
    default:
      return err(`unsupported command '${rawCmd}' (devdb redis minimal)`);
  }
}

function handle(socket: Socket) {
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let out = "";
    for (let p = parse(buf); p; p = parse(buf)) {
      buf = p.rest;
      if (p.args.length === 0) continue;
      if (p.args[0].toUpperCase() === "QUIT") {
        socket.end(out + ok);
        return;
      }
      out += exec(p.args, socket);
    }
    if (out) socket.write(out);
  });
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    unsubscribe(socket, []);
    subsOf.delete(socket);
  });
}

export function startRedis(host: string, port: number): Promise<Server> {
  return new Promise((resolveP, reject) => {
    const server = createServer(handle);
    server.once("error", reject);
    server.listen(port, host, () => resolveP(server));
  });
}
