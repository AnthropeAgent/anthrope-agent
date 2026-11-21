import websocket from "@fastify/websocket";
import Fastify, { type FastifyError } from "fastify";
import { closeAll, postgres } from "@ot/db";
import type { ApiError } from "@ot/types";
import { checkHealth } from "./health";
import { store } from "@ot/bridge";
import { searchEngine, type SearchEngine } from "@ot/search";
import { pgAuthStore, type AuthStore } from "./auth/store";
import { config } from "./config";
import { accountRoutes } from "./routes/account";
import { alertRoutes, pgAlertStore, type AlertStore } from "./routes/alerts";
import { cmsRoutes, pgCmsStore, type CmsStore } from "./routes/cms";
import { pgSiteStore, siteRoutes, type SiteStore } from "./routes/site";
import { apiKeyGuard, apiKeyRoutes, pgApiKeyStore, type ApiKeyStore } from "./routes/apikeys";
import { marketRoutes, redisMarketStore, type MarketStore } from "./routes/markets";
import { swapRoutes } from "./routes/swap";
import { redisWalletStore, walletRoutes, type WalletStore } from "./routes/wallets";
import { pgSwapStore, type SwapStore } from "./swap/store";
import type { Fetch } from "@ot/swap";
import { searchRoutes } from "./routes/search";
import { pgScanReader, redisTokenStore, tokenRoutes, type ScanReader, type TokenStore } from "./routes/tokens";
import { redisBus, type Bus } from "./ws/bus";
import { WS_LIMITS, wsRoutes } from "./ws/gateway";

const VERSION = "0.1.0";

/** Buat instance Fastify (dipisah dari server.ts supaya bisa dites tanpa listen). */
export function buildApp(opts: { logger?: boolean | object; tokenStore?: TokenStore; bus?: Bus | null; searchEngine?: SearchEngine | null; authStore?: AuthStore; swapStore?: SwapStore; swapFetch?: Fetch; scanReader?: ScanReader | null; walletStore?: WalletStore; marketStore?: MarketStore; alertStore?: AlertStore; cmsStore?: CmsStore; siteStore?: SiteStore; apiKeyStore?: ApiKeyStore } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  const startedAt = Date.now();
  app.addHook("onClose", async () => {
    await closeAll();
  });

  const apiKeys = opts.apiKeyStore ?? pgApiKeyStore;
  app.register(
    async (v1) => {
      v1.addHook("onRequest", apiKeyGuard(apiKeys));
      v1.get("/health", async (_req, reply) => {
        const h = await checkHealth(VERSION, startedAt);
        // 200 walau degraded: API tetap melayani; status DB ada di body.
        return reply.send(h);
      });
      await v1.register(tokenRoutes, { store: opts.tokenStore ?? redisTokenStore, scans: opts.scanReader === undefined ? (postgres() ? pgScanReader : null) : opts.scanReader });
      await v1.register(searchRoutes, {
        store: opts.tokenStore ?? redisTokenStore,
        engine: opts.searchEngine === undefined ? searchEngine() : opts.searchEngine,
      });
      await v1.register(accountRoutes, {
        auth: opts.authStore ?? pgAuthStore,
        tokens: opts.tokenStore ?? redisTokenStore,
        origins: config.APP_ORIGIN,
        appName: config.APP_NAME,
      });
      await v1.register(swapRoutes, {
        store: opts.swapStore ?? pgSwapStore,
        auth: opts.authStore ?? pgAuthStore,
        origins: config.APP_ORIGIN,
        fetch: opts.swapFetch ?? fetch,
        enabled: config.SWAP_ENABLED,
      });
      await v1.register(walletRoutes, { store: opts.walletStore ?? redisWalletStore });
      await v1.register(alertRoutes, { alerts: opts.alertStore ?? pgAlertStore, auth: opts.authStore ?? pgAuthStore, tokens: opts.tokenStore ?? redisTokenStore, origins: config.APP_ORIGIN });
      await v1.register(apiKeyRoutes, { keys: apiKeys, auth: opts.authStore ?? pgAuthStore, origins: config.APP_ORIGIN, stripeConfigured: !!config.STRIPE_SECRET_KEY });
      await v1.register(cmsRoutes, { cms: opts.cmsStore ?? pgCmsStore, auth: opts.authStore ?? pgAuthStore, origins: config.APP_ORIGIN, adminWallets: config.ADMIN_WALLETS });
      await v1.register(siteRoutes, { site: opts.siteStore ?? pgSiteStore, auth: opts.authStore ?? pgAuthStore, origins: config.APP_ORIGIN, adminWallets: config.ADMIN_WALLETS });
      await v1.register(marketRoutes, { store: opts.marketStore ?? redisMarketStore });
    },
    { prefix: "/api/v1" },
  );

  // WebSocket di /ws (di luar /api/v1; Caddy dan rewrite Next meneruskannya ke sini)
  app.register(websocket, { options: { maxPayload: WS_LIMITS.maxPayloadBytes } });
  app.register(wsRoutes, {
    bus: opts.bus === undefined ? redisBus() : opts.bus,
    touchView: opts.tokenStore?.touchView ?? store.touchView,
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ApiError = { error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} tidak ada` } };
    reply.code(404).send(body);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error(err);
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    const body: ApiError = {
      error: { code: err.code ?? "INTERNAL", message: status >= 500 ? "Internal server error" : err.message },
    };
    reply.code(status).send(body);
  });

  return app;
}
