# 青梧 右侧面板（工作区与文件审查）设计方案

本文档记录青梧客户端右侧面板的技术与产品设计。
- **UI 风格与桌面质感**：参考 **Codex 桌面端**（紧凑、扁平、高信息密度、优雅的深浅色质感）。
- **底层技术与数据协议**：参考并对齐 **DeepSeek Harness（DSH 官方右侧面板体系）**，结合青梧作为桌面客户端的原生系统级能力（打开/定位文件）进行务实实现。

---

## 1. 现状痛点与重构定位

### 1.1 现状痛点
1. **信息单一**：原面板仅罗列会话内发生的 `fileChanges`，且只能看 `edit` 的代码片段 diff，一旦遇到 `write`（新建或全量写入文件）就显示“写入操作，无 diff”，无法预览内容。
2. **缺乏交付物与文件感知**：办公场景下，Agent 频繁生成 Word、Excel、PPT 或 Markdown，用户找不到生成的交付文件在哪，缺乏一键打开与在资源管理器定位的入口。
3. **未能复用 DSH 原生能力**：DSH 官方引擎本身已内置了成熟的 `deliverables/presented`、`workspace/changes`（差异摘要与比对 API）、`workspaceFiles`（工作区文件只读分页服务），青梧此前未对接这些现有能力，导致重复造轮子且体验受限。

### 1.2 重构定位
将右侧面板定位为 **「文件与变更审查面板（Files & Changes Panel）」**：
- **UI 视觉**：彻底对齐 Codex 的精致紧凑布局（紧凑 Header、胶囊 Tab、紧凑行距、等宽 Diff 对比）。
- **功能分层**：
  - **Tab 1: 变更审查（Changes Review）**：对齐 DSH `changes-review` 语义与 Codex 变更列表，审查会话内所有修改/新建文件，支持完整 Diff 查看与 `write` 内容预览。
  - **Tab 2: 交付物与文件（Deliverables & Files）**：对齐 DSH `deliverables/presented` 语义，直观展示 Agent 交付/生成的文件，提供桌面级系统操作（默认程序打开、在资源管理器高亮定位、复制路径）。

---

## 2. 界面与交互设计（Codex 桌面质感）

整体遵循 Codex 风格的平铺紧凑排版，去除多余厚重边框与臃肿间距：

```
+-------------------------------------------------------------+
| [Changes (3)]   [Deliverables (2)]          [📁] [💻] [◫]   | <- 紧凑 Header (36px)
+-------------------------------------------------------------+
|                                                             |
| [视图 A: Changes 变更审查 (默认)]                           |
| ----------------------------------------------------------- |
| v docs/TODO.md                                   +3 -1     |
|   +-------------------------------------------------------+ |
|   | 16  ## Bug 修复                                       | |
|   | 17 + - [ ] 偶发黑屏排查                                | |
|   +-------------------------------------------------------+ |
| > src/main/terminal.ts                           +12 -0    |
| > reports/summary.txt (新建文件)                  写入 45 行 |
|                                                             |
| ----------------------------------------------------------- |
| [视图 B: Deliverables 成果交付]                             |
| ----------------------------------------------------------- |
| [DOCX] 2026年度激励方案.docx            [打开] [定位] [···] |
|        docs\2026年度激励方案.docx · 刚刚                   |
| [XLSX] 薪酬包测算底稿.xlsx              [打开] [定位] [···] |
|        calc\薪酬包测算底稿.xlsx · 5分钟前                  |
+-------------------------------------------------------------+
```

### 2.1 顶栏（Header，对齐 Codex）
- **高度**：收紧至 `36px`，与标题栏及整体界面呼吸感一致。
- **左侧**：紧凑胶囊 Tab 切换（`Changes 变更`、`Deliverables 交付物`），附带数量 Badge。
- **右侧快捷操作**：
  - `📁`：在 Windows 资源管理器打开当前工作区根目录。
  - `💻`：在外部终端中打开当前工作区。
  - `◫`：收起面板。

### 2.2 紧凑排版与字号规范（Codex 风格）
- **列表单项**：高度压缩为 `28px ~ 32px`，内边距 `3px 8px`，去除厚重圆角背景，采用淡雅悬停底色。
- **Diff 差异视图**：字体 `12px` 等宽（`--native-mono`），行高 `18px`，去卡片外边框，紧凑左右贴边。
- **暗色自适应**：遵循现有变量 `--native-surface`, `--native-hover`, `--native-border`。

---

## 3. 技术实现与底层协议（对齐 DSH Harness）

青梧作为 DSH 的 Electron 桌面壳，底层数据流与接口设计完全遵循 DSH 规范：

### 3.1 数据来源与事件折算

| 功能模块 | DSH 底层事件 / API 来源 | 青梧处理与消费方式 |
| :--- | :--- | :--- |
| **显式交付产物** | `deliverables/presented` 增量事件，数据形如 `{ files: [{ path, description? }] }` | 折算入会话 `deliverables` 清单，标记为首要交付项 |
| **第一方写入工具** | 工具调用 `write`（成功执行） | 若该文件此前不存在，自动并入交付物清单；若存在则记录为全量变更 |
| **文件变更与统计** | 工具调用 `edit`、`write`（以及 DSH 的 `workspace/changes` 宣告） | 统计 `edits`、`writes`，提取最近一次修改片段或写入正文 |
| **文件预览/读取** | DSH RPC `workspaceFiles.read`（按需分页读取 UTF-8 文本） | 供以后扩展完整文件大图/文本查看，本次先用工具调用入参作为轻量预览 |

### 3.2 桌面原生增强接口（IPC 契约）

利用 Electron 优势，为主进程和 Preload 补充原生文件操作：

1. **`workspace:showItemInFolder(filePath: string)`** *(新增)*：
   - 映射到 Electron `shell.showItemInFolder(resolvedPath)`。
   - 效果：直接拉起 Windows 资源管理器并高亮选中该文件，免去用户逐层翻找目录。
2. **`workspace:openPath(targetPath: string)`** *(已有)*：
   - 映射到 Electron `shell.openPath(resolvedPath)`。
   - 效果：使用 Windows 默认程序（WPS / Word / Excel / VS Code 等）打开该文件或目录。

---

## 4. 实施阶段分解

遵循“不留技术债、按需轻量演进”的原则，分步推进：

- **第一阶段（基础增强与 IPC）**：
  1. 在主进程 `terminal.ts` 与 `preload` 中增加 `showItemInFolder` 接口；
  2. 在 `panel-data.ts` 中增强对 `deliverables/presented` 事件与 `write` 内容的折算提取。
- **第二阶段（UI 重构与 Codex 紧凑质感）**：
  1. 重构 `RightPanel.tsx`，加入 Codex 风格的胶囊 Tab（`Changes` / `Deliverables`）；
  2. 落地 `Deliverables` 交付物列表与系统操作微按钮（打开、定位、复制）；
  3. 完善 `Changes` 视图中的 `write` 内容预览，去除“写入操作，无 diff”冷提示；
  4. 在 `native.css` 中重写面板相关样式，落实紧凑行距与排版。
- **第三阶段（门禁与验证）**：
  1. 补充纯逻辑单元测试（`panel-data.test.ts`）；
  2. 运行 `npm run check` 确保构建、类型与单测通过。
