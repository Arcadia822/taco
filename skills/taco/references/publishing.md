# Publishing a Taco to a Host

Open this reference only for explicitly requested remote publication. Local Taco assembly and review use `SKILL.md` without a CLI or account.

1. Read `taco-cli help publish` for the installed binary's current arguments and output. Choose the intended Host with `--host <origin>` or `TACO_HOST_URL`; the CLI default is a local Host, not an implicit public endpoint.
2. Inspect the `.taco.html` locally for secrets and collaboration credentials before sharing it. A collaboration-enabled file can contain credentials; do not transmit the complete file to an external service or model without authorization. Hosted Tacos, comments, revisions, and assets are public by default.
3. Run `taco-cli publish <file.taco.html> --host <origin> --dry-run`. This projects and validates locally; examine its file list, `contentHash`, and `payloadBytes`. The dry run sends no network request.
4. If the projected content is safe and publication was requested, run the same command without `--dry-run`. The Host returns a `url` for the reviewer and a `tacoId` for subsequent event reads. A publication does not change canonical local files.

`publish` creates a new hosted Taco. `taco-cli update` currently supports only `--dry-run` projection; it cannot replace a hosted revision over the network. A corrected file needs a new publication. Consult `taco-cli help` rather than assuming an older binary implements updates, deletion, private hosting, or authentication.
