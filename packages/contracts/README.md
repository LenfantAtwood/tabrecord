# Contracts（规划）

跨 UI、AudioWorklet、Worker、Python 和持久化层共享的版本化契约。

首批对象：

- `SessionConfig` / `InstrumentProfile`
- `NoteCandidate` / `NoteEvent` / `TabPosition`
- `GesturePrior`
- `Revision` / `CommitBoundary`
- `CanonicalScore` / `ScoreSnapshot`
- `DiagnosticEvent`

要求：纯数据、无 UI/模型依赖；有 JSON Schema、运行时验证、迁移测试和固定 fixtures。
