import { parseAllDocuments, type Document } from 'yaml'
import { createMermaidPreview, type MermaidPluginLabels, type MermaidRuntime } from './mermaid.ts'
import { createSegmentedControl } from './segmented-control.ts'
import { createSourceEditor, type SourceEditorController } from './source-editor.ts'
import { fileName, type TacoFile } from './model.ts'
import { el, svgIcon } from './ui-primitives.ts'
import type { Locale } from './i18n.ts'

type StructuredMode = 'overview' | 'preview' | 'source'
type SourceKind = 'yaml' | 'json' | 'mermaid'

interface StructuredFileLabels {
  viewMode: string
  overview: string
  preview: string
  source: string
  parseError: string
  openapiUnavailable: string
  mermaidUnavailable: string
  yamlWarnings: string
  empty: string
  name: string
  location: string
  status: string
  contentTypes: string
  title: string
  version: string
  metadata: string
  servers: string
  tags: string
  operations: string
  parameters: string
  requestBody: string
  responses: string
  schemas: string
  security: string
  required: string
  description: string
  type: string
  properties: string
  enum: string
}

const english: StructuredFileLabels = {
  viewMode: 'File view', overview: 'Overview', preview: 'Preview', source: 'Source',
  parseError: 'Source could not be parsed.', openapiUnavailable: 'OpenAPI overview is unavailable.',
  mermaidUnavailable: 'Mermaid preview is unavailable. Source remains editable.', yamlWarnings: 'YAML parser warning',
  empty: 'No values to display.', name: 'Name', location: 'Location', status: 'Status', contentTypes: 'Content type',
  title: 'Title', version: 'Version', metadata: 'Metadata', servers: 'Servers', tags: 'Tags',
  operations: 'Operations', parameters: 'Parameters', requestBody: 'Request body', responses: 'Responses',
  schemas: 'Schemas', security: 'Security', required: 'Required', description: 'Description', type: 'Type',
  properties: 'Properties', enum: 'Allowed values',
}

