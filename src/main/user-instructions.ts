import fs from "node:fs";
import path from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "./dsh-paths";
import type { UserInstructionsSnapshot } from "../shared/types";

/**
 * 设置页用户级指令文件（$DSH_HOME/AGENTS.md，默认 ~/.dsh/AGENTS.md）直读直写。
 *
 * 路径与引擎 dsh-agent-instructions 的用户全局层一致（DSH_HOME 下的 AGENTS.md，
 * 优先于 ~/.agents/AGENTS.md）；引擎在会话创建时读取该文件，保存后新会话生效。
 * 不依赖引擎进程：引擎离线时同样可读写。
 * 64KB 为引擎指令渲染预算；超限内容引擎侧会截断，界面在保存前拦截。
 */
export const USER_INSTRUCTIONS_MAX_BYTES = 64 * 1024;

function userInstructionsPath(): string {
  return path.join(resolveDshHome(), "AGENTS.md");
}

export function getUserInstructions(): UserInstructionsSnapshot {
  const filePath = userInstructionsPath();
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    maxBytes: USER_INSTRUCTIONS_MAX_BYTES,
  };
}

export async function saveUserInstructions(
  content: string,
): Promise<UserInstructionsSnapshot> {
  if (typeof content !== "string") throw new Error("指令内容必须为文本");
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > USER_INSTRUCTIONS_MAX_BYTES) {
    throw new Error("超出 64KB 上限");
  }
  const filePath = userInstructionsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await withFileLock(filePath, async () => {
    // 指令文件非敏感内容，按普通文档权限落盘（区别于凭据类文件的 0600）
    await writeFileAtomic(filePath, content, { mode: 0o644 });
  });
  return { content, sizeBytes, maxBytes: USER_INSTRUCTIONS_MAX_BYTES };
}
