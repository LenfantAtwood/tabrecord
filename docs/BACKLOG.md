# TabRecord Backlog

- 更新日期：2026-08-27
- 优先级：P0 阻塞 MVP，P1 MVP 所需，P2 Beta，P3 Later
- 估算：XS ≤ 0.5 天，S ≤ 2 天，M ≤ 5 天；超过 M 必须拆分

## 里程碑

| 里程碑 | 目标 | Exit criteria |
| --- | --- | --- |
| M0 可行性 | 证明 GP8 输入、实时窗口和弦品解码可行 | 三份 spike 报告、固定 fixtures、go/no-go 决策 |
| M1 垂直切片 | GP8/麦克风输入到可编辑 TAB，再导出 MIDI | 30 秒端到端演示，带延迟与恢复证据 |
| M2 MVP | 可实际完成录制、纠错、回放与导出 | PRD 的 0.1 验收和 10 人可用性测试 |
| M3 手势 Beta | 可选摄像头先验有稳定净收益 | 达到多模态 go 条件且有自动降级 |

## Epic 0 — 范围、许可与基准（P0）

- [ ] **TAB-001 [S]** 确认首发平台、参考设备、最低浏览器和是否允许本地 sidecar。验收：PRD 待确认项有负责人和日期。
- [ ] **TAB-002 [S]** 建立 3–5 个可再分发的短音频/GP8/MIDI fixtures。验收：每个样例有来源、许可证、预期事件和 hash。
- [ ] **TAB-003 [M]** 定义评估协议。验收：固定数据切分、容差、note/frame/string/fret 指标和 latency 采样方式。
- [ ] **TAB-004 [S]** 建立性能参考设备矩阵。验收：至少一台低配和一台主开发机，记录 CPU/浏览器/音频设备。
- [ ] **TAB-005 [S]** 完成依赖许可证表。验收：alphaTab、Basic Pitch、模型 runtime、数据集和候选 MIDI 库均有结论。
- [ ] **TAB-006 [S]** 建立媒体隐私与用户同意文案草案。验收：音频/视频保存、上传和诊断默认值明确。
- [ ] **TAB-007 [S]** 确认 Guitar Pro 8 样例的版权/分发边界。验收：CI 中只使用自制或许可明确文件。
- [ ] **TAB-008 [XS]** 由仓库所有者选择 TabRecord 许可证。验收：根目录 LICENSE 与 README 一致。

## Epic 1 — 仓库与契约基础（P0）

- [ ] **TAB-101 [M]** 定义 contracts v0：时间单位、tick、弦编号、调弦、NoteEvent、Revision、ScoreSnapshot。
- [ ] **TAB-102 [S]** 为 contracts 生成 JSON Schema 和跨 Worker 运行时校验。
- [ ] **TAB-103 [S]** 初始化 Web/PWA 工程、严格 TypeScript、格式化、lint、unit test。
- [ ] **TAB-104 [S]** 初始化 Python 实验环境与锁文件；提供单命令基线评估。
- [ ] **TAB-105 [S]** 建立 CI：typecheck、tests、docs links、license scan、黄金 fixtures。
- [ ] **TAB-106 [S]** 实现版本化事件日志和确定性 reducer。
- [ ] **TAB-107 [S]** 实现会话 manifest 与 v0→未来版本迁移测试框架。
- [ ] **TAB-108 [XS]** 创建延迟 trace ID 和统一诊断事件契约。

## Epic 2 — GP8 输入、渲染与播放 Spike（P0）

- [ ] **TAB-201 [M]** 集成 alphaTab 最小页面：载入自制 GP8，渲染标准谱/TAB，播放和光标同步。
- [ ] **TAB-202 [M]** 建立 GP8 输入字段兼容矩阵；不创建旧格式矩阵。
- [ ] **TAB-203 [M]** 验证 `GP8 .gp → alphaTab.Score → CanonicalScore → 当前页面`。
- [ ] **TAB-204 [S]** 建立 GP8 输入字段的语义 diff，忽略无关 zip/布局差异。
- [ ] **TAB-205 [M]** 测量 1、10、100、500 小节的全量/脏小节重渲染性能。
- [ ] **TAB-206 [S]** 设计渲染节流：合并 100–250 ms 内的事件更新，保持录制头流畅。
- [ ] **TAB-207 [S]** 生成 GP8 输入 compatibility report。
- [ ] **TAB-208 [M, P1]** 输入模型稳定后实现 `Gp8Writer` spike，并由 Guitar Pro 8 重开验证当前页面快照。
- [ ] **TAB-209 [S]** 决定 MIDI writer；建立 tempo/拍号/note/pitch bend 黄金测试。

## Epic 3 — 音频采集与会话时钟（P0）

- [ ] **TAB-301 [M]** 实现设备选择、权限、输入电平、削波和静音提示。
- [ ] **TAB-302 [M]** 实现 AudioWorklet → Shared/Ring Buffer（含不支持 SharedArrayBuffer 的降级）。
- [ ] **TAB-303 [S]** 统一 `performance.now`、audio context time 和媒体时间轴。
- [ ] **TAB-304 [S]** 实现声道转换、重采样和归一化，并保存参数。
- [ ] **TAB-305 [M]** 连续 30 分钟 capture soak test，报告丢块、内存和后台标签页行为。
- [ ] **TAB-306 [S]** 设备断开/切换后可恢复，不重复或倒退时间戳。
- [ ] **TAB-307 [S]** 每 5 秒持久化事件增量，模拟崩溃恢复。

## Epic 4 — 音频转录基线与流式适配（P0/P1）

