---
title: '009 界面设计：导航、文件页头与 Checkpoint 视图'
created: '2026-09-23'
status: 'Draft'
specification: 'spec.md'
---

## 1. 范围与原则

本文细化 [spec](spec.md) §6–§8 中与界面相关的部分。

- 能复用现有组件的，一律复用。Checkpoint 名沿用 category 原来的显示方式：侧栏分组行和页头分组标签。
- 状态用图标表示；选择状态的菜单里，图标旁显示状态名。
- 导航行沿用 `.sidebar-row`，页头标签沿用 `.workspace-category-badge`，弹出菜单沿用 `.topbar-popover`。
- 界面颜色沿用 Taco token，状态色由四个 CSS 变量定义。

## 2. 状态图标

`todo`、`in_progress` 保留圆形进度语言；`complete` 使用填充圆与反白对勾，`freeze` 使用锁形轮廓与独立颜色。形状不依赖颜色也能分辨。

| 状态          | 图形             | 颜色变量            |
| ------------- | ---------------- | ------------------- |
| `todo`        | 空心圆           | `--status-todo`     |
| `in_progress` | 半填充圆         | `--status-progress` |
| `complete`    | 填充圆与反白对勾 | `--status-complete` |
| `freeze`      | 锁形轮廓         | `--status-freeze`   |

亮色与暗色主题各自定义清晰可辨的状态色。

- 实现为 `ui-primitives.ts` 中的 `createStatusIcon(status)`，所有位置都调用它。
- 图标不显示文字，但必须带 `aria-label`（状态名）和 `title`（悬停提示状态名）。
- Checkpoint 的聚合状态用同一套图标表示。

## 3. 左侧导航

```text
┌ Taco                               ＋  ◧ ┐
│ □┐□ Checkpoints                           │   ← workflow 图标
│                                            │   ← 加大间距，不绘制分隔线
│ 用户旅程                          ＋   ▢ │   ← 新增文件与冻结状态
│     journey.md                         ▢ │
│ 开发设计                               ◐ │
│     plan.md                            ◐ │
│     openapi.yaml (悬停显示可选图标)     ○ │   ← 占位行
│ 测试用例                               ○ │
│     test-cases.md                      ○ │
│ 开发就绪                               ○ │
│     tasks.md                           ○ │
│                                            │
│ 调研                                     │   ← 普通 category 行，与现在一致
│     notes.md                             │
└──────────────────────────────────────────┘
```

### 3.1 置顶的内置菜单项

- 位于品牌行下方的独立容器 `.sidebar-pinned` 中，不随文档树滚动；下方留出比分类间距更大的空白，不画分隔线。
- 结构沿用 `sidebarRow`：前导图标为 `workflow`（两个方块由折线相连），颜色 `--muted`；标签为"Checkpoints"，字重 500。**不显示计数。**
- 选中时的样式与 `.file-row.is-selected` 一致，同时取消文件的选中态。
- 没有悬停菜单，不可拖拽，没有右键菜单。
- `checkpoints` 非法时，不显示入口；品牌行下方显示包含错误路径的警告文字，不能进入 Checkpoints 视图。
- 没有 `checkpoints` 字段时，整个 `.sidebar-pinned` 不渲染。

### 3.2 category 行：Checkpoint 与普通分类

- Checkpoint 分组行沿用 `.stage-summary`，名称为 Checkpoint 的 `title`。右侧并列显示新增文件按钮和只读聚合状态图标。
- 不提供分组重命名、删除或拖放；新增文件默认选择该 Checkpoint category，但只写导航 manifest，不修改节点文档成员表，也不赋予状态。
- 聚合状态图标只用于展示，点击无效果；要修改状态，改的是其中的文档。
- 展开和收起行为与现有分组一致，展开状态的键为 `checkpoint-<id>`。
- 顺序：按拓扑层级排列，同层按 `id` 排序（spec §4）。
- 最后一个 Checkpoint 分组与后面的普通分组之间有一条 `--line` 细线。后面没有普通分组时不画。

### 3.3 文件行

