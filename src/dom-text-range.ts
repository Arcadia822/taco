/**
 * Convert a DOM boundary point into an offset in the root's concatenated text.
 * The caller is responsible for passing a node contained by root.
 */
export function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}

/** Convert offsets in root.textContent into a DOM Range spanning its text nodes. */
export function domRange(root: HTMLElement, start: number, end: number): Range | null {
  if (start < 0 || end < start) return null
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  let position = 0
  let startNode: Text | null = null
  let endNode: Text | null = null
  let startOffset = 0
  let endOffset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const next = position + node.data.length
    if (!startNode && start >= position && start <= next) {
      startNode = node
      startOffset = start - position
    }
    if (end >= position && end <= next) {
      endNode = node
      endOffset = end - position
      break
    }
    position = next
  }
  if (!startNode || !endNode) return null
  const range = root.ownerDocument.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}
