# Web 应用

TabRecord 浏览器客户端使用 React 19、TypeScript、Vite、alphaTab 与 pnpm workspace。

## 当前通路

- GP8 `.gp` 文件选择/拖放、大小检查、alphaTab 渲染和本地播放。
- 主动勾选实验开关后：音频文件/麦克风 → 本地单音识别 → TAB/五线谱 → 修正弦品 → MIDI/会话保存与恢复。
- 麦克风由 AudioWorklet 采集；Worker 负责音高识别，单任务分析防止预览队列堆积。停止时等待尾部块，再做最终识别。取消/切换页面释放采集设备，忽略过期分析结果。
- 原始时间、置信度、量化 ticks、弦品和人工修订保存在 `features/audio/tabScore.ts` 的版本化快照中；alphaTex 与 Type 1 MIDI 都由该快照派生。alphaTab 仍使用现有适配组件。

音频上限 25 MB/120 秒；标准六弦、0–24 品、固定 BPM 40–240、4/4、十六分音符量化。快于量化网格的连续音符可能向后移动、拉长乐句。录制中整段都是暂定结果，停止后才确认；不是已实现滚动确认线的完整实时系统。默认实验关闭；不启用时仍可导入 GP8。

文件格式以浏览器解码支持为准，优先 WAV/MP3；不能解码时显示提示。麦克风需要 HTTPS/localhost 和授权，后台暂停会停止录制。所有媒体仅在本机内存处理。会话 JSON 不包含音频，页面关闭前应主动保存；未实现自动持久化、完整音高/时值编辑、复音或 GP8 写回。

## 本地运行与验证

需要 Node.js 22+、pnpm 11。在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
```

浏览器打开 Vite 输出地址。勾选实验开关，设好 BPM，选择音频或开始录音；停止后可展开音符列表选择同音高的其他弦品。保存会话可以在之后恢复手动修正。清空/新会话后可重新设置 BPM。

`pnpm check` 包括 ESLint、严格 TypeScript、Vitest、生产构建。测试覆盖合成音高、静音/噪声、真实 worklet 程序的尾部/限长行为、权限/取消/设备断开、Worker 生命周期、弦品约束、alphaTex 解析、MIDI 二进制时间和会话校验。算法 CPU 基准见 [实验报告](../../experiments/audio-monophonic-baseline.md)，不等价于真实演奏准确率或端到端延迟。