const labelOverrides: Record<Locale, Partial<StructuredFileLabels>> = {
  en: {},
  'zh-Hans': {
    viewMode: '文件视图', overview: '概览', preview: '预览', source: '源码',
    parseError: '无法解析源码。', openapiUnavailable: 'OpenAPI 概览不可用。',
    mermaidUnavailable: 'Mermaid 预览不可用，源码仍可编辑。', yamlWarnings: 'YAML 解析警告',
    empty: '没有可显示的内容。', name: '名称', location: '位置', status: '状态码', contentTypes: '内容类型', title: '标题', version: '版本', metadata: '元数据', servers: '服务器', tags: '标签',
    operations: '操作', parameters: '参数', requestBody: '请求体', responses: '响应', schemas: '模式',
    security: '安全声明', required: '必填', description: '描述', type: '类型', properties: '属性', enum: '允许值',
  },
  'zh-Hant': {
    viewMode: '檔案檢視', overview: '概覽', preview: '預覽', source: '原始碼',
    parseError: '無法解析原始碼。', openapiUnavailable: 'OpenAPI 概覽無法使用。',
    mermaidUnavailable: 'Mermaid 預覽無法使用，原始碼仍可編輯。', yamlWarnings: 'YAML 解析警告',
    empty: '沒有可顯示的內容。', name: '名稱', location: '位置', status: '狀態碼', contentTypes: '內容類型', title: '標題', version: '版本', metadata: '中繼資料', servers: '伺服器', tags: '標籤',
    operations: '操作', parameters: '參數', requestBody: '請求內容', responses: '回應', schemas: '結構描述',
    security: '安全宣告', required: '必填', description: '說明', type: '類型', properties: '屬性', enum: '允許值',
  },
  ja: {
    viewMode: 'ファイル表示', overview: '概要', preview: 'プレビュー', source: 'ソース',
    parseError: 'ソースを解析できません。', openapiUnavailable: 'OpenAPI 概要を表示できません。', mermaidUnavailable: 'Mermaid プレビューを表示できません。ソースは編集できます。', yamlWarnings: 'YAML 解析警告',
    empty: '表示する値がありません。', name: '名前', location: '場所', status: 'ステータス', contentTypes: 'コンテンツタイプ', title: 'タイトル', version: 'バージョン', metadata: 'メタデータ', servers: 'サーバー', tags: 'タグ', operations: '操作', parameters: 'パラメーター', requestBody: 'リクエスト本文', responses: 'レスポンス', schemas: 'スキーマ', security: 'セキュリティ', required: '必須', description: '説明', type: '型', properties: 'プロパティ', enum: '許可値',
  },
  es: {
    viewMode: 'Vista del archivo', overview: 'Resumen', preview: 'Vista previa', source: 'Código',
    parseError: 'No se pudo analizar el código.', openapiUnavailable: 'El resumen de OpenAPI no está disponible.', mermaidUnavailable: 'La vista previa de Mermaid no está disponible. El código sigue siendo editable.', yamlWarnings: 'Advertencia del analizador YAML',
    empty: 'No hay valores que mostrar.', name: 'Nombre', location: 'Ubicación', status: 'Estado', contentTypes: 'Tipo de contenido', title: 'Título', version: 'Versión', metadata: 'Metadatos', servers: 'Servidores', tags: 'Etiquetas', operations: 'Operaciones', parameters: 'Parámetros', requestBody: 'Cuerpo de solicitud', responses: 'Respuestas', schemas: 'Esquemas', security: 'Seguridad', required: 'Obligatorio', description: 'Descripción', type: 'Tipo', properties: 'Propiedades', enum: 'Valores permitidos',
  },
  fr: {
    viewMode: 'Vue du fichier', overview: 'Aperçu', preview: 'Aperçu', source: 'Source',
    parseError: 'La source ne peut pas être analysée.', openapiUnavailable: "L’aperçu OpenAPI n’est pas disponible.", mermaidUnavailable: 'Le rendu Mermaid est indisponible. La source reste modifiable.', yamlWarnings: 'Avertissement de l’analyseur YAML',
    empty: 'Aucune valeur à afficher.', name: 'Nom', location: 'Emplacement', status: 'Statut', contentTypes: 'Type de contenu', title: 'Titre', version: 'Version', metadata: 'Métadonnées', servers: 'Serveurs', tags: 'Étiquettes', operations: 'Opérations', parameters: 'Paramètres', requestBody: 'Corps de requête', responses: 'Réponses', schemas: 'Schémas', security: 'Sécurité', required: 'Obligatoire', description: 'Description', type: 'Type', properties: 'Propriétés', enum: 'Valeurs autorisées',
  },
  de: {
    viewMode: 'Dateiansicht', overview: 'Übersicht', preview: 'Vorschau', source: 'Quelltext',
    parseError: 'Der Quelltext konnte nicht geparst werden.', openapiUnavailable: 'Die OpenAPI-Übersicht ist nicht verfügbar.', mermaidUnavailable: 'Die Mermaid-Vorschau ist nicht verfügbar. Der Quelltext bleibt bearbeitbar.', yamlWarnings: 'YAML-Parserwarnung',
    empty: 'Keine Werte zum Anzeigen.', name: 'Name', location: 'Position', status: 'Status', contentTypes: 'Inhaltstyp', title: 'Titel', version: 'Version', metadata: 'Metadaten', servers: 'Server', tags: 'Tags', operations: 'Operationen', parameters: 'Parameter', requestBody: 'Anfrageinhalt', responses: 'Antworten', schemas: 'Schemas', security: 'Sicherheit', required: 'Erforderlich', description: 'Beschreibung', type: 'Typ', properties: 'Eigenschaften', enum: 'Zulässige Werte',
  },
  it: {
    viewMode: 'Vista file', overview: 'Panoramica', preview: 'Anteprima', source: 'Sorgente',
    parseError: 'Impossibile analizzare il sorgente.', openapiUnavailable: 'La panoramica OpenAPI non è disponibile.', mermaidUnavailable: 'L’anteprima Mermaid non è disponibile. Il sorgente resta modificabile.', yamlWarnings: 'Avviso del parser YAML',
    empty: 'Nessun valore da mostrare.', name: 'Nome', location: 'Posizione', status: 'Stato', contentTypes: 'Tipo di contenuto', title: 'Titolo', version: 'Versione', metadata: 'Metadati', servers: 'Server', tags: 'Tag', operations: 'Operazioni', parameters: 'Parametri', requestBody: 'Corpo richiesta', responses: 'Risposte', schemas: 'Schemi', security: 'Sicurezza', required: 'Obbligatorio', description: 'Descrizione', type: 'Tipo', properties: 'Proprietà', enum: 'Valori consentiti',
  },
  pt: {
    viewMode: 'Visualização do arquivo', overview: 'Visão geral', preview: 'Prévia', source: 'Código-fonte',
    parseError: 'Não foi possível analisar o código-fonte.', openapiUnavailable: 'A visão geral OpenAPI não está disponível.', mermaidUnavailable: 'A prévia Mermaid não está disponível. O código-fonte continua editável.', yamlWarnings: 'Aviso do analisador YAML',
    empty: 'Nenhum valor para mostrar.', name: 'Nome', location: 'Local', status: 'Status', contentTypes: 'Tipo de conteúdo', title: 'Título', version: 'Versão', metadata: 'Metadados', servers: 'Servidores', tags: 'Tags', operations: 'Operações', parameters: 'Parâmetros', requestBody: 'Corpo da solicitação', responses: 'Respostas', schemas: 'Esquemas', security: 'Segurança', required: 'Obrigatório', description: 'Descrição', type: 'Tipo', properties: 'Propriedades', enum: 'Valores permitidos',
  },
}

