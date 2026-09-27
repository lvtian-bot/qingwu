import type { DshRpcResult } from "../../../shared/types";
import { fallbackTranslate } from "../i18n";
const qingwu = window.qingwu;

export async function rpc<T>(endpoint: string, payload: unknown): Promise<T> {
  const result = (await qingwu.dshCall(endpoint, payload)) as
    DshRpcResult<T> | undefined;
  if (!result || typeof result.ok !== "boolean") {
    // rpc 为非组件模块，按系统语言静态取词（跟随系统用户与应用语言一致）。
    throw new Error(fallbackTranslate("app.rpc.invalidResult", { endpoint }));
  }
  if (!result.ok) {
    throw new Error(
      fallbackTranslate("app.rpc.failed", {
        endpoint,
        detail: `${result.error?.code ?? "unknown"} ${result.error?.message ?? ""}`,
      }),
    );
  }
  return result.value;
}

/** 任意抛出值转用户可读文案（RPC 异常与其他错误兜底共用同一呈现）。 */
export function toErrMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
