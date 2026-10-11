/**
 * plan-schema.mjs
 *
 * Runtime validation and guards for plan-schema.
 * Enforces boundary discipline: all untrusted plans, steps, and scenes are validated
 * before execution.
 */

export const DESKTOP_VIEWPORT = Object.freeze({ width: 1280, height: 800 })

export const MAX_SCENES = 3
export const MAX_STEPS_PER_SCENE = 12
export const MAX_SCENE_ID_LENGTH = 48
export const MAX_SHOT_NAME_LENGTH = 64
export const MAX_GENERATED_FILENAME_LENGTH = 128
export const VALID_SHOT_NAME = /^[a-z0-9][a-z0-9_-]*$/
export const RESERVED_SHOT_NAMES = new Set(['failure', 'failure-state'])
export const FORBIDDEN_TEXT_OR_TARGET =
  /退出|quit|删除|delete|remove|移除|更新到|update to|restart|重启|sign out|登出|卸载|uninstall/i

export class PlanValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PlanValidationError'
  }
}

/**
 * Validates a plan object against the strict budget and rules.
 *
 * @param {unknown} plan
 * @returns {import('./plan-schema.d.mts').PreviewPlan}
 */
export function validatePreviewPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new PlanValidationError('Plan must be a non-null object')
  }

  const p = /** @type {Record<string, any>} */ (plan)
  if (p.version !== 1) {
    throw new PlanValidationError(`Unsupported plan version: ${p.version}`)
  }
  if (p.source !== 'deepseek-planner' && p.source !== 'human-fixture') {
    throw new PlanValidationError(`Invalid plan source: ${p.source}`)
  }
  if (typeof p.ui_change !== 'boolean') {
    throw new PlanValidationError('Plan must contain boolean ui_change')
  }
  if (typeof p.summary !== 'string' || !p.summary.trim()) {
    throw new PlanValidationError('Plan must contain non-empty summary')
  }
  if (!Array.isArray(p.scenes)) {
    throw new PlanValidationError('Plan scenes must be an array')
  }
  if (!p.ui_change) {
    // Canonical rule: when ui_change is false, scenes must be empty
    if (p.scenes.length > 0) {
      throw new PlanValidationError('Plan with ui_change=false must have scenes=[]')
    }
  } else if (p.scenes.length === 0) {
    throw new PlanValidationError('Plan with ui_change=true must have at least 1 scene')
  }
  if (p.scenes.length > MAX_SCENES) {
    throw new PlanValidationError(
      `Plan scenes length ${p.scenes.length} exceeds maximum ${MAX_SCENES}`,
    )
  }

  const seenSceneIds = new Set()
  const seenFilenames = new Set()
  const reservedFailureFilenames = new Set()

  // First pass: collect and validate all scene IDs and reserve failure filenames globally
  for (let sceneIdx = 0; sceneIdx < p.scenes.length; sceneIdx += 1) {
    const scene = p.scenes[sceneIdx]
    if (!scene || typeof scene !== 'object') {
      throw new PlanValidationError(`Scene [${sceneIdx}] must be an object`)
    }
    if (typeof scene.id !== 'string' || !VALID_SHOT_NAME.test(scene.id)) {
      throw new PlanValidationError(`Scene [${sceneIdx}] invalid id: ${scene.id}`)
    }
    if (scene.id.length > MAX_SCENE_ID_LENGTH) {
      throw new PlanValidationError(
        `Scene [${sceneIdx}] id "${scene.id}" exceeds maximum length ${MAX_SCENE_ID_LENGTH}`,
      )
    }
    if (seenSceneIds.has(scene.id)) {
      throw new PlanValidationError(`Duplicate scene id: ${scene.id}`)
    }
    seenSceneIds.add(scene.id)

    const failFilename = `${scene.id}-failure.png`
    if (failFilename.length > MAX_GENERATED_FILENAME_LENGTH) {
      throw new PlanValidationError(
        `Scene [${scene.id}] reserved failure filename "${failFilename}" exceeds maximum length ${MAX_GENERATED_FILENAME_LENGTH}`,
      )
    }
    reservedFailureFilenames.add(failFilename)
  }
  for (let sceneIdx = 0; sceneIdx < p.scenes.length; sceneIdx += 1) {
    const scene = p.scenes[sceneIdx]
    if (scene.target !== 'taco' && scene.target !== 'host') {
      throw new PlanValidationError(`Scene [${scene.id}] invalid target: ${scene.target}`)
    }
    if (!Array.isArray(scene.steps)) {
      throw new PlanValidationError(`Scene [${scene.id}] steps must be an array`)
    }
    if (scene.steps.length > MAX_STEPS_PER_SCENE) {
      throw new PlanValidationError(
        `Scene [${scene.id}] has ${scene.steps.length} steps, exceeding maximum ${MAX_STEPS_PER_SCENE}`,
      )
    }

    let sceneShotsCount = 0
    for (let stepIdx = 0; stepIdx < scene.steps.length; stepIdx += 1) {
      const step = scene.steps[stepIdx]
      if (!step || typeof step !== 'object') {
        throw new PlanValidationError(`Scene [${scene.id}] step [${stepIdx}] must be an object`)
      }
      const validActions = ['click', 'hover', 'shot', 'wait', 'scroll', 'open-file']
      if (!validActions.includes(step.do)) {
        throw new PlanValidationError(
          `Scene [${scene.id}] step [${stepIdx}] invalid action: ${step.do}`,
        )
      }
      if (step.do === 'click' || step.do === 'hover') {
        if (typeof step.target !== 'string' || !step.target.trim()) {
          throw new PlanValidationError(
            `Scene [${scene.id}] step [${stepIdx}] action "${step.do}" requires non-empty target selector`,
          )
        }
      }
      if (step.do === 'scroll') {
        if (typeof step.to !== 'string' || !step.to.trim()) {
          throw new PlanValidationError(
            `Scene [${scene.id}] step [${stepIdx}] action "scroll" requires non-empty "to" selector`,
          )
        }
      }
      if (step.do === 'open-file') {
        if (typeof step.path !== 'string' || !step.path.trim()) {
          throw new PlanValidationError(
            `Scene [${scene.id}] step [${stepIdx}] action "open-file" requires non-empty "path"`,
          )
        }
      }
      if (step.do === 'wait') {
        if (step.ms !== undefined) {
          if (
            typeof step.ms !== 'number' ||
            !Number.isFinite(step.ms) ||
            step.ms < 50 ||
            step.ms > 10000
          ) {
            throw new PlanValidationError(
              `Scene [${scene.id}] step [${stepIdx}] wait ms must be a number between 50 and 10000`,
            )
          }
        }
      }
      if (step.target && FORBIDDEN_TEXT_OR_TARGET.test(step.target)) {
        throw new PlanValidationError(
          `Scene [${scene.id}] step [${stepIdx}] target contains forbidden words: ${step.target}`,
        )
      }
      if (step.text && FORBIDDEN_TEXT_OR_TARGET.test(step.text)) {
        throw new PlanValidationError(
          `Scene [${scene.id}] step [${stepIdx}] text contains forbidden words: ${step.text}`,
        )
      }
      if (step.do === 'shot') {
        sceneShotsCount += 1
        if (!step.name || !VALID_SHOT_NAME.test(step.name)) {
          throw new PlanValidationError(`Scene [${scene.id}] shot invalid name: ${step.name}`)
        }
        if (RESERVED_SHOT_NAMES.has(step.name)) {
          throw new PlanValidationError(
            `Scene [${scene.id}] shot name "${step.name}" is reserved for execution failure artifacts`,
          )
        }
        if (step.name.length > MAX_SHOT_NAME_LENGTH) {
          throw new PlanValidationError(
            `Scene [${scene.id}] shot name "${step.name}" exceeds length ${MAX_SHOT_NAME_LENGTH}`,
          )
        }
        const filename = `${scene.id}-${step.name}.png`
        if (filename.length > MAX_GENERATED_FILENAME_LENGTH) {
          throw new PlanValidationError(
            `Scene [${scene.id}] generated filename "${filename}" exceeds maximum length ${MAX_GENERATED_FILENAME_LENGTH}`,
          )
        }
        // Also ensure the reserved failure filename for this scene does not exceed file length bounds
        const reservedFailName = `${scene.id}-failure.png`
        if (reservedFailName.length > MAX_GENERATED_FILENAME_LENGTH) {
          throw new PlanValidationError(
            `Scene [${scene.id}] reserved failure filename "${reservedFailName}" exceeds maximum length ${MAX_GENERATED_FILENAME_LENGTH}`,
          )
        }
        if (reservedFailureFilenames.has(filename)) {
          throw new PlanValidationError(
            `Shot filename "${filename}" collides with a reserved failure screenshot filename`,
          )
        }
        if (seenFilenames.has(filename)) {
          throw new PlanValidationError(`Duplicate shot filename generated: ${filename}`)
        }
        seenFilenames.add(filename)
      }
    }
    if (sceneShotsCount === 0) {
      throw new PlanValidationError(
        `Scene [${scene.id}] must contain at least 1 "shot" step to produce screenshots`,
      )
    }
  }

  return /** @type {import('./plan-schema.d.mts').PreviewPlan} */ (p)
}
