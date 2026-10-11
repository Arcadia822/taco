#!/usr/bin/env node
/**
 * plan-preview.mjs
 *
 * Runs in the TRUSTED PLANNER job with controlled outbound network.
 * NEVER runs PR app code, NEVER executes untrusted binaries.
 *
 * Inputs:
 *   - PR Diff file
 *   - DOM Outlines JSON (from network-none outline step)
 *   - DEEPSEEK_API_KEY (env)
 *
 * Outputs:
 *   - preview-plan.json (strict plan schema)
 *
 * If DEEPSEEK_API_KEY is missing or the planner fails:
 *   - Does NOT invent an AI plan or fallback to happy path claiming success.
 *   - Writes plan with ui_change=false or marks status as unavailable/error so
 *     the PR clearly reports that the dynamic plan could not be computed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validatePreviewPlan } from './plan-schema.mjs'

const MODEL = process.env.PLAN_MODEL || 'deepseek-chat'
const DEFAULT_TIMEOUT_MS = 60000

const PLANNER_SYSTEM_PROMPT = `You are a UI Preview Planner for Taco, a single-file specification review workspace.
You plan a short sequence of interactive desktop scenes (1280x800) demonstrating what the PR changes.

Rules:
1. Target desktop only: scenes target either "taco" (the complete specification file) or "host" (the hosted demo web app).
2. Maximum 3 scenes, maximum 12 steps per scene.
3. Steps can be:
   - "click": { "do": "click", "target": "css selector", "text": "optional text match", "caption": "short description" }
   - "hover": { "do": "hover", "target": "css selector" }
   - "wait": { "do": "wait", "ms": 500 }
   - "scroll": { "do": "scroll", "to": "css selector" }
   - "open-file": { "do": "open-file", "path": "path/in/sidebar" }
   - "shot": { "do": "shot", "name": "kebab-case-name", "caption": "what this screenshot shows" }
4. Special capability:
   - Taco renders Mermaid diagrams (flowchart and sequenceDiagram).
   - SVG Mermaid nodes have selectors like "g.node" or "[data-id]" and clicking a node activates the source editor line and the comment toolbar (".mermaid-comment-toolbar" or ".tiptap-code-block-button").
   - You can click Mermaid diagram nodes or code buttons to demonstrate interactions!
5. Never click dangerous items (delete, remove, restart, quit, sign out).
6. Return JSON only conforming to the plan schema:
{
  "version": 1,
  "source": "deepseek-planner",
  "model": "${MODEL}",
  "ui_change": true,
  "summary": "Short summary of what changed in the UI",
  "mismatch": "Any discrepancy between PR claim and diff",
  "unseen": "Any feature not exercisable in this sandbox",
  "scenes": [
    {
      "id": "scene-id",
      "title": "Scene Title",
      "target": "taco",
      "steps": [...]
    }
  ]
}
`

export async function requestDeepseekPlan(messages, apiKey) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`DeepSeek API error ${res.status}: ${errText.slice(0, 300)}`)
  }

  const json = await res.json()
  const content = json.choices?.[0]?.message?.content || '{}'
  return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''))
}

export async function planPreview(options = {}) {
  const {
    diffFile,
    outlinesFile,
    outPlanFile,
    apiKey = process.env.DEEPSEEK_API_KEY,
    fixturePlanFile,
  } = options

  // If a pre-validated fixture plan is explicitly provided (for offline reproduction/tests)
  if (fixturePlanFile && existsSync(fixturePlanFile)) {
    console.log(`[plan-preview] Using human-provided fixture plan from ${fixturePlanFile}`)
    const raw = JSON.parse(readFileSync(fixturePlanFile, 'utf-8'))
    raw.source = 'human-fixture'
    const validated = validatePreviewPlan(raw)
    writeFileSync(outPlanFile, JSON.stringify(validated, null, 2), 'utf-8')
    return validated
  }

  if (!apiKey) {
    console.warn('[plan-preview] DEEPSEEK_API_KEY is not set. Marking plan as unavailable.')
    const emptyPlan = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: false,
      summary: 'DEEPSEEK_API_KEY is unavailable in this environment; dynamic planning skipped.',
      scenes: [],
    }
    writeFileSync(outPlanFile, JSON.stringify(emptyPlan, null, 2), 'utf-8')
    return emptyPlan
  }

  const diffText = diffFile && existsSync(diffFile) ? readFileSync(diffFile, 'utf-8') : ''
  const outlinesData =
    outlinesFile && existsSync(outlinesFile) ? readFileSync(outlinesFile, 'utf-8') : '{}'

  const userPrompt = `PR Diff:
${diffText.slice(0, 15000)}

DOM Outlines of the available pages:
${outlinesData.slice(0, 20000)}

Please inspect the diff and available DOM elements (including SVG Mermaid nodes and navigation elements), and generate the preview plan.
`

  console.log(`[plan-preview] Requesting dynamic plan from DeepSeek (${MODEL})...`)
  const messages = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let rawPlan
  try {
    rawPlan = await requestDeepseekPlan(messages, apiKey)
  } catch (err) {
    console.error(`[plan-preview] DeepSeek call failed:`, err.message)
    const failedPlan = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: false,
      summary: `Planner error: ${err.message}`,
      scenes: [],
    }
    writeFileSync(outPlanFile, JSON.stringify(failedPlan, null, 2), 'utf-8')
    return failedPlan
  }

  rawPlan.version = 1
  rawPlan.source = 'deepseek-planner'
  rawPlan.model = MODEL

  const validated = validatePreviewPlan(rawPlan)
  writeFileSync(outPlanFile, JSON.stringify(validated, null, 2), 'utf-8')
  console.log(
    `[plan-preview] Successfully generated and validated plan with ${validated.scenes.length} scenes.`,
  )
  return validated
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--diff-file' && argv[i + 1]) options.diffFile = argv[++i]
    else if (argv[i] === '--outlines-file' && argv[i + 1]) options.outlinesFile = argv[++i]
    else if (argv[i] === '--out-plan' && argv[i + 1]) options.outPlanFile = argv[++i]
    else if (argv[i] === '--fixture-plan' && argv[i + 1]) options.fixturePlanFile = argv[++i]
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2))
  planPreview(args).catch((err) => {
    console.error('[plan-preview] Fatal error:', err)
    process.exit(1)
  })
}
