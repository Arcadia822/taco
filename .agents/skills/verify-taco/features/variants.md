---
title: 'Verify Taco variants, preferences and hostile content'
---

Exercise the Complete/Lite browser boundary, visible preferences and responsive controls with synthetic data and blocked external network.

## Sub-features

- Complete offline: rich editor and bundled rendering continue with no external network.
- Lite offline: blocked CDN leaves the supported source/editor fallback usable.
- Theme/language: controls change visible state and retained preference in the same browser context.
- Narrow viewport/panel: navigation and review controls remain usable through real clicks and keyboard paths.
- Hostile content: source HTML/Markdown stays within its documented render/sandbox boundary; untrusted outbound requests are never allowed.

## How to get to it (user POV)

Open a built Complete or Lite Taco, use header preferences and panel toggles, choose a Markdown/source/HTML file and exercise the controls at desktop or narrow viewport. File selection uses its actual full path; a preference label does not rename any canonical file.

## Driving it with Playwright

Run `npm run test:verify -- --feature variants`. Read `scripts/variants.mjs` for exact case IDs and `scripts/fixture.mjs` for seeded paths/content. Lite cases carry `variant: 'lite'` and receive the generated Lite fixture; every case starts from a fresh context. Browser network is local-only, except version-locked Mermaid requests answered by installed bytes. Assert rendered controls/content, preferences and network/page-error evidence. UI content mutations require download/reopen. Keep captures, ARIA, trace and result manifests in the case directory.

## Gotchas

- Offline fallback proof does not prove live CDN delivery or a production deployment.
- Network blocking by the harness is recorded separately from product CSP/sandbox behavior; inspect the iframe attributes and visible content when asserting the product boundary.
- Headless narrow viewport and ARIA snapshots do not establish real touch, IME or screen-reader experience.
- Use the settings menu's actual accessible names after locale changes. Browser preference persistence is distinct from persistence inside a saved Taco bundle.
