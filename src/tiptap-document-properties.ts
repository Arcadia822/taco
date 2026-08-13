import { mergeAttributes, Node, type Editor, type MarkdownToken } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { parseDocument, stringify } from 'yaml'
import {
  deleteFrontmatterProperty,
  parseFrontmatterYaml,
  renameFrontmatterProperty,
  setFrontmatterProperty,
  splitFrontmatter,
  type FrontmatterEntry,
} from './frontmatter.ts'

type DocumentPropertiesToken = MarkdownToken & {
  type: 'documentProperties'
  raw: string
  yaml: string
  bom: boolean
  closed: boolean
  eol: '\n' | '\r\n'
}

export interface DocumentPropertiesLabels {
  properties: string
  addProperty: string
  propertyKey: string
  propertyValue: (key: string) => string
  removeProperty: (key: string) => string
  invalidYaml: string
  invalidScope: string
  invalidTitle: string
  duplicateSource: (keys: string[]) => string
  rawValue: string
  addListItem: (key: string) => string
}

const englishLabels: DocumentPropertiesLabels = {
  properties: 'Properties',
  addProperty: 'Add property',
  propertyKey: 'Property name',
  propertyValue: (key) => `${key} value`,
  removeProperty: (key) => `Remove ${key}`,
  invalidYaml: 'Fix the YAML source to edit these properties.',
  invalidScope: 'Choose spec, plan, or tasks. Other values are preserved but do not route this file.',
  invalidTitle: 'The document title must be text. This value is preserved but is not used as the display title.',
  duplicateSource: (keys) => `YAML and legacy metadata both define ${keys.join(', ')}. YAML controls Taco behavior; legacy text is preserved.`,
  rawValue: 'Edit YAML value',
  addListItem: (key) => `Add item to ${key}`,
}

const chineseLabels: DocumentPropertiesLabels = {
  properties: '文档属性',
  addProperty: '添加文档属性',
  propertyKey: '属性名称',
  propertyValue: (key) => `${key} 的值`,
  removeProperty: (key) => `删除 ${key}`,
  invalidYaml: '请修正 YAML 源码后再编辑这些属性。',
  invalidScope: '请选择 spec、plan 或 tasks。其他值会被保留，但不会用于文件路由。',
  invalidTitle: '文档标题必须是文本。当前值会被保留，但不会作为显示标题使用。',
  duplicateSource: (keys) => `YAML 与旧式元数据同时定义了 ${keys.join('、')}。Taco 以 YAML 为准，并保留旧式文本。`,
  rawValue: '编辑 YAML 值',
  addListItem: (key) => `向 ${key} 添加一项`,
}

const defaultLabels = (): DocumentPropertiesLabels =>
  document.documentElement.lang.toLocaleLowerCase().startsWith('zh') ? chineseLabels : englishLabels

const tacoScopes = new Set(['spec', 'plan', 'tasks'])
const reservedProperties = new Set(['title', 'taco_scope'])
let dataListSerial = 0

const leadingLegacyPropertyKeys = (markdown: string): Set<string> => {
  const body = splitFrontmatter(markdown)?.body ?? markdown
  const keys = new Set<string>()
  let foundProperty = false
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) {
      if (foundProperty) break
      continue
    }
    const match = line.match(/^\s*\*\*([^*]+)\*\*\s*:\s*/)
    if (!match) break
    foundProperty = true
    keys.add(match[1].trim().toLocaleLowerCase().replace(/[\s-]+/g, '_'))
  }
  return keys
}

const encodeYamlAttribute = (value: unknown): string => encodeURIComponent(String(value ?? ''))
const decodeYamlAttribute = (value: string | undefined): string => {
  try { return decodeURIComponent(value ?? '') }
  catch { return value ?? '' }
}

const scalarText = (value: unknown): string => value === null ? '' : String(value)

const stopEditorMouseDown = (element: HTMLElement): void => {
  element.addEventListener('mousedown', (event) => event.stopPropagation())
}

const icon = (path: string): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('document-property-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = path
  return svg
}