export const structuredFileLabels = (locale: Locale): StructuredFileLabels => ({
  ...english,
  ...labelOverrides[locale],
})

interface ParseDiagnostic {
  message: string
  level: 'error' | 'warning'
}

interface YamlAnalysis {
  kind: 'yaml'
  documents: Document.Parsed[]
  diagnostics: ParseDiagnostic[]
  openapi?: Record<string, unknown>
  openapiDiagnostic?: string
}

interface JsonAnalysis {
  kind: 'json'
  value?: unknown
  diagnostic?: string
  openapi?: Record<string, unknown>
  openapiDiagnostic?: string
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const openApiVersion = (value: unknown): value is string =>
  typeof value === 'string'
  && /^3\.(?:0|1)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)

const candidateName = (file: TacoFile): boolean => /(?:^|[-_.])openapi(?:[-_.]|$)/i.test(fileName(file.path))

const diagnosticMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message.split('\n')[0].slice(0, 500)
  return String(error).slice(0, 500)
}

export const analyzeYamlSource = (file: TacoFile): YamlAnalysis => {
  const documents = parseAllDocuments(file.content, { prettyErrors: true, strict: true, uniqueKeys: true })
  const diagnostics: ParseDiagnostic[] = []
  for (const document of documents) {
    for (const error of document.errors) diagnostics.push({ level: 'error', message: diagnosticMessage(error) })
    for (const warning of document.warnings) diagnostics.push({ level: 'warning', message: diagnosticMessage(warning) })
  }
  const analysis: YamlAnalysis = { kind: 'yaml', documents, diagnostics }
  if (diagnostics.some(({ level }) => level === 'error') || documents.length !== 1) {
    if (candidateName(file)) analysis.openapiDiagnostic = documents.length !== 1
      ? 'OpenAPI requires exactly one YAML document.'
      : 'OpenAPI source is not valid YAML.'
    return analysis
  }
  let value: unknown
  try {
    value = documents[0].toJS({ maxAliasCount: 100 })
  } catch (error) {
    diagnostics.push({ level: 'error', message: diagnosticMessage(error) })
    if (candidateName(file)) analysis.openapiDiagnostic = 'OpenAPI source could not be projected safely.'
    return analysis
  }
  const hasMarker = record(value) && Object.prototype.hasOwnProperty.call(value, 'openapi')
  if (record(value) && hasMarker && openApiVersion(value.openapi)) analysis.openapi = value
  else if (hasMarker || candidateName(file)) analysis.openapiDiagnostic = hasMarker
    ? 'The root openapi value must be a supported OpenAPI 3.0.x or 3.1.x version.'
    : 'No supported root openapi field was found.'
  return analysis
}

