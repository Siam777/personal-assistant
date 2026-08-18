// Type declarations for dev-spec.mjs, consumed only by server/src/dev-script.test.ts
// via TypeScript's companion-declaration-file resolution (no `allowJs` needed,
// which would otherwise pull scripts/dev.mjs and scripts/verify-dev-shutdown.mjs
// into server/tsconfig.json's rootDir-constrained compilation).

export interface DevSpecOptions {
  cwd: string;
  stdio?: [string, string, string];
  shell: boolean;
  detached?: boolean;
}

export interface DevSpec {
  name: string;
  cmd: string;
  args: string[];
  options: DevSpecOptions;
}

export interface BuildSpec {
  cmd: string;
  args: string[];
  options: DevSpecOptions;
}

export function resolvePackageBin(packageName: string, binName: string, fromUrl: string): string;

export const DEV_PORTS: {
  server: number;
  client: number;
};

export function buildInitialBuildSpec(opts: { rootDir: string; fromUrl: string }): BuildSpec;

export function buildDevSpecs(opts: {
  platform: string;
  rootDir: string;
  fromUrl: string;
}): DevSpec[];
