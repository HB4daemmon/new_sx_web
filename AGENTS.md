# 仓库协作说明

## 新版内容库

- 新版卡面与首测参数的单一编辑源是 `content/shanhai/`，采用 YAML 1.2、每实体一文件。
  按 `rules/methods/artifacts/events/storylines/enemies/acts` 分目录，
  字段与作者约定见 `content/shanhai/README.md`。
- `content/shanhai/manifest.yaml` 是显式清单。新增或移除实体时同步清单，
  不改成无差别扫描整个仓库，不使用旧 `data/game.json` 作为新版内容源。
- 独立工具位于 `tools/content-kit/`，依赖与锁文件在该模块维护，不修改根依赖。
  在该目录运行 `npm test`、`npm run validate`、`npm run docs`、`npm run docs:check`。
- `docs/shanhai/rework/content/` 的固定 32 个阅读页由工具生成，不手工改卡面。
  同目录上级的基线 Markdown 仍人工维护共同规则与设计意图；规则修改要核对两者一致。
- YAML 变更本身不被文档站 watcher 监听；内容工具校验并生成 Markdown 后，站点自动发现并发布。
  这是内容生成步骤，不是文档站的发布审批。日常编辑不暂停 watcher、不逐页登记、不手动发布。
  未准备公开的草稿留在公开根之外或 `_drafts/` 等隐藏目录，不把秘密写入公开页。
- 当前内容为 `design_target`，实测字段保持 `null`，直至存在真实测试结果。
  结构枚举、算术审计和卡库校验不等于战斗仿真。新版运行时位于 `src/shanhai/`，
  已替换旧游戏入口；旧运行时与内容包不保留，不新增兼容层。
- 根 `npm run build` 校验 YAML 后按实体目录输出 `dist/content/`，使用原生 ES 模块。
  克隆后先 `npm ci` 与 `npm ci --prefix tools/content-kit`；不手工编辑编译后的 JSON。
- 游戏验收：`npm test`、`npm run test:content`、`npm run simulate`；
  `npm run dev` 后运行 `npm run test:browser` 和 `npm run test:journey`。
  `npm run calibrate` 生成固定敌人参考盘与真实流程测量报告。
  游戏服务默认 `http://localhost:4173/`。
  构建游戏不发布文档站，不自动提交或推送。

## 文档站

### 入口与维护范围

- 公网地址：`http://sg.229465154.xyz/`。
- 用户明确要求 HTTP、公开访问、无需鉴权。未经新要求，不添加 HTTPS 跳转或登录。
- 独立站点模块位于 `tools/docs-site/`，详细运维说明见 `tools/docs-site/README.md`。
- 文档站使用 VitePress，依赖和脚本在模块自己的 `package.json` 中维护。
  不为文档站修改游戏运行时、游戏数据或根目录依赖。
- 默认暗色模式，保留明暗切换及浏览器偏好保存；桌面入口在右上角，手机入口在导航菜单中。

### 内容来源与公开规则

- 文档公开根是仓库内的 `docs/shanhai/`。站点递归发现其中所有普通 Markdown 文件，
  支持 `.md`/`.MD`；不是聊天记录，也不扫描整个仓库。
- 当前新版方案维护在 `docs/shanhai/rework/`；其余已公开资料放在站点的“历史稿与资料”分组。
  修改新版方案时不要混用历史稿的规则。
- 放入公开目录即授权自动上线；移出、删除，或放入以 `.`/`_` 开头的文件或目录即不再收录。
  例如 `docs/shanhai/_drafts/`、`rework/_notes.md` 不公开。非 Markdown 文件不作为站点源。
- 已取消逐文件白名单。`scripts/discovery.mjs` 负责目录发现、路径映射和自动导航；
  不恢复 `ALLOWED_MARKDOWN`、`NEW_REWORK_FILES` 或另一套逐篇发布登记。
- `rework/**` 保留 `/rework/**`，其余文档映射 `/history/**`。所有大小写变体的
  `INDEX.md` 都映射为 `index.md`；大小写路径冲突会阻止发布，不能静默覆盖。
