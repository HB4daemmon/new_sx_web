# 原典名器来源记录

> 状态：原典核验记录与改编边界，不是游戏规则或已实现内容。
> 核验日期：2026-09-19。固定来源锚点：`A01` 至 `A08`。
> 本页只记录 `FB41` 至 `FB48` 的原典证据；八物的战斗效果、`R01` 至 `R08` 的取得过程、玩家持有、数值和路线结果均为本作原创/改编。

## 核验口径

- 本次使用 SSXX2 古籍库只读精确 SQL：调用 `knowledge_review._conn()` 后设置 `conn.read_only=True`，按名器和 `segment_id` 参数化 `SELECT`；未执行写入、ETL、review 状态升级、向量化或数据库服务操作。
- A02-A08 及 A01 的封神异物辨析使用 `document_id=canon.fengshen_yanyi.txt`（Gutenberg TXT 版）；A01 的游戏主来源使用 `canon.xiyou_ji`。`canon.fengshen_yanyi` 是另一个文档，不能把不同文档的 `chapter`、`segment_no` 或 `segment_id` 拼接成同一出处。
- A01 采用《西游记》的“照妖镜”为 `FB41` 主来源。《封神演义》的“照妖鑑/照妖鉴”另列为异物辨析，保留两条独立记录，不合并主人或器物。
- 本次采用精确 SQL，未运行向量语义检索；因此不填写相关度，也不把名称相似当作语义相关度。
- `review_status` 只反映本次读取到的知识库当前值；以下已查询实体均为 `draft`，不得写成 `reviewed` 或 `locked`。实体的 `provenance` 记录是实体导入来源，不替代下列实际段落核验。
- 短引文均取自所列段落；只作出处核对，不把原典描写扩写为游戏机制。公开入口提供可追溯的作品/版次页面，本页的回目、段号和 `segment_id` 以本地只读段落为准。

## A01 照妖镜

<a id="A01"></a>

### 名称与原典分歧

- 游戏位：`FB41 照妖镜`；取得事件：`R01`。
- 《封神演义》对应的是“照妖鑑”（简体实体名为“照妖鉴”），由云中子借给杨戬；不要把“鑑”改写成同一件《西游记》“照妖镜”后再声称两者是同一器物。
- 《西游记》另有精确名称“照妖镜”，知识库将其作为独立实体；本作 `FB41` 采用这一记录，不把云中子的照妖鉴归属移植给它。

### 《封神演义》段落证据（异名）

- 出处：第九十一回，第 10 段；`segment_id=canon.fengshen_yanyi.txt:ch.091.sec.010`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“借了照妖鑑來，照定他的原身”；同段又写“忙取寶鑑付與楊戩”。
- 原典可支持结论：该版本把“照妖鑑”写成云中子所有、杨戬为查梅山七怪而借用的辨认原身之宝。第九十一回第 13、17 段继续写杨戬用它照出常昊为白蛇、吴龙为蜈蚣：`canon.fengshen_yanyi.txt:ch.091.sec.013`、`canon.fengshen_yanyi.txt:ch.091.sec.017`。

### 《西游记》同名补录

- 出处：第六十一回，第 208 段；`segment_id=canon.xiyou_ji:ch.061.sec.208`；`document_id=canon.xiyou_ji`。
- 短引文：“托塔天王將照妖鏡照住本像”。
- 原典可支持结论：该段写托塔李天王持有“照妖镜”，可照住妖怪本相。它与上面的“照妖鑑”分别属于不同书、不同 `document_id`，不能凭名称相近合并。

### 知识库实体记录

- `canon.fengshen_yanyi.artifact.e1e66701f`：`artifact`，`canonical_name=照妖鉴`，`review_status=draft`，`provenance_id=prov.fengshen_yanyi.research`。
- `canon.xiyou_ji.artifact.e1d678510`：`artifact`，`canonical_name=照妖镜`，`review_status=draft`，`provenance_id=prov.xiyou_ji.research`。

### 归属变化与本作原创边界

- 原典只支持两条各自独立的器物记录及其持有/使用段落：封神版为云中子之“照妖鑑”，西游版为托塔李天王之“照妖镜”。
- `FB41` 主来源已选《西游记》；守器者在 `R01` 出场、普攻破甲与怒技增伤、玩家取得和永久唯一持有，均为本作改编，不由原典使用段落直接推出。
- 原典不证明两器是同一物，不证明主角继承，不证明游戏数值或 `R01` 胜利后转移。

