# 王者万象棋机制资料库

来源：[万象棋大数据](https://www.datawxq.com/lineups)，实际资料入口为
[资料库](https://www.datawxq.com/database)。
本库按用户要求用于修仙肉鸽的机制研究，不接入游戏运行时，不自动发布到文档站。

## 本次快照

采集时间：2026-10-26 07:34:15 UTC。以 `catalog.json` 中的 `metadata.retrieved_at`
为机器可读时间；源站更新后需主动重新采集，不宣称始终与线上同步。

| 内容 | 数量与范围 |
| --- | --- |
| 天赋主表 | 395 条，保留 ID、规则、品质、获取说明、阶段、天赋包和关联卡牌 |
| 万象大赛天赋 | 261 条：金 120、银 108、铜 33 |
| 钻石狂潮天赋 | 134 条，源站均标记为金色 |
| 棋手 | 21 位，63 个技能分节，共 125 个分节条目 |
| 关联资料 | 423 条记录形态，覆盖 368 个引用 ID，不等于 423 张不同卡牌 |

这里的“全部”限定为采集时该站公开资料集合中的天赋和棋手，不是游戏客户端中的
所有历史、测试或未公开内容。棋手专属规则保存在棋手分节及关联资料中，
不能把天赋主表的 395 条误读为所有专属技能的去重总数。

当前天赋主表全部带有 `visibleOnOfficialSite: true`；这是源站数据字段，
不表示我们独立证明了每条规则都与游戏客户端一致。
排行页的 `v261022` 是统计筛选版本，未作为卡面版本号使用。

## 阅读入口

- [总索引](INDEX.md)：自动生成的目录与统计。
- [全部天赋](TALENTS.md)：两种玩法模式的卡面规则。
- [全部棋手](COMMANDERS.md)：技能、秘技、专属和关联说明。
- [关联卡牌](RELATED_CARDS.md)：补充技能面板、效果牌、装备和引用摘要。
- [结构化数据](catalog.json)：完整提取的源字段，便于其他模型或脚本读取。
- [机制研究索引](DESIGN_INDEX.md)：我们整理的参考方向，与原始规则明确分开。

阅读页保留源字段名，不将推测的“构筑核心”“转化”等分类混入原站数据。
`assets`、`cardImage` 等仅为来源链接，没有下载或复用原站图片。

## 本地查询

在项目根目录执行，无需启动游戏或联网：

```bash
node tools/wanxiang-reference/browse.mjs stats
node tools/wanxiang-reference/browse.mjs search 恢复 --type talent --quality gold --mode wanxiang
node tools/wanxiang-reference/browse.mjs show 毒奶 --type talent --mode wanxiang
node tools/wanxiang-reference/browse.mjs show 常小娥 --type commander
node tools/wanxiang-reference/browse.mjs search 复制 --json --limit 50
```

`search` 检索名称和嵌套说明，默认显示前 20 条并报告总数。`show` 按 ID 或准确名称查询；
有同名、跨模式或完整记录/摘要重叠时会报告歧义，不任取一个结果。
添加 `--json` 可供后续模型或自动分析读取。棋手没有源模式字段，不应加模式筛选。

## 完整性与限制

- 保留源数据的模式区别、结构和缺省字段。武凤的部分技能没有 ID、等级或卡图，
  也没有独立 `relatedCards` 列表；没有补造这些字段。
- 368 个关联 ID 中，55 个取得独立完整来源记录，313 个只有来源中附带的引用摘要。
  “未解决引用为 0”只代表已有记录或摘要，不表示 368 个 ID 都有完整技能面板。
- 关联资料保留同一 ID 的完整记录与摘要等不同形态，避免静默丢失差异。
  不同模式可能复用 ID，后续分析应连同模式和记录类型一起识别。
- 采集器读取公开页面实际引用的资源，采用 JavaScript AST 提取静态字面量，
  不执行远端脚本，不访问登录、管理或私有接口。
- `metadata.source_assets` 保存来源 URL、SHA-256 和字节数。它证明这次采集读取的资源，
  不证明源站规则本身没有错误。仅发现两种模式及棋手集合后才接受快照；
  源站结构大改时应复核，不能把更新工具当成任意网站的通用爬虫。
- 本次只采集规则资料，不采集玩家个人信息、对局记录或排行榜统计。
  参考规则不等于可以将对方的名称、表达、美术和代码原样用于本项目商业发布。

## 更新

工具和依赖独立维护在 [tools/wanxiang-reference](../../tools/wanxiang-reference/README.md)。
日常离线查阅不需要安装依赖；首次采集或运行完整测试时先安装模块依赖。

```bash
npm ci --prefix tools/wanxiang-reference
npm run collect --prefix tools/wanxiang-reference
npm run docs --prefix tools/wanxiang-reference
npm run check --prefix tools/wanxiang-reference
npm run docs:check --prefix tools/wanxiang-reference
npm test --prefix tools/wanxiang-reference
```

采集失败不会覆盖上一份有效快照。更新后检查数量、字段、规则与来源指纹差异，
同步本页“本次快照”说明，再单独提交；命令不会自行提交、推送或发布。
