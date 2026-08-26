# 相似工作与可复用组件

- 调研日期：2026-08-27
- 原则：优先记录官方仓库、官方文档和论文；版本与许可证在引入依赖时需再次锁定。

## 1. 结论摘要

1. 用户提到的 “audioTab” 很可能是 **alphaTab**。它能承担 GP 导入、标准谱/TAB 渲染、播放和 GP7 导出，但它是 SDK，不是完整实时编辑器。
2. **Basic Pitch** 是很好的音频到 MIDI 离线基线，但当前公开接口以文件/窗口预测为主，实时 streaming 仍是待实现能力；不能把它直接写成“实时模型已就绪”。
3. 吉他 TAB 的关键不只是音高识别，而是弦品分配。TabCNN、GuitarSet、SynthTab 和 playability-constrained decoding 都值得学习。
4. 手势先验有直接研究依据：音频给出音高，视觉可帮助消除同音异位。产品上应把视觉作为可降权的软先验，避免遮挡时拖垮音频路径。
5. GP 写入应先限定到 alphaTab 已公开支持的 GP7 exporter；如果必须回写 GP3–5，再评估 PyGuitarPro。

## 2. 项目与资料

| 项目/论文 | 可学习内容 | 与 TabRecord 的关系 | 主要注意点 |
| --- | --- | --- | --- |
| [alphaTab](https://github.com/CoderLine/alphaTab) / [格式文档](https://www.alphatab.net/docs/category/formats/) / [导出文档](https://docs.alphatab.net/docs/guides/exporter) | GP3–8 输入、数据模型、SVG/Canvas TAB 渲染、播放；GP7 导出 | 首选渲染和 GP7 适配器 | SDK 而非完整编辑器；MPL-2.0；升级要跑黄金集 |
| [Spotify Basic Pitch](https://github.com/spotify/basic-pitch) / [TS 版本](https://github.com/spotify/basic-pitch-ts) | 轻量、复音、instrument-agnostic 音频到 MIDI，支持 pitch bend | 离线基线与浏览器推理候选 | 原生实时输出不是现成功能；窗口边界、延迟和重复事件需自行解决 |
| [Basic Pitch streaming proposal #171](https://github.com/spotify/basic-pitch/issues/171) | 社区对重叠缓冲、增量 MIDI、低延迟的需求分解 | 说明流式适配是独立工程 | Issue 是提案，不是已发布能力 |
| [TabCNN 实现](https://github.com/simon-minami/tabcnn) / [原论文](https://archives.ismir.net/ismir2019/paper/000033.pdf) | 直接按每根弦预测 fret class 的吉他专用转录 | 对比通用音高模型 + 后置弦品解码 | 训练域与真实设备差异明显；仍需时值/流式工程 |
| [GuitarSet](https://github.com/marl/GuitarSet) / [数据发布](https://zenodo.org/records/3371780) | 六通道拾音辅助得到的音高、弦、品、节拍和演奏风格标注 | 主要离线评估/训练候选 | 已知标注问题要固定版本；不是摄像头多模态数据 |
| [SynthTab](https://github.com/yongyizang/SynthTab) | 大规模合成 Guitar Pro → JAMS → MIDI → audio 管线；TabCNN 基线 | 学习合成数据和 GP 转标注流水线 | 数据 CC BY-NC 4.0，可能限制商业用途；仓库披露了渲染 bug |
| [PyGuitarPro](https://github.com/Perlence/PyGuitarPro) | Python 读写与操作 GP3、GP4、GP5 | 旧格式写入的备选 sidecar | 与 Web 主栈分离；仅在明确兼容需求后引入 |
| [Audio-visual guitar transcription](https://ceur-ws.org/Vol-379/paper15.pdf) | 指板追踪、手部检测与音视融合消除弦品歧义 | 手势先验的早期直接证据 | 较老方法；应学习问题分解，不直接复制实现 |
| [MIDI-to-Tab](https://arxiv.org/abs/2408.05024) | 从 MIDI 推断可演奏 TAB，比较约束与数据驱动方法 | 音高事件到弦品的第二阶段解码候选 | 先做硬约束/动态规划基线，再考虑模型 |
| [Audio-based transcription with playability constraints](https://doi.org/10.1109/ICASSP.2013.6637636) | 用动态规划满足演奏连续性 | 可解释的 MVP 弦品解码基线 | 成本函数要通过真实演奏数据调参 |

## 3. alphaTab 能力边界

官方资料显示：

- 输入格式覆盖 GP3、GP4、GP5、GPX、GP7/8、MusicXML 和 alphaTex 的相应支持子集；
- 可以渲染标准谱和 TAB、播放并显示光标；
- 从 1.2.0 起有 `Gp7Exporter`，可把 `Score` 导出为 `.gp` 二进制；
- alphaTab 明确定位为构建记谱软件的 SDK，而不是开箱即用编辑器。

因此建议：

- MVP 的 “GP 读写” 定义为多版本导入 + GP7 导出；
- TabRecord 维护自己的修订历史和内部乐谱，alphaTab 只位于适配层；
- 在 spike 中验证修改内存 `Score` 后的重渲染成本，以及是否能只刷新脏小节；
- 对每个 GP 功能建立兼容矩阵，不写“全格式无损”。

## 4. 实时音频转录路线比较

| 路线 | 优点 | 风险 | 建议 |
| --- | --- | --- | --- |
| Basic Pitch 重叠窗口 | 快速得到复音 MIDI 基线，Python/TS 均有生态 | 非原生 streaming；窗口边界、重复 onset、未来上下文和 1–3 秒延迟 | 第一阶段必须做 |
| TabCNN/吉他专用模型 | 直接输出每弦 fret，贴近目标 | 训练数据少、域偏移、浏览器部署成本 | 离线并行评估 |
| 传统 onset + pitch + DP | 可解释、延迟低，单音场景稳定 | 和弦、泛音、失真较弱 | 作为最低可用/降级路径 |
| 端到端多模态 | 理论上同时解决音高与弦品 | 数据、同步、标注和部署风险最高 | 手势数据成熟后再做 |

推荐先采用级联：`audio → note events → rhythm/quantization → string/fret decoder → score`。每层有独立指标和可替换实现。

## 5. 手势先验的最小可行实验

不要一开始训练端到端视频模型。先做：

1. 用户标定琴枕和若干指板角点；
2. 估计每帧指板网格与手指关键点；
3. 将按弦指尖映射为 `P(string, fret | frame)`；
4. 与音频合法位置交集后作为解码成本；
5. 对遮挡、扫弦、滑音、推弦和空弦单独标记失败；
6. 比较 audio-only 与 audio+gesture 的 string/fret accuracy 和额外延迟。

Go 条件：相对降低至少 10% 弦品错误、p95 额外延迟不超过 250 ms、校准中位用时不超过 30 秒。否则保留为实验能力。

## 6. 需要避免的误区

- 把音高正确等同于 TAB 正确；
- 用 MIDI 作为唯一内部格式，丢失弦品、来源、置信度和修订；
- 每个推理窗口直接追加音符，造成边界重复；
- 在录制头上每帧全量重绘整首谱；
- 把 Basic Pitch 的离线推理包装成“低延迟实时”而不测 p95；
- 使用 SynthTab 全量数据却忽略 CC BY-NC；
- 把模型生成的未确认内容写入最终 GP 后再试图恢复历史。

## 7. 建议先复现的三个基线

1. **Baseline A**：Basic Pitch → note events → 固定 BPM 量化 → 最小换把动态规划 → MIDI/GP7。
2. **Baseline B**：TabCNN 类每弦分类 → onset/offset 后处理 → TAB。
3. **Baseline C**：Baseline A + 标注/模拟手势概率 → 加权束搜索。

相同 GuitarSet 切分和自录合法样例上比较音符、弦品、延迟、内存和失败类型，再决定主路径。
