# Host Font Assets & Provenance

This directory stores offline font assets and licensing documentation for the Taco Host application (`packages/host`).

## Architecture & Boundaries

The Host web application uses `next/font/local` to serve self-contained WOFF2 font assets directly from this directory. This design ensures:

- **Zero build-time network requests**: Eliminates external HTTP fetches to Google Fonts APIs (`fonts.googleapis.com` / `fonts.gstatic.com`) during `next build`.
- **Immunity to CDN/loader defects**: Bypasses the Next.js Google font loader regular expression failure (`/\\.(woff|woff2|eot|ttf|otf)$/.exec(...)` throwing `TypeError` when dynamic subset URLs lack file extensions).
- **Offline & air-gapped reproducibility**: Containerized CI environments and offline developer builds succeed deterministically without network access.
- **Full glyph and subset coverage**: Uses official variable font releases providing full character set coverage (Latin, Latin Extended, Cyrillic, Greek, Vietnamese, programming symbols and ligatures) matching or exceeding original Google Fonts subsets.

---

## Font Catalog

### 1. Geist Sans (Variable)

- **File**: `Geist-Variable.woff2`
- **Family**: Geist
- **Format**: WOFF2 (Variable Font)
- **Weight Axis (`wght`)**: 100–900 (covers configured weights 400, 500, 600, 700)
- **CSS Variable**: `--font-geist`
- **File Size**: 69,652 bytes
- **SHA-256**: `a369fcf5628ea2aa4e1b9e2ec6a5b3624e365bda588e1f0f2f12b564f728fbb8`
- **Upstream Source**: Vercel Geist Font Release `v1.7.2`
  - Upstream URL: `https://github.com/vercel/geist-font/releases/download/v1.7.2/geist-font-v1.7.2.zip`
  - Extracted Path: `geist-font/Geist/webfonts/Geist[wght].woff2`
- **License**: SIL Open Font License, Version 1.1 (OFL-1.1)
  - Copyright (c) 2024 The Geist Project Authors (`https://github.com/vercel/geist-font`)
  - License file: [`OFL-Geist.txt`](./OFL-Geist.txt)

### 2. Fira Code (Variable)

- **File**: `FiraCode-Variable.woff2`
- **Family**: Fira Code
- **Format**: WOFF2 (Variable Font)
- **Weight Axis (`wght`)**: 300–700 (covers configured weights 400, 500, 600, 700)
- **CSS Variable**: `--font-fira-code`
- **File Size**: 113,088 bytes
- **SHA-256**: `408e876a202f15ea6ee307a70a65cf40ceb222c589a0b17e0a3a371db96dd49f`
- **Upstream Source**: Tonsky FiraCode Release `6.2`
  - Upstream URL: `https://github.com/tonsky/FiraCode/releases/download/6.2/Fira_Code_v6.2.zip`
  - Extracted Path: `woff2/FiraCode-VF.woff2`
- **License**: SIL Open Font License, Version 1.1 (OFL-1.1)
  - Copyright (c) 2014-2021 The Fira Code Project Authors (`https://github.com/tonsky/FiraCode`)
  - License file: [`OFL-FiraCode.txt`](./OFL-FiraCode.txt)

---

## Fallback Metrics

`next/font/local` automatically inspects font tables via `fontkit` and computes `@font-face` fallback metrics to prevent layout shifts (CLS) when fallback fonts (Arial) load:

- **Geist**: `ascentOverride: 94.56%`, `descentOverride: 27.76%`, `lineGapOverride: 0.00%`, `sizeAdjust: 106.28%`, fallback: `Arial`
- **Fira Code**: `ascentOverride: 68.45%`, `descentOverride: 22.82%`, `lineGapOverride: 0.00%`, `sizeAdjust: 134.86%`, fallback: `Arial`