export const analyzeJsonSource = (file: TacoFile): JsonAnalysis => {
  let value: unknown
  try {
    value = JSON.parse(file.content)
  } catch (error) {
    return { kind: 'json', diagnostic: diagnosticMessage(error), ...(candidateName(file) ? { openapiDiagnostic: 'OpenAPI source is not valid JSON.' } : {}) }
  }
  const hasMarker = record(value) && Object.prototype.hasOwnProperty.call(value, 'openapi')
  if (record(value) && hasMarker && openApiVersion(value.openapi)) return { kind: 'json', value, openapi: value }
  return {
    kind: 'json',
    value,
    ...((hasMarker || candidateName(file)) ? {
      openapiDiagnostic: hasMarker
        ? 'The root openapi value must be a supported OpenAPI 3.0.x or 3.1.x version.'
        : 'No supported root openapi field was found.',
    } : {}),
  }
}

const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : String(value)
const entries = (value: unknown): Array<[string, unknown]> => record(value) ? Object.entries(value) : []
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []

const section = (title: string, className = ''): HTMLElement => {
  const node = el('section', `openapi-section ${className}`.trim())
  node.append(el('h2', 'structured-heading', title))
  return node
}

const definitionList = (rows: Array<[string, unknown]>): HTMLElement => {
  const list = el('dl', 'openapi-definition-list')
  for (const [label, value] of rows.filter(([, value]) => value !== undefined && value !== null && value !== '')) {
    list.append(el('dt', '', label), el('dd', '', text(value)))
  }
  return list
}

const contentTypes = (value: unknown): string => entries(record(value) ? value.content : undefined).map(([name]) => name).join(', ')
const securityText = (value: unknown): string => array(value).map((requirement) =>
  entries(requirement).map(([name, scopes]) => `${name}${array(scopes).length ? ` (${array(scopes).map(text).join(', ')})` : ''}`).join(' + ')).join(' | ')

type TableCell = string | Node

const dataTable = (headers: string[], rows: TableCell[][], className: string): HTMLTableElement => {
  const table = el('table', `openapi-data-table ${className}`) as HTMLTableElement
  const head = el('thead')
  const headRow = el('tr')
  for (const header of headers) {
    const cell = el('th', '', header)
    cell.setAttribute('scope', 'col')
    headRow.append(cell)
  }
  head.append(headRow)
  const body = el('tbody')
  for (const row of rows) {
    const tableRow = el('tr')
    for (const value of row) {
      const cell = el('td')
      if (typeof value === 'string') cell.textContent = value || '—'
      else cell.append(value)
      tableRow.append(cell)
    }
    body.append(tableRow)
  }
  table.append(head, body)
  return table
}

const keyValueTable = (rows: Array<[TableCell, TableCell]>, className = ''): HTMLElement => {
  const table = el('div', `document-properties-rows openapi-kv-table ${className}`.trim())
  for (const [key, value] of rows) {
    const row = el('div', 'document-property openapi-kv-row')
    const leading = el('span', 'document-property-leading openapi-property-leading')
    leading.setAttribute('aria-hidden', 'true')
    const keyNode = el('div', 'openapi-kv-key')
    if (typeof key === 'string') keyNode.textContent = key
    else keyNode.append(key)
    const valueNode = el('div', 'document-property-value openapi-kv-value')
    if (typeof value === 'string') valueNode.textContent = value || '—'
    else valueNode.append(value)
    row.append(leading, keyNode, valueNode)
    table.append(row)
  }
  return table
}

const parameterType = (value: Record<string, unknown>): string => {
  const schema = record(value.schema) ? value.schema : {}
  const itemSchema = record(schema.items) ? schema.items : {}
  const base = text(schema.type)
  if (base === 'array') return `array<${text(itemSchema.type) || text(itemSchema.$ref) || 'unknown'}>`
  return base || text(schema.$ref) || contentTypes(value) || text(value.$ref)
}

const renderParameters = (value: unknown, labels: StructuredFileLabels): HTMLElement | null => {
  const parameters = array(value)
  if (!parameters.length) return null
  const group = el('div', 'openapi-subsection')
  group.append(el('h4', '', labels.parameters))
  const rows: string[][] = []
  for (const candidate of parameters) {
    if (!record(candidate)) continue
    rows.push([
      text(candidate.name) || text(candidate.$ref),
      text(candidate.in),
      parameterType(candidate),
      candidate.required === true ? '✓' : '—',
      text(candidate.description),
    ])
  }
  group.append(dataTable(
    [labels.name, labels.location, labels.type, labels.required, labels.description],
    rows,
    'openapi-parameters-table',
  ))
  return group
}

