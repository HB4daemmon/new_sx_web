# 神话敌方人物原典来源

> 状态：原典身份与单一核心意象核验笔记，供敌人条目引用；不是游戏规则、数值或已实现内容。
> 核验日期：2026-09-19。固定来源 ID：`M01` 至 `M14`。

## 1. 核验口径

- 本页只记录人物身份、原典称谓和一个可追溯的核心意象，不编写敌人行为规则、功法天赋、法宝效果或战斗数值。
- 本次使用 `knowledge_review._conn()` 的参数化精确只读 SQL 读取实体和 `source_segments`，并设置 `conn.read_only=True`；这是本地非向量检索回退，因此不填写相关度。没有写入、编辑、状态流转、ETL、向量化或数据库服务操作。
- `canon.xiyou_ji` 的来源文档为《西游记》Project Gutenberg 23962；`canon.fengshen_yanyi` 的来源文档为《封神演义》Project Gutenberg 23910。本页没有把 `canon.fengshen_yanyi.txt` 与 `canon.fengshen_yanyi` 混用。
- 实体记录当前保持知识库原状态；本页命中的实体均为 `draft`，没有把任何实体升级为 `reviewed` 或 `locked`。M02、M03 未以本次精确名称查询命中 `character` 实体，故不补写实体 ID。
- 引文均为实际读取段落中的短引文。原典身份不等于本作敌人的功法、法宝、剧情或掉落关系；`KF01-KF10` 与本目录 `FB` 配装属于游戏改编，不冒称原典修炼或持有。

## 2. 敌方人物来源

<a id="M01"></a>

### M01 黑熊精

**原典身份**

- 知识库实体：`黑大王`（`kind=character`，`entity_id=canon.xiyou_ji.character.e0f6cbf58`，`review_status=draft`）。本库实体摘要将其标为“黑熊精”；原文同时出现“黑大王”和“黑熊精”，不把未读到的“黑风怪”另作已证别名。
- 关键意象：妖王盗取袈裟，原文称其为黑熊精。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第一七回，段 174，`segment_id=canon.xiyou_ji:ch.017.sec.174`。短引文：“那黑大王修成人道”。
- 出处：`document_id=canon.xiyou_ji`，第一七回，段 205，`segment_id=canon.xiyou_ji:ch.017.sec.205`。短引文：“黑熊精在那裏鄰住，著他偷了我師父袈裟”。

**游戏改编边界**

- M01 只借用黑熊精/黑大王的原典身份与盗袈裟意象。敌方采用的 `KF01-KF10` 主修、天赋选择和 `FB` 装备是本作配装，不宣称黑熊精原著修炼这些功法或持有这些游戏法宝；胜利也不等于杀死原典角色或继承其全部宝物。

<a id="M02"></a>

### M02 白骨精

**原典身份**

- 本次精确名称查询未命中 `白骨精` 或 `白骨夫人` 的 `character` 实体，因此不填写实体 ID、kind 或 review 状态。
- 称谓核验：原文用“白骨夫人”；核心意象是以僵尸/白骨变化迷惑取经一行。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第二七回，段 184，`segment_id=canon.xiyou_ji:ch.027.sec.184`。短引文：“僵尸，在此迷人敗本”。
- 出处：`document_id=canon.xiyou_ji`，第二七回，段 185，`segment_id=canon.xiyou_ji:ch.027.sec.185`。短引文：“叫做『白骨夫人』”。

**游戏改编边界**

- M02 只借用白骨夫人的原典身份与变化迷人意象。游戏敌人的 `KF01-KF10`、`FB` 和遭遇剧情不由这两段原文推出，也不把游戏胜利写成原典角色死亡或宝物继承。

<a id="M03"></a>

### M03 黄风怪

**原典身份**

- 本次精确名称查询未命中 `黄风怪` 或 `黄风大王` 的 `character` 实体，因此不以同名技能或其他实体补写人物 ID、kind 或 review 状态。
- 原文在同一遭遇中可见“黄风大王”和“黄风怪”两种称谓；本页只记录实际段落，不把相近名称搜索结果冒充为另一条人物实体。
- 关键意象：三昧神风。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第二一回，段 88，`segment_id=canon.xiyou_ji:ch.021.sec.088`。短引文：“被黃風大王拿了我師父去了”。
- 出处：`document_id=canon.xiyou_ji`，第二一回，段 100，`segment_id=canon.xiyou_ji:ch.021.sec.100`。短引文：“他叫做三昧神風”。
- 另见同回段 205，`segment_id=canon.xiyou_ji:ch.021.sec.205`，短引文：“在此鎮押黃風怪”；该段与段 88 的同回遭遇称谓一并核对。

