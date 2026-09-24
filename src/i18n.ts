import type { CheckpointLabels } from './checkpoint-view.ts'
export const LOCALE_CHOICES = [
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'en', label: 'English' },
] as const

export type Locale = typeof LOCALE_CHOICES[number]['code']

const en = {
  files: 'Files', otherFiles: 'Unassigned files', search: 'Search', searchTitle: 'Search documents',
  ungrouped: 'Unassigned', newGroup: 'New group...', newGroupTitle: 'New group', groupTitlePlaceholder: 'Group name', create: 'Create',
  addGroup: 'Add group', renameGroup: 'Rename group', deleteGroup: 'Delete group',
  addFile: 'Add file', renameFile: 'Rename file', deleteFile: 'Delete file',
  setEntry: 'Set as entry document', entryBadge: 'Entry', newGroupPrompt: 'Group title:',
  newFilePrompt: 'File name (e.g. overview.md):', renameFilePrompt: 'New file name:',
  newFileType: 'File type', newFileName: 'File name', newFileCategory: 'Category', changeCategory: 'Change category',
  deleteGroupConfirm: 'Delete this group? Its files will be moved to Unassigned.',
  deleteFileConfirm: 'Delete this file permanently?',
  searchPlaceholder: 'Search file names and contents…', noMatches: 'No matching files.',
  collapseFiles: 'Collapse file sidebar', expandFiles: 'Expand file sidebar',
  collapseRightPanel: 'Collapse outline and comments', expandRightPanel: 'Expand outline and comments',
  language: 'Language', share: 'Share', save: 'Save', saved: 'Saved', saveCopy: 'Save a copy…', saveAndUnpack: 'Save & unpack…', copyReview: 'Handoff', copyReviewLabel: 'Handoff', copyAllChanges: 'Handoff', copyTabInspect: 'Handoff (w/o data)', reviewCopied: 'Copied for Agent', noReviewChanges: 'No changes to copy',
  handoffIntro: 'I have completed modifications and comments in the Taco review page. Please sync the following changes:',
  handoffDocTitle: 'Document title',
  handoffLocalPath: 'Local path',
  handoffDiffHeader: 'Text modifications (Unified Diff):',
  handoffBinaryNotice: '(new file or binary asset)',
  handoffCommentsHeader: 'Review notes & comments:',
  handoffQuoteLabel: 'Quote',
  handoffInspectIntro: 'Please inspect my review results in the open Taco review tab:',
  handoffPageTitle: 'Page title',
  handoffTabUrl: 'Tab URL',
  handoffInspectAction: 'Locate this tab in browser and run `window.taco.getReviewHandoff()` in the console to inspect all modifications and inline comments.',
  handoffMermaidNode: (label: string) => `Mermaid node: ${label}`,
  handoffMermaidLine: (line: number) => `Mermaid L${line}`,
  handoffMermaidDiagram: 'Mermaid diagram',
  handoffCodeBlock: (lang: string) => `${lang} code block`,
  nativeShare: 'Share with system…', copyLink: 'Copy link to this location', copied: 'Link copied', copyFailed: 'Could not copy link',
  download: 'Download', downloadStarted: 'Taco download started', saveUnpacked: (count: number) => `Taco saved and ${count} files unpacked`,
  downloadConfirmTitle: 'Download This Taco?', downloadConfirmBody: 'This browser cannot write directly to a local file. Taco will download a new file, and your browser settings control its destination.',
  downloadConfirmCredential: 'This working copy contains collaboration credentials. The downloaded file will preserve that access.',
  saveCancelled: 'Save cancelled', saveFailed: 'Save failed', unpackUnsupported: 'This browser cannot write to a folder',
  directoryUnavailable: 'No folder was selected, or the browser denied folder write access',
  close: 'Close', empty: 'This Taco contains no files.', unsaved: 'Unsaved changes',
  outline: 'Outline', noHeadings: 'This document has no H1–H3 headings.', comments: 'Comments', rightPanel: 'Document outline and comments',
  noComments: 'No comments yet', commentsEmptyHint: 'Select text in the document, then choose “Comment” to start a focused discussion.',
  addComment: 'Add comment', commentSelection: 'Comment', commentBlock: 'Comment on entire code block', commentPlaceholder: 'Write a comment…', cancel: 'Cancel',
  reply: 'Reply', replyPlaceholder: 'Reply to this thread…', resolve: 'Resolve', reopen: 'Reopen', delete: 'Delete thread',
  positionLost: 'Position lost',
  localUser: 'Local user', unresolvedAnchor: 'The source text changed and this comment cannot be located.', emptyComment: 'A comment cannot be empty.',
  editMessage: 'Edit', deleteMessage: 'Delete', saveMessage: 'Save', edited: 'Edited', editedAt: (time: string) => `Edited ${time}`,
  messageDeleted: 'Message deleted', editMessageBy: (author: string) => `Edit message by ${author}`, deleteMessageBy: (author: string) => `Delete message by ${author}`,
  deleteMessageConfirm: 'Delete this message? The thread and other replies will remain.', deleteThread: 'Delete thread', deleteThreadConfirm: 'Delete this entire thread and all of its replies?',
  messageChangedRemotely: 'This message changed elsewhere. Your edit was not saved.', principalSessionOnly: 'Comment identity cannot be persisted in this browser. Edit continuity lasts only for this session.',
  mermaidSource: 'Edit Mermaid source', mermaidHidePreview: 'Return to Mermaid preview', mermaidZoom: 'Enlarge Mermaid diagram', mermaidZoomIn: 'Zoom in', mermaidZoomOut: 'Zoom out', mermaidResetZoom: 'Reset zoom', mermaidZoomLevel: 'Current zoom level', mermaidPreviewTitle: 'Mermaid diagram',
  mermaidTheme: 'Theme', mermaidCodePanel: 'Code panel', mermaidLineComment: 'Comment on line', mermaidNodeComment: 'Comment on node',
  mermaidDirection: 'Direction',
  lightTheme: 'Light', darkTheme: 'Dark',
  systemTheme: 'System',
  mermaidLiveUpdate: 'Live update', mermaidUpdateDiagram: 'Update diagram',
  codeCopy: 'Copy code', codeCopied: 'Code copied', codeCopyFailed: 'Could not copy code', codeAuto: 'Auto', codePlainText: 'Plain text',
  codeBlockReference: (language: string) => language ? `${language} code block` : 'Code block', mermaidBlockReference: 'Mermaid diagram',
  sourceEditor: (kind: string) => `${kind.toUpperCase()} source editor`, markdownEditor: 'Markdown WYSIWYG editor', editorFailed: 'The editor failed to load.',
  openHtmlPrototype: 'Open Preview',
  mermaidLoading: 'Rendering diagram…', mermaidError: 'Invalid Mermaid syntax. Expand the source to fix it.',
  documentTitle: 'Taco title; also used for the browser tab and new-file defaults',
  fileTitle: 'File title; does not rename the file or change its path',
  yourName: 'Your name', nameHint: 'Used for comments, collaborative cursors and the people list', guest: 'Guest',
  localCollab: 'Local collaboration is on', collabOff: 'Local collaboration is off', enableCollab: 'Turn on local collaboration', disableCollab: 'Turn off local collaboration', connected: (count: number) => `${count} connected`, commentName: 'Your name (shown on comments):',
  people: 'People', you: 'you', owner: 'Owner', editor: 'Editor', viewer: 'Viewer', offlineReader: 'Read-only',
  live: 'Live', connecting: 'Connecting…', notLive: 'Not live — turns on when you share',
  shareCopy: 'Share a copy', inviteEdit: 'Invite to edit…', readOnlyCopy: 'Read-only copy…',
  stopSharing: 'Stop Sharing', goLive: 'Go Live', resetAccess: 'Reset Access…', resetConfirm: 'Reset access? Every copy already sent will permanently stop syncing.',
  credentialSaveConfirm: 'This is a credential-bearing working copy. Saving it preserves collaboration access. Continue?',
  resetDone: 'Access reset', sharingFailed: 'Could not start live collaboration', sharingUnavailable: 'Online collaboration is not configured in this build. Contact the build provider.', ownerInviteOnly: 'This copy cannot issue a new editor invitation',
  removeMember: (name: string) => `Remove ${name}`, removeConfirm: (name: string) => `Remove ${name}? That device becomes read-only.`, memberRemoved: (name: string) => `${name} was removed`,
  readonlyNotice: 'This copy is read-only. It receives live updates but cannot change the Taco.', offlineReadonlyNotice: 'This file is a read-only copy.',
}

