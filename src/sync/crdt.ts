// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Taco binding for the Bento-derived generic CRDT engine.

export * from '../kernel/sync/crdt.ts'

import { SyncEngine, shape } from '../kernel/sync/crdt.ts'

export const TACO_SHAPE = shape('files', 'nodes')

export class SyncState extends SyncEngine {
  constructor(actor: string) {
    super(actor, TACO_SHAPE)
  }
}
