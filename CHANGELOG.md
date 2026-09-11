# 更新日志

所有显著变更都记录在本文件中，格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## 未发布
### 📝 文档
- 版本号递增规则成文，只递增最后一位

**完整对比**: [v0.1.1...](https://github.com/lvtian-bot/qingwu/compare/v0.1.1...)
## 0.1.1（2026-09-11）
### ♻️ 重构
- UserData 重定向至 ASCII 目录并自动迁移旧配置
### ⚙️ 工程维护
- 升级内置引擎 dsh 至 0.1.5-rc.1
### ✨ 新增
- 自研界面对齐 ChatGPT 桌面版视觉并新增模型/强度/权限选择器
- 窗口关闭时记忆位置尺寸与最大化并在启动时还原
### 🏗️ 构建与集成
- 升级 GitHub Actions 至 node24 运行时版本
### 🐛 修复
- 关于页引擎版本改为运行时读取 dsh 包真实版本
### 📝 文档
- 提交与对外表述补充青梧界面用语规范
- 归档 v0.2.0 发布前累计已完成事项

**完整对比**: [v0.1.0...v0.1.1](https://github.com/lvtian-bot/qingwu/compare/v0.1.0...v0.1.1)
## 0.1.0（2026-09-09）
### ⚙️ 工程维护
- 清理备用图标并忽略 .trae 工具目录
### ✨ 新增
- 自研界面 Codex 风格升级（Markdown 渲染/工具卡片/思考过程/右侧面板）

**完整对比**: [v0.0.9...v0.1.0](https://github.com/lvtian-bot/qingwu/compare/v0.0.9...v0.1.0)
## 0.0.9（2026-09-08）
### ⚙️ 工程维护
- 忽略 .zcode 工具目录
### ✨ 新增
- 自研界面阶段 1：引擎通信桥与对话界面骨架
- 升级 dsh 0.1.2-rc.1 并迁移自研桥至 typert/gateway 契约
### 🏗️ 构建与集成
- 发布工作流在 master 顶端回写 CHANGELOG
### 🐛 修复
- 标题栏菜单 Esc 等无信号关闭路径的高亮残留
- 补齐打包缺失的 dsh 协议包致 0.0.9 启动崩溃
### 📝 文档
- 归档 v0.0.9 发布前累计已完成事项

**完整对比**: [v0.0.8...v0.0.9](https://github.com/lvtian-bot/qingwu/compare/v0.0.8...v0.0.9)
## 0.0.8（2026-08-22）
### ♻️ 重构
- 自有代码全量迁移 TypeScript
### 🐛 修复
- 标题栏菜单点击外部关闭后清除按钮高亮

**完整对比**: [v0.0.7...v0.0.8](https://github.com/lvtian-bot/qingwu/compare/v0.0.7...v0.0.8)
## 0.0.7（2026-08-21）
### 🐛 修复
- Windows 下隐藏子进程控制台弹窗
### 📝 文档
- 清理 V1 轮次表述并移除第一轮需求文档

**完整对比**: [v0.0.6...v0.0.7](https://github.com/lvtian-bot/qingwu/compare/v0.0.6...v0.0.7)
## 0.0.4（2026-08-21）
### 🐛 修复
- 安装包文件名改为纯 ASCII 避免更新下载 404

**完整对比**: [v0.0.3...v0.0.4](https://github.com/lvtian-bot/qingwu/compare/v0.0.3...v0.0.4)
## 0.0.3（2026-08-20）
### ✨ 新增
- 自研渲染层与检查更新页面

**完整对比**: [v0.0.2...v0.0.3](https://github.com/lvtian-bot/qingwu/compare/v0.0.2...v0.0.3)
## 0.0.2（2026-08-20）
### ⚙️ 工程维护
- 初始化青梧项目管理机制与第一轮需求文档
### ✨ 新增
- 完成青梧 V0.0.1 桌面客户端开发与 Windows 打包
- 增加菜单栏、关于对话框与手动检查更新功能
- 配置 GitHub Releases 发布源与项目主页
### 🏗️ 构建与集成
- 参照 InkMark 接入 GitHub Actions 自动化质量门禁与发布工作流

<!-- 本文件由 git-cliff 依据 Conventional Commits 自动生成，请勿手工编辑 -->
