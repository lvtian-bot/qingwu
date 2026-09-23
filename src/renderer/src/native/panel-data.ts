import { extractToolResult } from "./events";
import type {
  EditArgs,
  PresentArgs,
  SessionEvent,
  TodoWriteArgs,
  ToolCallEventData,
  ToolResultEventData,
  WriteArgs,
} from "./protocol";
import type { DeliverableItem, FileChangeEntry, TodoEntry } from "./RightPanel";

/** 从当前历史窗口聚合任务、文件修改与交付物；失败的工具调用不计入。 */
export function foldPanelData(events: SessionEvent[]) {
  const failedCalls = new Set<string>();
  const presentedEvents: { path: string; description?: string; time?: number }[] = [];

  for (const event of events) {
    if (event.type === "tool/result") {
      const data = event.data as ToolResultEventData | null;
      const { callId, isError } = extractToolResult(data);
      if (callId && isError) {
        failedCalls.add(callId);
      }
    } else if (event.type === "deliverables/presented") {
      // DSH 规范 deliverables/presented 事件
      const data = event.data as { files?: Array<{ path?: string; description?: string }> } | null;
      if (data && Array.isArray(data.files)) {
        for (const file of data.files) {
          if (typeof file?.path === "string" && file.path.trim()) {
            presentedEvents.push({
              path: file.path.trim(),
              description: typeof file.description === "string" ? file.description : undefined,
              time: event.time,
            });
          }
        }
      }
    }
  }

  let todos: TodoEntry[] | null = null;
  const files = new Map<string, FileChangeEntry>();
  const deliverablesMap = new Map<string, DeliverableItem>();

  for (const event of events) {
    if (event.type === "turn/start") {
      // 对齐 DSH 官方 todos 投影逻辑：新轮次开启时清空上一轮的待办列表
      todos = null;
      continue;
    }

    if (event.type === "todo/write") {
      // DSH 原生 todo/write 会话事件
      const data = event.data as { todos?: TodoEntry[] } | null;
      if (data && Array.isArray(data.todos)) {
        todos = data.todos;
      }
      continue;
    }

    if (event.type === "tool/call") {
      const data = event.data as ToolCallEventData | null;
      if (!data || typeof data.arguments !== "string" || failedCalls.has(data.callId)) {
        continue;
      }

      try {
        const args = JSON.parse(data.arguments) as EditArgs &
          WriteArgs &
          TodoWriteArgs &
          PresentArgs;

        if (data.name === "todo_write") {
          if (Array.isArray(args.todos)) todos = args.todos;
        } else if (data.name === "present") {
          if (Array.isArray(args.files)) {
            for (const item of args.files) {
              if (typeof item?.path === "string" && item.path.trim()) {
                const path = item.path.trim();
                deliverablesMap.set(path, {
                  path,
                  description: typeof item.description === "string" ? item.description : undefined,
                  source: "presented",
                });
              }
            }
          }
        } else if (data.name === "edit" || data.name === "write") {
          if (typeof args.file_path === "string" && args.file_path.trim()) {
            const filePath = args.file_path.trim();
            const existing = files.get(filePath);
            const entry: FileChangeEntry = existing ?? {
              path: filePath,
              edits: 0,
              writes: 0,
              addedLines: 0,
              removedLines: 0,
            };

            if (data.name === "edit") {
              entry.edits += 1;
              if (typeof args.old_string === "string") {
                entry.lastEdit = {
                  oldStr: args.old_string,
                  newStr: args.new_string ?? "",
                };
                const oldLines = args.old_string ? args.old_string.split("\n").length : 0;
                const newLines = args.new_string ? args.new_string.split("\n").length : 0;
                entry.addedLines = (entry.addedLines ?? 0) + newLines;
                entry.removedLines = (entry.removedLines ?? 0) + oldLines;
              }
            } else {
              // write 操作
              // 若此前未在会话中作为既有文件进行过 edit，且未声明过，则视为本次会话生成/写入的交付物
              const isNewInSession = !existing || existing.edits === 0;
              if (isNewInSession && !deliverablesMap.has(filePath)) {
                deliverablesMap.set(filePath, {
                  path: filePath,
                  source: "write",
                });
              }

              entry.writes += 1;
              if (typeof args.content === "string") {
                entry.lastEdit = { oldStr: "", newStr: args.content };
                const lines = args.content.length > 0 ? args.content.split("\n").length : 0;
                entry.addedLines = (entry.addedLines ?? 0) + lines;
              }
            }
            files.set(filePath, entry);
          }
        }
      } catch {
        // 参数非合法 JSON 时跳过该条
      }
    }
  }

  // 融合显式 deliverables/presented 事件（优先覆盖）
  for (const item of presentedEvents) {
    deliverablesMap.set(item.path, {
      path: item.path,
      description: item.description,
      source: "presented",
      time: item.time,
    });
  }

  return {
    todos,
    fileChanges: Array.from(files.values()),
    deliverables: Array.from(deliverablesMap.values()),
  };
}
