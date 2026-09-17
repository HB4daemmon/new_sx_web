# 封神 · 劫中人

中国神话题材的路线 Roguelite。八槽构筑，全自动斗法，四幕人物因缘。

[在线试玩](https://hb4daemmon.github.io/new_sx_web/)

## 当前版本

玩法与内容 **4.4.0**，界面修订 **18.0**；当前浏览器存档键为 `fengshen-run-v44`。

- 每幕行进 10 个节点（含命运与首领），全程 40 步；每幕从两名首领中抽取一名。
- 每幕开始恢复至当前最大生命；幕内伤势持续保留。
- 角色创建拆分为 **族裔 + 出身 + 命格**：4 个族裔、5 个出身，互不锁定。
- 40 个可成长天赋：16 个公共天赋 + 每族 6 个专属天赋；筑基、金丹、元婴、化神时由玩家手动择一。
- 八槽命盘采用自由构筑：10 种普攻、10 种怒技、68 个组件、8 件命器与 10 套战策可以跨流派组合；8 个主流派提供 6 条跨流派混合配方。
- 106 项能力、44 种敌人、56 个事件、8 条人物线；8 个族裔多阶段事件包含公开概率检定、前因回响与族裔天赋解法。
- 战斗与构筑提供来源、条件、资源转换和未触发原因的反馈；四条人物承诺支持兑现、违约、借道与主动追踪。
- 12 个既有地点事件已去模板化，奖励、检定、条件和阶段路由保持不变，改为各幕独立叙事。
- 战斗中即时显示伤害、回复、护盾变化和负面状态消耗；技能、槽位、法宝与能力图形继续使用原有 SVG。

**4.4.0 使用独立存档规则，4.3.0 及更早存档不能直接导入本版，需要重新开局；旧档仍可从静室导出备份。** 同版本内读档、天赋选项、事件检定与行动回放保持确定一致。

## 开发与验证

要求 Node.js 22 或以上。源码直接纳入版本管理，克隆后无需展开归档。

```sh
npm ci
npm test
npm run verify:reports
npm run dev
```

`npm test` 覆盖构建、引擎、族裔、天赋、流派配方、事件文案、构筑分析、战斗诊断、人物承诺与战斗反馈。`npm run verify:reports` 会先构建，再生成 `verification/simulation.json` 和 `verification/balance-audit.json`；其中模拟固定为五出身各 40 局，平衡审计固定为四族裔 × 五出身 × 25 种子的 500 局确定性回归矩阵。两份报告都是固定自动策略的回归信号，不等同于真人玩家胜率。`npm run build` 生成 `dist/` 和单文件离线版 `PLAY.html`。

单独重跑报告时，先确保构建产物与源码一致：

```sh
npm run build
npm run simulate
npm run balance
```

模拟报告会记录内容/规则版本、UI 修订号、存档键、策略文件和内容哈希；验证产物的历史版本与当前版本边界见 [`verification/README.md`](verification/README.md)。

浏览器验收脚本默认从当前仓库解析 `PLAY.html`，并将截图与报告写入 `verification/` 下对应目录：

```sh
python tests/browser-smoke.py
python tests/ancestry-browser.py
python tests/immersion-browser.py
```

三份脚本都支持 `--html`、`--output`、`--chromium`；也可使用 `PLAY_HTML_PATH`（兼容 `PLAY_HTML`）、`BROWSER_OUTPUT_DIR` 和 `CHROMIUM_PATH` 环境变量。`ancestry-browser.py` 与 `immersion-browser.py` 还支持 `--url` 验证 HTTP 构建。

The Node Playwright browser harness covers creation insights, strategy behavior, settlement timing, desktop/mobile overflow, and save import/export. It checks `dist/PLAY.html` by default, resolves Playwright from `PLAYWRIGHT_MODULE` or common npm/npx caches, and resolves Chromium from `CHROMIUM_PATH` or the Playwright browser cache:

```sh
npm run build
npm run test:browser-node
```

The harness writes `verification/browser-node/browser-node.json` and key screenshots. Missing Playwright, Chromium, or build output returns exit code `3` with a clear message. Use `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `PLAY_HTML_PATH`, and `BROWSER_OUTPUT_DIR` to override the defaults.

## 内容编辑

`data/game.json` 是权威玩法配置，含族裔、出身、天赋、流派、混合流派、法宝、敌人、事件与出现条件。`data/presentation.json` 保存事件表现文案。修改 JSON 后运行：

```sh
python scripts/create-content.py
npm test
npm run verify:reports
```

生成脚本只校验 ID 并合并显示文案，保留已经编辑的玩法值。构建也会同步显示文案。

[族裔、天赋与命途设计记录](docs/ANCESTRY_TALENTS.md)。`.github/workflows/pages.yml` 在 `main` 更新后验证并发布 GitHub Pages。

美术沿用项目现有资源，未使用《杀戮尖塔》《小丑牌》或《王者万象棋》的游戏素材；仅参考棋手/阵容/组合构筑的设计思路，具体种族、天赋、功法、法宝与事件均为本项目原创。

## UI 18.0

延续双角色斗法舞台和逐帧像素特效；当前版本加入族裔、出身和命格的定性开局说明，境界突破时的天赋手选，天赋前置关系与流派方向展示。命盘、战斗结算和因缘页会保留对应来源与状态反馈。技能与法宝继续使用原 SVG 视觉。

18.0 收紧主界面文案：创建、命盘、事件、坊市、休整与帮助页减少规则式说明，保留关键数值与直接得失，以人物、命格、因缘和场景本身承担叙事。

## 4.4 自动平衡回归

当前版本用 500 局确定性自动策略矩阵检查 20 个“族裔 × 出身”组合，并保留逐局结果。报告由 `npm run balance` 生成，门槛为整体胜率 50%～70%、族裔差不超过 15 个百分点、出身差不超过 20 个百分点。

本次报告结果：整体胜率 **60.4%**；四族裔为人族 **62.4%**、精怪 **62.4%**、龙裔 **61.6%**、灵族 **55.2%**，族裔差 **7.2 个百分点**；五出身为山野散修 **59%**、行伍武者 **55%**、方士 **66%**、行脚药师 **51%**、旧观咒徒 **71%**，出身差 **20 个百分点**。这些数字只作为固定自动策略的回归指标，不等同于真人玩家胜率。
