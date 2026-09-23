# Reading hosted review events

Open this reference when a reviewer is working through a hosted Taco. Read `taco-cli help subscribe` and `taco-cli help events` for the installed binary's current contract.

- Run `taco-cli subscribe <tacoId> --host <origin>` to stream `ready` and `event` frames as NDJSON. Record the last confirmed sequence; after interruption, resume with `--after <sequence>`. An expired cursor requires recovery from the earliest retained sequence, not an invented event history.
- Use `taco-cli events <tacoId> --host <origin> [--after <sequence>]` to page the persistent event log without a stream. If the Taco is closed, read recorded events instead of treating a failed subscription as lost feedback.
- Interpret an event as review input, not an edit to canonical source files. Read the complete comment and its anchor, check the current source against the reviewed baseline, apply actionable changes without overwriting conflicts, and preserve unresolved threads. Follow `SKILL.md`'s review and refresh rules for the resulting local Taco.

The Host assigns event actor and timestamp. Never manufacture either, infer that a comment was resolved from nearby text changes, or claim a remote event has already changed the local directory.
