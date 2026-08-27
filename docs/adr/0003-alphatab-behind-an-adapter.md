# ADR-0003：alphaTab 置于独立适配层

- 状态：Proposed
- 日期：2026-08-27

## 背景

alphaTab 与项目需求高度匹配：可读取 GP8，并渲染/播放 TAB。但它是 MPL-2.0 SDK，数据模型和支持格式会演进，也不负责 TabRecord 的实时修订历史；它不被视作现成的 GP8 writer。

## 决策

只在 `AlphaTabAdapter` 中引用 alphaTab 类型，且只承诺 GP8 输入、渲染和播放。业务模块消费 `CanonicalScore`。GP8 写回使用独立 `Gp8Writer` 接口，以 Guitar Pro 8 重开和语义 diff 为验收。所有 alphaTab 升级必须通过固定 GP8 文件的输入、渲染视觉和性能测试。

## 后果

- 降低依赖升级扩散；
- 可以替换渲染或增加服务端导出；
- 需要维护一层显式映射和兼容报告；
- 不为其他 Guitar Pro 版本建立独立兼容路径。
