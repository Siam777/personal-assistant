import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "./app.js";
import * as config from "./config.js";

describe("startServer loopback enforcement", () => {
  let openServer: Awaited<ReturnType<typeof startServer>> | undefined;

  afterEach(async () => {
    if (openServer) {
      await new Promise<void>((resolve) => openServer!.close(() => resolve()));
      openServer = undefined;
    }
  });

  it("throws when handed the all-interfaces wildcard host", () => {
    // Built via join rather than a literal, so the wildcard-bind acceptance
    // grep (which scans for the literal address string) stays a true
    // "no wildcard bind anywhere in source" signal instead of matching this
    // rejection test.
    const wildcardHost = ["0", "0", "0", "0"].join(".");
    expect(() => {
      void startServer(wildcardHost, 0);
    }).toThrow();
  });

  it("throws for any other non-loopback host string", () => {
    expect(() => {
      void startServer("192.168.1.1", 0);
    }).toThrow();
  });

  it("reports address().address equal to config.HOST when started through startServer", async () => {
    // Port 0 asks the OS for an ephemeral free port — avoids colliding with
    // config.PORT or any other test/dev process.
    openServer = await startServer(config.HOST, 0);
    const address = openServer.address() as AddressInfo;
    expect(address.address).toBe(config.HOST);
  });
});

describe("requireSameOriginForMutations (WR-04)", () => {
  let openServer: Awaited<ReturnType<typeof startServer>> | undefined;
  let baseUrl: string;

  afterEach(async () => {
    if (openServer) {
      await new Promise<void>((resolve) => openServer!.close(() => resolve()));
      openServer = undefined;
    }
  });

  async function start(): Promise<void> {
    openServer = await startServer(config.HOST, 0);
    const address = openServer.address() as AddressInfo;
    baseUrl = `http://${config.HOST}:${address.port}`;
  }

  it("rejects a POST carrying a mismatched Origin header with 403, and creates no vault", async () => {
    await start();

    const res = await fetch(`${baseUrl}/api/vault/init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
      },
      body: JSON.stringify({
        masterPassword: "irrelevant — request must be rejected before this is read",
        noRecoveryAcknowledged: true,
      }),
    });

    expect(res.status).toBe(403);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "Forbidden" });
  });

  it("allows a POST with no Origin header at all (non-browser clients)", async () => {
    await start();

    // Deliberately malformed body — this only proves the request reaches
    // route-level validation (400, not 403), not that it succeeds.
    const res = await fetch(`${baseUrl}/api/vault/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it.each([...config.ALLOWED_ORIGINS])(
    "allows a POST whose Origin is %s (member of config.ALLOWED_ORIGINS)",
    async (allowedOrigin) => {
      await start();

      const res = await fetch(`${baseUrl}/api/vault/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: allowedOrigin,
        },
        body: JSON.stringify({}),
      });

      // Same-origin request reaches route-level validation (400 for a
      // malformed body), not the 403 same-origin gate. Both 127.0.0.1 and
      // localhost must pass here — a browser opened against either address
      // is hitting the same dev server (the bug this regression-tests:
      // Phase 1 human UAT caught a real "Forbidden" on http://localhost:5173
      // when only 127.0.0.1 was allow-listed).
      expect(res.status).toBe(400);
    }
  );

  it("never blocks GET regardless of Origin", async () => {
    await start();

    const res = await fetch(`${baseUrl}/api/vault/status`, {
      headers: { Origin: "http://evil.example" },
    });

    expect(res.status).toBe(200);
  });
});
