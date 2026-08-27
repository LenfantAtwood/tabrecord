# 参与 TabRecord


## 开始前

1. 从 [Backlog](docs/BACKLOG.md) 选择一个有验收条件的任务。
2. 不清楚能否实现的事项先建 `spike`，不要直接包装成产品功能。
3. 影响数据模型、文件格式或模块边界的变更先新增 ADR。
4. 音频、视频、模型权重和完整数据集不得直接提交到 Git。

## 分支与提交

- 分支：`feat/TAB-123-short-name`、`fix/TAB-123-short-name`、`spike/TAB-123-short-name`。
- 提交建议使用 Conventional Commits，例如 `feat(renderer): add gp7 round-trip fixture`。
- 保持 PR 小而可验证；实验结果与产品代码尽量分开提交。

## 拉取请求最低要求

- 关联任务和明确的验收条件；
- 说明用户可见变化、风险与回滚方式；
- 对新算法给出基线、数据版本、配置、随机种子和结果摘要；
- 对 GP/MIDI 变更附黄金文件往返结果；
- 对实时路径附参考设备、p50/p95 延迟和丢帧/丢块数据；
- 更新相关文档或说明为什么无需更新。

完整的状态流、质量门和完成定义见 [研发工作流](docs/WORKFLOW.md)。
