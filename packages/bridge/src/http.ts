/**
 * HTTP ke provider pihak ketiga: timeout, rate limit per provider, retry saat 429/5xx.
 * Tidak ada data user/proyek yang dikirim; User-Agent generik.
 */

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

/** Limiter sederhana: jarak minimum antar panggilan, antre FIFO. */
export class RateLimiter {
  private next = 0;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.next - Date.now();
      if (wait > 0) await sleep(wait);
      this.next = Date.now() + this.minIntervalMs;
      return fn();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchJsonOptions {
  provider: string;
  limiter: RateLimiter;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export async function fetchJson<T>(url: string, o: FetchJsonOptions): Promise<T> {
  const retries = o.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      return await o.limiter.schedule(async () => {
        const res = await fetch(url, {
          headers: { accept: "application/json", "user-agent": "onchain-terminal-bridge/0.1", ...o.headers },
          signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
        });
        if (!res.ok) throw new ProviderError(o.provider, res.status, `HTTP ${res.status} ${new URL(url).pathname}`);
        return (await res.json()) as T;
      });
    } catch (e) {
      const status = e instanceof ProviderError ? e.status : 0;
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= retries) throw e;
      await sleep((status === 429 ? 15_000 : 2_000) * (attempt + 1));
    }
  }
}
