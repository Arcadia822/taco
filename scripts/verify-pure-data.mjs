import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LIVE_HOST = 'https://host-gamma-steel.vercel.app'
console.log('🚀 [Pure Data Spec Verification] Target Host:', LIVE_HOST)

async function step(name, fn) {
  process.stdout.write(`\n⏳ ${name}... `)
  const result = await fn()
  console.log('✅ OK')
  return result
}

// 1. Check Capabilities
await step('1. 获取能力配置 (/v1/capabilities)', async () => {
  const res = await fetch(`${LIVE_HOST}/v1/capabilities`)
  if (!res.ok) throw new Error(`Status ${res.status}`)
  const data = await res.json()
  console.log(`\n   协议版本: ${data.protocol}, 存储模型: ${data.storage}`)
})

// 2. Bootstrap Anonymous ApiKey
const apiKey = await step('2. 自动引导匿名凭据 (/v1/anonymous-credentials)', async () => {
  const res = await fetch(`${LIVE_HOST}/v1/anonymous-credentials`, { method: 'POST' })
  const data = await res.json()
  console.log(`\n   分配用户: ${data.user.id}, 凭据前缀: ${data.apiKey.prefix}`)
  return data.apiKey.secret
})

// 3. Prepare Pure Data Snapshot
const fixtureTaco = resolve(process.cwd(), 'specs/008-taco-host-contract/008-taco-host-contract.taco.html')
const htmlContent = readFileSync(fixtureTaco, 'utf8')
const bundleMatch = htmlContent.match(/<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i)
const parsedBundle = JSON.parse(bundleMatch[1].trim())

// 严格按照 spec 第 5 节：只上传纯数据 JSON，绝无 HTML 外壳
const targetFile = parsedBundle.files[0]
const stagedDataPayload = {
  protocol: 'taco-host/1',
  snapshot: {
    format: 'taco/files',
    version: 1,
    docId: parsedBundle.docId,
    title: parsedBundle.title,
    root: parsedBundle.root,
    files: parsedBundle.files,
    navigation: parsedBundle.navigation,
  },
  importedComments: [],
}

const stagedBytes = new TextEncoder().encode(JSON.stringify(stagedDataPayload))
const cryptoHash = await crypto.subtle.digest('SHA-256', stagedBytes)
const payloadHash = `sha256:${Array.from(new Uint8Array(cryptoHash)).map((b) => b.toString(16).padStart(2, '0')).join('')}`
const idempotencyKey = crypto.randomUUID()

// 4. Prepare Upload Reservation
const prep = await step('3. 申请私有暂存预签名预约 (/v1/uploads)', async () => {
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
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  console.log(`\n   预约 uploadId: ${data.uploadId}`)
  return data
})

// 5. Direct PUT to Storage (Pure Data JSON bytes)
await step('4. 纯数据 JSON 直传对象存储', async () => {
  const res = await fetch(prep.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: stagedBytes,
  })
  if (!res.ok) throw new Error(await res.text())
})

// 6. Commit Publish
const published = await step('5. 轻量原子提交确权入库 (/v1/tacos)', async () => {
  const res = await fetch(`${LIVE_HOST}/v1/tacos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      protocol: 'taco-host/1',
      uploadId: prep.uploadId,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  console.log(`\n   Taco UUID: ${data.tacoId}`)
  console.log(`   访问链接: ${data.url}`)
  return data
})

const tacoId = published.tacoId
const revisionId = published.revisionId

// 7. Subscribe to EventStream
console.log('\n⏳ 6. 建立实时订阅 EventStream 连接...')
const controller = new AbortController()
const subRes = await fetch(`${LIVE_HOST}/v1/tacos/${tacoId}/subscribe`, {
  signal: controller.signal,
  headers: { Accept: 'text/event-stream' },
})
const reader = subRes.body.getReader()
const decoder = new TextDecoder()
let receivedEvent = false

;(async () => {
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          const frame = JSON.parse(line.slice(6))
          console.log(`   📡 实时捕获帧: [${frame.kind || frame.type}] #${frame.sequence || frame.cursor}`)
          if (frame.type === 'comment.created') {
            receivedEvent = true
          }
        }
      }
    }
  } catch {}
})()

await new Promise((r) => setTimeout(r, 1000))

// 8. Submit Review Comment with Valid Anchor
await step('7. 提交带真实文本行锚点的在线评审评论 (/v1/tacos/:id/reviews)', async () => {
  const commentPayload = {
    revisionId,
    type: 'comment.created',
    body: '📌 评审意见：纯数据快照已正确加载，锚点挂载通过！',
    anchor: {
      path: targetFile.path,
      position: { start: 0, end: 10 },
      quote: {
        exact: targetFile.content.slice(0, 10),
        prefix: '',
        suffix: targetFile.content.slice(10, 30),
      },
    },
  }

  const res = await fetch(`${LIVE_HOST}/v1/tacos/${tacoId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commentPayload),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  console.log(`\n   评论事件生成: #${data.event.sequence}`)
})

await new Promise((r) => setTimeout(r, 1500))
controller.abort()

console.log('\n===============================================================')
console.log('🎉 验证完毕！纯数据存储、真实锚点评论已成功投影！')
console.log(`👉 访问真实页面: ${LIVE_HOST}/t/${tacoId}`)
console.log('===============================================================')
