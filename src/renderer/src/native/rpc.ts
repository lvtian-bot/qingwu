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
