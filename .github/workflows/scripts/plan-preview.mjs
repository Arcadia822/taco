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
 *   - PREVIEW_API_KEY / DEEPSEEK_API_KEY (env)
 *   - PREVIEW_API_BASE_URL (env, optional)
 *   - PREVIEW_MODEL / PLAN_MODEL (env, optional)
 *
 * Outputs:
 *   - preview-plan.json (strict plan schema)
 *
 * If API key is missing or the planner fails:
 *   - Does NOT invent an AI plan or fallback to happy path claiming success.
 *     the PR clearly reports that the dynamic plan could not be computed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validatePreviewPlan } from './plan-schema.mjs'
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'
const DEFAULT_TIMEOUT_MS = 60000

export function resolvePlannerConfig(env = process.env) {
  const apiKey = env.PREVIEW_API_KEY || env.DEEPSEEK_API_KEY || ''
  const rawBaseUrl = env.PREVIEW_API_BASE_URL || DEFAULT_BASE_URL
  const baseUrl = rawBaseUrl.replace(/\/+$/, '')
  const model = env.PREVIEW_MODEL || env.PLAN_MODEL || DEFAULT_MODEL
  return { apiKey, baseUrl, model }
}

const PLANNER_SYSTEM_PROMPT = `You are a UI Preview Planner for Taco, a single-file specification review workspace.
You plan a short sequence of interactive desktop scenes (1280x800) demonstrating what the PR changes.

Rules:
1. Target desktop only: scenes target either "taco" (the complete specification file) or "host" (the hosted demo web app).
2. Strict Limits: Maximum 3 scenes, maximum 8 steps per scene. Keep scenes concise and focused!
3. Steps must strictly include their required operands:
   - "hover": { "do": "hover", "target": "css selector" }
   - "wait": { "do": "wait", "ms": 500 } (ms must be between 50 and 10000)
   - "scroll": { "do": "scroll", "to": "css selector" }
   - "open-file": { "do": "open-file", "path": "exact/file/path" }
   - "shot": { "do": "shot", "name": "kebab-case-name", "caption": "what this screenshot shows" }
   - Every scene MUST contain at least 1 "shot" step!
4. Special capability:
   - Taco renders Mermaid diagrams (flowchart and sequenceDiagram).
   - In Taco, files in the sidebar have exact data-path attributes, e.g. "button.sidebar-row.file-row[data-path='demo-spec/spec.md']". Use "open-file" with the exact path!
   - SVG Mermaid nodes have selectors like "g.node" or "[data-id]" and clicking a node activates the source editor line and the comment toolbar (".mermaid-comment-toolbar" or ".tiptap-code-block-button").
   - You can click Mermaid diagram nodes or code buttons to demonstrate interactions!
5. Never click dangerous items (delete, remove, restart, quit, sign out).
6. Return JSON only conforming to the plan schema:
{
  "version": 1,
  "source": "deepseek-planner",
  "model": "model-identifier",
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
export async function requestPlannerPlan(messages, config) {
  const { apiKey, baseUrl, model } = config
  const endpoint = `${baseUrl}/chat/completions`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Planner API error ${res.status}: ${errText.slice(0, 300)}`)
  }

  const json = await res.json()
  const content = json.choices?.[0]?.message?.content || '{}'
  return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''))
}

export async function requestDeepseekPlan(messages, apiKey) {
  return requestPlannerPlan(messages, {
    apiKey,
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
  })
}
export async function planPreview(options = {}) {
  const {
    diffFile,
    outlinesFile,
    outPlanFile,
    apiKey: explicitApiKey,
    baseUrl: explicitBaseUrl,
    model: explicitModel,
    fixturePlanFile,
  } = options

  const resolved = resolvePlannerConfig(process.env)
  const apiKey = explicitApiKey !== undefined ? explicitApiKey : resolved.apiKey
  const baseUrl = (explicitBaseUrl !== undefined ? explicitBaseUrl : resolved.baseUrl).replace(/\/+$/, '')
  const model = explicitModel !== undefined ? explicitModel : resolved.model
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
    console.warn('[plan-preview] PREVIEW_API_KEY/DEEPSEEK_API_KEY is not set. Marking plan as unavailable.')
    const emptyPlan = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: false,
      summary: 'Preview planner API key is unavailable in this environment; dynamic planning skipped.',
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

  console.log(`[plan-preview] Requesting dynamic plan from ${model} at ${baseUrl}...`)
  const messages = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let rawPlan
  try {
    rawPlan = await requestPlannerPlan(messages, { apiKey, baseUrl, model })
  } catch (err) {
    console.error(`[plan-preview] Planner call failed:`, err.message)
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

  let validated
  try {
    rawPlan.version = 1
    rawPlan.source = 'deepseek-planner'
    rawPlan.model = model
    if (Array.isArray(rawPlan.scenes)) {
      rawPlan.scenes = rawPlan.scenes.slice(0, 3)
      for (const sc of rawPlan.scenes) {
        if (Array.isArray(sc.steps) && sc.steps.length > 12) {
          const shots = sc.steps.filter((st) => st.do === 'shot')
          const nonShots = sc.steps.filter((st) => st.do !== 'shot')
          sc.steps = [...nonShots.slice(0, 10), ...shots.slice(-2)].slice(0, 12)
        }
      }
    }
    validated = validatePreviewPlan(rawPlan)
  } catch (err) {
    console.error(`[plan-preview] Plan validation failed:`, err.message)
    const invalidPlan = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: false,
      summary: `Planner produced invalid plan: ${err.message}`,
      scenes: [],
    }
    writeFileSync(outPlanFile, JSON.stringify(invalidPlan, null, 2), 'utf-8')
    return invalidPlan
  }

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
    else if (argv[i] === '--api-key' && argv[i + 1]) options.apiKey = argv[++i]
    else if (argv[i] === '--base-url' && argv[i + 1]) options.baseUrl = argv[++i]
    else if (argv[i] === '--model' && argv[i + 1]) options.model = argv[++i]
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
