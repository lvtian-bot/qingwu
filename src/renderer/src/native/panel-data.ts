import type {
  EditArgs,
  SessionEvent,
  TodoWriteArgs,
  ToolCallEventData,
  ToolResultEventData,
  WriteArgs,
} from "./protocol";
import type { FileChangeEntry, TodoEntry } from "./RightPanel";

/** 从当前历史窗口聚合任务和文件修改；失败的工具调用不计入。 */
export function foldPanelData(events: SessionEvent[]) {
  const failedCalls = new Set<string>();
  const toolCalls: ToolCallEventData[] = [];
  for (const event of events) {
    if (event.type === "tool/call") {
      const data = event.data as ToolCallEventData | null;
      if (data && typeof data.arguments === "string") toolCalls.push(data);
    } else if (event.type === "tool/result") {
      const data = event.data as ToolResultEventData | null;
      const block = data?.message?.content?.[0];
      if (
        data &&
        block &&
        block.type === "tool-result" &&
        (data.error || block.isError)
      ) {
        failedCalls.add(block.toolCallId);
      }
    }
  }
  let todos: TodoEntry[] | null = null;
  const files = new Map<string, FileChangeEntry>();
  for (const data of toolCalls) {
    if (failedCalls.has(data.callId)) continue;
    try {
      const args = JSON.parse(data.arguments) as EditArgs &
        WriteArgs &
        TodoWriteArgs;
      if (data.name === "todo_write") {
        if (Array.isArray(args.todos)) todos = args.todos;
      } else if (data.name === "edit" || data.name === "write") {
        if (typeof args.file_path === "string" && args.file_path) {
          const entry: FileChangeEntry = files.get(args.file_path) ?? {
            path: args.file_path,
            edits: 0,
            writes: 0,
          };
          if (data.name === "edit") {
            entry.edits += 1;
            if (typeof args.old_string === "string") {
              entry.lastEdit = {
                oldStr: args.old_string,
                newStr: args.new_string ?? "",
              };
            }
          } else {
            entry.writes += 1;
            if (typeof args.content === "string") {
              entry.lastEdit = { oldStr: "", newStr: args.content };
            }
          }
          files.set(args.file_path, entry);
        }
      }
    } catch {
      // 参数非合法 JSON 时跳过该条
    }
  }
  return { todos, fileChanges: Array.from(files.values()) };
}
