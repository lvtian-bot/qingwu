import type { DshRpcError, DshRpcResult } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isError(value: unknown): value is DshRpcError {
  return (
    isObject(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

/** 只检查传输信封，业务 value 保持 unknown，由对应界面负责解释。错误不得包含原始载荷。 */
export function parseDshResponse(
  value: unknown,
  rpcId: string,
): DshRpcResult<unknown> {
  if (
    !isObject(value) ||
    value.type !== "server-response" ||
    value.rpcId !== rpcId
  ) {
    throw new Error("引擎响应信封不合法");
  }
  const result = value.result;
  if (!isObject(result)) throw new Error("引擎响应结果不合法");
  // void 方法序列化为 JSON 时可以省略 value。
  if (result.ok === true) return { ok: true, value: result.value };
  if (result.ok === false && isError(result.error))
    return { ok: false, error: result.error };
  throw new Error("引擎响应结果不合法");
}

export type DshStreamMessage =
  | { type: "item"; streamId: string; value?: unknown }
  | { type: "error"; streamId: string; error: DshRpcError }
  | { type: "end"; streamId: string };

/** 拒绝未知帧种类和缺失的错误字段，避免把畸形控制帧当业务 item 转发。 */
export function parseDshStreamMessage(value: unknown): DshStreamMessage {
  if (
    !isObject(value) ||
    typeof value.streamId !== "string" ||
    !value.streamId.trim()
  ) {
    throw new Error("引擎流信封不合法");
  }
  if (value.type === "item")
    return { type: "item", streamId: value.streamId, value: value.value };
  if (value.type === "end") return { type: "end", streamId: value.streamId };
  if (value.type === "error" && isError(value.error)) {
    return { type: "error", streamId: value.streamId, error: value.error };
  }
  throw new Error("引擎流信封不合法");
}
