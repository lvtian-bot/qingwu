# 工作区文件与交付

## 职责

- 青梧从当前会话事件窗口折算文件变更、交付物及会话内任务列表，并在右侧面板展示。面板是本模块的界面，不是单独的项目模块；它不写文件，也不维护一套独立的工作区文件数据库。
- 用户可从面板用系统默认程序打开文件、在资源管理器定位文件，或打开当前工作区目录和终端；主进程执行这些桌面操作，渲染层经 preload 暴露的 IPC 调用。

## 主要代码入口

- 投影与界面：`src/renderer/src/native/panel-data.ts`、`RightPanel.tsx`、`TodoPanel.tsx`、`NativeApp.tsx`、`usePanelWidth.ts`。
- 数据契约：`src/renderer/src/native/protocol.ts`、`events.ts`；桌面操作：`src/main/terminal.ts`、`index.ts`、`src/preload/index.ts`、`src/shared/types.ts`。

## 技术约束

- `panel-data.ts` 读取 `deliverables/presented` 事件，并折算成功的 `edit`、`write`、`present` 工具调用；明确呈现的交付物优先于同路径的推断条目。失败工具调用不得计入变更。右侧面板的变更和交付清单受当前会话已加载事件窗口限制，不能宣称已枚举工作区全部文件。
- 当前 `write` 预览使用工具调用中的正文，`edit` 展示最近片段；这不是实时文件读取或完整的工作区 diff。旧设计方案提到的 `workspaceFiles.read`、`workspace/changes` 不是当前面板的数据来源，增加此类能力前须重新核对 dsh 当前 API。
- 原生文件操作解析相对路径时以活跃工作区为基准；没有工作区时以用户主目录兜底。路径解析与是否存在由主进程负责，界面不能把相对路径直接交给浏览器或假定文件仍存在。
