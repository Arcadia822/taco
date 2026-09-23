---
title: '009-checkpoint-pipeline-and-document-status'
feature_id: '009-checkpoint-pipeline-and-document-status'
created: '2026-09-23'
status: 'Draft'
issue: 'https://github.com/Arcadia822/taco/issues/40'
---

## 1. 定位与边界

Taco 新增一项**状态记录能力**：一个 Taco 可以声明若干 Checkpoint 以及每个 Checkpoint 需要的文档，并记录每份文档的状态。它相当于人和 Agent 共用的一张 todo list，不是流程引擎。

已确认：

- 文档状态为 `todo` / `in_progress` / `complete` / `freeze` 四种。
- 状态只是标记。Taco 不校验权限、可信度或审批人，人和 Agent 都可以改任意状态。
- `freeze` 只是一个状态值，不绑定内容，也不做任何 hash 校验。
- 状态存放在 Taco bundle 中，不写进文档正文或 frontmatter。
- 不支持条件要求。每条文档要求只有一个内置的 `optional` 标记。
- Checkpoint 之间是有向无环图（DAG），允许并行分叉和汇合。
- Checkpoint 内部的文档是无序集合，文档之间只区分是否 `optional`。一个文件最多属于一个 Checkpoint。
- Checkpoint 是一种挂载了附加属性的 category；category 不一定是 Checkpoint（§7）。
- 不做任何 hash 校验：既不计算内容 hash，也不计算定义 hash。原因是 Agent 直接写数据块，没有编译步骤，算不出 hash；只在浏览器里计算也无法判断 Agent 是否改过内容。
- Agent 可以直接解析 `.taco.html` 的数据块，也可以在浏览器控制台调用 `window.taco`。skill 还会附带一个解析脚本。
- Tacobin 需要同步升级：发布时携带 `checkpoints`，页面上只读展示。暂不支持人在线编辑。

不做：门禁强制、阶段解锁控制、通知、流程编排、在 Taco 界面中编辑 Checkpoint 定义。

## 2. 现有代码依据

