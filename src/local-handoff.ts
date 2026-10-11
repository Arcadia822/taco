import type { LocalHandoff, LocalHandoffAck, TacoDocument } from '@taco/protocol'

const CREDENTIAL_KEY_PATTERN = /^(collab|access|credentials|relay|relayConfig|relay_config|token|secret|apiKey|api_key|password|authToken|auth_token|accessToken|access_token|privateKey|ownerPriv|priv|key|authorization)$/i

function stripCredentials(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripCredentials)
  }
  if (value && typeof value === 'object') {
    const res: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (CREDENTIAL_KEY_PATTERN.test(k)) continue
      res[k] = stripCredentials(v)
    }
    return res
  }
  return value
}

export function credentialFreeDocument<T extends Record<string, unknown>>(doc: T): TacoDocument {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>
  const cleaned = stripCredentials(clone) as Record<string, unknown>
  return cleaned as unknown as TacoDocument
}

export interface SendLocalHandoffOptions {
  port: number
  token: string
  docId: string
  sessionId: string
  payload: LocalHandoff
  timeoutMs?: number
}

export async function sendLocalHandoff({
  port,
  token,
  docId,
  sessionId,
  payload,
  timeoutMs = 10_000,
}: SendLocalHandoffOptions): Promise<LocalHandoffAck> {
  const url = `http://127.0.0.1:${port}/handoff`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Taco-Doc-Id': docId,
        'X-Taco-Session-Id': sessionId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) {
      let errMsg = `Local handoff failed: HTTP ${res.status}`
      try {
        const body = (await res.json()) as { error?: string; message?: string }
        if (body.error) errMsg = body.error
        else if (body.message) errMsg = body.message
      } catch {
        try {
          const text = await res.text()
          if (text) errMsg = text
        } catch {}
      }
      return {
        ok: false,
        handoffId: payload.handoffId,
        error: errMsg,
      }
    }

    const data = (await res.json()) as Partial<LocalHandoffAck>
    const isOk = data.ok === true
      && data.handoffId === payload.handoffId
      && typeof data.receiptId === 'string'
      && data.receiptId.length > 0

    if (!isOk) {
      return {
        ok: false,
        handoffId: payload.handoffId,
        error: data.error || 'Invalid or mismatched acknowledgement from listener',
      }
    }

    return {
      ok: true,
      handoffId: payload.handoffId,
      receiptId: data.receiptId,
    }
  } catch (error) {
    return {
      ok: false,
      handoffId: payload.handoffId,
      error: (error as Error).message || 'Network error sending local handoff',
    }
  }
}
