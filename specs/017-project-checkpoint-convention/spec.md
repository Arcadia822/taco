---
title: '017-project-checkpoint-convention'
feature_id: '017-project-checkpoint-convention'
created: '2026-10-02'
status: 'Draft'
issue: 'https://github.com/Arcadia822/taco/issues/76'
linear: 'https://linear.app/castrel/issue/TACO-34'
input: |-
  TACO-34: [提案] 扩展 taco skill：写 Taco 时参考并遵循项目 Checkpoint 规范
---

## 1. 背景与问题

Taco 已经具备 Checkpoints（阶段 DAG、文档状态表、每份文档的 `instruction`），但 Agent 写 Taco 时不会主动参考项目里的 Checkpoint 规范；项目没有规范时，也没有人提出要不要建立。每次需求要产出哪些文档、每份文档的硬性要求，全凭会话临场判断。

原提案（新建 `taco-checkpoints` skill、`.taco/checkpoints.json` 第二份 schema、AGENTS.md 受管段落与字节幂等接线）已被用户在 2026-10-02 评审中否决：Checkpoint 是 Taco 的固有能力，不需要独立的 skill、schema 与初始化流程。本设计只在现有 `skills/taco/` 上做简短扩展。
