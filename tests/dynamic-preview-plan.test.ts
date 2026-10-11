// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import {
  validatePreviewPlan,
  PlanValidationError,
  MAX_SCENES,
  MAX_STEPS_PER_SCENE,
} from '../.github/workflows/scripts/plan-schema.mjs'
import {
  resolvePlannerConfig,
  requestPlannerPlan,
} from '../.github/workflows/scripts/plan-preview.mjs'
describe('Dynamic Preview: Plan Schema Validation', () => {
  it('validates a correct dynamic plan', () => {
    const validPlan = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'Added interactive Mermaid comments',
      scenes: [
        {
          id: 'mermaid-test',
          title: 'Mermaid Interaction',
          target: 'taco',
          steps: [
            { do: 'shot', name: 'initial', caption: 'Initial view' },
            { do: 'click', target: 'svg.mermaid g.node', caption: 'Click node' },
            { do: 'wait', ms: 500 },
            { do: 'shot', name: 'clicked', caption: 'Node clicked' },
          ],
        },
      ],
    }

    const result = validatePreviewPlan(validPlan)
    expect(result.version).toBe(1)
    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0].steps).toHaveLength(4)
  })

  it('rejects forbidden dangerous actions or keywords', () => {
    const dangerousPlan = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'Bad plan',
      scenes: [
        {
          id: 'bad-scene',
          title: 'Dangerous',
          target: 'taco',
          steps: [
            { do: 'click', target: 'button#delete-all' },
            { do: 'shot', name: 'dangerous-shot' },
          ],
        },
      ],
    }
    expect(() => validatePreviewPlan(dangerousPlan)).toThrow(PlanValidationError)
  })

  it('enforces required operands for actions and bounds on wait ms', () => {
    const missingTarget = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'Missing target',
      scenes: [
        {
          id: 's1',
          title: 'S1',
          target: 'taco',
          steps: [{ do: 'click' }, { do: 'shot', name: 's' }],
        },
      ],
    }
    expect(() => validatePreviewPlan(missingTarget)).toThrow(/requires non-empty target/)

    const missingScrollTo = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'Missing to',
      scenes: [
        {
          id: 's1',
          title: 'S1',
          target: 'taco',
          steps: [{ do: 'scroll' }, { do: 'shot', name: 's' }],
        },
      ],
    }
    expect(() => validatePreviewPlan(missingScrollTo)).toThrow(/requires non-empty "to"/)

    const missingOpenFilePath = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'Missing path',
      scenes: [
        {
          id: 's1',
          title: 'S1',
          target: 'taco',
          steps: [{ do: 'open-file' }, { do: 'shot', name: 's' }],
        },
      ],
    }
    expect(() => validatePreviewPlan(missingOpenFilePath)).toThrow(/requires non-empty "path"/)

    const badWaitMs = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'Bad wait ms',
      scenes: [
        {
          id: 's1',
          title: 'S1',
          target: 'taco',
          steps: [{ do: 'wait', ms: 999999 }, { do: 'shot', name: 's' }],
        },
      ],
    }
    expect(() => validatePreviewPlan(badWaitMs)).toThrow(/wait ms must be a number between 50 and 10000/)
  })

  it('rejects scenes with no shot steps', () => {
    const noShotsPlan = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'No shots',
      scenes: [
        {
          id: 's1',
          title: 'S1',
          target: 'taco',
          steps: [{ do: 'wait', ms: 500 }],
        },
      ],
    }
    expect(() => validatePreviewPlan(noShotsPlan)).toThrow(/must contain at least 1 "shot" step/)
  })

  it('enforces maximum scene count and step count budget', () => {
    expect(MAX_SCENES).toBe(3)
    expect(MAX_STEPS_PER_SCENE).toBe(12)
    const tooManyScenes = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'Too many',
      scenes: [
        { id: 's1', title: '1', target: 'taco', steps: [{ do: 'shot', name: 's1' }] },
        { id: 's2', title: '2', target: 'taco', steps: [{ do: 'shot', name: 's2' }] },
        { id: 's3', title: '3', target: 'taco', steps: [{ do: 'shot', name: 's3' }] },
        { id: 's4', title: '4', target: 'taco', steps: [{ do: 'shot', name: 's4' }] },
      ],
    }
    expect(() => validatePreviewPlan(tooManyScenes)).toThrow(/exceeds maximum/)
  })

  it('validates plan with shot before click for failure state reproduction', () => {
    const plan = {
      version: 1,
      source: 'deepseek-planner',
      ui_change: true,
      summary: 'Failure test plan',
      scenes: [
        {
          id: 'scene-fail',
          title: 'Scene with Expected Failure',
          target: 'taco',
          steps: [
            { do: 'open-file', path: 'spec.md' },
            { do: 'shot', name: 'before-click', caption: 'Document rendered' },
            { do: 'click', target: 'non-existent-button' },
          ],
        },
      ],
    }
    const validated = validatePreviewPlan(plan)
    expect(validated.scenes[0].steps).toHaveLength(3)
  })

  describe('Planner Provider Configuration', () => {
    it('defaults to DeepSeek settings when no env vars are provided', () => {
      const config = resolvePlannerConfig({})
      expect(config.apiKey).toBe('')
      expect(config.baseUrl).toBe('https://api.deepseek.com/v1')
      expect(config.model).toBe('deepseek-chat')
    })

    it('uses PREVIEW_* variables when configured', () => {
      const config = resolvePlannerConfig({
        PREVIEW_API_KEY: 'preview-key',
        PREVIEW_API_BASE_URL: 'https://api.commandcode.ai/provider/v1/',
        PREVIEW_MODEL: 'deepseek/deepseek-v4.1-flash',
      })
      expect(config.apiKey).toBe('preview-key')
      expect(config.baseUrl).toBe('https://api.commandcode.ai/provider/v1')
      expect(config.model).toBe('deepseek/deepseek-v4.1-flash')
    })

    it('falls back to legacy DEEPSEEK_API_KEY and PLAN_MODEL', () => {
      const config = resolvePlannerConfig({
        DEEPSEEK_API_KEY: 'legacy-key',
        PLAN_MODEL: 'deepseek-coder',
      })
      expect(config.apiKey).toBe('legacy-key')
      expect(config.baseUrl).toBe('https://api.deepseek.com/v1')
      expect(config.model).toBe('deepseek-coder')
    })

    it('dispatches requestPlannerPlan to the configured endpoint and model', async () => {
      let capturedUrl = ''
      let capturedOptions: RequestInit | undefined

      const fakeFetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
        capturedUrl = String(url)
        capturedOptions = options
        return {
          ok: true,
          text: async () => '',
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    version: 1,
                    source: 'deepseek-planner',
                    ui_change: true,
                    summary: 'Test plan',
                    scenes: [],
                  }),
                },
              },
            ],
          }),
        }
      })

      vi.stubGlobal('fetch', fakeFetch)

      try {
        const res = await requestPlannerPlan([{ role: 'user', content: 'hello' }], {
          apiKey: 'test-secret',
          baseUrl: 'https://api.commandcode.ai/provider/v1',
          model: 'deepseek/deepseek-v4.1-flash',
        })

        expect(capturedUrl).toBe('https://api.commandcode.ai/provider/v1/chat/completions')
        const headers = capturedOptions?.headers as Record<string, string> | undefined
        expect(headers?.Authorization).toBe('Bearer test-secret')
        const body = JSON.parse(String(capturedOptions?.body))
        expect(body.model).toBe('deepseek/deepseek-v4.1-flash')
        expect(body.response_format).toEqual({ type: 'json_object' })
        expect(res.summary).toBe('Test plan')
        vi.unstubAllGlobals()
      }
    })
  })
})
