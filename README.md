# 封神 · 劫中人

原创中国神话题材的单人路线 Roguelite。四幕、24 个主要节点，八槽零背包构筑，全自动斗法。

## 运行

交付压缩包中的 `PLAY.html` 是完整离线版，解压后用现代浏览器打开即可。不依赖 CDN、后端、账号、外部字体或在线图片。

从源码开发（Node.js 22 或更新版本）：

```sh
npm install
npm run build
npm run dev
```

默认本地地址：`http://localhost:4173`。手机和电脑在同一局域网时，可使用电脑的局域网 IP。构建产物在 `dist/`，可以部署到普通静态主机。

## 技术结构

- TypeScript + 原生 Web Components；运行时零第三方依赖。
- `src/engine.ts`：纯规则、独立随机流、自动战斗回放、路线与状态机。
- `src/app.ts`：响应式界面、回放播放、存档导入导出。
- `src/art.ts` / `src/style.css`：原创 SVG 人物、山水与法宝图标，暗色鎏金卡面。
- `data/game.json`：全部游戏内容与数值配置。
- `scripts/create-content.py`：可选的内容编写辅助脚本；运行游戏不需要 Python。
- `tests/`：规则测试、自动模拟及浏览器验收脚本。
- `verification/`：测试结果与截图。

## 内容

3 个出身、8 个命格、43 项玩家能力（6 基础技、6 怒气技、10 辅法、15 法宝、6 战策）、20 个敌人、16 个事件、4 幕、4 个条件结局。

基础技 ×1、怒气技 ×1、辅法 ×2、法宝 ×3、战策 ×1。同名能力升阶至 R3；满槽获得新能力时必须替换或放弃。商店替换确认前不扣款。生命跨战斗保存，升级、换幕与 Boss 胜利都不自动回血。

同一 Seed、内容版本、规则版本和 ActionLog 可重放同一局。路线、事件、商店、奖励、战斗的随机流分离。已生成的选项和战斗回放随存档保存。

## 验证

```sh
npm test
npm run simulate
```

浏览器测试需要 Python Playwright 和 Chromium，详见 `docs/IMPLEMENTATION.md`。自动模拟用于发现死流程和初步平衡问题，不等同于真人胜率；当前护盾反击明显偏强。

## GitHub Pages

仓库中的 Actions 工作流负责构建、测试、生成可下载交付包，并尝试部署 Pages。只有部署作业成功后，工作流显示的 `page_url` 才是有效预览地址。

本仓库保持私有；不会自动改成公开仓库。私有仓库的 Pages 可用性取决于 GitHub 账户方案与 Pages 权限。若首次启用受限，需要仓库管理员在 Settings → Pages → Source 选择 GitHub Actions，再重跑部署。

## 美术与范围

借鉴暗色卡面、印刷质感和分支路线的视觉语言，未使用《小丑牌》或《杀戮尖塔》的图片、音乐、字体或代码。所有人物、地图与图标为程序绘制的原创 SVG。

本版为完整流程 MVP，不含多人、手动出牌、永久局外数值成长、AI 实时剧情或云端存档。具体实现取舍和验收限制见 `docs/IMPLEMENTATION.md`。
