import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { KDF_PARAMS } from "../src/config.js";

/**
 * Calibrates the Argon2id cost parameters against real hardware (research
 * assumption A6). Runs `argon2.hash` with `config.KDF_PARAMS` and
 * `raw: true` five times against a throwaway password and a random salt,
 * and prints the median wall-clock milliseconds alongside the parameter
 * set used.
 *
 * Never prints the password, the salt, or the derived buffer — only
 * timings and the (non-secret) parameter set.
 */

const RUNS = 5;
const THROWAWAY_PASSWORD = "bench-kdf-throwaway-password";

async function runOnce(): Promise<number> {
  const salt = randomBytes(16);
  const start = process.hrtime.bigint();
  await argon2.hash(THROWAWAY_PASSWORD, {
    ...KDF_PARAMS,
    salt,
    raw: true,
  });
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000; // ns -> ms
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function main(): Promise<void> {
  const durations: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    durations.push(await runOnce());
  }

  const med = median(durations);

  console.log(`Argon2id parameters: ${JSON.stringify(KDF_PARAMS)}`);
  console.log(`Runs (ms): ${durations.map((d) => d.toFixed(2)).join(", ")}`);
  console.log(`Median: ${med.toFixed(2)} ms`);
}

main().catch((err: unknown) => {
  console.error("bench-kdf failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
