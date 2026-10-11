/**
 * view-registry.mjs
 *
 * Fixed, trusted view definitions for the Taco UI preview pipeline.
 *
 * The capture job renders exactly these views and every later stage (sanitizer,
 * validator, publisher) rejects anything outside this set, so a pull request can
 * never introduce a URL, selector, viewport, or output filename of its own.
 */

export const FIXED_VIEWS = Object.freeze([
  Object.freeze({
    id: 'taco-desktop',
    filename: 'taco-desktop.png',
    title: 'Complete Taco Desktop',
    target: 'taco',
    viewport: Object.freeze({ width: 1280, height: 800 }),
  }),
  Object.freeze({
    id: 'host-desktop',
    filename: 'host-desktop.png',
    title: 'Host Demo Desktop',
    target: 'host',
    viewport: Object.freeze({ width: 1280, height: 800 }),
  }),
])

export function getViewByFilename(filename) {
  return FIXED_VIEWS.find((view) => view.filename === filename) ?? null
}

/**
 * Single source of truth for where a captured view lands on the assets branch.
 * The publisher writes this path and the PR body links to it, so both must agree.
 */
export function previewAssetPath(view, prNumber, headSha) {
  return `previews/pr-${prNumber}/${view.id}-${headSha}.png`
}

/**
 * Dynamic preview asset path generator for arbitrary planned scenes/shots.
 */
export function dynamicPreviewAssetPath(prNumber, headSha, filename) {
  const baseName = filename.replace(/\.png$/, '')
  return `previews/pr-${prNumber}/${baseName}-${headSha}.png`
}
