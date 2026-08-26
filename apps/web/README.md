# Web 应用（规划）

这里将承载 TabRecord 的 Web/PWA 客户端：

- 音频设备与 AudioWorklet 采集；
- 可选摄像头与指板校准；
- Worker 中的转录、事件合并和渲染编排；
- alphaTab 标准谱/TAB、播放与光标；
- 人工编辑、会话恢复、GP/MIDI 导入导出。

在 `TAB-101` 契约和 `TAB-201` alphaTab spike 完成前，不锁定 UI 框架或引入大规模组件库。