const propertyIcon = () => icon('<path d="M4 7h16M4 12h16M4 17h10"/>')
const removeIcon = () => icon('<path d="M18 6 6 18M6 6l12 12"/>')
const invalidIcon = () => icon('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.6 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/>')

const frontmatterAttributes = (attributes: Record<string, unknown>): Record<string, string> => ({
  'data-type': 'document-properties',
  'data-yaml': encodeYamlAttribute(attributes.yaml),
  'data-bom': attributes.bom ? 'true' : 'false',
  'data-closed': attributes.closed === false ? 'false' : 'true',
  'data-eol': attributes.eol === '\r\n' ? 'crlf' : 'lf',
})

export const createDocumentProperties = (providedLabels?: DocumentPropertiesLabels) => Node.create({
  name: 'documentProperties',
  group: 'block',
  atom: true,
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      yaml: { default: '' },
      bom: { default: false },
      closed: { default: true },
      eol: { default: '\n' },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="document-properties"]',
      getAttrs: (element) => {
        const html = element as HTMLElement
        return {
          yaml: decodeYamlAttribute(html.dataset.yaml),
          bom: html.dataset.bom === 'true',
          closed: html.dataset.closed !== 'false',
          eol: html.dataset.eol === 'crlf' ? '\r\n' : '\n',
        }
      },
    }]
  },

  renderHTML({ HTMLAttributes }) {
    const { yaml: _yaml, bom: _bom, closed: _closed, eol: _eol, ...publicAttributes } = HTMLAttributes
    return ['div', mergeAttributes(publicAttributes, {
      class: 'document-properties',
      ...frontmatterAttributes(HTMLAttributes),
    })]
  },

  markdownTokenName: 'documentProperties',

  parseMarkdown(token, helpers) {
    const properties = token as DocumentPropertiesToken
    return helpers.createNode('documentProperties', {
      yaml: properties.yaml,
      bom: properties.bom,
      closed: properties.closed,
      eol: properties.eol,
    })
  },

  renderMarkdown(node) {
    const yaml = String(node.attrs?.yaml ?? '')
    const eol = node.attrs?.eol === '\r\n' ? '\r\n' : '\n'
    const normalizedYaml = yaml.replace(/\r?\n/g, eol)
    const bom = node.attrs?.bom ? '\uFEFF' : ''
    if (node.attrs?.closed === false) return `${bom}---${eol}${normalizedYaml}`
    return `${bom}---${eol}${normalizedYaml}${normalizedYaml ? eol : ''}---`
  },

  markdownTokenizer: {
    name: 'documentProperties',
    level: 'block',
    start: (source) => splitFrontmatter(source) ? 0 : -1,
    tokenize(source, tokens) {
      if (tokens.length > 0) return undefined
      const block = splitFrontmatter(source)
      if (!block) return undefined
      return {
        type: 'documentProperties',
        raw: block.closed ? block.raw : source,
        yaml: block.yaml,
        bom: block.bom,
        closed: block.closed,
        eol: block.eol,
      } as DocumentPropertiesToken
    },
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const labels = providedLabels ?? defaultLabels()
      let currentNode = node
      let selfUpdating = false

      const dom = document.createElement('section')
      dom.className = 'document-properties'
      dom.contentEditable = 'false'
      dom.setAttribute('aria-label', labels.properties)
      stopEditorMouseDown(dom)

      const updateYaml = (yaml: string, repaint = false): void => {
        const position = getPos()
        if (typeof position !== 'number') return
        selfUpdating = true
        const transaction = yaml.trim()
          ? editor.state.tr.setNodeMarkup(position, undefined, {
              ...currentNode.attrs,
              yaml,
              closed: true,
            })
          : editor.state.tr.delete(position, position + currentNode.nodeSize)
        editor.view.dispatch(transaction)
        selfUpdating = false
        if (repaint && yaml.trim()) paint()
      }

      const mutate = (mutation: () => string, repaint = true): void => {
        try { updateYaml(mutation(), repaint) }
        catch (error) {
          dom.dataset.propertyError = error instanceof Error ? error.message : String(error)
        }
      }

      const inputForScalar = (entry: FrontmatterEntry): HTMLElement => {
        if (entry.kind === 'boolean') {
          const select = document.createElement('select')
          select.className = 'document-property-input document-property-select'
          select.name = entry.key
          select.setAttribute('aria-label', labels.propertyValue(entry.key))
          for (const value of ['true', 'false']) {
            const option = document.createElement('option')
            option.value = value
            option.textContent = value
            option.selected = String(entry.value) === value
            select.append(option)
          }
          select.disabled = !editor.isEditable
          select.addEventListener('change', () => mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, select.value === 'true'), false))
          return select
        }

        if (entry.kind === 'complex') {
          const textarea = document.createElement('textarea')
          textarea.className = 'document-property-input document-property-raw'
          textarea.name = entry.key
          textarea.rows = 2
          textarea.value = stringify(entry.value).trimEnd()
          textarea.readOnly = !editor.isEditable
          textarea.setAttribute('aria-label', `${labels.rawValue}: ${entry.key}`)
          textarea.setAttribute('autocomplete', 'off')
          textarea.addEventListener('change', () => {
            const document = parseDocument(textarea.value, { strict: true, uniqueKeys: true })
            if (document.errors.length) {
              textarea.setAttribute('aria-invalid', 'true')
              textarea.title = document.errors[0].message
              return
            }
            textarea.removeAttribute('aria-invalid')
            textarea.removeAttribute('title')
            mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, document.toJS()), false)
          })
          return textarea
        }

        const input = document.createElement('input')
        input.className = 'document-property-input'
        input.name = entry.key
        input.type = entry.kind === 'number' ? 'number' : 'text'
        input.value = scalarText(entry.value)
        input.readOnly = !editor.isEditable
        input.setAttribute('aria-label', labels.propertyValue(entry.key))
        input.setAttribute('autocomplete', 'off')
        if (entry.kind === 'number') input.inputMode = 'decimal'

        if (entry.key === 'taco_scope') {
          const dataList = document.createElement('datalist')
          dataList.id = `taco-scope-values-${++dataListSerial}`
          for (const value of tacoScopes) {
            const option = document.createElement('option')
            option.value = value
            dataList.append(option)
          }
          input.setAttribute('list', dataList.id)
          input.addEventListener('change', () => {
            mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, input.value), true)
          })
          const container = document.createElement('div')
          container.className = 'document-property-combobox'
          container.append(input, dataList)
          return container
        }

        const commit = (): void => {
          const value = entry.kind === 'number' ? Number(input.value) : entry.kind === 'null' && !input.value ? null : input.value
          mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, value), false)
        }
        input.addEventListener(entry.key === 'title' ? 'input' : 'change', commit)
        return input
      }

      const listEditor = (entry: FrontmatterEntry): HTMLElement => {
        const values = Array.isArray(entry.value) ? entry.value : []
        const list = document.createElement('div')
        list.className = 'document-property-list'
        values.forEach((value, index) => {
          const chip = document.createElement('span')
          chip.className = 'document-property-chip'
          const text = document.createElement('input')
          text.className = 'document-property-chip-input'
          text.name = `${entry.key}-${index}`
          text.value = scalarText(value)
          text.readOnly = !editor.isEditable
          text.setAttribute('aria-label', `${labels.propertyValue(entry.key)} ${index + 1}`)
          text.setAttribute('autocomplete', 'off')
          text.size = Math.max(1, Math.min(24, text.value.length || 1))
          text.addEventListener('change', () => {
            const next = [...values]
            next[index] = text.value
            mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, next))
          })
          text.addEventListener('keydown', (event) => {
            if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
            const target = event.key === 'ArrowLeft' ? index - 1 : index + 1
            if (target < 0 || target >= values.length) return
            event.preventDefault()
            const next = [...values]
            ;[next[index], next[target]] = [next[target], next[index]]
            mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, next))
          })
          chip.append(text)
          if (editor.isEditable) {
            const remove = document.createElement('button')
            remove.type = 'button'
            remove.className = 'document-property-chip-remove'
            remove.setAttribute('aria-label', `Remove ${scalarText(value)} from ${entry.key}`)
            remove.append(removeIcon())
            remove.addEventListener('click', () => mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, values.filter((_, candidate) => candidate !== index))))
            chip.append(remove)
          }
          list.append(chip)
        })
        if (editor.isEditable) {
          const add = document.createElement('input')
          add.className = 'document-property-list-add'
          add.name = `${entry.key}-item`
          add.placeholder = 'Add…'
          add.setAttribute('aria-label', labels.addListItem(entry.key))
          add.setAttribute('autocomplete', 'off')
          add.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || !add.value.trim()) return
            event.preventDefault()
            mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, [...values, add.value.trim()]))
          })
          list.append(add)
        }
        return list
      }

      const rowFor = (entry: FrontmatterEntry): HTMLElement => {
        const invalidScope = entry.key === 'taco_scope' && (typeof entry.value !== 'string' || !tacoScopes.has(entry.value))
        const invalidTitle = entry.key === 'title' && entry.kind !== 'string'
        const invalid = invalidScope || invalidTitle
        const row = document.createElement('div')
        row.className = 'document-property'
        row.classList.toggle('is-invalid', invalid)

        const leading = document.createElement('span')
        leading.className = 'document-property-leading'
        leading.append(invalid ? invalidIcon() : propertyIcon())

        const key = document.createElement('input')
        key.className = 'document-property-key'
        key.name = `${entry.key}-key`
        key.value = entry.key
        key.readOnly = !editor.isEditable
        key.spellcheck = false
        key.setAttribute('aria-label', labels.propertyKey)
        key.setAttribute('autocomplete', 'off')
        key.addEventListener('change', () => {
          const nextKey = key.value.trim()
          if (!nextKey || nextKey === entry.key) { key.value = entry.key; return }
          mutate(() => renameFrontmatterProperty(String(currentNode.attrs.yaml), entry.key, nextKey))
        })

        const value = document.createElement('div')
        value.className = 'document-property-value'
        value.append(entry.kind === 'list' ? listEditor(entry) : inputForScalar(entry))

        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'document-property-remove'
        remove.hidden = !editor.isEditable
        remove.setAttribute('aria-label', labels.removeProperty(entry.key))
        remove.title = labels.removeProperty(entry.key)
        remove.append(removeIcon())
        remove.addEventListener('click', () => mutate(() => deleteFrontmatterProperty(String(currentNode.attrs.yaml), entry.key)))

        row.append(leading, key, value, remove)
        if (invalid) {
          const error = document.createElement('p')
          error.className = 'document-property-error'
          error.id = `document-property-error-${dataListSerial}-${entry.key}`
          error.textContent = invalidScope ? labels.invalidScope : labels.invalidTitle
          error.setAttribute('aria-live', 'polite')
          row.append(error)
          const control = value.querySelector('input')
          control?.setAttribute('aria-invalid', 'true')
          control?.setAttribute('aria-describedby', error.id)
        }
        return row
      }

      const paint = (): void => {
        dom.replaceChildren()
        dom.removeAttribute('data-property-error')
        const header = document.createElement('div')
        header.className = 'document-properties-header'
        const title = document.createElement('span')
        title.className = 'document-properties-title'
        title.textContent = labels.properties
        header.append(title)
        dom.append(header)

        const parsed = parseFrontmatterYaml(String(currentNode.attrs.yaml ?? ''))
        const missingClosingDelimiter = currentNode.attrs.closed === false
        if (parsed.kind === 'invalid' || missingClosingDelimiter) {
          dom.classList.add('has-invalid-yaml')
          const raw = document.createElement('textarea')
          raw.className = 'document-properties-invalid-source'
          raw.value = String(currentNode.attrs.yaml ?? '')
          raw.readOnly = !editor.isEditable
          raw.spellcheck = false
          raw.setAttribute('aria-label', labels.rawValue)
          raw.setAttribute('aria-invalid', 'true')
          raw.setAttribute('autocomplete', 'off')
          const error = document.createElement('p')
          error.className = 'document-properties-invalid-message'
          const message = missingClosingDelimiter
            ? 'Frontmatter is missing a closing --- delimiter.'
            : parsed.kind === 'invalid' ? parsed.message : ''
          error.textContent = `${labels.invalidYaml} ${message}`
          error.setAttribute('aria-live', 'polite')
          raw.addEventListener('input', () => {
            updateYaml(raw.value, false)
            const next = parseFrontmatterYaml(raw.value)
            error.textContent = next.kind === 'invalid' ? `${labels.invalidYaml} ${next.message}` : ''
            raw.setAttribute('aria-invalid', String(next.kind === 'invalid'))
          })
          dom.append(raw, error)
          return
        }

        dom.classList.remove('has-invalid-yaml')
        const yamlKeys = new Set(parsed.entries.map((entry) => entry.key))
        const legacyKeys = leadingLegacyPropertyKeys(editor.getMarkdown())
        const duplicateKeys = [...reservedProperties].filter((key) => yamlKeys.has(key) && legacyKeys.has(key))
        if (duplicateKeys.length) {
          const warning = document.createElement('p')
          warning.className = 'document-properties-duplicate-warning'
          warning.textContent = labels.duplicateSource(duplicateKeys)
          warning.setAttribute('role', 'status')
          dom.append(warning)
        }
        const rows = document.createElement('div')
        rows.className = 'document-properties-rows'
        for (const entry of parsed.entries) rows.append(rowFor(entry))
        dom.append(rows)

        if (editor.isEditable) {
          const add = document.createElement('button')
          add.type = 'button'
          add.className = 'document-properties-add'
          add.textContent = `+ ${labels.addProperty}`
          add.addEventListener('click', () => {
            const used = new Set(parsed.entries.map((entry) => entry.key))
            let key = 'property'
            let suffix = 2
            while (used.has(key)) key = `property_${suffix++}`
            mutate(() => setFrontmatterProperty(String(currentNode.attrs.yaml), key, ''), true)
            requestAnimationFrame(() => {
              const inputs = dom.querySelectorAll<HTMLInputElement>('.document-property-key')
              const input = inputs.item(inputs.length - 1)
              input?.focus()
              input?.select()
            })
          })
          dom.append(add)
        }
      }

      paint()
      return {
        dom,
        update(nextNode) {
          if (nextNode.type.name !== currentNode.type.name) return false
          currentNode = nextNode
          if (!selfUpdating) paint()
          return true
        },
        ignoreMutation: () => true,
        stopEvent: (event) => dom.contains(event.target as globalThis.Node),
      }
    }
  },
})

export const setEditorFrontmatterProperty = (editor: Editor, key: string, value: unknown | undefined): boolean => {
  const found: { node?: ProseMirrorNode; position?: number } = {}
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'documentProperties') return true
    found.node = node
    found.position = position
    return false
  })

  if (!found.node || found.position === undefined) {
    if (value === undefined) return true
    const type = editor.schema.nodes.documentProperties
    if (!type) return false
    const yaml = setFrontmatterProperty('', key, value)
    editor.view.dispatch(editor.state.tr.insert(0, type.create({ yaml, bom: false, closed: true, eol: '\n' })))
    return true
  }

  try {
    const yaml = value === undefined
      ? deleteFrontmatterProperty(String(found.node.attrs.yaml ?? ''), key)
      : setFrontmatterProperty(String(found.node.attrs.yaml ?? ''), key, value)
    const transaction = yaml.trim()
      ? editor.state.tr.setNodeMarkup(found.position, undefined, { ...found.node.attrs, yaml, closed: true })
      : editor.state.tr.delete(found.position, found.position + found.node.nodeSize)
    editor.view.dispatch(transaction)
    return true
  } catch {
    return false
  }
}