**游戏改编边界**

- M03 只借用黄风怪/黄风大王的原典身份与三昧神风意象。敌人的功法、天赋、装备和阶段规则均为本作改编，不把 `三昧神风` 直接写成游戏技能或原典配装。

<a id="M04"></a>

### M04 红孩儿

**原典身份**

- 知识库实体：`红孩儿`（`kind=character`，`entity_id=canon.xiyou_ji.character.e9a2af44e`，`review_status=draft`）。
- 关键意象：圣婴大王与三昧真火。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第四○回，段 218，`segment_id=canon.xiyou_ji:ch.040.sec.218`。短引文：“乳名叫做紅孩兒，號叫做聖嬰大王”。
- 出处：`document_id=canon.xiyou_ji`，第四○回，段 217，`segment_id=canon.xiyou_ji:ch.040.sec.217`。短引文：“修行了三百年，煉成三昧真火”。

**游戏改编边界**

- M04 只借用红孩儿/圣婴大王的身份与三昧真火意象。游戏中为其配置的 `KF01-KF10`、`FB` 和战斗压力是跨书改编，不宣称原著持有本目录游戏法宝或修炼本作功法。

<a id="M05"></a>

### M05 百眼魔君

**原典身份**

- 知识库实体：`百眼魔君`（`kind=character`，`entity_id=canon.xiyou_ji.character.e09cb330d`，`review_status=draft`）。
- 称谓核验：原文在同一段直接写“百眼魔君”与“多目怪”；关键意象是胁下千眼放出金光、黄雾。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第七三回，段 185，`segment_id=canon.xiyou_ji:ch.073.sec.185`。短引文：“本是個百眼魔君，又喚做多目怪”。
- 出处：`document_id=canon.xiyou_ji`，第七三回，段 145，`segment_id=canon.xiyou_ji:ch.073.sec.145`。短引文：“兩脅下有一千隻眼”。
- 同回段 147，`segment_id=canon.xiyou_ji:ch.073.sec.147`，短引文：“艷艷金光，千隻眼中如放”。

**游戏改编边界**

- M05 只借用百眼魔君/多目怪的身份与千眼金光意象。敌方负面状态、功法、法宝与阶段规则属于本作配装，不把原文的千眼直接等同为游戏通用技能或免疫规则。

<a id="M06"></a>

### M06 白鹿精

**原典身份**

- 知识库实体：`白鹿精`（`kind=character`，`entity_id=canon.xiyou_ji.character.e8f038282`，`review_status=draft`）。
- 称谓核验：同一遭遇把宫中“国丈”揭为妖精，最后现出白鹿；“白鹿精/国丈”只按这些实际段落记录。
- 关键意象：国丈现出白鹿，且为老寿星之物。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第七九回，段 25，`segment_id=canon.xiyou_ji:ch.079.sec.025`。短引文：“原來國丈是妖精”。
- 出处：`document_id=canon.xiyou_ji`，第七九回，段 120，`segment_id=canon.xiyou_ji:ch.079.sec.120`。短引文：“轉身，原來是隻白鹿”。
- 同回段 158，`segment_id=canon.xiyou_ji:ch.079.sec.158`，短引文：“白鹿既是老壽星之物”。

**游戏改编边界**

- M06 只借用白鹿/国丈的原典身份与白鹿显形意象。游戏中的主修、天赋、装备和战斗阶段不从南极寿星或蟠龙拐的原典归属推导，也不把胜利写成取得寿星全部器物。

<a id="M07"></a>

### M07 袁洪

**原典身份**

- 知识库实体：`袁洪`（`kind=character`，`entity_id=canon.fengshen_yanyi.character.e4b819bc4`，`review_status=draft`）。
- 关键意象：梅山得道白猿、变化多端。

**原文依据**

