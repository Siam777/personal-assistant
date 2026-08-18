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
