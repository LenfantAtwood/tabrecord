# TabRecord

TabRecord 是一个面向吉他演奏者的实时 TAB 录制与编辑工具。它从麦克风获取演奏音频，可选地结合摄像头中的左手/指板位置先验，持续生成可修订的音符事件、六线谱和 MIDI，并读取或写回 Guitar Pro 8 文件。

> 当前状态：前端工程已建立，正在验证 GP8 输入、alphaTab 渲染与本地播放闭环。

## 产品目标

- 演奏时尽快看到“暂定”TAB，停止或继续演奏时自动校正最近若干拍。
- 支持 Guitar Pro 8 `.gp` 导入、实时渲染、人工纠错与写回。
- 使用乐器可演奏性与可选手势信息，解决同一音高对应多个弦品位置的歧义。
- 保留可复现的原始事件、模型置信度和人工修改，不把渲染格式当作唯一数据源。

## 首版

首版优先支持标准六弦吉他、标准/自定义调弦、单把吉他输入，以及近实时的本地会话。目标延迟为“可用于练习和创作记录”的 1–3 秒级。

首版输入：

- 麦克风中的单把吉他音频；
- Guitar Pro 8 `.gp` 文件。

首版输出：

- 屏幕中的标准谱 + TAB 实时预览；
- MIDI 文件；
- Guitar Pro 8 `.gp` 文件；
- TabRecord 内部会话文件，用于无损恢复和继续编辑。

GP8 是唯一 Guitar Pro 兼容目标。项目不为其他版本建立解析、写入和测试路径；先完成 GP8 输入，再在同一页面模型上完成 GP8 写回。


## 技术需求

- **alphaTab**：读取 GP8，并负责 TAB/标准谱渲染与播放。
- **GP8 适配器**：把 GP8 输入映射为页面模型，并在输入路径稳定后写回 GP8 `.gp`。
- **内部事件模型**：音符、节拍、弦品、技法、置信度、来源和修订历史的唯一事实来源。
- **两阶段转录**：最近窗口为 `provisional`（可修订），跨过确认线后变成 `committed`（默认不再被模型改写）。
- **音频基线**：先离线评估 Basic Pitch / TabCNN 类方法，再通过重叠窗口做流式适配；Basic Pitch 本身不是原生实时系统。
- **弦品解码**：先用调弦、跨度、换把、同弦连续性等可演奏约束，再加入摄像头手势概率作为软先验。

详见 [产品需求](docs/PRODUCT_REQUIREMENTS.md)、[系统架构](docs/ARCHITECTURE.md)、[研发工作流](docs/WORKFLOW.md)、[研究笔记](docs/RESEARCH.md) 和 [完整待办](docs/BACKLOG.md)。

## 仓库结构

```text
apps/web/                 浏览器/PWA 界面、音视频采集、alphaTab 集成
packages/contracts/       跨模块事件、命令和文件契约
services/transcription/   Python 基线、模型实验与可选本地推理服务
experiments/              可复现实验配置与结果摘要（不提交大数据/权重）
fixtures/                 小型、可再分发的黄金测试样例说明
docs/                     PRD、架构、工作流、研究、ADR 与 backlog
```

## 启动前端

需要 Node.js 22 或更新版本，以及 pnpm 11：

```bash
pnpm install
pnpm dev
```

当前页面只接受由 Guitar Pro 8 保存的 `.gp` 文件。文件在浏览器本地读取，不会上传。运行全部检查：

```bash
pnpm check
```

## 实验

1. 用 3 个合法可再分发的短音频样例建立离线基线。
2. 验证 GP8 输入 → 页面模型 → 局部重渲染；随后验证当前页面快照写回 GP8。
3. 定义并冻结 `NoteEvent`、`TabPosition`、`Revision`、`ScoreSnapshot` 的 v0 JSON Schema。
4. 做一个 30 秒会话切片：麦克风 → 音频环形缓冲 → 暂定音符 → 静态 TAB。
5. 记录端到端延迟、音符 F1、弦品准确率和导出往返差异，决定是否进入 MVP。

## 参与开发

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。所有模型或数据集引入前必须完成许可证、隐私和可复现性检查。
