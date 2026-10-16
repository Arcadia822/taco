只认领带 factory-e2e:service-live-post-magpie-20261016-a3 批次标识且属于本服务范围的 issue
只允许两条业务 issue：第一条给 post-magpie-a3-review，第二条给 post-magpie-a3-navigation
交付 PR 必须：分支名包含对应 Linear issue 键；标题与正文用中文；先 Draft 后 Ready for review；正文链接该 issue 的完整 URL
第二条 issue 是 TACO-52 的最小独立子项：只对新建子 issue 用 Fixes 链接其 URL；若父项在 Linear 中已关联，写 Part of TACO52，绝不用 Fixes 链接父项
绝不 merge、绝不 force push、绝不改基线分支
绝不安装外部调度器，只依赖 harness 原生推进能力
