# 手绘动作参考

动作通过 imagegen CLI 的 `edit` 生成，每次保留相同角色身份和完整透明轮廓。

| 导出源 | 输入参考 | 提示词 |
| --- | --- | --- |
| `player-attack.png` | `player-v2.png` | `cartoon-player-attack.txt` |
| `player-rage.png` | `player-v2.png` | `cartoon-player-rage.txt` |
| `enemy-attack.png` | `enemy-v2.png` | `cartoon-enemy-attack.txt` |

模型为当前配置中的 `gpt-image-2.5`。原图位于不公开的
`output/imagegen-cartoon-kit/`，运行时只使用处理后的 PNG。
这些是独立动作姿态，不是 Spine 骨骼、分层绑定或完整逐帧动画。
