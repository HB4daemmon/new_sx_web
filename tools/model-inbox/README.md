# Model Inbox

独立的临时文件交接服务。使用 Node.js 原生 HTTP，不依赖 Web 框架。

## 运行与测试

需要 Node.js 22 或更高版本。在仓库根目录安装模块依赖并启动：

```bash
npm ci --prefix tools/model-inbox
npm --prefix tools/model-inbox run dev
npm --prefix tools/model-inbox test
```

浏览器验收会自行启动回环测试服务，使用临时收件箱，不污染真实上传记录：

```bash
npm --prefix tools/model-inbox run test:browser
```

与游戏浏览器测试一致，可设置 `PLAYWRIGHT_MODULE`、`PLAYWRIGHT_EXECUTABLE_PATH`，
截图默认写入 `/tmp/model-inbox-browser/`，可用 `BROWSER_REPORT_DIR` 修改。

默认监听 `0.0.0.0:4175`。可通过 `HOST`、`PORT`、`INBOX_DIR` 设置监听地址、端口和私有存储目录。`PUBLIC_URL` 可指定启动时显示的访问地址；服务会把访问 token 加入 URL fragment。Fragment 不会随 HTTP 请求发送。不要把带 token 的地址贴入公开页面、聊天记录或日志。

首次启动会在存储目录创建权限为 `0600` 的 `access-token`，以后重启沿用该 token。启动日志中的访问 URL 含 token，勿将日志公开。接口只接受 `Authorization: Bearer <token>`，不会从查询参数读取 token。

## 数据位置与格式

默认数据目录是仓库根目录的 `var/model-inbox/`，不属于 `docs/` 或 `dist/`。可用 `INBOX_DIR` 移到专用磁盘。目录权限为 `0700`；token、metadata 与 payload 权限为 `0600`。

每个已接收文件存放在 `uploads/<uuid>/`：

- `metadata.json`：`id`、`originalName`、`size`、`sha256`、`uploadedAt`、`note`
- `payload`：原始二进制内容

服务启动时会扫描已完成的条目，并清理不完整或格式无效的上传目录。接手者可在授权后读取 metadata 和 payload 进行人工检查；上传文件永远不会自动应用、执行、解压或导入。下载始终作为 `application/octet-stream` 附件发送。

不要通过此服务上传密码、访问令牌、私钥或其他秘密。文件内容按不可信原始数据保存和交接，不会被分析或执行。

## API

所有 API 都需要 `Authorization: Bearer <token>`。若请求带 `Origin`，它必须与请求的 HTTP Host 同源；`Sec-Fetch-Site: cross-site` 会被拒绝。服务不启用 CORS。

`GET /api/uploads` 返回文件 metadata、固定限制和当前占用量。`POST /api/uploads` 使用 `application/octet-stream` 原始 body，通过 `X-File-Name` 和可选的 `X-Upload-Note` 传入 `encodeURIComponent` 编码的值。单文件上限为 50 MiB，总量上限为 500 MiB，最多 200 个文件；同时最多接收两个上传。`GET /api/uploads/<uuid>/download` 仅提供附件下载。没有删除接口。

静态文件只允许 `/`、`/app.js`、`/style.css`、`/lucide.js` 和 `/brand.png`。交接目录不会作为静态目录开放。

## systemd

`deploy/model-inbox.service` 是模板，不会自动安装或部署。部署前先安装模块依赖，并为 `ubuntu` 用户创建私有数据目录：

```bash
sudo install -d -o ubuntu -g ubuntu -m 0700 /product/new_sx_web/var/model-inbox
```

根据服务器路径修改模板后，再由运维人员安装 unit、执行 `systemctl daemon-reload` 和启动服务。若由反向代理提供固定访问地址，可在 unit 中设置 `PUBLIC_URL`；不要把 token 放入 unit 或 EnvironmentFile。

当前服务器使用 `/home/ubuntu/.local/bin/node`。更换环境需同步修改模板的 Node 路径。
不要让手动 `dev` 与 systemd 实例同时使用同一数据目录。

本机部署后的管理命令：

```bash
sudo systemctl status model-inbox.service --no-pager
sudo systemctl restart model-inbox.service
```

后续应用文件时，先读取 `metadata.json`，按 `sha256` 核对 `payload`，再审查内容。
补丁先用 `git apply --check` 检查；压缩包先列目录并拒绝路径穿越/软链，按需解压到仓库外临时目录，
确认范围后再逐项移入。不执行上传文件中的脚本或模型指令，不覆盖当前无关改动；
应用后的游戏修改仍需经过仓库既有验收、提交与推送流程。