- 已创建的 Checkpoint 文档状态图标固定在行尾，**悬停时也不隐藏**；`…` 菜单出现在它左侧，不遮挡状态图标。
- 点击状态图标，弹出状态菜单（§4.2）。这是在侧栏修改已创建文档状态的入口。
- 文件行菜单中只有"设为入口"和"重命名"；仅选择 Checkpoint category 的普通文件仍使用普通文件菜单，不显示状态。
- 入口文档在文件名后显示钥匙图标；可选文档显示 Icon Park Outline `optional` 图标。两者同时存在时并排排列，均仅在行悬停、键盘聚焦或选中时显现，整个文件行悬停底色连续。Checkpoint 与普通分类右侧的新增按钮分别与同组文件行操作按钮对齐。
- 占位行（文件未创建）：
  - 文件类型图标描边改为虚线，透明度 .55；
  - 文件名颜色为 `--muted`，`title` 提示"未创建"；
  - 点击文件名打开占位页；
  - 不显示状态图标或状态菜单；
  - 没有 `…` 菜单，不可拖拽。

### 3.4 新建文件对话框

- 类型、文件名、分类和操作按钮均使用当前语言的文案；类型卡片及所有对话框的确认/取消按钮沿用共享的 `control-button` 样式。
- 分类下拉列出 Checkpoint category、普通分类和未分组，默认选择打开按钮所在的分类。从 Checkpoint 分组创建的文件只归入侧栏 category，不改变 Checkpoint 节点的 `documents`，也没有状态。

## 4. 文件页头

### 4.1 分组标签

页头元素不变：文档集标题、分组标签（`categoryBadge`）、路径。**页头不显示状态。**

```text
[ 设计评审 ] [ 开发设计 ]  specs/demo/plan.md                              分享 复制 保存
              └ 分组标签内容为 Checkpoint 名；边框换成 Checkpoint 色，不可点击
```

- 对 Checkpoint 文档（包括占位页），分组标签的文字就是所属 Checkpoint 的 `title`，与普通分组标签的写法相同。
- 视觉上只有两处不同：
  - 边框颜色为 `color-mix(in srgb, var(--status-freeze) 55%, var(--line))`。这是 Checkpoint 的专属色，与"可编辑"标签的绿色边框区分开；
  - 标签不可点击：不加 `is-editable`，光标为默认样式，不弹出分组选择器。
- 悬停提示为"分组由 Checkpoint 决定"。如果文件自身声明的 category 被覆盖，提示改为"分组由 Checkpoint 决定，原 category「其他」未生效"。
- 非 Checkpoint 文档：分组标签仍可编辑，包括仅选择 Checkpoint category 的普通文件；这类文件不会得到状态或 DAG 成员身份。

### 4.2 状态菜单

从已创建的 Checkpoint 文档侧栏文件行或 Checkpoint 视图文档行点击状态图标，弹出的是同一个菜单：

```text
┌ 开发设计 · 必需                ┐
│ ○  待开始                       │
│ ◐  进行中                     ✓ │
│ ●✓ 已完成                       │
│ ▢  已冻结                       │
├───────────────────────────────┤
│ ⧉  在 Checkpoints 中查看         │
└───────────────────────────────┘
```

- 这是唯一在图标旁显示状态名的地方，用于选择。
- 当前状态用选项末尾的对勾和 `aria-checked` 标记。选择后立即关闭菜单，并提交一次 `document` 变更。
- 只读模式下，四个状态选项置灰、不可点击；"在 Checkpoints 中查看"仍可用。
- 键盘可用 Tab 聚焦、Enter 选择、Esc 关闭；不声明方向键切换选项。

## 5. 占位页

```text
                    ┌╌╌╌┐
                    ╎ ≡ ╎
                    └╌╌╌┘
                test-cases.md
          specs/demo/test-cases.md

              测试用例 · 必需

               [ 创建文件 ]
```

- 内容居中，最大宽度 420px，距顶部 18vh。
- 页头照常显示分组标签（Checkpoint 名）和路径。
- 只读模式下不显示"创建文件"按钮，改为一行提示"此文件尚未创建"。
- 创建成功后，页面原地切换到该文件的编辑器。

## 6. Checkpoints 视图

