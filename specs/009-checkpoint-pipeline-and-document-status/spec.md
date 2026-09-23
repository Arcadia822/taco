---
title: '009-checkpoint-pipeline-and-document-status'
feature_id: '009-checkpoint-pipeline-and-document-status'
created: '2026-09-23'
status: 'Proposed'
priority: 'high'
issue: 'https://github.com/Arcadia822/taco/issues/40'
---

## 1. 业务背景与问题定义

在 AI Coding Agent 参与软件研发的协作场景中，设计与架构阶段往往存在强规范约束：
- 某些开发需求必须具备**用户旅程 (User Journey)**；
- 架构设计必须包含**系统设计方案 (System Design)** 与 **测试用例 (Test Cases)**；
- 若涉及接口变动，必须具备前置的 **OpenAPI / 接口契约文档 (API Contract)**。

当前存在的核心痛点：
1. **Agent 缺乏阶段感知**：Agent 容易一次性跨阶段“抢跑”，在未经人类评审用户旅程的情况下，便直接编写具体的开发设计或生成接口实现，导致大量返工。
2. **缺乏文档完备度度量**：Taco 容器虽然可以容纳多个 Markdown 文件，但缺乏对“当前任务需要哪些文件”、“哪些文件尚未编写”、“哪些在审”、“哪些已通过锁定”的形式化状态机。
3. **缺乏显式的人机审查门禁 (Checkpoints)**：人类无法直观掌控阶段交付边界，Agent 也缺乏明确信号判断何时应当挂起并等待人类在 Taco 页面中审批。

---

## 2. 核心设计：Checkpoint 阶段树与文档状态机

### 2.1 文档完备度状态机 (Document Readiness State)

在 Taco 数据契约中为每一个受管文档定义三级生命周期状态：

```
[ pending (待撰写 / 缺失) ]
            │
            ▼ (Agent 生成 / 更新)
[ in_review (审查修改中) ]
            │
            ▼ (人类审查签署 / Approve)
[ locked (已审查锁定 / 只读保护) ]
```

- **`pending`**：阶段规范所要求的必备文档尚未创建或为空，此时不可推进对应 Checkpoint 闭环。
- **`in_review`**：文档已编写或产生新修订，允许人类与 Agent 进行行间高亮批注与多轮迭代。
- **`locked`**：人类审查者（Reviewer）完成核准后显式锁定。在后续阶段中，该文档作为前置基线不可被 Agent 随意篡改，保障契约稳定性。

---

### 2.2 树形分阶段门禁模型 (Checkpoint Pipeline Tree)

Checkpoint 将研发过程组织为有向流转的阶段树（典型为自顶向下的阶段流水线）：

```
[ Stage 1: 用户探索与需求定义 (User Journey & Requirements) ]
  ├── 必需文档: user-journey.md (状态: locked)
  ├── 必需文档: requirements.md (状态: locked)
  └── 门禁决策: 人类签署核准 (Sign-off) ──► 【PASS: 解锁 Stage 2】
         │
         ▼
[ Stage 2: 方案原型与系统设计 (Architecture & Prototypes) ]
  ├── 必需文档: system-design.md (状态: in_review)
  ├── 必需文档: api-contract.yaml (状态: in_review)
  ├── 可选文档: prototype.html (状态: pending)
  └── 门禁决策: 等待所有必需文档 locked ──► 【PAUSED: 等待人类审阅】
         │
         ▼ (锁定后解锁)
[ Stage 3: 测试验证与实施分解 (Verification & Tasks) ]
  ├── 必需文档: test-cases.md (状态: pending)
  └── 必需文档: tasks.md (状态: pending)
```

#### 阶段流转规则：
1. **严格拓扑顺序**：前序 Checkpoint 未全部满足（即所有必需文档状态均为 `locked` 且获得人类 Sign-off）前，后续阶段保持锁定。
2. **Agent 边界自知**：Agent 读取 Taco 状态时，可以一眼推导：
   - 当前处于哪一个活跃 Checkpoint；
   - 还可以编写/修改哪些处于 `pending` 或 `in_review` 的文档；
   - 当前阶段文档已完备时，立即发出停止修改信号，通知人类前往 Taco 审查；
   - 严禁擅自修改已 `locked` 的上游文档。

---

### 2.3 Taco 容器内置树形可视化视图 (Interactive Checkpoint View)

在 Taco 单文件应用中新增自包含的 **Checkpoint Pipeline Dashboard** 视图：
- **自顶向下的树形节点渲染**：每一层清晰呈现阶段名称、目标、要求文档清单与当前进度徽标（`0/2 Locked`、`In Review`、`Ready for Sign-off`）。
- **点击直达与文档高亮**：点击任一文档直接在 Taco 阅读器中展开对应内容或 Diff 视图。
- **审查签署交互条 (Sign-off Bar)**：在 Checkpoint 满足所有前置条件后，为人类审查者提供明显的 `Approve & Lock Checkpoint` 操作按钮，点击后向 Taco 数据块写入签名并广播状态事件。

---

### 2.4 模板化与可定制性 (Checkpoint Templates)

研发流的阶段数量与具体文档要求完全解耦，支持模板化配置：
- **`quick-feature` (轻量需求模板)**：仅 2 个 Checkpoint（需求定义 → 任务分解）。
- **`standard-spec` (标准规约模板)**：3 个 Checkpoint（用户旅程 → 架构与接口 → 测试与任务）。
- **`critical-arch` (核心高危改造模板)**：4 个 Checkpoint（问题定义与指标 → 协议契约与威胁建模 → 迁移计划 → 降级测试）。

---

## 3. 契约定义与数据模型扩展 (Data Schema)

在 Taco 根元数据中增加 `pipeline` 与 `checkpoints` 结构（草案）：

```json
{
  "taco": {
    "version": "1.1",
    "pipeline": {
      "template": "standard-spec",
      "current_checkpoint": "stage-2",
      "checkpoints": [
        {
          "id": "stage-1",
          "name": "用户旅程与需求对齐",
          "status": "passed",
          "unlocked_at": "2026-09-23T08:00:00Z",
          "approved_at": "2026-09-23T09:30:00Z",
          "approved_by": "reviewer@arcadia",
          "requirements": [
            { "path": "user-journey.md", "required": true, "status": "locked" },
            { "path": "requirements.md", "required": true, "status": "locked" }
          ]
        },
        {
          "id": "stage-2",
          "name": "系统设计与接口契约",
          "status": "in_progress",
          "requirements": [
            { "path": "system-design.md", "required": true, "status": "in_review" },
            { "path": "contracts/openapi.yaml", "required": true, "status": "in_review" },
            { "path": "prototypes/flow.html", "required": false, "status": "pending" }
          ]
        },
        {
          "id": "stage-3",
          "name": "测试用例与开发任务",
          "status": "blocked",
          "requirements": [
            { "path": "checklists/test-cases.md", "required": true, "status": "pending" },
            { "path": "tasks.md", "required": true, "status": "pending" }
          ]
        }
      ]
    }
  }
}
```

---

## 4. 实施规划与验收标准

1. **协议层**：扩展 Taco 容器元数据，校验 checkpoint 的拓扑有效性与文档引用关系。
2. **UI 视图层**：在 Taco 前端增加交互式树形阶段视图（支持折叠、节点连线、文档卡片与一键 Sign-off）。
3. **Agent 协同层**：在 `taco-cli` 与 Agent Skill 中增加 `taco checkpoint status` 与 `taco checkpoint advance` 指令，使 Agent 能机器读取当前阶段并判断是否该触发等待。
