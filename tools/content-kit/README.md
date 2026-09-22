# 山海版内容工具

这是新版 `content/shanhai/` 的独立 Node ESM 校验器和阅读页 renderer。它只读取
`manifest.yaml` 明确列出的 YAML 文件，不扫描内容目录，也不修改根目录依赖。

```sh
cd tools/content-kit
npm ci
npm test
npm run validate
npm run docs
npm run docs:check
```

`validate` 在清单文件缺失、空文件、非法 YAML、重复 ID、非法引用或结构越界时返回非零状态。
即使校验通过，报告也会列出伤害、持续伤害、护盾、治疗、状态和怒气尚未接入运行时校准的边界。

`docs` 只有在全量内容通过校验后，才会生成固定的 32 个阅读页到
`docs/shanhai/rework/content/`。生成页带有不可手改的页首标记；`docs:check` 将预期内容与
磁盘上的固定 32 页逐一比较，缺失、漂移或输出软链均会失败，不写入文档目录。
首次生成或 YAML 修改后先运行 `docs`，再运行 `docs:check`。

真实内容回归检查包含数量、引用、关键消费规则和每门 81 种天赋组合的结构枚举；
它不执行新游戏的战斗，不证明数值平衡或 810 组对抗已测完。

YAML 通过 `yaml` 官方包的 `parseDocument` 结构化解析；工具拒绝重复键、anchors/aliases、
显式 tags 和多文档输入，不执行 YAML 或字段中的任意代码。
