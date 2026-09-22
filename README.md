# 随时修仙 · 山海行

以中国古代神话为背景的功法构筑自动斗法游戏。四幕各 11 个节点，加一场终局渡劫。
当前仓库只构建山海新版，不保留旧版游戏入口、内容包或存档兼容层。

## 开发

需要 Node.js 22 或以上。内容编译工具独立管理依赖：

```sh
npm ci
npm ci --prefix tools/content-kit
npm test
npm run dev
```

默认游戏地址为 `http://localhost:4173/`。开发服务器监听 `0.0.0.0`；
修改源码后运行 `npm run build`，刷新页面即可。通过 `PORT=4174 npm run dev`
更换端口。游戏使用原生 ES 模块和分文件内容，需要 HTTP 服务，不提供单文件离线版。

## 已接入范围

- 10 门功法、120 项天赋，5 门普通功法可开局选择；其他功法通过事件获取。
- 44 件法宝，不设全局槽位，按各卡自身叠层上限累计，附带战斗或旅途能力。
- 36 个普通事件、16 个核心事件、6 条两遇人物线。
- 34 套敌方构筑，与玩家共用功法、天赋和法宝规则。
- 每幕六种路线，战前预览，冻结的奖励三选一与有限商店，休整和换法。
- 突破手选天赋，过幕与突破不补满当前气血。
- 自动斗法回放、倍速、暂停、跳过、来源贡献与未触发反馈。
- 确定性种子、逐步自动存档、通关构筑归档与 JSON 导出。

内容参数已经过首轮可玩性校准，仍是设计输入，不代表完成全面平衡。
目前后期首领与终战偏短，正式难度还需扩大构筑与路线样本后调整。
15 回合是基线观察窗口，不是超时判负规则。

## 内容与代码

`content/shanhai/` 是唯一内容编辑源，YAML 1.2，每个实体单独一文件。
新增实体时更新显式 `manifest.yaml`。构建先校验内容，再按原目录结构生成
`dist/content/**/*.json`，不是另一个手工维护的总 JSON。

| 位置 | 职责 |
| --- | --- |
| `src/shanhai/combat.ts` | 战斗、状态、怒气、效果与回放 |
| `src/shanhai/run.ts` | 节点、事件、经济、旅途与境界 |
| `src/shanhai/persistence.ts` | 存档校验、确定性回放重建与通关记录 |
| `src/shanhai/app.ts`、`style.css` | 浏览器界面 |
| `src/shanhai/types.ts` | 共享运行时契约 |
| `src/art.ts` | 原创游戏图形组件 |
| `tools/content-kit/` | 内容校验与文档生成 |
| `tools/docs-site/` | 独立文档站，不由游戏构建发布 |

存档键为 `suishi-shanhai-run-v1`，通关构筑键为 `suishi-shanhai-build-v1`。
战斗存档保存确定性输入，读取时重新生成回放，避免长战报占满浏览器存储。

## 验证

```sh
npm test
npm run test:content
npm run simulate
npm run test:browser
npm run test:journey
npm run calibrate
```

- `npm test` 构建新版，执行战斗、流程和跨模块回归，包括 810 组完整天赋组合的冒烟测试。
- `simulate` 使用真实战斗、当前 YAML 参数和固定启发式策略，默认五门开局功法各五个种子；
  可用 `SIM_SEEDS=20 npm run simulate` 扩大样本。输出 `verification/shanhai/simulation.json`。
  每次决策后保存并重载，比较状态与战斗回放。自动策略结果不是真人胜率，也不能单独证明数值平衡。
- 浏览器检查需先启动游戏服务，并安装 Playwright 与 Chromium；
  可通过 `PLAYWRIGHT_MODULE`、`PLAYWRIGHT_EXECUTABLE_PATH`、`BROWSER_URL` 指定环境。
  输出 `verification/shanhai/browser/`。界面 fixture 的成功不等于真实单局通关。
- `test:journey` 从角色创建开始，仅点击浏览器可见控件：桌面走完 45 节点并检查通关归档，
  手机完成第一幕；同时检查战斗操作、刷新恢复、页面错误和整体横向溢出。
  输出 `verification/shanhai/browser-journey/`。
- `calibrate` 记录固定敌人参考盘与真实节点对局，保留输入哈希、胜负、轮数、净损血、
  最低血线和单轮损耗。输出 `verification/shanhai/calibration-*.json`，不回写内容的实测字段。
- 游戏构建只产生 `dist/`，不会触发文档站发布，也不会提交或推送 Git。

具体实现边界见 [运行时说明](docs/SHANHAI_RUNTIME.md)，参数调整与测量边界见
[首轮校准记录](docs/SHANHAI_CALIBRATION.md)。