- 出处：`document_id=canon.fengshen_yanyi`，第九十二回，段 8，`segment_id=canon.fengshen_yanyi:ch.092.sec.008`。短引文：“此怪乃梅山得道白猿，最是精靈”。
- 作为同一文档的补充核验：第九十三回，段 4，`segment_id=canon.fengshen_yanyi:ch.093.sec.004`，短引文：“袁洪上了『山河社稷圖』”。

**游戏改编边界**

- M07 只借用袁洪的梅山白猿身份与变化意象。`KF01-KF10`、`FB` 和游戏遭遇不是《封神演义》原文中的袁洪构筑；胜利不宣称原典结局被重演或玩家继承原典器物。

<a id="M08"></a>

### M08 吕岳

**原典身份**

- 知识库实体：`吕岳`（`kind=character`，`entity_id=canon.fengshen_yanyi.character.e5d1544a8`，`review_status=draft`）。
- 关键意象：九龙岛炼气士、瘟部鼻祖。

**原文依据**

- 出处：`document_id=canon.fengshen_yanyi`，第五十七回，段 29，`segment_id=canon.fengshen_yanyi:ch.057.sec.029`。短引文：“九龍島內經修煉”；同段又有“呂岳聲名四海傳”。
- 出处：`document_id=canon.fengshen_yanyi`，第五十九回，段 2，`segment_id=canon.fengshen_yanyi:ch.059.sec.002`。短引文：“一位是瘟部鼻祖”。

**游戏改编边界**

- M08 只借用吕岳的原典身份与瘟部意象。游戏毒、负面状态、主修、天赋和装备若出现在敌人构筑中，均是本作改编，不写成吕岳原著已修炼本作功法或持有本目录法宝。

<a id="M09"></a>

### M09 罗宣

**原典身份**

- 知识库实体：`罗宣`（`kind=character`，`entity_id=canon.fengshen_yanyi.character.eb739c838`，`review_status=draft`）。
- 关键意象：火龙岛焰中仙，以火箭焚烧西岐。

**原文依据**

- 出处：`document_id=canon.fengshen_yanyi`，第六十四回，段 12，`segment_id=canon.fengshen_yanyi:ch.064.sec.012`。短引文：“火龍島焰中仙羅宣是也”。
- 出处：`document_id=canon.fengshen_yanyi`，第六十四回，段 18，`segment_id=canon.fengshen_yanyi:ch.064.sec.018`。短引文：“萬里起雲煙乃是火箭”。
- 同回段 20，`segment_id=canon.fengshen_yanyi:ch.064.sec.020`，短引文：“萬只火鴉飛騰入城，口內噴火”。

**游戏改编边界**

- M09 只借用罗宣的原典身份与焚城火意象。游戏燃烧、法宝 ID、阶段压力和胜利奖励不由原典火器归属自动推出，也不把游戏法宝名器关系写成原著持有关系。

<a id="M10"></a>

### M10 牛魔王

**原典身份**

- 知识库实体：`牛魔王`（`kind=character`，`entity_id=canon.xiyou_ji.character.e6c412338`，`review_status=draft`）。
- 称谓核验：原文直接说明“大力王”即牛魔王；关键意象是现出大白牛原身。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第六○回，段 2，`segment_id=canon.xiyou_ji:ch.060.sec.002`。短引文：“大力王即牛魔王也”。
- 出处：`document_id=canon.xiyou_ji`，第六一回，段 144，`segment_id=canon.xiyou_ji:ch.061.sec.144`。短引文：“現出原身：一隻大白牛”。
- 同回段 7，`segment_id=canon.xiyou_ji:ch.061.sec.007`，短引文：“他也有七十二變”。

**游戏改编边界**

- M10 只借用牛魔王/大力王的身份与大白牛、变化意象。游戏配装、`KF01-KF10`、阶段规则和奖励是本作改编；胜利不等于重演原典收伏，也不自动取得芭蕉扇或其他原典器物。

<a id="M11"></a>

### M11 寅将军

**原典身份**

- 知识库实体：`寅将军`（`kind=character`，`entity_id=canon.xiyou_ji.character.eaf7d6419`，`review_status=draft`）。
- 关键意象：双叉岭虎精，食人。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第一三回，段 80，`segment_id=canon.xiyou_ji:ch.013.sec.080`。短引文：“寅將軍者，是個老虎精”。
- 出处：`document_id=canon.xiyou_ji`，第一三回，段 78，`segment_id=canon.xiyou_ji:ch.013.sec.078`。短引文：“寅將軍。他三個把我二從者吃了”。