const renderRequestBody = (value: unknown, labels: StructuredFileLabels): HTMLElement | null => {
  if (!record(value)) return null
  const group = el('div', 'openapi-subsection')
  group.append(el('h4', '', labels.requestBody), definitionList([
    [labels.description, value.description],
    [labels.type, contentTypes(value)],
    [labels.required, value.required === true ? labels.required : ''],
    ['$ref', value.$ref],
  ]))
  return group
}

const renderResponses = (value: unknown, labels: StructuredFileLabels): HTMLElement | null => {
  const responseEntries = entries(value)
  if (!responseEntries.length) return null
  const group = el('div', 'openapi-subsection')
  group.append(el('h4', '', labels.responses))
  const rows: string[][] = []
  for (const [status, response] of responseEntries) {
    rows.push(record(response)
      ? [status, text(response.description), contentTypes(response), text(response.$ref)]
      : [status, text(response), '', ''])
  }
  group.append(dataTable(
    [labels.status, labels.description, labels.contentTypes, '$ref'],
    rows,
    'openapi-responses-table',
  ))
  return group
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

export const renderOpenApiOverview = (api: Record<string, unknown>, labels: StructuredFileLabels): HTMLElement => {
  const root = el('article', 'structured-document openapi-overview')
  const info = record(api.info) ? api.info : {}
  const hero = el('section', 'openapi-section openapi-metadata document-properties')
  const metadataHeader = el('div', 'document-properties-header')
  metadataHeader.append(el('h2', 'document-properties-title', labels.metadata))
  const metadataRows: Array<[TableCell, TableCell]> = []
  for (const [key, value] of [
    ['OpenAPI', api.openapi], [labels.title, info.title], [labels.version, info.version], [labels.description, info.description],
  ] as Array<[string, unknown]>) {
    if (value === undefined || value === null || value === '') continue
    metadataRows.push([key, text(value)])
  }
  hero.append(metadataHeader, keyValueTable(metadataRows, 'openapi-metadata-table'))
  root.append(hero)

  const servers = array(api.servers)
  if (servers.length) {
    const group = section(labels.servers)
    const rows: Array<[TableCell, TableCell]> = []
    for (const server of servers) if (record(server)) rows.push([text(server.url) || '—', text(server.description)])
    group.append(keyValueTable(rows, 'openapi-servers-table'))
    root.append(group)
  }

  const tags = array(api.tags)
  if (tags.length) {
    const group = section(labels.tags)
    const rows: Array<[TableCell, TableCell]> = []
    for (const tag of tags) {
      if (!record(tag)) continue
      const name = text(tag.name)
      rows.push([name ? el('span', 'openapi-tag', name) : '—', text(tag.description)])
    }
    group.append(keyValueTable(rows, 'openapi-tags-table'))
    root.append(group)
  }

  const operations = section(labels.operations)
  let operationCount = 0
  for (const [path, pathValue] of entries(api.paths)) {
    if (!record(pathValue)) continue
    const pathGroup = el('section', 'openapi-path')
    pathGroup.append(el('h3', 'openapi-path-name', path))
    for (const [method, operationValue] of Object.entries(pathValue)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !record(operationValue)) continue
      operationCount += 1
      const card = el('article', 'openapi-operation')
      const heading = el('h4', 'openapi-operation-heading')
      heading.append(el('span', `openapi-method method-${method.toLowerCase()}`, method.toUpperCase()), el('span', 'openapi-operation-summary', text(operationValue.summary) || path))
      card.append(heading)
      const operationTags = array(operationValue.tags).map(text).filter(Boolean)
      const operationId = text(operationValue.operationId)
      if (operationId) {
        const apiPath = operationTags[0] ? `${operationTags[0]}/${operationId}` : operationId
        const identity = el('div', 'openapi-operation-identity')
        identity.append(el('code', 'openapi-operation-api-path', apiPath))
        card.append(identity)
      }
      if (operationTags.length) {
        const tagList = el('div', 'openapi-operation-tags')
        tagList.setAttribute('aria-label', labels.tags)
        for (const tag of operationTags) tagList.append(el('span', 'openapi-tag', tag))
        card.append(tagList)
      }
      const details = definitionList([
        [labels.description, operationValue.description],
      ])
      if (details.childElementCount) card.append(details)
      const parameters = renderParameters([...array(pathValue.parameters), ...array(operationValue.parameters)], labels)
      if (parameters) card.append(parameters)
      const requestBody = renderRequestBody(operationValue.requestBody, labels)
      if (requestBody) card.append(requestBody)
      const responses = renderResponses(operationValue.responses, labels)
      if (responses) card.append(responses)
      const security = securityText(operationValue.security)
      if (security) card.append(definitionList([[labels.security, security]]))
      pathGroup.append(card)
    }
    if (pathGroup.childElementCount > 1) operations.append(pathGroup)
  }
  if (!operationCount) operations.append(el('p', 'structured-empty', labels.empty))
  root.append(operations)

  const schemas = entries(record(api.components) ? api.components.schemas : undefined)
  if (schemas.length) {
    const group = section(labels.schemas)
    const rows: Array<[TableCell, TableCell]> = []
    for (const [name, schemaValue] of schemas) {
      const schema = record(schemaValue) ? schemaValue : {}
      const detail = [
        text(schema.type),
        text(schema.description),
        array(schema.required).length ? `${labels.required}: ${array(schema.required).map(text).join(', ')}` : '',
        entries(schema.properties).length ? `${labels.properties}: ${entries(schema.properties).map(([property]) => property).join(', ')}` : '',
        array(schema.enum).length ? `${labels.enum}: ${array(schema.enum).map(text).join(', ')}` : '',
        text(schema.$ref),
      ].filter(Boolean).join(' · ')
      rows.push([name, detail])
    }
    group.append(keyValueTable(rows, 'openapi-schemas-table'))
    root.append(group)
  }

  const security = securityText(api.security)
  const schemes = entries(record(api.components) ? api.components.securitySchemes : undefined)
  if (security || schemes.length) {
    const group = section(labels.security)
    const rows: Array<[TableCell, TableCell]> = []
    if (security) rows.push([labels.required, security])
    for (const [name, schemeValue] of schemes) {
      const scheme = record(schemeValue) ? schemeValue : {}
      rows.push([name, [text(scheme.type), text(scheme.scheme), text(scheme.in), text(scheme.name), text(scheme.$ref)].filter(Boolean).join(' · ')])
    }
    group.append(keyValueTable(rows, 'openapi-security-table'))
    root.append(group)
  }
  return root
}

