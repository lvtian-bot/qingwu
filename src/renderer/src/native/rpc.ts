import type { DshRpcResult } from "../../../shared/types";
const qingwu = window.qingwu;

export async function rpc<T>(endpoint: string, payload: unknown): Promise<T> {
  const result = (await qingwu.dshCall(endpoint, payload)) as
    DshRpcResult<T> | undefined;
  if (!result || typeof result.ok !== "boolean") {
    throw new Error(`${endpoint} 返回非法结果`);
  }
  if (!result.ok) {
    throw new Error(
      `${endpoint} 失败: ${result.error?.code ?? "unknown"} ${result.error?.message ?? ""}`,
    );
  }
  return result.value;
}

/** 任意抛出值转用户可读文案（RPC 异常与其他错误兜底共用同一呈现）。 */
export function toErrMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
