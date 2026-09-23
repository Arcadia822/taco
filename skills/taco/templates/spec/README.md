# SDD 阶段图示例（Feature Spec）

供具有独立 `spec.md` → `plan.md` → `tasks.md` 评审阶段的项目参考。它不是 Taco 默认流程或必须使用的 Checkpoint 模板；先遵循用户与项目的审阅约定，也可以不用 Checkpoint。

## 场景定位

- **目标**：以业务价值和用户旅程为中心定义产品需求、验收测试条件与边界条件。
- **推荐主入口**：`README.md` 或 `spec.md`。

## 示例字段（按项目约定调整）

- `title`: 功能特性全称（展示于 Taco 顶部与卡片）。
- `feature_id`: 逻辑编号（如 `001-user-auth`）。
- `created`: 起草日期（如 `2026-09-16`）。
- `status`: 状态（`Draft` / `Review` / `Approved`）。
- `input`: 用户原始自然语言输入描述。

## 包含文件

- `template.md`：可参考的规范骨架 Markdown；按项目实际内容和字段要求调整。
- `bundle.json`：示例 bundle，展示三阶段 Checkpoint 图；复制前调整 `root`、文档路径与身份，不要让示例覆盖已有评审状态。
- `empty.taco.html`：由示例 `bundle.json` 和 Taco shell 生成，可本地打开查看；它的位置不决定实际 Taco 的输出位置。
