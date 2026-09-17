# 青梧 Qingwu

办公 Agent 桌面客户端。把 DeepSeek Harness 封装成普通办公用户能双击打开、不用命令行的 Windows 桌面应用。

## 开发与构建

```bash
# 按锁文件安装依赖
npm ci

# 准备 Windows 引擎运行时
npm run runtime:node

# 代码检查
npm run check

# 开发运行
npm run dev

# 打包 Windows 安装包
npm run dist
```

`npm start` 预览已有构建，使用前先运行 `npm run build`。环境要求、按任务阅读的模块入口与验证方法见 [维护导航](docs/maintenance.md)。

## 产品定位

把 Agent 引擎封装成普通桌面软件：双击打开即用，会话、工具调用、文件读写由内置引擎提供。定位与边界见 docs/product-positioning.md。

## 项目结构

- AGENTS.md：协作规范
- docs/product-positioning.md：产品定位
- docs/tech-architecture.md：技术路线与决策
- docs/maintenance.md：模块导航、开发排障与升级验证
- docs/TODO.md：待办
- docs/release.md：发布流程

## AI Agent 驱动开发

与 InkMark 一致：工程实现由 AI Agent 完成；项目发起者负责产品目标、使用场景、体验判断与重要取舍。

## 协议

暂未定，待确认。