```text
Checkpoints: 设计评审

                 ┌──────────────────────────┐
                 │ 用户旅程                ▢ │
                 │   journey.md            ▢ │
                 └────────────┬─────────────┘
               ┌──────────────┴──────────────┐
┌──────────────▼───────────┐   ┌─────────────▼────────────┐
┃ 开发设计                ◐ │   ┃ 测试用例                ○ │
┃   plan.md               ◐ │   ┃   test-cases.md 未创建   ○ │
┃   openapi.yaml ◇ 未创建    ○ │   └─────────────┬────────────┘
└──────────────┬───────────┘                 │
               └──────────────┬──────────────┘
                 ┌╌╌╌╌╌╌╌╌╌╌╌╌▼╌╌╌╌╌╌╌╌╌╌╌╌╌┐
                 ╎ 开发就绪                ○ ╎
                 ╎   tasks.md              ○ ╎
                 └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

- 页头显示 `Checkpoints: <模板名称>`；名称可编辑，空名称显示占位提示。`template` 不改变 DAG 推导。右侧不显示 `frontier` 摘要或未关联状态记录；这些数据仍可由解析 API 读取。
- 用现有 `--surface`、`--sidebar-surface`、`--line`、`--line-strong`、`--ink`、`--muted`、`--accent-dark`，不另造图谱配色。卡片宽约 260px，细边框、小圆角、可辨认的柔和阴影；文档行最小高度 46px，上下各 10px 内边距。标题与文档状态在同一右侧图标列水平居中。
- 可用且未冻结的节点只用略带强调色的边框提示，不画左侧色条；等待前置节点用虚线边框和较淡标题，保留阴影。可用性只改变视觉提示，不限制状态操作；`frontier` 仍是 API 派生值。
- DAG 按拓扑层级纵向排列，同层横排且桌面不自动换行；内容超出工作区时由同一个阅读区域横向、纵向滚动。层间用 SVG 正交折线连接，起点保留圆端口，终点使用指向后继节点的箭头。可用性影响线色或虚线；滚动时连线仍随卡片移动，不独立承载操作或状态文字。
- 文档行点击文件名进入文件页或占位页，点击状态图标打开状态菜单；可选文档以 Icon Park Outline `optional` 图标标记，行悬停或键盘聚焦时显示，"未创建"保留文字。
- 窄屏（不大于 620px）同层节点纵向堆叠，不绘制连线，也不产生横向溢出；不以假连线暗示关系，依赖仍由 `after` 数据保留。

## 7. 状态变化时的反馈

- 状态修改后，以下位置在同一次 `store.commit` 中一起刷新：文件行图标、所在 category 行的聚合图标、Checkpoint 视图。
- 图标颜色切换使用 `140ms var(--ease-out)` 过渡；`prefers-reduced-motion` 下关闭。
- 保存按钮照常显示"未保存"标记。

## 8. 文案（i18n）

状态名只在状态菜单、`aria-label` 和悬停提示中出现。以下为中文和英文，其余已有语言需一并补齐：

| 键                         | 中文                                             | English                                          |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `checkpoints`              | Checkpoints                                      | Checkpoints                                      |
| `checkpointsInvalid`       | Checkpoints 定义无效                             | Invalid checkpoints                              |
| `statusTodo`               | 待开始                                           | To do                                            |
| `statusInProgress`         | 进行中                                           | In progress                                      |
| `statusComplete`           | 已完成                                           | Complete                                         |
| `statusFreeze`             | 已冻结                                           | Frozen                                           |
| `checkpointTemplateName`   | 模板名称                                         | Template name                                    |
| `checkpointUnnamed`        | 未命名                                           | Untitled                                         |
| `checkpointOptional`       | 可选                                             | optional                                         |
| `checkpointRequired`       | 必需                                             | required                                         |
| `checkpointMissingFile`    | 未创建                                           | Not created                                      |
| `checkpointOpenView`       | 在 Checkpoints 中查看                            | Show in Checkpoints                              |
| `checkpointCreateFile`     | 创建文件                                         | Create file                                      |
| `checkpointNotCreatedRead` | 此文件尚未创建                                   | This file has not been created                   |
| `checkpointGroupHint`      | 分组由 Checkpoint 决定                           | Grouped by checkpoint                            |
| `checkpointOverridden`     | 分组由 Checkpoint 决定，原 category「{0}」未生效 | Grouped by checkpoint; category "{0}" is ignored |
| `newFileType`              | 文件类型                                         | File type                                        |
| `newFileName`              | 文件名                                           | File name                                        |
| `newFileCategory`          | 分类                                             | Category                                         |
| `changeCategory`           | 更改分类                                         | Change category                                  |

## 9. 验收时的目视检查

1. 亮色和暗色主题下，四种状态图标都能区分；灰度截图中仅凭形状也能区分。
2. 侧栏宽度 250px 时，行悬停或选中显示紧贴文件名的入口与可选图标，两者可并排；分类新增按钮与文件操作按钮对齐，状态图标与 `…` 菜单互不遮挡，文件名正常省略，整行悬停底色连续。
3. 页头的 Checkpoint 分组标签边框颜色明显区别于可编辑标签，并且点击无响应。
4. 只读模式（Tacobin）下，状态菜单中的选项置灰，占位页不显示"创建文件"。
5. 窄屏抽屉模式下，同层节点纵向堆叠，连线隐藏，卡片和文档标记不被裁切。
