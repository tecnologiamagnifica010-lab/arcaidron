---
name: Arcaidron stack decisions
description: Key non-obvious fixes for Arcaidron's React+Vite+Socket.io setup in this project
---

## Dark theme
Must add `class="dark"` to `<html>` in `index.html` — the app uses `.dark` CSS variant, so without it the page is a blank dark background with no visible content.

**Why:** The CSS has `:root` with light vars and `.dark` overrides for the futuristic dark theme, but nothing sets the class automatically.

**How to apply:** Already done in `artifacts/arcaidron/index.html`.

## Wouter wildcard routes
`{*splat}` syntax doesn't work in wouter v3 — use `/:rest*` instead.

**Why:** Wouter 3.x uses `:name*` for rest/splat segments, not `{*name}`.

## Socket.io proxy in Vite
Vite dev server proxies `/socket.io` and `/api` to `localhost:3000` (Node backend). `window.location.origin` correctly resolves through the proxy when served from port 18207.

**Why:** The React frontend runs on port 18207 but the Node backend is on port 3000 — Vite proxy bridges them in dev.

## pnpm workspace setup
The project needs a `pnpm-workspace.yaml` at root to use `catalog:` entries in `artifacts/arcaidron/package.json`. Was missing and had to be created.

## sqlite3 rebuild
After `pnpm install --no-frozen-lockfile`, sqlite3 native bindings need `npm rebuild sqlite3` to compile. pnpm alone doesn't run the build scripts by default.