- 首页优先使用 `docs/shanhai/rework/README.md`；该文件移除后生成最小首页。
  页面名取首个一级标题，没有标题则使用文件名；子目录自动成为侧栏分组，
  `README`/`index` 优先，其余自然排序。
- 导航、侧栏与本地搜索随实际文件重建，不逐项编辑配置，也不手工修改 `sidebar-data.mjs`。
  新增目录或页面只需放置文档并检查链接；移动或删除时同步修复其他文档的引用。

### 更新与发布

- 本机的 `suishi-docs-watch.service` 监听 `docs/shanhai/`，捕获 Markdown 增删改及目录
  创建、删除、重命名、整体移入移出，防抖后串行构建。构建期间继续修改会排队重建。
  日常只控制文档目录，无需手动执行发布、重启服务、提交 Git、推送或合并 PR。
- 仅在聊天中讨论而未写入源文件的内容不会同步到站点。
- watcher 不监听主题、配置或构建脚本。只有站点程序升级/运维才需要手动构建或重启；
  不把普通文档编辑当成部署操作。
- 以下目录是生成产物，不直接编辑：`tools/docs-site/site/content/`、
  `tools/docs-site/cache/`、`tools/docs-site/published/`。
- 断链、路径冲突、软链或凭据检查失败会阻止新版本上线，修复源文件后自动重试。
  构建先生成静态文件，再写入 `published/releases/`，原子切换
  `published/current` 相对软链；保留最近两次成功发布，失败时继续使用上一版。
- `npm run build` 在这台部署服务器上会直接发布到公网，不只是本地编译检查。
  不要同时启动多个构建或额外 watcher。
- Git 提交和远端推送仍是独立操作；没有用户要求时，不因发布网站而自动提交或推送。

在 `tools/docs-site/` 目录执行：

```bash
npm test
npm run build
```

新环境需要先按模块 README 安装依赖；现有部署不需要每次重新安装。

### 部署位置与边界

- Compose 文件：`tools/docs-site/deploy/compose.yaml`。
  项目名 `suishi-docs`，静态服务容器 `suishi-docs-web-1`，加入已有网络 `traefik_default`。
- Caddy 配置：`tools/docs-site/deploy/Caddyfile`。
  只读挂载整个 `published/` 父目录到 `/srv`，站点根目录为 `/srv/current`。
  不要只挂载 `current` 软链目标，否则原子发布后可能仍提供旧内容。
- Traefik 路由模板：`tools/docs-site/deploy/traefik-http.yaml`。
  本机安装位置：`/opt/daeserver/traefik/dynamic/suishi-docs.yaml`。
  使用 `web` 入口，后端为 `http://suishi-docs-web-1:8080`。
- watcher 单元模板：`tools/docs-site/deploy/suishi-docs-watch.service`。
  本机安装位置：`/etc/systemd/system/suishi-docs-watch.service`。
  以 `ubuntu` 用户在 `/product/new_sx_web/tools/docs-site` 下运行 `scripts/watch.mjs`。
- 共享 Traefik 的 Docker provider 曾存在 API 兼容问题，因此本站使用文件 provider。
  不为本站维护擅自升级、重启共享 Traefik，或改动其他站点路由。
- 不将仓库根目录、`.git`、`.env`、技能目录、内部脚本或验证报告作为静态根目录公开。
  保留构建中的凭据扫描和源文件软链限制；源 Markdown 不开放任意 HTML 执行。

从仓库根目录查看运行状态：

```bash
sudo systemctl status suishi-docs-watch.service --no-pager
sudo journalctl -u suishi-docs-watch.service -n 30 --no-pager
sudo docker compose -f tools/docs-site/deploy/compose.yaml ps
```

### 验收要求

- 文档或导航变更：确认目标页面、内部链接、标题锚点和本地搜索可用。
- 主题变更：用浏览器检查桌面和手机；确认首次访问默认暗色，明暗切换后刷新仍保留选择，
  正文、表格、代码、侧栏和搜索框均可读。
- 手机页面不得出现整体横向溢出；宽表格应在自身范围内横向滚动。
- 发布或部署变更：确认公开页面返回成功状态，私有路径仍不可访问，浏览器无新增页面错误。
- 仅修改本文件等非站点源文件时，无需重新构建或重启文档站。
