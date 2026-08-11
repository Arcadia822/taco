# Taco kernel maintenance

The files in this directory were adapted from Bento and are maintained as a
local fork. They are not a read-only vendored dependency.

- Keep application-specific UI and model behavior outside `src/kernel/`.
- Document intentional divergence from Bento in the affected file.
- Route Taco collaboration code through `src/sync/crdt.ts`; it is the
  application binding that selects the `files` and `nodes` document shape.
- Change `src/kernel/sync/crdt.ts` only when modifying the generic CRDT engine.
  Run the collaboration and convergence tests after every such change.

The two `crdt.ts` files serve different purposes: `src/sync/crdt.ts` is the
small Taco binding, while `src/kernel/sync/crdt.ts` is the generic engine.
