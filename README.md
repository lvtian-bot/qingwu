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

`npm start` 预览已有构建，使用前先运行 `npm run build`。项目定位、技术文档入口与协作规则见 [AGENTS.md](AGENTS.md)。

## AI Agent 驱动开发

与 InkMark 一致：工程实现由 AI Agent 完成；项目发起者负责产品目标、使用场景、体验判断与重要取舍。

## 协议

暂未定，待确认。
