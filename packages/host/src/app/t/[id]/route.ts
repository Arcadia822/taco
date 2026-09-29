import { notFound } from 'next/navigation'
import type { DocumentSnapshot } from '@taco/protocol'
import type { SharedStateResult } from '@/lib/db'
import { getStorageAdapter } from '@/lib/storage-adapter'
import { getSharedReviewState } from '@/lib/server-state'
import { renderCanonicalTacoHtml } from '@/lib/taco-shell-template'

export const dynamic = 'force-dynamic'

/**
 * Inert block that tells the shell a same-origin Host review is available for this Taco. The shell
 * reads it from `<head>` only, so file content can neither enable writes nor redirect them. The
 * element id and media type are the frozen interface with `src/host-capability.ts`.
 */
const HOST_CAPABILITY_ELEMENT_ID = 'taco-host-capability'
const HOST_CAPABILITY_MEDIA_TYPE = 'application/taco+host'
const HEAD_ANCHOR = '<head>'

interface LegacyPaste {
  snapshot?: DocumentSnapshot
  comments?: unknown[]
  importedComments?: unknown[]
}

/** Legacy pastes may carry anchored comments; a thread without an anchor is not a valid bundle thread. */
const anchoredComments = (paste: LegacyPaste): unknown[] =>
  [...(paste.comments ?? []), ...(paste.importedComments ?? [])]
    .filter((thread) => Boolean(thread)
      && typeof thread === 'object'
      && 'anchor' in thread
      && thread.anchor != null)

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: pasteId } = await props.params

  // Current content is the Host's durable shared state. The published object is only the immutable
  // publish baseline, used when no shared state exists.
  let state: SharedStateResult | null
  try {
    state = await getSharedReviewState(pasteId)
  } catch (error) {
    // The Host database is unreachable, so there is no way to tell the baseline from the current
    // shared state. Fail closed instead of serving a stale published object as if it were current.
    const message = error instanceof Error ? error.message : 'Host review storage is unavailable'
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  let snapshot: DocumentSnapshot | null = state?.snapshot ?? null
  const shared = Boolean(state)
  let legacy: LegacyPaste = {}
  if (!snapshot) {
    const storage = getStorageAdapter()
    const rawBytes = await storage.getObject(`pastes/${pasteId}.json`)
    if (!rawBytes) notFound()
    legacy = JSON.parse(new TextDecoder().decode(rawBytes)) as LegacyPaste
    const baseline = legacy.snapshot
    if (!baseline) notFound()
    snapshot = baseline
  }

  const bundle = {
    ...snapshot,
    // Only a Taco with a durable shared state is editable; a baseline-only paste stays a reader page.
    ...(shared ? {} : { access: 'reader' as const }),
    comments: shared ? [] : anchoredComments(legacy),
  }

  let html: string
  try {
    html = renderCanonicalTacoHtml(bundle)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Host review shell asset is unavailable'
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  if (shared) {
    const payload = JSON.stringify({ version: 1, tacoId: pasteId }).replace(/</g, '\\u003c')
    if (!html.includes(HEAD_ANCHOR)) throw new Error('Taco shell is missing its document head')
    html = html.replace(
      HEAD_ANCHOR,
      `${HEAD_ANCHOR}\n    <script type="${HOST_CAPABILITY_MEDIA_TYPE}" id="${HOST_CAPABILITY_ELEMENT_ID}">${payload}</script>`,
    )
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
