# 开源骨骼动画

## 当前方案

使用 DragonBones 骨骼与动画运行时，配合 PixiJS 的透明 WebGL 画布。
锁定 `pixi-dragonbones-runtime@8.0.3` 与 `pixi.js@8.22.0`，
不使用 Spine，也没有把自制骨骼换名后继续使用。
核心、社区 Pixi 适配器、PixiJS 与实际打包的传递依赖声明，
随预览提供在 `public/animation-LICENSE.txt`。

DragonBones 原始项目与当前 Pixi 适配器不是同一个维护团队。
这里使用社区的 Pixi 8 适配器，并锁定依赖及浏览器验收，
不假定旧编辑器仍有活跃支持。范围限于当前手绘预览；
正式游戏的结果事件对接、全部敌人覆盖与真实低端手机测试尚未完成。

## 编辑源

- `src/rig-data.js`：六套人物各自的贴图关节、骨骼、动作关键帧和命中事件。
- `src/rig.js`：开源运行时的加载、渲染、时钟、状态与生命周期适配。
- `public/assets/rig-*.png`：已有 imagegen 分层贴图，不使用厂商示例人物。
- `public/assets/library.json`：图集区域、功法与素材映射。
- `src/animation-base-LICENSE.txt`、`src/colord-LICENSE.txt`：声明源。

`public/rig.js` 与 `public/animation-LICENSE.txt` 是可复现的编译产物，
不手工修改。浏览器不访问 `node_modules`，不使用 CDN 浮动版本。
安装与构建均在本模块执行，不修改根依赖：

```bash
npm ci
npm run build:animation
npm test
npm run test:rig
```

`npm test` 检查已提交的编译产物是否与源码、锁文件及实际依赖声明一致。
构建不启动发布、不提交 Git、不执行模型生成。
源码产生标准 DragonBones 5.5 数据对象，由真实运行时解析器读入；
没有 `.spine` 工程，也不冒充动画师在编辑器中制作的工程。

## 绑定

每套素材独立标定头颈、衣身肩点、袖臂肩点、肘点、前臂肘点、手掌和武器握点。
坐标来自实际裁切图像，不能统一使用贴图中心或共用尺寸猜测。
袖臂原画角度通过显示变换对齐骨骼轴，再由骨骼长度确定肘点。
前臂与武器均沿父骨骼更新；握点不通过额外平移追逐手掌。

前后袖臂分别绘制，衣身覆盖肩部接缝。所有动作保留相同脚底锚点与镜头比例，
不在动作之间自动缩放人物。当前属于刚性贴图骨骼绑定，不含柔性网格蒙皮；
生成原画上的接缝样式仍需美术与用户继续确认。

## 动作与反馈

每名人物具有待机、普攻、怒技、法宝、恢复、受击和格挡七个关键帧动画。
剑、杵、杖与扇的出手幅度不同；法宝和恢复使用不同的手势。
待机只轻动上身与饰物，腿部锚点不随呼吸漂移。
DragonBones 的 `impact` 帧事件通知表现夹具，不由骨骼重新计算伤害。
同一次行动仍合并一个伤害反馈，命中时同步更新气血与护盾。

Pixi 不使用共享自动 ticker。表现层显式推进 DragonBones 的时间，
暂停、模态框与后台切换同时冻结动画和数值。
倍速改变同一时间增量；离开斗法清理待处理动作。
减少动态时恢复静态姿态，只提交一次尚未完成的命中；
暂停时不提交，恢复后再提交。

WebGL 不可用、贴图失败或运行中丢失上下文时恢复完整人物图。
上下文丢失时保留尚未展示的反馈，不丢失、不重复，也不突破暂停状态。
浏览器往返缓存保留画布，不在返回时复用已销毁的渲染器。
Pixi 的无 eval 补丁保留严格 CSP，不增加 `unsafe-eval` 或外部脚本权限。

## 验收

解析测试使用依赖的 `ObjectDataParser`，不是替代解析器。
浏览器检查五种功法造型、两侧非空 WebGL 像素、连续变化、
暂停、模态框、倍速、命中点、降动效、离页与失败回退。
另对六套素材、七种动作、九个时间点、两方进行 756 个真实姿态采样，
比较实际 Pixi 贴图矩阵中的肩肘点与骨骼位置，
并检查武器握点和固定脚底。

自动检查不能证明动画好看。主会话需检查完整手机斗法截图、
逐动作图与连续播放；截图保存在不公开的 `captures/dragonbones/` 与
`captures/rig/`，四屏导出由 `capture:previews` 更新。
用户认可了总体手绘风格，但本轮绑定与动作仍待用户确认。

## 资料

- [DragonBonesJS](https://github.com/DragonBones/DragonBonesJS)。
- [社区 Pixi 适配器](https://github.com/h1ve2/pixi-dragonbones-runtime)。
- [PixiJS](https://github.com/pixijs/pixijs)。