const diagnosticNode = (message: string, level: 'error' | 'warning' = 'error'): HTMLElement => {
  const node = el('p', `structured-diagnostic is-${level}`, message)
  node.setAttribute('role', level === 'error' ? 'alert' : 'status')
  return node
}

const button = (label: string, className: string): HTMLButtonElement => {
  const node = el('button', className, label) as HTMLButtonElement
  node.type = 'button'
  node.setAttribute('aria-label', label)
  node.title = label
  return node
}

const openStandaloneMermaidZoom = (
  source: string,
  labels: MermaidPluginLabels,
  runtime?: MermaidRuntime,
): void => {
  const dialog = el('dialog', 'mermaid-zoom-dialog') as HTMLDialogElement
  dialog.setAttribute('aria-label', labels.zoom)
  const header = el('header', 'mermaid-zoom-header')
  const controls = el('div', 'mermaid-zoom-controls')
  const zoomOut = button('−', 'tiptap-code-block-button mermaid-zoom-out')
  zoomOut.setAttribute('aria-label', labels.zoomOut)
  zoomOut.title = labels.zoomOut
  const zoomLevel = el('output', 'mermaid-zoom-level') as HTMLOutputElement
  zoomLevel.setAttribute('aria-label', labels.zoomLevel)
  zoomLevel.setAttribute('aria-live', 'polite')
  const zoomIn = button('+', 'tiptap-code-block-button mermaid-zoom-in')
  zoomIn.setAttribute('aria-label', labels.zoomIn)
  zoomIn.title = labels.zoomIn
  const reset = button('↺', 'tiptap-code-block-button mermaid-zoom-reset')
  reset.setAttribute('aria-label', labels.resetZoom)
  reset.title = labels.resetZoom
  const close = button('×', 'tiptap-code-block-button mermaid-zoom-close')
  close.setAttribute('aria-label', labels.close)
  close.title = labels.close
  const canvas = el('div', 'mermaid-zoom-canvas')
  const diagram = createMermaidPreview(source, labels, undefined, undefined, runtime)
  canvas.append(diagram)
  controls.append(zoomOut, zoomLevel, zoomIn, reset, close)
  header.append(el('span', '', labels.previewTitle), controls)
  dialog.append(header, canvas)
  let zoom = 1
  let drag: { id: number; x: number; y: number; left: number; top: number } | null = null
  const paint = (): void => {
    const percentage = Math.round(zoom * 100)
    diagram.style.setProperty('--mermaid-zoom-width', `${percentage}%`)
    diagram.style.setProperty('--mermaid-zoom-min-width', `${Math.round(960 * zoom)}px`)
    zoomLevel.value = `${percentage}%`
    zoomOut.disabled = zoom <= .5
    zoomIn.disabled = zoom >= 2
    reset.disabled = zoom === 1
  }
  const setZoom = (next: number): void => { zoom = Math.max(.5, Math.min(2, next)); paint() }
  zoomOut.addEventListener('click', () => setZoom(zoom - .25))
  zoomIn.addEventListener('click', () => setZoom(zoom + .25))
  reset.addEventListener('click', () => { setZoom(1); canvas.scrollLeft = 0; canvas.scrollTop = 0 })
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? canvas.clientHeight : 1)
    setZoom(zoom * Math.exp(-delta * .0015))
  }, { passive: false })
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop }
    canvas.setPointerCapture?.(event.pointerId)
    canvas.classList.add('is-dragging')
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return
    canvas.scrollLeft = drag.left - (event.clientX - drag.x)
    canvas.scrollTop = drag.top - (event.clientY - drag.y)
  })
  const stop = (event: PointerEvent): void => {
    if (!drag || drag.id !== event.pointerId) return
    drag = null
    canvas.classList.remove('is-dragging')
  }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
  dialog.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') setZoom(zoom + .25)
    else if (event.key === '-' || event.key === '_') setZoom(zoom - .25)
    else if (event.key === '0') { setZoom(1); canvas.scrollLeft = 0; canvas.scrollTop = 0 }
    else return
    event.preventDefault()
  })
  const finish = (): void => { if (typeof dialog.close === 'function') dialog.close(); else dialog.remove(); dialog.remove() }
  close.addEventListener('click', finish)
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish() })
  dialog.addEventListener('click', (event) => { if (event.target === dialog) finish() })
  paint()
  document.body.append(dialog)
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
}

