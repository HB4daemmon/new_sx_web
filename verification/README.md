# 验证产物

本目录同时保留历史验证记录和当前发布验证。当前发布元数据如下：

- 内容与规则版本：`4.3.0`
- 界面修订：`17.1`
- 当前浏览器存档键：`fengshen-run-v43`
- Node.js：`22` 或以上

## 当前报告

从仓库根目录运行以下命令可重复生成当前模拟和平衡报告：

```sh
npm run verify:reports
```

该命令依次执行 `npm run build`、`npm run simulate` 和 `npm run balance`。也可以分步运行：

```sh
npm run build
npm run simulate
npm run balance
```

生成文件：

- `simulation.json`：`tests/simulate.mjs` 使用 `tests/policy.mjs`，对每个出身运行 `SIM-0` 至 `SIM-39`，共 200 局。
- `balance-audit.json`：`tests/balance-audit.mjs` 使用同一确定性策略，覆盖 4 个族裔 × 5 个出身 × 25 个种子，共 500 局。

模拟报告会记录内容/规则版本、UI 修订号、存档键、生成命令、固定种子模式、策略文件哈希和内容哈希，并以 `deterministic: true` 标记其用途。平衡报告中的 `failures` 必须为空；两份报告都只是固定自动策略的回归信号，不代表真人玩家胜率。

## 历史记录

`content-pool-v14.json`、`immersion-review.json` 和 `immersion-ui-report.json` 是较早版本的验证记录，分别包含 `3.0.0`、`2.9.0` 和旧 UI/存档断言。它们保留用于追溯，不可作为 `4.3.0 / UI 17.1 / 存档 v43` 的当前发布证据。

浏览器脚本是否通过需要单独的 Chromium 与 Playwright 环境；没有重新执行浏览器验收时，不应把历史 UI 报告改写成当前版本结果。
