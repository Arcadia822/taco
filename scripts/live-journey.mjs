import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LIVE_HOST = 'https://host-gamma-steel.vercel.app'
console.log('🚀 Starting Live End-to-End Journey on Vercel Next.js Host:', LIVE_HOST)

async function step(name, fn) {
  process.stdout.write(`\n⏳ [Step] ${name}... `)
  const result = await fn()
  console.log('✅ OK')
  return result
}

// 1. Check Capabilities
await step('Verify /v1/capabilities', async () => {
  const res = await fetch(`${LIVE_HOST}/v1/capabilities`)
  if (!res.ok) throw new Error(`Capabilities failed: ${res.status}`)
  const data = await res.json()
  console.log(`\n   Protocol: ${data.protocol}, Server: ${data.serverType}, Storage: ${data.storage}`)
})

// 2. Bootstrap Anonymous ApiKey
const apiKey = await step('Bootstrap Anonymous Credentials (/v1/anonymous-credentials)', async () => {
  const res = await fetch(`${LIVE_HOST}/v1/anonymous-credentials`, { method: 'POST' })
  if (!res.ok) throw new Error(`Anonymous bootstrap failed: ${res.status}`)
  const data = await res.json()
  console.log(`\n   Created User: ${data.user.id}, KeyPrefix: ${data.apiKey.prefix}`)
  return data.apiKey.secret
})

// 3. Prepare Two-Phase Upload
const fixtureTaco = resolve(process.cwd(), 'specs/008-taco-host-contract/008-taco-host-contract.taco.html')
const htmlContent = readFileSync(fixtureTaco, 'utf8')
const bundleMatch = htmlContent.match(/<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i)
const parsedBundle = JSON.parse(bundleMatch[1].trim())

const stagedPayload = {
  protocol: 'taco-host/1',
  snapshot: {
    format: 'taco/files',
    version: 1,
    docId: parsedBundle.docId,
    title: 'Live Vercel Next.js Taco Specification',
    root: parsedBundle.root,
    files: parsedBundle.files.slice(0, 2), // small subset for fast verification
  },
}
const stagedBytes = new TextEncoder().encode(JSON.stringify(stagedPayload))
const cryptoHash = await crypto.subtle.digest('SHA-256', stagedBytes)
const payloadHash = `sha256:${Array.from(new Uint8Array(cryptoHash)).map((b) => b.toString(16).padStart(2, '0')).join('')}`
const idempotencyKey = crypto.randomUUID()

const prepData = await step('Prepare Upload Reservation (/v1/uploads)', async () => {
  const res = await fetch(`${LIVE_HOST}/v1/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      protocol: 'taco-host/1',
      purpose: 'publish',
      payloadHash,
      payloadBytes: stagedBytes.byteLength,
    }),
  })
  if (!res.ok) throw new Error(`Prepare failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  console.log(`\n   Assigned uploadId: ${data.uploadId}, URL: ${data.uploadUrl}`)
  return data
})

// 4. Direct Upload to Storage
await step('Direct PUT to Storage Endpoint', async () => {
  const res = await fetch(prepData.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: stagedBytes,
  })
  if (!res.ok) throw new Error(`Direct PUT failed: ${res.status} ${await res.text()}`)
  const result = await res.json()
  console.log(`\n   Stored Bytes: ${result.storedBytes}`)
})

// 5. Commit Publish Transaction
const pubResult = await step('Commit Atomic Publish Transaction (/v1/tacos)', async () => {
  const res = await fetch(`${LIVE_HOST}/v1/tacos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      protocol: 'taco-host/1',
      uploadId: prepData.uploadId,
    }),
  })
  if (!res.ok) throw new Error(`Commit publish failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  console.log(`\n   Taco ID: ${data.tacoId}`)
  console.log(`   Public Web View: ${data.url}`)
  return data
})

// 6. Connect Realtime Stream
const tacoId = pubResult.tacoId
const receivedEvents = []

console.log(`\n⏳ [Step] Connecting Realtime EventStream (/v1/tacos/${tacoId}/subscribe)...`)
const controller = new AbortController()
const subRes = await fetch(`${LIVE_HOST}/v1/tacos/${tacoId}/subscribe`, {
  signal: controller.signal,
  headers: { Accept: 'text/event-stream' },
})
if (!subRes.ok) throw new Error(`Subscribe failed: ${subRes.status}`)
console.log('✅ SSE Stream Connected!')

const reader = subRes.body.getReader()
const decoder = new TextDecoder()

// Read stream in background
const streamPromise = (async () => {
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) {
        const frame = JSON.parse(line.slice(6))
        receivedEvents.push(frame)
        console.log(`   📡 Received Realtime Frame: [${frame.kind || frame.type}] sequence: ${frame.sequence || frame.cursor}`)
      }
    }
  }
})()

// Wait 1s for ready frame
await new Promise((r) => setTimeout(r, 1000))

// 7. Submit Review Comment
await step('Submit Review Comment Mutation (/v1/tacos/:id/reviews)', async () => {
  const res = await fetch(`${LIVE_HOST}/v1/tacos/${tacoId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revisionId: pubResult.revisionId,
      type: 'comment.created',
      body: '🎉 Live Vercel Next.js Host review verified successfully!',
    }),
  })
  if (!res.ok) throw new Error(`Post review failed: ${res.status}`)
  const data = await res.json()
  console.log(`\n   Created Comment Event: #${data.event.sequence} (${data.event.data.body})`)
})

// Wait 1.5s for SSE event propagation
await new Promise((r) => setTimeout(r, 1500))

// Clean up SSE connection
controller.abort()
try { await streamPromise } catch {}

console.log('\n===============================================================')
console.log('🎉 LIVE VERIFICATION COMPLETED SUCCESSFULLY ON VERCEL PRODUCTION!')
console.log(`👉 Visit Taco Web Space: ${LIVE_HOST}/t/${tacoId}`)
console.log('===============================================================')