| 位置                                            | 现状                                                                                                                       | 本特性的关系                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/model.ts` `TacoBundle`                     | 顶层字段有 `docId`、`comments`、`navigation`，并通过 `[extra: string]: unknown` 允许扩展字段                               | 新增顶层字段 `checkpoints`，与 `navigation` 同级                                               |
| `src/navigation.ts` `resolveDocumentNavigation` | 分组优先级依次为：navigation manifest、自定义 category、stage 路径约定。每个文件只能进一个分组（由 `assignedPaths` 去重）  | 先生成不可修改的 Checkpoint 分组，其余文件仍按原优先级解析（§7）；未创建文件显示为占位行（§6） |
| `src/category.ts` `resolveFileCategory`         | 根目录文件用自身 frontmatter 的 `category`；子目录文件跟随一级目录的 `_dir.yaml`（`canEdit: false`）；都没有则归入"未分类" | 最高优先级新增来源 `checkpoint`：Checkpoint 是挂有附加属性的 category，见 §7                   |
| `src/file-browser.ts` 新建文件                  | 可编辑时支持通过 `showNewFileDialog` 新建文件                                                                              | 占位页里的"创建文件"复用这个流程                                                               |
| `src/main.ts` `window.taco`                     | 已有 `listFiles`、`readFile`、`search`、`getReviewHandoff`                                                                 | 新增 `getCheckpoints()`，Handoff 中带上状态变化                                                |
| `packages/protocol/src/projection.ts`           | `ALLOWED_TOP_LEVEL_PROPERTIES` 中没有 `checkpoints`，遇到未知顶层字段直接拒绝                                              | 需要放行并做校验（§10）                                                                        |
| `skills/taco/SKILL.md`                          | 刷新时要求保留 `comments`、`navigation` 及其他已有字段                                                                     | 这条规则已覆盖 `checkpoints`，仍需显式写进保留清单                                             |
| `extensions/taco/templates/*/bundle.json`       | 模板包提供初始 bundle                                                                                                      | 作为模板化 Checkpoint 定义的载体（§9）                                                         |

## 3. 数据模型

`checkpoints` 是 bundle 顶层的可选字段。没有这个字段的 Taco，行为与现在完全一致。

```json
{
  "checkpoints": {
    "version": 1,
    "template": "feature-default",
    "nodes": [
      {
        "id": "journey",
        "title": "用户旅程",
        "after": [],
        "documents": [{ "path": "specs/demo/journey.md" }]
      },
      {
        "id": "design",
        "title": "开发设计",
        "after": ["journey"],
        "documents": [
          { "path": "specs/demo/plan.md" },
          { "path": "specs/demo/contracts/openapi.yaml", "optional": true }
        ]
      },
      {
        "id": "tests",
        "title": "测试用例",
        "after": ["journey"],
        "documents": [{ "path": "specs/demo/test-cases.md" }]
      },
      {
        "id": "ready",
        "title": "开发就绪",
        "after": ["design", "tests"],
        "documents": [{ "path": "specs/demo/tasks.md" }]
      }
    ],
    "documents": [
      { "path": "specs/demo/journey.md", "status": "freeze", "updatedAt": "2026-09-23T08:00:00Z" },
      { "path": "specs/demo/plan.md", "status": "in_progress", "updatedAt": "2026-09-23T09:00:00Z" }
    ]
  }
}
```

`checkpoints` 分成两部分：`nodes` 是**静态定义**，`documents` 是**状态表**。

### 字段

- `version`：固定为 `1`。
- `template`：可选的 Checkpoint 模板名称，不参与派生状态；Checkpoints 页头显示并允许编辑。未命名时显示占位名称。
- `nodes[]`：Checkpoint 定义。
  - `id`：非空字符串，在所有 `nodes` 中唯一。
  - `title`：非空字符串，用于展示。
  - `after`：前置 Checkpoint 的 `id` 集合。空集合表示起点；多个前置表示汇合；多个节点共享同一个前置表示并行分叉。
  - `documents[]`：本 Checkpoint 需要的文档集合。`path` 是完整的 bundle 路径，以 `root/` 开头，写法与 `navigation.groups[].paths` 一致。`optional` 可省略，默认 `false`。
- `documents[]`：状态表，每个 `path` 最多出现一次。
  - `status`：`todo` / `in_progress` / `complete` / `freeze` 之一。
  - `updatedAt`：最近一次修改状态的时间，RFC3339 UTC。

### 为什么状态放在 bundle 顶层，而不是 `files[]`

1. 状态为 `todo` 的文档往往还不存在，`files[]` 里没有对应条目。
2. Agent 刷新时会根据 canonical 目录重新生成 `files[]`。按现有规则，顶层字段会原样保留；而文件级扩展字段在重建时容易丢失。
3. 状态表与定义分开存放：状态变化只更新 `documents`；页头改名更新 `template`。文件创建、重命名或删除不会修改 Checkpoint 的成员定义 `nodes`，文档要求仍由 Agent 在数据块中独立维护。

### 默认值与校验

- 被 `nodes[].documents` 引用、但状态表里没有记录的路径，视为 `todo`。状态表允许出现没有被任何 Checkpoint 引用的路径；解析接口保留这些记录，但 Checkpoints 页面和导航均不展示。
- 以下任一情况都算校验失败：
  - `id` 重复；
  - `after` 中有重复元素，或引用了不存在的 `id`；
  - 依赖关系出现环；
  - 同一个 `path` 出现不止一次，无论在同一个 Checkpoint 内还是跨 Checkpoint（一个文件最多属于一个 Checkpoint）；
  - `path` 不安全，或不在 `root/` 下；
  - 状态值不合法。
- 校验失败时，界面忽略整个 `checkpoints`，给出可见的警告，保存时**原样写回**原始值。这与 `navigation` 非法时直接丢弃的做法不同，因为状态数据只有这一份，丢了无法从文件树重新推导。

## 4. 排列规则

节点顺序、`after` 顺序和文档顺序都没有语义，所以展示不依赖书写顺序。语义相同的定义，渲染结果一定相同：

- DAG 按拓扑层级自上而下排列，同层节点按 `id` 排序。
- 节点内的文档先列必需文档、后列 optional 文档，每组内部按 `path` 排序。
- 排序一律按字符串的 UTF-16 码元字典序（JS 默认 `sort()`）。

## 5. 派生状态

以下内容都是计算得出、不存储的。浏览器、`window.taco`、skill 脚本和 Tacobin 共用同一个同步纯函数 `resolveCheckpoints(bundle)`。它放在 `packages/protocol/src/checkpoints.ts`：008 AD-0 禁止 Host 导入 `src/`，所以纯逻辑必须放在 `@taco/protocol` 里，由 `src/` 引用。

每份文档派生：

- `exists`：`files[]` 中是否存在该路径。
- `status`：状态表中的值；没有记录时为 `todo`。
- `optional`：是否可选。

每个 Checkpoint 派生：

- **参与聚合的文档**：所有非 `optional` 的文档；如果全部都是 `optional`，则取全部文档。
- **聚合状态**：
  - 参与文档全部为 `freeze` → `freeze`；
  - 全部为 `complete` 或 `freeze` → `complete`；
  - 全部为 `todo` → `todo`；
  - 其余情况 → `in_progress`。
- `available`：所有前置 Checkpoint 的聚合状态都是 `freeze`。起点恒为 `true`。它只是提示，不限制任何操作。
- `missing`：参与聚合、状态不是 `todo`、但文件不存在的文档。

Taco 级派生：`frontier`，即 `available` 为真、且聚合状态不是 `freeze` 的 Checkpoint 列表。它保留在解析接口中供 Agent 使用，不在 Checkpoints 页面显示摘要或列表。

## 6. 导航中的未创建文件

**决策：展示。** 被 Checkpoint 引用但不在 `files[]` 中的路径，在左侧导航中显示为占位行。这样文档要求的全貌在导航里就能看到，而导航本来就是人最先看的地方。只在 Checkpoint 视图中列出，很容易被忽略。

放置规则：每个占位文件都属于某个 Checkpoint，所以占位行总是出现在所属 Checkpoint 的分组中，与导航模式无关（§7）。不另设"未创建"分组。

展示方式：

- 占位行颜色变浅，图标为虚线轮廓，右侧通过提示显示"未创建"；optional 图标仅在行悬停、聚焦或选中时出现。
- 点击后打开占位页，而不是编辑器。占位页显示：
  - 路径；
  - 所属 Checkpoint，以及是否 optional；
  - 不显示状态；未创建的路径只有定义中的成员关系，尚无文件状态操作入口。
- Taco 可编辑时，占位页提供"创建文件"按钮。它复用现有的新建文件流程：路径预先填好，mediaType 根据扩展名推断，推断不出时回落到新建对话框，内容为空。创建之后，占位行变成普通文件行；已有的路径状态记录不因创建而改变。

占位文件**不进入**以下任何位置：`files[]`、保存内容、搜索、`listFiles`、`readFile`、Handoff 的 `changedFiles`、安全校验、评论锚点。

创建、重命名或删除文件均不修改 `nodes`。新建文件如果与已声明的路径相同，占位行自动变为文件行；如果路径不在 `nodes[].documents` 中，即使从 Checkpoint 分组的新增按钮进入新建对话框，也不会成为 Checkpoint 文档。该对话框可以选择 Checkpoint category，仅影响导航分组。

## 7. Checkpoint 与 Category 的关系

**决策：Checkpoint 是一种 category，额外挂载了附加属性；反过来，category 不一定是 Checkpoint。**

这个模型将导航中的 category 与 Checkpoint 文档成员区分开：文件可以选择 Checkpoint category 来分组，但只有 `nodes[].documents` 中明确声明的路径才是 Checkpoint 文档，具有状态和 DAG 归属。附加属性是依赖关系 `after`、文档的 `optional` 标记及各文档的状态。

### 成员归属：由 Checkpoint 按路径声明

Checkpoint 的成员只由 `nodes[].documents[].path` 决定，**不读**文件 frontmatter。原因：

1. 需要的文档可能还没创建，这时不存在 frontmatter 可以用来声明归属。
2. 定义只读，归属就不会因为编辑文档内容而意外改变。

### category 解析优先级

`resolveFileCategory` 新增最高优先级来源 `checkpoint`：

1. `checkpoint`：路径出现在某个 Checkpoint 中 → category 为该 Checkpoint，`canEdit: false`。
2. `root-file`：根目录文件自身 frontmatter 中的 `category`。
3. `first-level-dir`：一级目录 `_dir.yaml` 中的 `category`。
4. **"未分类"**。

- 冲突处理：Checkpoint 成员如果自身 frontmatter 或所在目录的 `_dir.yaml` 声明了另一个 category，以 Checkpoint 为准。页头分组标签的悬停提示说明原 category 未生效；不修改文件内容。
- Checkpoint 成员的页头分组标签只显示 Checkpoint 标题，边框略作区分，不显示状态、不可点击，也不能改归属。要改归属只能改定义，而定义在界面中只读（ui.md §4）。
- 同一目录里，不属于任何 Checkpoint 的文件仍按原规则解析；它也可以通过导航 manifest 显式选择 Checkpoint category，而不成为 Checkpoint 文档。

### 分组身份与导航

- Checkpoint 分组的 id 为 `checkpoint-<id>`，标题取 Checkpoint 的 `title`，与普通 category 分组的 `category-<name>` 不在同一命名空间。导航 manifest 使用相同的 Checkpoint 分组 id 记录非成员文件的 category 选择；这类文件仅在侧栏归组，不进入节点文档列表。
- frontmatter 中写的 category 字符串即使与某个 Checkpoint 的 `title` 相同，也**不会**加入该 Checkpoint。此时导航中会出现两个同名分组，Checkpoint 分组带有 Checkpoint 标记，并给出校验警告；显式选择 Checkpoint category 时则不会产生同名分组。
- 现有规则中"category 值为 `spec` / `plan` / `tasks` 时交给原生 stage 导航"（`navigation.ts`），只适用于 frontmatter 和 `_dir.yaml` 中的值，不适用于 Checkpoint 分组。因此 `spec` 模板中 id 为 `spec` / `plan` / `tasks` 的 Checkpoint 不会被 stage 导航吸收。
- **Checkpoint 的已有文档归属不可拖动或重命名，并且在任何导航模式下都生效。** 导航解析分两步：
  1. 先按 `checkpoints` 生成 Checkpoint 分组，每个分组收纳该 Checkpoint 的全部文档，包括占位行。分组按 §4 的布局顺序排列：先按拓扑层级，同层按 `id`。
  2. 其余文件（不属于任何 Checkpoint 的文件）继续按现有优先级 manifest > category > stage 解析；manifest 显式指定 `checkpoint-<id>` 的文件显示在对应 Checkpoint 分组中，但没有状态图标，其余文件接在 Checkpoint 分组之后。
- 第 2 步中，manifest 的 group 如果列出了某个 Checkpoint 文档的路径，这一项会被忽略，文档仍留在自己的 Checkpoint 分组里，并给出警告。manifest 原值保留，不做清理。
- 仅凭 `checkpoints` 本身不会触发 category 模式。模式切换仍只由其余文件的 frontmatter 和 `_dir.yaml` 决定。
- 界面限制：Checkpoint 分组不能重命名、删除，也不接受拖放；可编辑模式下保留分组行的新增文件按钮，默认选择该 Checkpoint category，但新文件不修改 `nodes`，也没有状态。已有 Checkpoint 文档不能移到其他分组（`moveFileToGroup`），也不能改 Category。设为入口（`setNavigationEntry`）仍然允许。
- Checkpoint 分组的组头右侧显示聚合状态图标；只有已创建的 Checkpoint 文档行右侧显示可点击的文档状态图标，未创建占位行和仅选择该 category 的文件均不显示状态。
- Checkpoints 视图保留，用来展示 DAG 及各节点的可用性：导航只能表现成员归属，无法表现依赖关系。语义上的 `frontier` 仍由 API 提供，不单独写成页面文案。入口规则见 §8。

## 8. 界面

界面细节（状态图形、导航、文件页头、占位页、Checkpoints 视图、文案）以 [ui.md](ui.md) 为准。本节只列出行为约束。

- **Checkpoint 菜单项**：这是导航中内置的默认菜单项，**不是文档**，与文档导航区分开。
  - 固定在导航最上方，和文档导航之间不画分隔线；以大于普通分类间距的留白区分，不随文档树滚动，也不参与分组。
  - 不在 `files[]` 中，不参与搜索，不能重命名、删除，也不能设为入口。
  - 只在 `checkpoints` 合法时出现。
  - 选中后，主区域显示 Checkpoint 视图。
- **Checkpoints 视图**：页头为 `Checkpoints: <模板名>`，模板名可编辑并写入 `checkpoints.template`；未命名时显示占位名称。DAG 按 §4 的布局规则自上而下展开。
  - 不显示 `frontier` 摘要或未关联状态记录列表。
  - 节点显示标题、聚合状态及可用性视觉提示；节点内各文档显示状态、是否可选、是否已创建。点击文档跳转到对应的文件页或占位页。
- **状态切换**：点击已创建的 Checkpoint 文档侧栏文件行或 Checkpoints 视图文档行的状态图标，在菜单中切换四种状态，每次实际切换都更新 `updatedAt`；占位页和文件页头没有状态控件。
- 状态变化和其他编辑一样是内存中的未保存修改：⌘S 保存进 `.taco.html`，Handoff 会带出这些变化。
- 除模板名外，Checkpoint 定义（`nodes`）在界面中只读；文件创建与成员定义互不耦合。

## 9. 模板

用于真实项目的模板只声明 `checkpoints` 的 `version`、`template`、`nodes`，状态表为空。它放在模板包的 `bundle.json` 中，与 `navigation` 并列。提供：

- `spec` 模板包：`spec` → `plan` → `tasks` 三个 Checkpoint。现有 navigation manifest 里只列了这三个文件，在 Checkpoint 分组下已无作用，因此一并删除。
- 新增快速需求模板：只有一个 Checkpoint，覆盖需求说明和任务。
- `checkpoint-scroll` 演示模板：10 层 × 5 列共 50 个节点、200 条文档要求，部分文档已创建并带演示状态，用于检验双轴滚动与连线；它不是实际项目的审批模板，复制到真实项目时必须替换演示数据并清空示例状态。

模板包遵守现有规则：canonical 源位于 `extensions/taco/templates/`，`skills/taco/templates/` 是逐字节一致的生成镜像。不另建模板注册表或模板选择界面，Agent 创建 Taco 时从模板包复制 `checkpoints` 即可。

## 10. Agent 接口与 Tacobin

Agent：

1. **直接读写文件**：`checkpoints` 位于 `#taco-document` 数据块中，Agent 可以直接修改，刷新时必须保留。
2. **浏览器控制台**：`window.taco.getCheckpoints()` 返回 `resolveCheckpoints(bundle)` 的派生结果，包含 `raw`、`valid`、`error?`、`state?`、`nodes[]`、`documents[]`、`layout`、`frontier[]` 和 `unlinked[]`；它反映尚未保存的内存状态。`frontier` 与 `unlinked` 不在页面单独列出。`getReviewHandoff()` 的 `checkpointChanges[]` 记录 `{ path, from, to }` 状态变化，`checkpointTemplateChange` 记录模板名变化，`checkpointDocumentAdditions[]` 记录新增成员。
3. **skill 脚本**：`skills/taco/scripts/checkpoints.mjs <file.taco.html>`，输出与 `getCheckpoints()` 相同的 JSON。它由 `packages/protocol/src/checkpoints.ts` 构建生成，属于生成产物，不能手改。
4. **SKILL.md 需要补充**：字段说明；写入规则（`updatedAt` 使用 UTC）；以上三种读取方式；建议 Agent 按 `frontier` 推进工作，在某个 Checkpoint 的文档都达到 `complete` 后请人审阅（这是建议，不是约束）；刷新时必须保留 `checkpoints`。

Tacobin：

- `projection.ts` 放行 `checkpoints`，按 §3 的规则校验，发布快照中原样携带。校验失败时报错，不静默剥离。008 的 `contracts/protocol.schema.json` 快照白名单需要同步加入 `checkpoints`。
- Host 阅读页用 `renderCanonicalTacoHtml` 把快照注入同一个 Taco shell，并设置 `access: 'reader'`。因此，快照只要带上 `checkpoints`，Checkpoint 菜单项、Checkpoint 视图、无状态的导航占位行及已创建成员的状态圆点就会自动得到只读展示。只读由 `bundleCanWrite` 为 false 来保证：已创建成员的状态控件和"创建文件"按钮都要按这个条件禁用。
- 首版不支持在线修改状态，不新增状态变更事件，也不创建占位文件。

Taco 实时协作（relay）：

- `src/sync/validation.ts` 中，`rebuildSyncDoc` 目前只保留 `title` 和 `navigation`，`DOC_SET_KEYS` 同样只放行这两个键。不改的话，协作会话中应用一次远端文档就会丢掉 `checkpoints`。
- 需要把 `checkpoints` 按 §3 校验后加入这两处。状态修改走 `document` 变更，整个 `checkpoints` 对象按最后写入者生效（LWW）。这对状态工具来说可以接受，两个人同时改不同文档的状态时，后写的一方会覆盖先写的。

## 11. 验收场景

1. 没有 `checkpoints` 的 Taco：界面、导航、保存结果与现在完全一致。
2. 打开 §3 的示例：
   - 聚合状态：`journey` 为 `freeze`，`design` 为 `in_progress`；
   - `design` 和 `tests` 为 `available`，`ready` 不是；
   - `frontier` 为 `[design, tests]`。
3. 已冻结的 `journey.md` 被修改后，状态仍为 `freeze`，界面没有任何提示。Taco 不做内容校验。
4. `design` 中 optional 文档一直为 `todo`、`plan.md` 为 `freeze` 时，`design` 的聚合状态为 `freeze`。
5. 调整示例中 `nodes` 的顺序、`after` 的顺序、文档顺序，或者补写、省略 `optional: false`，渲染结果与派生结果都保持不变。
6. 同一个 `path` 出现在两个 Checkpoint 中，或在同一个 Checkpoint 内重复：校验失败并给出警告，保存后 `checkpoints` 原值保留。`after` 成环时同样处理。
7. 示例中 `test-cases.md` 不存在：
   - 无论导航处于哪种模式，占位行都出现在 `tests` 的 Checkpoint 分组中；
   - 点击后打开无状态控件的占位页，可以"创建文件"，创建后变成普通文件行，已有的路径状态记录不变；
   - 占位文件不出现在搜索、`listFiles`、保存后的 `files[]` 中。
8. navigation manifest 的某个 group 列出了 `specs/demo/plan.md`：该文件仍在 `design` 分组中，这一项被忽略并给出警告，manifest 原值保留。界面上不能把 `plan.md` 移到其他分组，也不能重命名或删除 `design` 分组；从该分组的新增按钮创建普通文件时，默认选中 `design` category，`nodes` 不变，该文件没有状态。manifest 中其余非 Checkpoint 文件照常排列。
9. Checkpoint 与 category 的交互：
   - 根目录文件 frontmatter 写 `category: 其他`，同时被 Checkpoint `design` 引用：导航中它归入 `design` 分组；页头显示不可点击的 Checkpoint 标题标签，悬停提示原 category「其他」未生效；文件内容不变。
   - 从 `nodes` 中移除这个文件后，它回到"其他"分组。
   - 不属于 Checkpoint 的文件可选择 Checkpoint category，在对应侧栏分组显示，但不进入 `nodes[].documents`、Checkpoints 视图或状态表；仍可从页头更改分类。
   - `spec` 模板打开后，导航显示 `spec` / `plan` / `tasks` 三个 Checkpoint 分组，而不是 stage 导航。
   - 给文件改状态不改变它的 frontmatter 和 `_dir.yaml`。
10. 通过界面切换状态并按 ⌘S：数据块中只有 `documents` 发生变化，`nodes` 和其他字段逐字节不变。
11. 对同一个文件，`getCheckpoints()` 与 `checkpoints.mjs` 的派生结果一致；控制台结果包含未保存的修改。Handoff 中列出本次改过的状态。
12. 带 `checkpoints` 的 Taco 执行 `publish --dry-run` 时不报"未声明字段"。发布后，Host 页面只读展示 Checkpoint 菜单项和视图，派生结果与本地一致。
13. `skills/taco/templates/` 与 `extensions/taco/templates/` 逐字节一致。
14. Checkpoints 页头编辑模板名后，`checkpoints.template` 与 Handoff 同步更新；只读模式不可编辑。通过 Checkpoint 分组新增文件时，默认选中该 Checkpoint category，也可选择已有普通 category 或未分组，`nodes[].documents` 保持不变，页头 category 切换对新文件仍可用，Handoff 只报告新文件。目录里若同时存在 `optional` 与入口属性，两个图标并排且只在悬停、聚焦或选中时显示。
