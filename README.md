# Personal Assistant — Vault & Lens

A personal hub application. The first milestone ships two modules: a secure
credential vault for API keys, passwords, and secure notes, and an
image-to-text (OCR) "Lens" tool for ad-hoc text extraction from images.

## Prerequisites

- Node.js `>=20.19.0 <21` (see `server/package.json`'s `engines` field)
- `npm install` at the repository root (this is an npm workspaces monorepo —
  `server` and `client` are installed together from the root)

## Running the dev stack

```
npm run dev
```

This starts three watched processes together: the TypeScript compiler
(`tsc --watch`), the compiled Express server (`node --watch`), and the Vite
client dev server — each with its output prefixed by name in the same
terminal.

The equivalent direct invocation, bypassing the npm wrapper layer entirely:

```
node scripts/dev.mjs
```

**Windows note:** `npm run dev` inserts npm's own wrapper processes (npm.cmd
and npm's internal script-runner) above `scripts/dev.mjs` in the process
tree. Those layers are outside the dev script's control and receive the
console's Ctrl-C independently of it. If Ctrl-C ever behaves oddly in a
particular terminal, reach for the direct invocation instead — it has no
such layer above it.

Stop the stack with **Ctrl-C**, or by typing **`q`** (or `stop`) and
pressing Enter. Once running, the stack serves:

- Client: http://127.0.0.1:5173
- Server: http://127.0.0.1:5174

## Verifying shutdown

```
npm run verify:dev-shutdown
```

Proves — without a human at the keyboard — that a shutdown request reaps
the entire dev process tree and releases both ports. It does a real cold
build of the server, so it takes a couple of minutes. It needs both ports
(5173, 5174) free before it starts.

## Other commands

```
npm run typecheck   # tsc --noEmit for both server and client
npm run lint         # eslint .
npm test             # server + client test suites
```
