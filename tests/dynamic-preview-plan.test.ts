// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  validatePreviewPlan,
  PlanValidationError,
  MAX_SCENES,
  MAX_STEPS_PER_SCENE,
} from '../.github/workflows/scripts/plan-schema.mjs'

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
          steps: [{ do: 'click', target: 'button#delete-all' }],
        },
      ],
    }
    expect(() => validatePreviewPlan(dangerousPlan)).toThrow(PlanValidationError)
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
        { id: 's1', title: '1', target: 'taco', steps: [] },
        { id: 's2', title: '2', target: 'taco', steps: [] },
        { id: 's3', title: '3', target: 'taco', steps: [] },
        { id: 's4', title: '4', target: 'taco', steps: [] },
      ],
    }
    expect(() => validatePreviewPlan(tooManyScenes)).toThrow(/exceeds maximum/)
  })
})
