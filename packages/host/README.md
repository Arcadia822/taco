# Taco Host Web Application (`packages/host`)

The Host application (`taco-server`) provides the public web landing page and review coordination backend for Taco.

## Architectural Boundaries & Offline Builds

- **Build without Google Fonts**: After dependency installation, Next.js compilation (`npm run --prefix packages/host build`) uses local font assets. A production build passed with outbound network access denied by `sandbox-exec`.
- **Self-Contained Local Fonts**: Font assets are bundled locally in `src/app/fonts/` using `next/font/local`:
  - `Geist-Variable.woff2` (OFL-1.1, Vercel Geist v1.7.2, covers weights 400–700, variable axis 100–900).
  - `FiraCode-Variable.woff2` (OFL-1.1, Nikita Prokopov Fira Code v6.2, covers weights 400–700, variable axis 300–700).
  - Both fonts retain CSS variables (`--font-geist` and `--font-fira-code`); Next.js derives fallback metrics from their font tables to reduce layout shifts.
- **CI font loading**: Preview containers compile the bundled fonts without invoking the Google font loader. Dependency installation still requires registry access.

## Development & Build

```bash
# Development server
npm run dev

# Offline production build
npm run build
```
