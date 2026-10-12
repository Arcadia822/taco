# PRD（产品需求文档）模板包

适用于新产品、重大改版或跨端/多模块工程的需求定义，作为「重度文档集」的需求层（PRD + IxD + Architecture + Contracts）使用。

## 场景定位

- **目标**：一次讲清问题、目标与成功指标、用户场景、需求优先级、边界与风险，供人评审拍板。
- **何时用**：跨端或多模块工程、需要明确产品取舍与成功指标时。单点修复或局部改动不要套 PRD；中等改动从 `spec/` 或 `interaction/` 起步。
- **推荐主入口**：`prd.md`。

## 导航推荐结构

1. **需求（Requirements）**：问题与目标、用户与场景、按优先级排列的需求。
2. **验证（Validation）**：成功指标与可验收条目。

## 包含文件

- `template.md`：PRD 通用骨架，含待决决策项（Pending Decisions）章节。
- `bundle.json`：预设分组的最小化 PRD 文档 bundle。
- `empty.taco.html`：开箱即用的空白 PRD Taco，可本地打开查看；它的位置不决定实际 Taco 的输出位置。

## 轻中重选用

轻量改动只写单篇 `spec.md`，不要套 PRD。中等改动用 `spec.md` + `interaction/`。重度工程以 PRD 为需求层，按需补 `interaction/`（交互层）、`architecture/`（架构层）与 `api-reference/`（契约层），契约只保留一份权威定义。
