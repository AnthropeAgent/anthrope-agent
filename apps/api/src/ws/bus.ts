/**
 * Bus = sumber pesan realtime untuk gateway. Produksi/dev: Redis pub/sub (worker mem-publish).
 * Tes memakai bus palsu di memori.
 */
import { redisSubscriber } from "@ot/db";

export interface Bus {
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  onMessage(handler: (channel: string, payload: string) => void): void;
  close(): Promise<void>;
}

export function redisBus(): Bus | null {
  const sub = redisSubscriber();
  if (!sub) return null;
  let connecting: Promise<void> | null = null;
  const ready = () => (connecting ??= sub.status === "wait" ? sub.connect() : Promise.resolve());
  return {
    async subscribe(ch) {
      await ready();
      await sub.subscribe(ch);
    },
    async unsubscribe(ch) {
      if (sub.status === "wait") return;
      await sub.unsubscribe(ch);
    },
    onMessage(handler) {
      sub.on("message", handler);
    },
    async close() {
      if (sub.status === "wait") sub.disconnect();
      else await sub.quit().catch(() => sub.disconnect());
    },
  };
}
