import fs from "node:fs";
import path from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "./dsh-paths";

const EXA_KEY_NAME = "EXA_API_KEY";

/**
 * 把 Exa 搜索密钥写入 dsh 用户环境层（$DSH_HOME/.env）。
 *
 * Exa 插件不接入引擎凭据体系，只从启动环境读取 EXA_API_KEY（引擎在构造插件时
 * 快照该值）；用户环境层属于引擎启动环境的组成层，凭据状态查询的回退链同样
 * 覆盖此文件。因此 Exa 密钥走该文件而不是凭据库，明文不进入引擎凭据存储与
 * 插件配置。文件由引擎与用户共享，只改动 EXA_API_KEY 一行，保留其余内容。
 */
export async function setExaSearchKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Exa 密钥不能为空");
  if (/[\r\n]/.test(trimmed)) throw new Error("Exa 密钥包含换行，拒绝写入");
  const envPath = path.join(resolveDshHome(), ".env");
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  await withFileLock(envPath, async () => {
    const lines = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, "utf-8").split(/\r?\n/)
      : [];
    const kept = lines.filter((line) => !line.startsWith(`${EXA_KEY_NAME}=`));
    while (kept.length && kept[kept.length - 1] === "") kept.pop();
    kept.push(`${EXA_KEY_NAME}=${trimmed}`);
    await writeFileAtomic(envPath, `${kept.join("\n")}\n`, { mode: 0o600 });
  });
}
