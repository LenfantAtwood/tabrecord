# Web 应用

TabRecord 的浏览器客户端。目前的第一条垂直切片用于验证：

```text
GP8 .gp 文件 → alphaTab 读取 → 浏览器渲染 → 本地播放
```

当前包含：

- React 19、TypeScript、Vite 和 pnpm workspace；
- alphaTab 官方 Vite 插件，负责 Worker、AudioWorklet、Bravura 字体和 SoundFont 资源；
- `.gp` 文件选择/拖放、大小与扩展名检查；
- alphaTab 渲染容器、文件状态、播放/暂停和停止控制；
- GP8 文件边界的基础单元测试。

暂未包含 `CanonicalScore` 映射、页面编辑、持久化、GP8 写回和音频转录。

## 本地运行

在仓库根目录执行：

```bash
pnpm install
pnpm dev
```

浏览器打开 Vite 输出的本地地址，然后选择一个由 Guitar Pro 8 保存的 `.gp` 文件。

## 质量检查

```bash
pnpm check
```

该命令依次运行 ESLint、TypeScript、Vitest 和生产构建。
