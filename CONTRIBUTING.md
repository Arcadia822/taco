# Contributing to Taco

Taco welcomes focused issues and pull requests. The project is deliberately file-first: canonical files remain the source of truth, while navigation, outlines, comments, and search are derived views.

## Development setup

Requirements:

- Node.js 22 or newer
- npm

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

Development mode embeds `specs/001-taco-bento-product/` as the default Taco.

## Before opening a pull request

A reviewable change should:

- State the user problem and the explicit out-of-scope boundary.
- Preserve backward compatibility for file formats and public interfaces, or document the migration.
- Add tests for changed parsing, saving, comments, navigation, collaboration, or CLI behavior.
- Keep Markdown as canonical content instead of introducing a Taco-specific business database.
- Avoid remote runtime dependencies in the core path. Optional network enhancements must be triggered explicitly and retain a source fallback.
- Follow the surrounding TypeScript and JavaScript style: two-space indentation, single quotes, and no semicolons.

Run the complete local gate:

```bash
npm run check
```

The command checks contributor-facing formatting, runs the test suite, and produces the single-file build. The relay integration suite is separate because it requires a running relay:

```bash
npm run relay:dev
npm run test:relay
```

## Generated artifacts

`dist-single/Taco_Spec.taco.html` is ignored local build output. `extensions/taco/assets/taco-shell.html` is the tracked generated shell consumed directly by the Spec Kit integration, so source changes that affect the build must update it.

After `npm run build`, inspect and commit the generated extension shell when it changes. CI rebuilds it and fails if the committed output drifts from source. Do not hand-edit generated HTML; fix the source or build script and rebuild.

## Formatting

The repository uses EditorConfig for baseline whitespace and Prettier for contributor-facing Markdown, YAML, and JSON files:

```bash
npm run format
npm run format:check
```

The existing application source keeps its established style. A future whole-tree formatter migration should be proposed and reviewed separately rather than mixed into a functional change.

## Security reports

Do not disclose a suspected vulnerability in a public issue. Follow [`SECURITY.md`](SECURITY.md) and use GitHub's private vulnerability-reporting flow.

By participating, you agree to follow [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
