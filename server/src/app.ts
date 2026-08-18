import express, { type Express } from "express";
import type { Server } from "node:net";
import { pathToFileURL } from "node:url";
import * as config from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { logError, logInfo } from "./log.js";
import type { VaultStatus } from "./types.js";

/**
 * Configured Express app: a small-size-limited JSON body parser, routes
 * mounted under `/api`, and `errorHandler` registered last. No route here
 * ever writes to standard output directly — anything worth reporting goes
 * through `log.ts`.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: "100kb" }));

  // Placeholder route — Plan 01-02 replaces this with the real
  // implementation in modules/auth/routes.ts.
  app.get("/api/vault/status", (_req, res) => {
    const status: VaultStatus = {
      initialized: false,
      unlocked: false,
      totpEnabled: false,
      idleTimeoutMs: config.IDLE_TIMEOUT_MS,
    };
    res.json(status);
  });

  app.use(errorHandler);

  return app;
}

/**
 * Starts the given Express app listening on `host:port`. Asserts `host` is
 * exactly `config.HOST` and throws before calling `listen` if it is
 * anything else — binding to the all-interfaces wildcard (or any host other
 * than loopback) must be structurally impossible, not merely avoided
 * (D-02, PITFALLS.md Pitfall 5).
 */
export function startServer(host: string, port: number): Promise<Server> {
  if (host !== config.HOST) {
    throw new Error(
      `Refusing to start: host "${host}" is not the loopback address "${config.HOST}"`
    );
  }

  const app = createApp();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

// Entrypoint: only starts listening when this module is run directly
// (`node server/dist/src/app.js`), never when imported by tests.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  startServer(config.HOST, config.PORT)
    .then(() => {
      logInfo("server listening", { host: config.HOST, port: config.PORT });
    })
    .catch((err: unknown) => {
      logError("server failed to start", {
        message: err instanceof Error ? err.message : String(err),
      });
      process.exitCode = 1;
    });
}