export type Copy = typeof en

const zhHans: Copy = {
  files: '文件', otherFiles: '未分配文件', search: '搜索', searchTitle: '搜索文档',
  ungrouped: '未分配', newGroup: '新建分组...', newGroupTitle: '新建分组', groupTitlePlaceholder: '分组名称', create: '创建',
  addGroup: '添加分组', renameGroup: '重命名分组', deleteGroup: '删除分组',
  setEntry: '设为主入口', entryBadge: '入口', newGroupPrompt: '分组标题：',
  addFile: '新建文件', renameFile: '重命名文件', deleteFile: '删除文件',
  newFilePrompt: '文件名（如 overview.md）：', renameFilePrompt: '新文件名：',
  newFileType: '文件类型', newFileName: '文件名', newFileCategory: '分类', changeCategory: '更改分类',
  deleteGroupConfirm: '确定删除该分组吗？组内文件将移至未分配区。',
  deleteFileConfirm: '确定永久删除此文件吗？',
  searchPlaceholder: '搜索文件名与内容…', noMatches: '没有匹配的文件。',
  collapseFiles: '收起文件侧栏', expandFiles: '展开文件侧栏',
  collapseRightPanel: '收起大纲与评论', expandRightPanel: '展开大纲与评论',
  language: '语言', share: '分享', save: '保存', saved: '已保存', saveCopy: '保存副本…', saveAndUnpack: '解包到文件夹…', copyReview: '交接改动', copyReviewLabel: '交接改动', copyAllChanges: '交接改动', copyTabInspect: '交接改动（不含数据）', reviewCopied: '已复制给 Agent', noReviewChanges: '暂无改动可复制',
  handoffIntro: '我已在 Taco 评审页面完成了修改与评论，请同步以下变更：',
  handoffDocTitle: '文档标题',
  handoffLocalPath: '本地物理路径',
  handoffDiffHeader: '文本修改 (Unified Diff):',
  handoffBinaryNotice: '(新文件或二进制资源)',
  handoffCommentsHeader: '评审批注与评论:',
  handoffQuoteLabel: '引用',
  handoffInspectIntro: '请在当前浏览器打开的 Taco 评审标签页中查看我的评审结果：',
  handoffPageTitle: '页面标题',
  handoffTabUrl: '标签页 URL',
  handoffInspectAction: '请在浏览器中定位该标签页，并在控制台执行 `window.taco.getReviewHandoff()` 获取我的所有修改与行内评论。',
  handoffMermaidNode: (label: string) => `Mermaid 节点: ${label}`,
  handoffMermaidLine: (line: number) => `Mermaid L${line}`,
  handoffMermaidDiagram: 'Mermaid 图表',
  handoffCodeBlock: (lang: string) => `${lang} 代码块`,
  nativeShare: '系统分享…', copyLink: '复制当前位置链接', copied: '链接已复制', copyFailed: '无法复制链接',
  download: '下载', downloadStarted: '已开始下载 Taco 文件', saveUnpacked: (count: number) => `已保存 Taco 并解包 ${count} 个文件`,
  downloadConfirmTitle: '下载此 Taco？', downloadConfirmBody: '当前浏览器不支持直接写入本地文件。Taco 将下载一个新文件，保存位置由浏览器设置决定。',
  downloadConfirmCredential: '此工作副本包含协作凭据；下载后的文件将保留相应访问权限。',
  saveCancelled: '已取消保存', saveFailed: '保存失败', unpackUnsupported: '此浏览器不支持写入文件夹',
  directoryUnavailable: '未选择文件夹，或浏览器未授予文件夹写入权限',
  close: '关闭', empty: '此 Taco 不包含文件。', unsaved: '有未保存的修改',
  outline: '大纲', noHeadings: '此文档没有 H1–H3 标题。', comments: '评论', rightPanel: '文档大纲与评论',
  noComments: '还没有评论', commentsEmptyHint: '选中正文内容，然后点击“评论”即可针对原文发起讨论。',
  addComment: '添加评论', commentSelection: '评论', commentBlock: '评论整个代码块', commentPlaceholder: '写下评论…', cancel: '取消',
  reply: '回复', replyPlaceholder: '回复此线程…', resolve: '解决', reopen: '重新打开', delete: '删除线程',
  positionLost: '位置已失效',
  localUser: '本地用户', unresolvedAnchor: '原文已变化，无法定位此评论。', emptyComment: '评论内容不能为空。',
  editMessage: '编辑', deleteMessage: '删除', saveMessage: '保存', edited: '已编辑', editedAt: (time: string) => `编辑于 ${time}`,
  messageDeleted: '消息已删除', editMessageBy: (author: string) => `编辑 ${author} 的消息`, deleteMessageBy: (author: string) => `删除 ${author} 的消息`,
  deleteMessageConfirm: '删除此消息？评论线程和其他回复将保留。', deleteThread: '删除线程', deleteThreadConfirm: '删除整个评论线程及其全部回复？',
  messageChangedRemotely: '此消息已在其他位置发生变化，您的编辑未保存。', principalSessionOnly: '此浏览器无法持久保存评论身份；编辑权限只能延续到当前会话。',
  mermaidSource: '编辑 Mermaid 源码', mermaidHidePreview: '返回 Mermaid 预览', mermaidZoom: '放大 Mermaid 图表', mermaidZoomIn: '放大图表', mermaidZoomOut: '缩小图表', mermaidResetZoom: '重置缩放', mermaidZoomLevel: '当前缩放比例', mermaidPreviewTitle: 'Mermaid 图表',
  mermaidTheme: '主题', mermaidCodePanel: '代码面板', mermaidLineComment: '对此行评论', mermaidNodeComment: '对此节点评论',
  mermaidDirection: '方向',
  lightTheme: '浅色', darkTheme: '深色',
  systemTheme: '跟随系统',
  mermaidLiveUpdate: '实时更新', mermaidUpdateDiagram: '更新图表',
  codeCopy: '复制代码', codeCopied: '代码已复制', codeCopyFailed: '无法复制代码', codeAuto: '自动识别', codePlainText: '纯文本',
  codeBlockReference: (language: string) => language ? `${language} 代码块` : '代码块', mermaidBlockReference: 'Mermaid 图表',
  sourceEditor: (kind: string) => `${kind.toUpperCase()} 源码编辑器`, markdownEditor: 'Markdown 所见即所得编辑器', editorFailed: '编辑器加载失败。',
  openHtmlPrototype: '打开预览',
  mermaidLoading: '正在渲染图表…', mermaidError: 'Mermaid 语法有误；请展开源码修正。',
  documentTitle: 'Taco 标题；同时用于浏览器标签和新文件默认名',
  fileTitle: '文件标题；不会修改文件名或路径',
  yourName: '您的名字', nameHint: '用于评论署名、多人光标和在线成员列表', guest: '访客',
  localCollab: '本地协作已开启', collabOff: '本地协作未开启', enableCollab: '开启本地协作', disableCollab: '关闭本地协作', connected: (count: number) => `${count} 人已连接`, commentName: '您的名字（显示在评论中）：',
  people: '成员', you: '您', owner: '所有者', editor: '编辑者', viewer: '查看者', offlineReader: '只读',
  live: '实时协作', connecting: '正在连接…', notLive: '尚未实时共享 — 分享时开启',
  shareCopy: '分享副本', inviteEdit: '邀请编辑…', readOnlyCopy: '只读副本…',
  stopSharing: '停止共享', goLive: '开始实时共享', resetAccess: '重置访问权限…', resetConfirm: '重置后，之前发出的所有副本都将永久停止同步。继续吗？',
  credentialSaveConfirm: '这是携带协作凭据的工作副本。保存后仍可访问协作会话。是否继续？',
  resetDone: '访问权限已重置', sharingFailed: '无法启动实时协作', sharingUnavailable: '此版本未配置在线协作服务，请联系构建提供方。', ownerInviteOnly: '此副本不能签发新的编辑邀请',
  removeMember: (name: string) => `移除 ${name}`, removeConfirm: (name: string) => `移除 ${name}？该设备将变为只读。`, memberRemoved: (name: string) => `已移除 ${name}`,
  readonlyNotice: '此副本为只读；它会接收实时更新，但不能修改内容。', offlineReadonlyNotice: '此文件为只读副本。',
}

