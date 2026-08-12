// SPDX-License-Identifier: MIT
// Collaboration-copy semantics adapted from Bento slides/src/editor/editor.ts.

import { saveVariant, type SaveResult } from './kernel/save.ts'
import type { TacoBundle, TacoCollab } from './model.ts'
import { mintInvite } from './sync/online.ts'

const clone = <T>(value: T): T => structuredClone(value)

export const isCollabOwner = (bundle: TacoBundle): boolean =>
  Boolean(bundle.collab?.v === 2 && bundle.collab.owner && bundle.collab.ownerPriv)

export const collabRole = (bundle: TacoBundle): 'owner' | 'editor' | 'viewer' | 'offline-reader' | 'none' => {
  if (bundle.access === 'reader' && !bundle.collab) return 'offline-reader'
  const collab = bundle.collab
  if (!collab) return 'none'
  if (collab.role === 'reader') return 'viewer'
  if (collab.v === 2 && collab.ownerPriv) return 'owner'
  return 'editor'
}

export const editorCapability = (collab: TacoCollab, invite: NonNullable<TacoCollab['invite']>): TacoCollab => ({
  room: collab.room,
  key: collab.key,
  on: true,
  v: collab.v,
  owner: collab.owner,
  invite,
  role: 'writer',
  ...(collab.sync !== undefined ? { sync: clone(collab.sync) } : {}),
})

export async function editorInviteBundle(bundle: TacoBundle): Promise<TacoBundle> {
  const collab = bundle.collab
  if (!collab?.room || !collab.key || !collab.owner) throw new Error('A live collaboration session is required')
  if (!collab.ownerPriv) throw new Error('Only the owner copy can create an editor invitation')

  const next = clone(bundle)
  const invite = await mintInvite(collab.ownerPriv, 'writer')
  next.collab = editorCapability(collab, invite)
  delete next.access
  return next
}

export function sealedReaderBundle(bundle: TacoBundle): TacoBundle {
  const next = clone(bundle)
  delete next.collab
  next.access = 'reader'
  return next
}

export const saveEditorInvite = async (bundle: TacoBundle): Promise<SaveResult> =>
  saveVariant(await editorInviteBundle(bundle), 'invite')

export const saveSealedReader = async (bundle: TacoBundle): Promise<SaveResult> =>
  saveVariant(sealedReaderBundle(bundle), 'read-only')