export interface StructuredFileViewerOptions {
  file: TacoFile
  kind: SourceKind
  labels: StructuredFileLabels
  mermaidLabels: MermaidPluginLabels
  mermaidRuntime?: MermaidRuntime
  readOnly: boolean
  sourceLabel: string
  onChange: (content: string) => void
  onModeChange: () => void
}

export interface StructuredFileViewerController {
  element: HTMLElement
  sourceEditor: SourceEditorController
}

export const createStructuredFileViewer = (options: StructuredFileViewerOptions): StructuredFileViewerController => {
  const shell = el('section', `structured-file-viewer structured-file-${options.kind}`)
  const toolbar = el('header', 'structured-file-toolbar')
  const diagnostics = el('div', 'structured-file-diagnostics')
  const content = el('div', 'structured-file-content')
  shell.append(toolbar, diagnostics, content)
  let mode: StructuredMode = options.kind === 'mermaid' ? 'preview' : 'source'
  let available: StructuredMode[] = ['source']
  let renderSerial = 0
  let firstPaint = true

  const rawSource = createSourceEditor({
    value: options.file.content,
    language: options.kind,
    label: options.sourceLabel,
    readOnly: options.readOnly,
    onChange: (value) => {
      options.onChange(value)
      if (mode !== 'source') mode = 'source'
      paint()
    },
  })
  content.append(rawSource.element)
  let derivedView: HTMLElement | null = null

  const sourceEditor: SourceEditorController = {
    element: rawSource.element,
    input: rawSource.input,
    setCommentRanges: rawSource.setCommentRanges,
    activateRange: (range) => {
      if (range && mode !== 'source') { mode = 'source'; paint() }
      rawSource.activateRange(range)
    },
  }

  const setMode = (next: StructuredMode): void => {
    if (!available.includes(next)) return
    mode = next
    paint()
    requestAnimationFrame(options.onModeChange)
  }

  const showSource = (): void => {
    derivedView?.remove()
    derivedView = null
    rawSource.element.hidden = false
  }

  const showDerived = (view: HTMLElement): void => {
    derivedView?.remove()
    derivedView = view
    rawSource.element.hidden = true
    content.append(view)
  }

  const paintToolbar = (): void => {
    if (available.length < 2) {
      toolbar.hidden = true
      toolbar.replaceChildren()
      return
    }
    toolbar.hidden = false
    const optionLabels: Record<StructuredMode, string> = {
      overview: options.labels.overview,
      preview: options.labels.preview,
      source: options.labels.source,
    }
    const control = createSegmentedControl({
      label: options.labels.viewMode,
      value: mode,
      options: available.map((value) => ({ value, label: optionLabels[value] })),
      className: 'right-panel-tabs',
      variant: 'tabs',
      onChange: setMode,
    })
    toolbar.replaceChildren(control.element)
  }

  const paintMermaid = (): void => {
    available = ['preview', 'source']
    if (mode !== 'preview') {
      diagnostics.replaceChildren()
      showSource()
      paintToolbar()
      return
    }
    const serial = ++renderSerial
    const previewShell = el('div', 'standalone-mermaid-preview')
    const zoom = button(options.mermaidLabels.zoom, 'standalone-mermaid-zoom')
    zoom.replaceChildren(svgIcon('zoom-in'))
    zoom.addEventListener('click', () => openStandaloneMermaidZoom(rawSource.input.value, options.mermaidLabels, options.mermaidRuntime))
    const fail = (message: string): void => {
      if (serial !== renderSerial) return
      mode = 'source'
      diagnostics.replaceChildren(diagnosticNode(message))
      showSource()
      paintToolbar()
      requestAnimationFrame(options.onModeChange)
    }
    const diagram = createMermaidPreview(
      rawSource.input.value,
      options.mermaidLabels,
      undefined,
      () => fail(options.labels.mermaidUnavailable),
      options.mermaidRuntime,
      () => fail(options.mermaidLabels.error),
    )
    previewShell.append(zoom, diagram)
    diagnostics.replaceChildren()
    showDerived(previewShell)
    paintToolbar()
  }

  const paintStructured = (): void => {
    const isYaml = options.kind === 'yaml'
    const yamlAnalysis = isYaml ? analyzeYamlSource({ ...options.file, content: rawSource.input.value }) : null
    const jsonAnalysis = isYaml ? null : analyzeJsonSource({ ...options.file, content: rawSource.input.value })
    const analysis = yamlAnalysis ?? jsonAnalysis!
    const hasErrors = yamlAnalysis
      ? yamlAnalysis.diagnostics.some(({ level }) => level === 'error')
      : Boolean(jsonAnalysis?.diagnostic)
    available = analysis.openapi ? ['overview', 'source'] : ['source']
    if (firstPaint && !hasErrors) mode = analysis.openapi ? 'overview' : 'source'
    firstPaint = false
    if (!available.includes(mode)) mode = 'source'

    const messages: HTMLElement[] = []
    if (analysis.openapiDiagnostic) messages.push(diagnosticNode(`${options.labels.openapiUnavailable} ${analysis.openapiDiagnostic}`, 'warning'))
    if (yamlAnalysis) {
      for (const item of yamlAnalysis.diagnostics) messages.push(diagnosticNode(`${item.level === 'warning' ? options.labels.yamlWarnings : options.labels.parseError} ${item.message}`, item.level))
    } else if (jsonAnalysis?.diagnostic) messages.push(diagnosticNode(`${options.labels.parseError} ${jsonAnalysis.diagnostic}`))
    diagnostics.replaceChildren(...messages)
    paintToolbar()
    if (mode === 'overview' && analysis.openapi) showDerived(renderOpenApiOverview(analysis.openapi, options.labels))
    else showSource()
  }

  const paint = (): void => {
    if (options.kind === 'mermaid') paintMermaid()
    else paintStructured()
  }
  paint()
  return { element: shell, sourceEditor }
}