### 公开入口

- [《封神演义》Project Gutenberg 23910 书页](https://www.gutenberg.org/ebooks/23910)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23910/pg23910.txt)。
- [《西游记》Project Gutenberg 23962 书页](https://www.gutenberg.org/ebooks/23962)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23962/pg23962.txt)。

## A02 定海珠

<a id="A02"></a>

### 名称、出处与段落证据

- 游戏位：`FB42 定海珠`；取得事件：`R02`。
- 出处一：第四十七回，第 25 段；`segment_id=canon.fengshen_yanyi.txt:ch.047.sec.025`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“取出一物，名曰定海珠，珠有二十四顆”。
- 出处二：第四十七回，第 35 至 36 段；`segment_id=canon.fengshen_yanyi.txt:ch.047.sec.035`、`canon.fengshen_yanyi.txt:ch.047.sec.036`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“曹寶忙忙搶了定海珠”；“此寶名『定海珠』”。
- 出处三：第八十四回，第 9 段；`segment_id=canon.fengshen_yanyi.txt:ch.084.sec.009`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“遇著燃燈道人祭起定海珠打來”。

### 知识库实体记录

- `canon.fengshen_yanyi.artifact.e173e0335`：`artifact`，`canonical_name=定海珠`，`review_status=draft`，`provenance_id=prov.fengshen_yanyi.research`。

### 原典可支持结论

- 原典支持赵公明在第四十七回使用二十四颗定海珠；萧升、曹宝以落宝金钱收走后，燃灯辨认并取得；第八十四回继续写燃灯祭珠。
- “赵公明原持、后归燃灯”的变化由上述段落支持；不能把它压缩成单一永恒主人而抹掉转移过程。

### 归属变化与本作原创边界

- 原典归属变化：赵公明使用并失去定海珠；曹宝收珠；燃灯认出并收取，后续再使用。
- `FB42` 的守器者、`R02` 的争夺或试炼、游戏中的单件唯一、战斗伤害/命中/护盾等效果和玩家取得，均为本作改编。
- 原典不证明“定海珠”提供任何本作数值，不证明玩家可继承，也不证明 `R02` 的路线结果。

### 公开入口

- [《封神演义》Project Gutenberg 23910 书页](https://www.gutenberg.org/ebooks/23910)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23910/pg23910.txt)。

## A03 阴阳镜

<a id="A03"></a>

### 名称、出处与段落证据

- 游戏位：`FB43 阴阳镜`；取得事件：`R03`。
- 出处一：第五十九回，第 16 段；`segment_id=canon.fengshen_yanyi.txt:ch.059.sec.016`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“又取陰陽鏡付與殷洪”；“此鏡半邊紅，半邊白”。
- 出处二：第五十九回，第 23 段；`segment_id=canon.fengshen_yanyi.txt:ch.059.sec.023`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“把一邊白的對著二人一愰”。
- 出处三：第六十回，第 14 至 15 段；`segment_id=canon.fengshen_yanyi.txt:ch.060.sec.014`、`canon.fengshen_yanyi.txt:ch.060.sec.015`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“弟子往太華山去走一遭”；“果是師伯的徒弟殷洪”。

### 知识库实体记录

- `canon.fengshen_yanyi.artifact.e4c1ef8b8`：`artifact`，`canonical_name=阴阳镜`，`review_status=draft`，`provenance_id=prov.fengshen_yanyi.research`。

### 原典可支持结论

- 原典支持赤精子把阴阳镜交给殷洪；第五十九回的说明把红、白两面和“生路/死路”的叙述绑定到该镜；殷洪随后在战斗中使用。
- 该器物在文本中属于赤精子洞中宝物，发生了“赤精子持有/授予殷洪”的归属变化；不应只写成殷洪的先天法宝。

### 归属变化与本作原创边界

- 原典归属变化：赤精子取出并交给殷洪；殷洪持镜下山并使用。
- `FB43` 的颜色选择、敌我判定、游戏状态、伤害、概率、守器者、`R03` 取得和玩家永久持有，均为本作改编。
- 原典不证明游戏中的即死、复活、特殊闪避、战斗数值或主角继承；跨典籍混搭时必须标明是改编。

### 公开入口

- [《封神演义》Project Gutenberg 23910 书页](https://www.gutenberg.org/ebooks/23910)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23910/pg23910.txt)。

## A04 番天印

<a id="A04"></a>

### 名称、出处与段落证据

- 游戏位：`FB44 番天印`；取得事件：`R04`。
- 出处一：第六十三回，第 9 段；`segment_id=canon.fengshen_yanyi.txt:ch.063.sec.009`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“道人取出番天印、落魂鐘、雌雄劍付與殷郊”。
- 出处二：第六十三回，第 24 段；`segment_id=canon.fengshen_yanyi.txt:ch.063.sec.024`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“此寶乃廣成子師伯的”。
- 出处三：第七十七回，第 9 段；`segment_id=canon.fengshen_yanyi.txt:ch.077.sec.009`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“廣成子祭起番天印，多寶道人躲不及”。

### 知识库实体记录

- `canon.fengshen_yanyi.artifact.e27ecaf6d`：`artifact`，`canonical_name=番天印`，`review_status=draft`，`provenance_id=prov.fengshen_yanyi.research`。

### 原典可支持结论

- 原典支持番天印属于广成子；广成子将其与其他宝物交给殷郊，殷郊随后使用；文本也直接写广成子祭印攻击多宝道人。
- “广成子原持、殷郊阶段性持有”的归属变化有段落依据；不能把殷郊的持有写成永远独占。

### 归属变化与本作原创边界

- 原典归属变化：广成子持有并授予殷郊；殷郊下山使用；文本其他战段又写广成子本人祭用。
- `FB44` 的守印者、`R04` 的挑战、砸击或倍率等战斗效果、唯一转移和玩家取得，均为本作改编。
- 原典不证明游戏中“番天印”造成固定伤害、不证明无视防御、不证明主角继承或 `R04` 的胜负后果。

### 公开入口

- [《封神演义》Project Gutenberg 23910 书页](https://www.gutenberg.org/ebooks/23910)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23910/pg23910.txt)。

## A05 金蛟剪

<a id="A05"></a>

### 名称、出处与段落证据

- 游戏位：`FB45 金蛟剪`；取得事件：`R05`。
- 出处一：第四十七回，第 45 段；`segment_id=canon.fengshen_yanyi.txt:ch.047.sec.045`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“不得已，取出金蛟剪來”；上下文明确为雲霄從三仙島取出並借給趙公明。
- 出处二：第四十八回，第 5 段；`segment_id=canon.fengshen_yanyi.txt:ch.048.sec.005`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“此剪乃是兩條蛟龍”；“一閘兩段”。
- 出处三：第四十九回，第 25 段；`segment_id=canon.fengshen_yanyi.txt:ch.049.sec.025`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“忙取袍服所包金蛟剪放於案上”。

### 知识库实体记录

- `canon.fengshen_yanyi.artifact.ecdf7bac0`：`artifact`，`canonical_name=金蛟剪`，`review_status=draft`，`provenance_id=prov.fengshen_yanyi.research`。

### 原典可支持结论

- 原典支持金蛟剪由三仙岛云霄等姐妹持有，云霄借给赵公明；第四十八回明确以两条蛟龙形态出现，并写出“一闸两段”的文本效果。
- 赵公明死后，金蛟剪连袍服留在闻太师处，后由三仙岛姐妹收回的过程可由第四十九回相邻段落继续追读；不能把赵公明写成唯一永久主人。

### 归属变化与本作原创边界

- 原典归属变化：三仙岛姐妹持有；云霄借给赵公明；赵公明死后随袍服留在闻太师处；后续由姐妹处理遗物。
- `FB45` 的守器者、`R05` 取得条件、剪击段数、伤害、必中特性、敌我转移和玩家唯一持有，均为本作改编。
- 原典不证明游戏中的多段攻击、暴击、必杀或任何固定数值，也不证明主角取得后能复制原典“一闸两段”。

### 公开入口

- [《封神演义》Project Gutenberg 23910 书页](https://www.gutenberg.org/ebooks/23910)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23910/pg23910.txt)。

## A06 混元金斗

<a id="A06"></a>

### 名称、出处与段落证据

- 游戏位：`FB46 混元金斗`；取得事件：`R06`。
- 出处一：第五十回，第 13 段；`segment_id=canon.fengshen_yanyi.txt:ch.050.sec.013`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“雲霄娘娘祭起混元金斗”。
- 出处二：第五十回，第 17 段；`segment_id=canon.fengshen_yanyi.txt:ch.050.sec.017`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“雲霄把混元金斗祭起來拿子牙”；“此寶乃是混元金斗”。
- 出处三：第五十回，第 24 段；`segment_id=canon.fengshen_yanyi.txt:ch.050.sec.024`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“也將廣成子拿入「黃河陣」內”。

### 知识库实体记录

- `canon.fengshen_yanyi.artifact.ebd5f7c70`：`artifact`，`canonical_name=混元金斗`，`review_status=draft`，`provenance_id=prov.fengshen_yanyi.research`。

### 原典可支持结论

- 原典支持云霄及三霄姐妹掌握混元金斗，并写其可将玉虚门人拿入黄河阵；燃灯在同段识别该宝。
- 文本中的“拿入阵”是原典叙事行为，不等于一个可直接换算成游戏捕获、封印、即死或资源循环的规则。

### 归属变化与本作原创边界

- 原典归属变化：云霄、碧霄、瓊霄等三霄姐妹共同使用；第五十一回又写玉虚门人的镇洞之宝曾“装在混元金斗内”，后由元始命取回，不能简化成普通战利品。
- `FB46` 的守器者、`R06` 取得、控制/收纳/回怒效果、目标资格、次数和玩家唯一持有，均为本作改编。
- 原典不证明游戏中的控制时长、资源转换、概率、伤害或主角继承；跨典籍混搭须单列改编说明。

### 公开入口

- [《封神演义》Project Gutenberg 23910 书页](https://www.gutenberg.org/ebooks/23910)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23910/pg23910.txt)。

## A07 九龙神火罩

<a id="A07"></a>

### 名称、出处与段落证据

- 游戏位：`FB47 九龙神火罩`；取得事件：`R07`。
- 出处一：第七十六回，第 27 段；`segment_id=canon.fengshen_yanyi.txt:ch.076.sec.027`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“真人又將九龍神火罩，又取陰陽劍，共成八件兵器”。
- 出处二：第七十九回，第 28 段；`segment_id=canon.fengshen_yanyi.txt:ch.079.sec.028`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“罩裏現出九條火龍圍繞”；“馬忠化為灰燼”。
- 出处三：第九十一回，第 17 段；`segment_id=canon.fengshen_yanyi.txt:ch.091.sec.017`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“哪吒祭起九龍神火罩”。

### 知识库实体记录

- `canon.fengshen_yanyi.artifact.e7bbe1a2a`：`artifact`，`canonical_name=九龙神火罩`，`review_status=draft`，`provenance_id=prov.fengshen_yanyi.research`。

### 原典可支持结论

- 原典支持太乙真人把九龙神火罩交给哪吒，文本写哪吒将其作为八件兵器之一使用；第七十九回写罩内九条火龙围绕并烧死马忠。
- 这是太乙真人授予、哪吒持用的器物关系；不能因为哪吒后来使用就删掉授予者，也不能把原典单段战果直接当成普适游戏倍率。

### 归属变化与本作原创边界

- 原典归属变化：太乙真人持有并授予哪吒；哪吒在战斗中使用。
- `FB47` 的守器者、`R07` 取得条件、九条火龙的游戏表现、燃烧/伤害/目标选择和玩家转移，均为本作改编。
- 原典不证明游戏中的持续伤害、范围、命中规则、首领克制或主角继承，不证明 `R07` 胜利后可复制原器。

### 公开入口

- [《封神演义》Project Gutenberg 23910 书页](https://www.gutenberg.org/ebooks/23910)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23910/pg23910.txt)。

## A08 五火七禽扇

<a id="A08"></a>

### 名称、出处与段落证据

- 游戏位：`FB48 五火七禽扇`；取得事件：`R08`。
- 出处：第四十九回，第 7 段；`segment_id=canon.fengshen_yanyi.txt:ch.049.sec.007`；`document_id=canon.fengshen_yanyi.txt`。
- 短引文：“道德真君忙取五火七禽扇一搧”；“五火合成此寶”。
- 同段列出七禽翎为凤凰、青鸞、大鵬、孔雀、白鶴、鴻鵠、梟鳥，并写“七禽翎上有符印、有秘訣”；这些是原典段落内容，不是游戏标签。
- 后续异名用例：第八十一回，第 5 段；`segment_id=canon.fengshen_yanyi.txt:ch.081.sec.005`；`document_id=canon.fengshen_yanyi.txt`，文本简称“五火扇”。这不应与知识库的独立实体“`五火扇`”无说明地合并。

### 知识库实体记录

- `canon.fengshen_yanyi.artifact.e5f8c2446`：`artifact`，`canonical_name=五火七禽扇`，`review_status=draft`，`provenance_id=prov.fengshen_yanyi.research`。
- 知识库另有 `canon.fengshen_yanyi.artifact.e896a2a03`：`artifact`，`canonical_name=五火扇`，`review_status=draft`；本页不把它与“五火七禽扇”自动视为同一实体，仅记录名称重叠风险。

### 原典可支持结论

- 原典支持清虚道德真君持有/使用“五火七禽扇”，并明确给出五火构成和七禽翎、符印秘诀的描述。
- 后文写杨任使用“五火扇”，说明文本存在简称/使用者变化；不能只凭简称就断言每次“五火扇”都等于同一实体，需按段落和实体记录核对。

### 归属变化与本作原创边界

- 原典至少明确清虚道德真君的持用场景；后续文本又出现杨任持“五火扇”的使用场景，具体传承链不能超出实际段落推断。
- `FB48` 的卡面是否采用全名、守器者、`R08` 取得、扇火伤害、燃烧状态、次数和玩家持有，均为本作改编。
- 原典不证明游戏中的火焰倍率、范围、持续时间、暴击或主角继承；跨典籍、简称与全名的混搭必须显式标记。

### 公开入口

- [《封神演义》Project Gutenberg 23910 书页](https://www.gutenberg.org/ebooks/23910)；[Gutenberg TXT](https://www.gutenberg.org/cache/epub/23910/pg23910.txt)。

## 验收索引

| 锚点 | 游戏法宝 | 原典证据文档 | 主要段落 | 查询到实体 | 语义相关度 |
| --- | --- | --- | --- | --- | --- |
| `A01` | `FB41 照妖镜` | 主来源 `canon.xiyou_ji`；封神照妖鉴只作异物辨析 | 主来源为《西游记》第六十一回段 208；异物见封神第九十一回段 10、13、17 | 是；均为 `artifact/draft` | 未运行，非向量精确 SQL |
| `A02` | `FB42 定海珠` | `canon.fengshen_yanyi.txt` | 第四十七回段 25、35、36；第八十四回段 9 | 是，`artifact/draft` | 未运行，非向量精确 SQL |
| `A03` | `FB43 阴阳镜` | `canon.fengshen_yanyi.txt` | 第五十九回段 16、23；第六十回段 14、15 | 是，`artifact/draft` | 未运行，非向量精确 SQL |
| `A04` | `FB44 番天印` | `canon.fengshen_yanyi.txt` | 第六十三回段 9、24；第七十七回段 9 | 是，`artifact/draft` | 未运行，非向量精确 SQL |
| `A05` | `FB45 金蛟剪` | `canon.fengshen_yanyi.txt` | 第四十七回段 45；第四十八回段 5；第四十九回段 25 | 是，`artifact/draft` | 未运行，非向量精确 SQL |
| `A06` | `FB46 混元金斗` | `canon.fengshen_yanyi.txt` | 第五十回段 13、17、24 | 是，`artifact/draft` | 未运行，非向量精确 SQL |
| `A07` | `FB47 九龙神火罩` | `canon.fengshen_yanyi.txt` | 第七十六回段 27；第七十九回段 28；第九十一回段 17 | 是，`artifact/draft` | 未运行，非向量精确 SQL |
| `A08` | `FB48 五火七禽扇` | `canon.fengshen_yanyi.txt` | 第四十九回段 7；简称见第八十一回段 5 | 是，`artifact/draft` | 未运行，非向量精确 SQL |

八件名器均已找到可追溯段落。FB41 采用《西游记》照妖镜；FB48 保留“五火七禽扇”全名，
不凭知识库中的独立“五火扇”实体合并归属。实体状态仍为 draft，段落核验不等于升级校对状态。
