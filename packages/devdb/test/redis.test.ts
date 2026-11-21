import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Redis } from "ioredis";
import { startRedis } from "../src/redis";

test("pub/sub: subscriber menerima pesan, berhenti setelah unsubscribe", async () => {
  const server = await startRedis("127.0.0.1", 0);
  const port = (server.address() as AddressInfo).port;
  const pub = new Redis({ port, lazyConnect: true });
  const sub = new Redis({ port, lazyConnect: true });
  await Promise.all([pub.connect(), sub.connect()]);
  try {
    assert.equal(await sub.subscribe("a", "b"), 2);
    const got = new Promise<[string, string]>((res) => sub.once("message", (ch: string, msg: string) => res([ch, msg])));
    assert.equal(await pub.publish("b", "halo"), 1);
    assert.deepEqual(await got, ["b", "halo"]);
    assert.equal(await pub.publish("tidak-ada", "x"), 0);
    await sub.unsubscribe("a", "b");
    assert.equal(await pub.publish("b", "x"), 0);
    await pub.set("k", "v");
    assert.equal(await pub.get("k"), "v");
  } finally {
    pub.disconnect();
    sub.disconnect();
    await new Promise((r) => server.close(r));
  }
});