- [ ] **TAB-401 [M, P0]** 在固定 fixtures 上跑 Basic Pitch 离线基线并保存版本、权重 hash、指标和失败例。
- [ ] **TAB-402 [M, P0]** 设计重叠窗口和事件身份合并器，输出 insert/update/retract。
- [ ] **TAB-403 [M, P0]** 实现 provisional/committed/locked 状态机和确认线。
- [ ] **TAB-404 [M, P0]** 测量窗口长度、hop、未来上下文对准确度和 p95 延迟的 Pareto 曲线。
- [ ] **TAB-405 [M, P1]** 评估 basic-pitch-ts 浏览器内推理与 Python sidecar 的速度/内存/一致性。
- [ ] **TAB-406 [M, P1]** 复现 TabCNN 或等价吉他专用基线。
- [ ] **TAB-407 [S, P1]** 实现传统 onset/pitch 降级路径，至少覆盖单音输入。
- [ ] **TAB-408 [S, P1]** 建立静音、噪声、失真、扫弦、推弦、滑音和泛音失败套件。
- [ ] **TAB-409 [S, P1]** 推理落后时实现可观察的背压和降级策略。

## Epic 5 — 节拍、量化与乐谱组装（P1）

- [ ] **TAB-501 [S]** 支持固定 BPM、拍号和 count-in。
- [ ] **TAB-502 [M]** 量化 onset/duration，同时保留原始秒时间和量化误差。
- [ ] **TAB-503 [M]** 从事件生成小节、beat、voice、rest、tie。
- [ ] **TAB-504 [S]** 处理跨拍/跨小节音符与重叠 voice。
- [ ] **TAB-505 [M]** 比较自动 tempo/downbeat 候选；不足时明确降级为手动。
- [ ] **TAB-506 [S]** UI 显示量化强度并允许局部关闭/调整。

## Epic 6 — 弦品解码（P0/P1）

- [ ] **TAB-601 [S, P0]** 为任意调弦/变调夹/品数枚举音高合法位置。
- [ ] **TAB-602 [M, P0]** 实现最小换把动态规划或束搜索基线。
- [ ] **TAB-603 [S, P0]** 加入和弦跨度、同指板位置与音高一致性硬约束。
- [ ] **TAB-604 [M, P1]** 在 GuitarSet 上评估 string 和 string+fret accuracy。
- [ ] **TAB-605 [S, P1]** 输出前 N 个弦品候选及成本分解，供 UI 选择和调试。
- [ ] **TAB-606 [M, P1]** 比较 MIDI-to-Tab 模型与可解释 DP，记录准确度/延迟/内存。
- [ ] **TAB-607 [S, P1]** 对用户手动弦品选择建立 session-local 偏好，不自动训练全局模型。

## Epic 7 — 手势先验（P2）

- [ ] **TAB-701 [S]** 定义摄像头同意、默认不保存帧和立即关闭路径。
- [ ] **TAB-702 [M]** 指板标定：琴枕/边缘/参考品，记录标定置信度。
- [ ] **TAB-703 [M]** 手指关键点到指板坐标映射，输出 `GesturePrior`。
- [ ] **TAB-704 [S]** 音视频时钟同步和漂移测量。
- [ ] **TAB-705 [M]** 在合成/人工标注集上比较 audio-only 与 audio+gesture。
- [ ] **TAB-706 [S]** 遮挡、镜头抖动、右手进入画面时自动降权。
- [ ] **TAB-707 [S]** 校准 UX：中位 ≤ 30 秒，可随时重校。
- [ ] **TAB-708 [M]** 达不到研究 go 条件时保留实验 flag，不进入默认 MVP。

## Epic 8 — 编辑、回放与导出（P1）

- [ ] **TAB-801 [M]** 时间线 + TAB 双向选择；显示录制头、确认线和暂定阴影。
- [ ] **TAB-802 [M]** 音高/弦/品/onset/duration 编辑与键盘操作。
- [ ] **TAB-803 [S]** undo/redo、锁定字段和人工来源记录。
- [ ] **TAB-804 [M]** 原音频/MIDI 合成/alphaTab 光标同步，支持 1/2/4 小节循环。
- [ ] **TAB-805 [S]** 导出 MIDI、内部会话，以及通过 `TAB-208` 验证后的 GP8 文件和 compatibility report。
- [ ] **TAB-806 [S]** 导出前校验并阻止不可能弦品、负时值、越界 tick。
- [ ] **TAB-807 [S]** 输入 GP8 后继续增录新轨/新段的交互设计与 spike。

## Epic 9 — 可用性、性能与发布（P1/P2）

- [ ] **TAB-901 [S, P1]** 可访问性检查：键盘、焦点、状态非纯颜色、屏幕阅读标签。
- [ ] **TAB-902 [M, P1]** 参考设备端到端 p50/p95 trace 仪表盘。
- [ ] **TAB-903 [S, P1]** 输入 zip bomb、超大文件、损坏 GP8 的资源限制和错误提示。
- [ ] **TAB-904 [S, P1]** 诊断包脱敏测试。
- [ ] **TAB-905 [M, P1]** 10 人 MVP 可用性测试及问题分级。
- [ ] **TAB-906 [S, P1]** 发布说明模板包含指标、兼容性和已知失败模式。
- [ ] **TAB-907 [M, P2]** 低配设备性能优化和模型降级选择。
- [ ] **TAB-908 [M, P2]** 评估 Tauri 包装，不满足文件/延迟收益则不引入。

## 暂不排期

- 多乐器 stem separation 与多轨总谱；
- DAW/VST/AU 插件；
- 实时协作、云同步和分享；
- 移动原生应用；
- 自动识别全部 Guitar Pro 技法；
- 用户自训练/模型市场。
