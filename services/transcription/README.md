# Transcription service（规划）

用于离线基线、实验和可选本地推理 sidecar，不作为产品会话的唯一数据源。

计划包含：

- Basic Pitch 离线评估；
- TabCNN/吉他专用模型复现；
- 重叠窗口流式适配与事件输出；
- GuitarSet/SynthTab 数据适配；
- 模型导出、版本、权重 hash 和基准报告。

服务只能输出 contracts 中定义的候选事件；修订状态、人工锁定和最终乐谱由产品核心管理。
