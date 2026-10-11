---
title: 'TACO-61 官方 Host 默认值'
issue: 'https://linear.app/castrel/issue/TACO-61/需求-taco-cli-默认-host-应指向官方-tacobin-站点tacoarcadia-hancom而非-localhost'
status: 'Implemented'
---

## 行为

`taco-cli` 未指定 Host 时连接 `https://taco.arcadia-han.com`。覆盖优先级保持 `--host > TACO_HOST_URL > 默认值`。本地开发显式传入 `--host http://localhost:32167`。帮助输出与实际目标共用 `DEFAULT_HOST`。

Host 的数据形态仍是 origin 字符串。沿用现有参数、环境变量、默认常量的解析链，不增加持久化配置或新模块。更新发布 skill、CLI 文档和官网示例。

## 验收

- 清除 `TACO_HOST_URL` 后，实际 CLI 发布请求使用官方 HTTPS origin。
- 环境变量覆盖默认值；显式参数覆盖环境变量，并支持 loopback HTTP 开发。
- 根命令及发布命令帮助显示官方默认值和原有覆盖优先级。
- `publish --dry-run` 保持离线运行。

导航路径校验是 Issue 附带发现，与 Host 默认值分开处理。本次不更改导航协议或凭据策略。

## 体积与依赖预算

prepare 预估基于本工作树构建产物。CLI 默认字符串从 22 字节增加到 28 字节，预计 JavaScript 产物增加 6 字节。npm 发布包预计增加不超过 1 KiB，包含 README 文字变化。skill 目录预计增加不超过 512 字节，仅发布指南变化。Complete shell、Lite shell 与默认 `.taco.html` 产物预计增加 0 字节。新设计文档的专用 Taco 数据块另计。

| 产物 | 基线字节 | 预计增量字节 | 实测字节 | 实测增量字节 | 偏差及原因 |
| --- | ---: | ---: | ---: | ---: | --- |
| CLI JavaScript | 80065 | 6 | 80071 | 6 | 无偏差，替换默认字符串 |
| npm 发布包 | 21033 | ≤1024 | 21056 | 23 | 低于预算，压缩后的 CLI 和 README 变化 |
| skills/taco/ | 14094920 | ≤512 | 14095014 | 94 | 低于预算，仅发布指南变化 |
| Complete `.taco.html` | 2846650 | 0 | 2846650 | 0 | 无偏差 |
| Lite `.taco.html` | 297311 | 0 | 297311 | 0 | 无偏差 |
| Complete skill shell | 2738186 | 0 | 2738186 | 0 | 无偏差 |
| Lite skill shell | 188847 | 0 | 188847 | 0 | 无偏差 |

无新增依赖。远程命令的默认联网目标从 localhost 改为官方站点。help、skills、dry-run 的离线行为保持不变。发布包未压缩体积从 85574 增至 85747 字节，增加 173 字节。shell 均未达到较大增大阈值。

实测命令为 `npm run check`、`npm run build --workspace @tacobin/cli`、CLI 目录下的 `npm pack --dry-run --json --ignore-scripts`，以及逐文件字节求和。shell 基线与实测使用相同工作树和构建口径。

## 实现验证

- `npm run check` 通过，56 个测试文件、648 项测试通过，Complete、Lite、Host shell 构建与门禁通过。
- 新增发布路由回归通过，断言实际 POST 地址、投影正文和返回 URL，覆盖默认、环境、显式参数；帮助默认值与实际请求 origin 比较。
- 构建 CLI 的合成文档发布探针在修改前因 localhost 目标失败，修改后默认官方地址、环境覆盖和显式 localhost 均退出 0。传输受控，未创建公开文档。实际官方服务发布未执行。
- 构建 CLI 的 `publish --dry-run` 退出 0，保持本地投影。
- 官网浏览器验证通过，终端示例直接发布且没有环境设置行。预览为 `http://127.0.0.1:32169`。
- 独立源代码审查未发现问题。原有 CLI、Host 独立 TypeScript 检查仍失败；通过编译器读取 HEAD 版本的改动文件作为基线，两组配置与当前诊断相同，没有新增诊断。根仓库规定的 `tsc -b` 已通过。

## 变更记录

TACO-61 将 CLI 默认 Host 切换到官方站点，保留原有覆盖优先级。同步 CLI 使用文档、发布 skill 和官网示例。采用现有单一常量，未增加 origin-policy 模块；该备选会扩大校验与模块迁移范围。