**游戏改编边界**

- M11 只借用寅将军的虎精身份与双叉岭食人意象。游戏的高防、重击、法宝与胜利奖励不从原典食人情节扩写为规则，也不把战斗胜利写成原典角色永久死亡。

<a id="M12"></a>

### M12 银角大王

**原典身份**

- 知识库实体：`银角大王`（`kind=character`，`entity_id=canon.xiyou_ji.character.e350fa8ae`，`review_status=draft`）。
- 关键意象：莲花洞二大王，以宝葫芦装人。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第三五回，段 46，`segment_id=canon.xiyou_ji:ch.035.sec.046`。短引文：“銀角大王”。
- 出处：`document_id=canon.xiyou_ji`，第三五回，段 27，`segment_id=canon.xiyou_ji:ch.035.sec.027`。短引文：“葫蘆，可以裝人”。
- 同回段 59，`segment_id=canon.xiyou_ji:ch.035.sec.059`，短引文：“二大王爺爺裝在葫蘆裏”。

**游戏改编边界**

- M12 只借用银角大王的身份与宝葫芦装人意象。游戏中的法宝 ID、怒技、状态和奖励不宣称为银角大王原著持有本作器物，也不把胜利写成复制或继承太上老君全部宝物。

<a id="M13"></a>

### M13 九头虫

**原典身份**

- 知识库实体：`九头虫`（`kind=character`，`entity_id=canon.xiyou_ji.character.e400492e5`，`review_status=draft`）。
- 关键意象：九头多眼、使用月牙铲。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第六三回，段 158，`segment_id=canon.xiyou_ji:ch.063.sec.158`。短引文：“招了一個駙馬，乃是九頭蟲”。
- 出处：`document_id=canon.xiyou_ji`，第六三回，段 76，`segment_id=canon.xiyou_ji:ch.063.sec.076`。短引文：“原來那怪九個頭，轉轉都是眼睛”。
- 同回段 30，`segment_id=canon.xiyou_ji:ch.063.sec.030`，短引文：“使一般兵器，叫做月牙鏟”。

**游戏改编边界**

- M13 只借用九头虫的原典身份与九头多眼意象。游戏的多段攻击、法宝、阶段压力和奖励属于本作改编，不把月牙铲或原典战斗结果直接转成玩家可继承的游戏装备。

<a id="M14"></a>

### M14 大鹏金翅雕

**原典身份**

- 知识库实体：`云程万里鹏`（`kind=character`，`entity_id=canon.xiyou_ji.character.ea1329dd2`，`review_status=draft`）。
- 称谓核验：原文分别出现“云程万里鹏”和“大鹏金翅雕”；本页采用读取到的原文称谓，不把未经段落核对的其他写法另作实体。
- 关键意象：摶风运海、振翅远行的大鹏。

**原文依据**

- 出处：`document_id=canon.xiyou_ji`，第七四回，段 199，`segment_id=canon.xiyou_ji:ch.074.sec.199`。短引文：“雲程萬里鵬”；同段又有“摶風運海，振北圖南”。
- 出处：`document_id=canon.xiyou_ji`，第七七回，段 236，`segment_id=canon.xiyou_ji:ch.077.sec.236`。短引文：“現了本相，乃是一個大鵬金翅鵰”。

**游戏改编边界**

- M14 只借用云程万里鹏/大鹏金翅雕的身份与振翅意象。游戏功法、天赋、法宝、阶段规则和胜利奖励都是跨书遭遇改编，不宣称敌人原著持有本作 `FB`，也不把胜利写成原典角色死亡或继承全部宝物。

## 3. 统一改编边界

- M01-M14 是跨书单场遭遇改编，不是新增随机同伴线；不因敌人出现而新增人物回访、授宝或同伴关系。
- 原典段落只支持人物、称谓、身份、器物意象或遭遇背景，不支持本作的功法配置、完整天赋、数值、状态时序、战斗阶段、掉落、路线结果或持有关系。
- 敌人使用 `KF01-KF10` 和原创 `FB` 属于游戏配装；不能写成原典人物修炼本作功法或原著持有这些游戏法宝。
- 一般胜利不等于杀死原典角色，也不等于取得对方全部宝物。只有另有游戏文档明示授予的物品，才可作为游戏奖励处理。
