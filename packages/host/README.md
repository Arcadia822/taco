# Taco Host Web Application (`packages/host`)

The Host application (`taco-server`) provides the public web landing page and review coordination backend for Taco.

## Architectural Boundaries & Offline Builds

- **100% Offline Build**: Next.js compilation (`next build` / `npm run --prefix packages/host build`) does not depend on Google Fonts or any external CDN at build time.
- **Self-Contained Local Fonts**: Font assets are bundled locally in `src/app/fonts/` using `next/font/local`:
  - `Geist-Variable.woff2` (OFL-1.1, Vercel Geist v1.7.2, covers weights 400–700, variable axis 100–900).
  - `FiraCode-Variable.woff2` (OFL-1.1, Nikita Prokopov Fira Code v6.2, covers weights 400–700, variable axis 300–700).
  - Both fonts inject standard CSS variables (`--font-geist` and `--font-fira-code`) and provide deterministic font metric overrides for zero cumulative layout shift (CLS).
- **CI Container Reproducibility**: Because font loading is completely local, containerized builds (such as GitHub Actions `pull_request_target` preview containers running with restricted network or no network) build deterministically without triggering upstream loader failures (`TypeError: Cannot read properties of null (reading '1')` in Next.js Google font loader).

## Development & Build

```bash
# Development server
npm run dev

# Offline production build
npm run build
```
