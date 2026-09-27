---
title: '011-checkpoint-document-instruction'
feature_id: '011-checkpoint-document-instruction'
created: '2026-09-27'
status: 'Frozen'
issue: 'https://github.com/Arcadia822/taco/issues/56'
linear: 'https://linear.app/castrel/issue/TACO-22'
input: |-
  TACO-22: Checkpoint 文件支持可选 instruction，并在右侧面板提供 Instruction Tab 展示要求
---

## 1. 背景与目标

在 Spec / Checkpoint 驱动的工作流中，Checkpoint 节点定义了阶段性产出或关联的文件列表。当 Agent 或协作者被指派编写具体文件时，通常需要遵循针对该文件的专属编写约束、上下文提示或输入规范（例如必须覆盖的章节、关键依赖或注意事项）。

目前 Checkpoint 文件引用（`CheckpointDocumentRef`）仅包含 `path` 和 `optional` 属性，缺乏传达此类任务要求的字段；同时前端右侧辅助面板（Right Panel）目前仅有 `outline`（大纲）和 `comments`（评论）两个 Tab。

本特性旨在：
1. 在数据模型层（`@taco/protocol`）扩展 `instruction?: string` 属性，并支持校验与透出。
2. 在前端右侧辅助面板（Right Panel）扩展 `Instruction` Tab，动态展示当前选中 Checkpoint 文件的指令内容；在文件无指令时自动隐藏，并在必要时平滑回退。
3. 提供多语言支持（`zh-Hans`, `en`）。
4. 保证 Bundle 保存、导出、同步及离线恢复时的数据完备性。

---

## 2. 用户场景与交互

### 2.1 场景 1：查看含指令的 Checkpoint 文件 (P1)
- **Given**: Checkpoint 配置中对 `specs/011-checkpoint-document-instruction/spec.md` 配置了 `instruction: "必须详细定义数据模型变更与 UI 回退机制"`。
- **When**: 用户在文件浏览器中点击并打开该文件。
- **Then**: 
  - 右侧辅助面板（Right Panel）的 Tab 栏在 `Outline` / `Comments` 之外显示 `Instruction` Tab。
  - 点击 `Instruction` Tab 时，右侧面板展示该指令文本，清晰排版。

### 2.2 场景 2：在无指令文件与有指令文件之间切换 (P1)
- **Given**: 文件 A 配置了 `instruction`，文件 B（普通文件或未配指令的 Checkpoint 文件）没有 `instruction`。
- **When**: 用户在文件 A 的 `Instruction` Tab 浏览时，切换选中文件 B。
- **Then**:
  - 右侧面板的 `Instruction` Tab 自动隐藏。
  - 面板激活 Tab 平滑回退到 `outline`（若为 Markdown 文件且有大纲）或 `comments`。
- **When**: 用户再次切回文件 A。
  - 右侧面板重新显示 `Instruction` Tab。

### 2.3 场景 3：未创建的 Checkpoint 占位文件 (P2)
- **Given**: Checkpoint 声明了一个尚未在磁盘创建的文件并配有 `instruction`。
- **When**: 用户点击该占位行查看占位视图。
- **Then**: 右侧面板同样可呈现 `Instruction` Tab（或占位页已包含相关提示，但右侧面板保持一致可查阅）。

---

## 3. 数据模型设计 (`@taco/protocol`)

### 3.1 协议定义更新 (`packages/protocol/src/checkpoints.ts`)

```typescript
export interface CheckpointDocumentRef {
  path: string
  optional?: boolean
  instruction?: string
}

export interface ResolvedCheckpointDocument {
  path: string
  optional: boolean
  instruction?: string
  status: DocumentStatus
  exists: boolean
  updatedAt?: string
}
```

### 3.2 校验规则 (`validateCheckpoints`)
- 如果 `ref.instruction !== undefined`：
  - 必须为 `string` 类型（`typeof ref.instruction === 'string'`）。
  - 若传入非 string（如 number、boolean、object），校验失败并报错。
- `resolveCheckpoints` 透出：
  - 在生成 `ResolvedCheckpointDocument` 时，将 `ref.instruction` 赋值给 resolved 对象。

---

## 4. 前端辅助面板交互设计 (`src/file-browser.ts`)

### 4.1 `AuxiliaryTab` 扩展
```typescript
type AuxiliaryTab = 'outline' | 'comments' | 'instruction'
```

### 4.2 面板状态管理与渲染
1. **指令获取**：
   - 增加辅助方法 `getSelectedDocumentInstruction(): string | undefined`：
     - 从 `this.checkpoints?.documents` 或通过路径查找当前选中的 `this.selected` 是否匹配已解析的 Checkpoint Document 且含有 `instruction`。
2. **Segmented Control 动态展示**：
   - 当 `hasInstruction` 为 true 时，右侧 tab 栏显示 `Instruction` Tab；
   - 当 `hasInstruction` 为 false 时，隐藏 `Instruction` Tab。
3. **Tab 回退机制 (`syncAuxiliaryTabs`)**：
   - 若 `this.auxiliaryTab === 'instruction'` 但 `hasInstruction` 为 false，回退到：
     - 若当前文件支持大纲，回退到 `'outline'`；
     - 否则回退到 `'comments'`。
4. **内容面板 (`instructionPanel`)**：
   - 在右侧面板容器内新增 `instruction-panel` 容器。
   - 仅在 `this.auxiliaryTab === 'instruction'` 时激活显示。
   - 以格式化样式呈现 instruction 内容，保留换行与基本阅读间距，支持只读查看与一键复制。

---

## 5. 国际化 (`src/i18n.ts`)

当前 Taco 仅保留 `zh-Hans` 和 `en` 两种语言配置（`zh-Hant` 此前已清理移除）。在两个语言字典中增补词条：
- `instruction`:
  - `en`: `'Instruction'`
  - `zh-Hans`: `'要求'`
- `instructionEmpty`:
  - `en`: `'No instruction provided for this document.'`
  - `zh-Hans`: `'该文档暂无特殊要求说明'`
