import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('application shell accessibility', () => {
  it('provides a skip link to the runtime main landmark', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

    expect(html).toContain('class="taco-skip-link"')
    expect(html).toContain('href="#taco-main"')
  })
})