export const copy: Record<Locale, Copy> = {
  en,
  'zh-Hans': zhHans,
}


const checkpointEn: CheckpointLabels = {
  checkpoints: 'Checkpoints', checkpointsInvalid: 'Invalid checkpoints',
  checkpointTemplateName: 'Checkpoint template name', checkpointUnnamed: 'Untitled',
  statusTodo: 'To do', statusInProgress: 'In progress', statusComplete: 'Complete', statusFreeze: 'Frozen',
  checkpointOptional: 'optional', checkpointRequired: 'required', checkpointMissingFile: 'Not created',
  checkpointOpenView: 'Show in Checkpoints', checkpointCreateFile: 'Create file',
  checkpointNotCreatedRead: 'This file has not been created',
  checkpointGroupHint: 'Grouped by checkpoint', checkpointOverridden: (category) => `Grouped by checkpoint; category \"${category}\" is ignored`,
}
const checkpointTranslations: Record<Locale, CheckpointLabels> = {
  en: checkpointEn,
  'zh-Hans': {
    checkpoints: 'Checkpoints', checkpointsInvalid: 'Checkpoints 定义无效',
    checkpointTemplateName: 'Checkpoint 模板名称', checkpointUnnamed: '未命名',
    statusTodo: '待开始', statusInProgress: '进行中', statusComplete: '已完成', statusFreeze: '已冻结',
    checkpointOptional: '可选', checkpointRequired: '必需', checkpointMissingFile: '未创建',
    checkpointOpenView: '在 Checkpoints 中查看', checkpointCreateFile: '创建文件',
    checkpointNotCreatedRead: '此文件尚未创建',
    checkpointGroupHint: '分组由 Checkpoint 决定', checkpointOverridden: (category) => `分组由 Checkpoint 决定，原 category「${category}」未生效`,
  },
}
export const checkpointCopy = (locale: Locale): CheckpointLabels => checkpointTranslations[locale]

const matchLocale = (candidate: string | null | undefined): Locale | null => {
  const lower = candidate?.trim().replaceAll('_', '-').toLowerCase()
  if (!lower) return null
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-Hans'
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  return null
}

export const browserLocalePreferences = (): readonly string[] => {
  if (typeof navigator === 'undefined') return []
  const preferences = [...navigator.languages]
  if (navigator.language && !preferences.includes(navigator.language)) preferences.push(navigator.language)
  return preferences
}

export const resolveLocale = (
  stored: string | null,
  preferredLanguages: readonly string[] = browserLocalePreferences(),
): Locale => {
  const saved = matchLocale(stored)
  if (saved) return saved
  for (const preferred of preferredLanguages) {
    const matched = matchLocale(preferred)
    if (matched) return matched
  }
  return 'en'
}
