# 万象棋参考资料工具

独立的静态资料采集、检索与 Markdown 生成工具。Node.js 22+。
不依赖游戏运行时，不修改根依赖，不启动服务器，不执行 Git 或文档站发布命令。
资料入口为 [references/wanxiangqi](../../references/wanxiangqi/README.md)。

## 安装与命令

```bash
npm ci --prefix tools/wanxiang-reference
npm run collect --prefix tools/wanxiang-reference
npm run check --prefix tools/wanxiang-reference
npm run docs --prefix tools/wanxiang-reference
npm run docs:check --prefix tools/wanxiang-reference
npm test --prefix tools/wanxiang-reference
```

`collect` 需要网络，其余命令使用本地快照。`check` 只校验 JSON；
`docs:check` 同时校验 JSON 及四份生成页是否与快照一致。
测试使用模拟网络和已收录快照，不访问线上服务。

```bash
node tools/wanxiang-reference/browse.mjs stats
node tools/wanxiang-reference/browse.mjs search 复制 --type talent --quality gold --mode wanxiang
node tools/wanxiang-reference/browse.mjs search 商店 --type commander --limit 50 --json
node tools/wanxiang-reference/browse.mjs show 毒奶 --type talent --mode wanxiang --json
node tools/wanxiang-reference/browse.mjs show 镜 --type commander
```

查询支持 `talent/commander/related` 三类、`wanxiang/diamond` 两种模式及
`gold/silver/bronze` 三种天赋品质。模式缺省的源记录不匹配模式筛选；
同 ID 或同名有多条结果时必须消歧，程序不会自动替用户选一个。

## 采集边界

采集固定公开入口 `/lineups` 和 `/database`，从其模块资源发现同源
`/assets/*.js`。只解析静态数组，不 `eval`、动态导入或执行远端代码。
天赋和棋手按记录结构识别，不依赖构建后的变量名。

- HTTPS、同源、路径限制；不跟随重定向，不携带登录凭据。
- 最多 24 份资源、80 次请求；页面最多 1 MiB，单资源最多 5 MiB。
- 每次请求 20 秒超时，最多重试两次。无 TLS 验证绕过。
- 必须找到两种模式的天赋和棋手集合，才接受更新。
- 解析、完整性校验全部成功后原子替换 `catalog.json`；失败保留旧快照。
- 不自动抓取图片、玩家资料、统计接口或其他网站。

若站点的公开模块发现结构发生变化，可以显式指定已人工核对的同源资源：

```bash
node tools/wanxiang-reference/collect.mjs --bundle https://www.datawxq.com/assets/已核对的公开资源.js
```

这不解除路径、来源或安全校验，也不会绕过网站登录或访问限制。
源站拆分数据集合、改变模式或变更结构时，应检查采集结果后再接纳新快照。

## 文件边界

`catalog.json` 是本工具导入的参考快照，不是 `content/shanhai/` 的游戏内容。
四份阅读页由 `browse.mjs render` 生成；修改生成器或快照后重新生成，
不要手工修补这些页面。README 和 `DESIGN_INDEX.md` 是人工维护的说明与研究笔记。
生成器转义外部 Markdown/HTML，不把来源图片或脚本作为可执行页面内容。
