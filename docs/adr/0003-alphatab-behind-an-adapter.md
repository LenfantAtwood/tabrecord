# ADR-0003：alphaTab 置于独立适配层

- 状态：Proposed
- 日期：2026-08-27

## 背景

alphaTab 与项目需求高度匹配：可导入多代 Guitar Pro，渲染/播放 TAB，并导出 GP7。但它是 MPL-2.0 SDK，数据模型和支持格式会演进，也不负责 TabRecord 的实时修订历史。

## 决策

只在 `AlphaTabAdapter` 中引用 alphaTab 类型。业务模块消费 `CanonicalScore`。所有 alphaTab 升级必须通过固定 GP 文件的语义往返、渲染视觉和性能测试。

## 后果

- 降低依赖升级扩散；
- 可以替换渲染或增加服务端导出；
- 需要维护一层显式映射和兼容报告。
