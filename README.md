# 封神 · 劫中人

中国神话题材的路线 Roguelite。八槽构筑，全自动斗法，四幕人物因缘。

在线版：https://hb4daemmon.github.io/new_sx_web/

## 运行

交付压缩包已展开源码，可直接打开 `PLAY.html`，或将 `dist/` 作为静态网站部署。

从本仓库克隆时，源码保存在经过验证的 `bootstrap/` 分片中。先展开一次：

```sh
bash restore-source.sh
```

Windows 使用 `./restore-source.ps1`。源码展开后：

```sh
npm install
npm run build
npm run dev
```

## 验证

```sh
npm test
npm run simulate
python scripts/create-content.py
npm run build
```

浏览器验证需要 `playwright==1.57.0` 和 Chromium：

```sh
python -m pip install playwright==1.57.0
python -m playwright install chromium
python tests/immersion-browser.py
```

构建目录以 HTTP 提供时，可指定 `--url http://127.0.0.1:4173/`。

## 当前修订

规则与内容 **2.9.0**，界面修订 **13.1**。本轮保留旧存档与所有玩法数值，重整信息层级、战报阅读和人物叙述。详见 `docs/IMMERSION_REVIEW.md`；验收记录在 `verification/immersion-review.json`。

`data/game.json` 是运行内容；`data/presentation.json` 是显示文案。修改后运行生成脚本再构建。设置和阅读行为不消耗随机数。

美术为原创程序 SVG，未使用《小丑牌》或《杀戮尖塔》的素材。正式部署工作流保留在 `.github/workflows/pages.yml`。
