# 随时修仙·设计文档站

这是一个独立的 VitePress 静态文档站模块。发布内容自动读取
`../../docs/shanhai/` 下的 Markdown 文件，不维护逐文件白名单。
新版 `rework/` 基线页和内容工具生成的首发卡库归入新版分组，其余内容归档到“历史稿与资料”。
源目录不会被挂载到站点目录。
站点首次访问默认使用暗色模式；右上角“外观”开关可切换到浅色，选择会由浏览器保存并在下次访问时恢复。

## 日常维护

只操作文档目录，不需要逐篇登记、改侧栏、手动发布或重启服务：

| 操作 | 自动结果 |
| --- | --- |
| 在 `docs/shanhai/rework/` 新建 `.md` 或 `.MD` 文件 | 新增新版页面，标题进入导航与本地搜索 |
| 新建子目录并放入文档 | 自动增加侧栏分组 |
| 修改正文或一级标题 | 更新页面、导航名称和搜索 |
| 移动或删除文件/目录 | 更新路径与导航，旧页面在成功发布后移除 |
| 放到 `_drafts/`、隐藏目录，或使用 `_`/`.` 开头的文件名 | 不收录、不公开 |

页面名取首个一级标题，无标题则使用文件名。`README`/`index` 优先排列，其余自然排序。
`rework/**` 保持 `/rework/**`，其他目录保持 `/history/**`；`INDEX.md` 规范化为 `index.md`。
首页优先读取 `rework/README.md`，缺失时生成最小首页。

移动或删除文档时，也要修复其他文档对它的引用。断链、路径冲突或安全检查失败时保留
上一版站点，不发布残缺结果；修复后会再次自动构建。站点侧栏是自动目录，正文中手写的
目录或链接仍属于文档内容，不会自动改写成新内容。

卡库仍以 `content/shanhai/` 的 YAML 为编辑源：运行内容工具校验和生成阅读页后，站点
自动收录这些 Markdown。文档站不直接发布 YAML，也不把内容实体清单当作文档发布白名单。

## 本地运行与运维

新环境在本目录执行；已有服务器日常维护无需运行这些发布命令：

```bash
npm ci
npm test
npm run watch
```

`npm run build` 可用于一次性运维发布；先扫描公开目录并写入 `site/content/`，
自动生成导航，再由 VitePress 生成静态站，
最后把成功结果写入 `published/releases/`，并原子更新 `published/current` 相对软链。
只保留最近两次成功发布；构建失败不会切换当前发布。

`npm run watch` 启动时构建一次并递归监听源目录。文件增删改以及整个目录的移动都能触发，
变更经过 250ms 防抖，构建请求串行执行；构建中的后续变更会排队，失败时保留上一版。
主进程可由用户的 systemd
单元托管，站点服务器将只读的 `published/` 父目录挂载到 `/srv`，并以
`/srv/current` 作为静态根目录。

## 本机发布

用户选择通过 HTTP 公开访问，无鉴权，不申请证书：

```text
http://sg.229465154.xyz/
```

`deploy/compose.yaml` 启动独立静态容器，通过 `deploy/traefik-http.yaml` 给现有
Traefik 的 `web` 入口增加域名路由，不更改其它站点，不发布额外宿主机端口。
容器只读挂载编译结果和自身 Caddy 配置。使用文件 provider，是为了避开当前 Traefik
Docker provider 与 Docker API 的兼容错误；没有改动或重启共享代理。

```bash
sudo docker compose -f tools/docs-site/deploy/compose.yaml up -d
sudo install -m 644 tools/docs-site/deploy/traefik-http.yaml /opt/daeserver/traefik/dynamic/suishi-docs.yaml
sudo install -m 644 tools/docs-site/deploy/suishi-docs-watch.service /etc/systemd/system/suishi-docs-watch.service
sudo systemctl daemon-reload
sudo systemctl enable --now suishi-docs-watch.service
```

上述命令在仓库根目录运行。查看后台状态：

```bash
sudo systemctl status suishi-docs-watch.service
sudo journalctl -u suishi-docs-watch.service -n 30 --no-pager
sudo docker compose -f tools/docs-site/deploy/compose.yaml ps
```

停用时先停止 watcher，移除专用 `dynamic/suishi-docs.yaml`，再仅停止本模块 compose
项目；不操作现有 Traefik 项目及其它动态配置。

## 公开范围

站点按产品授权在 `sg.229465154.xyz` 无鉴权公开。放进公开根的非隐藏 Markdown 即视为
需要发布的文档，不要将秘密或内部材料放入其中。扫描不越过 `docs/shanhai/`，
不会发布仓库根、`.git`、`.env`、技能、验证报告或内部脚本；非 Markdown 不复制。
软链来源会被拒绝，构建会阻断常见凭据模式且不把匹配值打印到日志。
隐藏或 `_` 开头的路径用于未发布草稿，不构成存放真实凭据的建议。

依赖锁定为 VitePress `1.6.4`，Node 要求 `>=22`。本模块使用 VitePress 默认主题、
本地全文搜索和 Markdown-It；不加载外部 CDN JavaScript 或字体。
书本图标来自 Lucide 的 `book-open`，授权文本随站点发布于 `lucide-LICENSE.txt`。
旧资料只允许精确的空命名锚点，其余源 HTML 继续转义，不开放脚本或任意标签执行。

VitePress 1.6.4 的构建依赖 Vite/esbuild 存在 audit 提示。本部署只提供编译完成的
静态文件，不开放 Vite/VitePress 开发或预览服务；依赖升级仍需后续复核。
