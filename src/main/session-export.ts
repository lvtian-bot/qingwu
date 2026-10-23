import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';
import { zipSync } from 'fflate';

const zstdDecompressAsync = promisify(zstdDecompress);

/** 导出结果：成功带回落地路径与统计，失败带回可直接展示的原因。 */
export type SessionExportResult =
  | { ok: true; filePath: string; sessionCount: number; mediaCount: number }
  | { ok: false; message: string };

/** 会话日志文件名（引擎当前代次为 session.jsonl.zstd，旧代次带 vN 后缀）。 */
const LOG_FILE_PATTERN = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;

interface FoundSession {
  sessionId: string;
  logPath: string;
  /** 压缩过的日志需要先解压再打包，让导出的 ZIP 在任何工具里都是纯文本 JSONL。 */
  compressed: boolean;
}

/**
 * 在数据根里定位一个会话的日志文件。
 *
 * 引擎的落盘布局是 <root>/<workspace>/<sessionId>/session.jsonl.zstd，
 * 工作区目录名来自会话 cwd 的转义，调用方给不出，所以按会话 id 目录名扫描。
 * 同一会话可能出现代次变体（session.v3.jsonl 等），取代次最高的一份。
 */
function findSessionLogs(sessionsRoot: string, sessionId: string): FoundSession[] {
  const found: FoundSession[] = [];
  if (!fs.existsSync(sessionsRoot)) return found;

  for (const workspaceDir of fs.readdirSync(sessionsRoot)) {
    const candidate = path.join(sessionsRoot, workspaceDir, sessionId);
    if (!fs.existsSync(candidate)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(candidate);
    } catch {
      continue;
    }
    const logs = entries
      .filter((name) => LOG_FILE_PATTERN.test(name))
      .sort()
      .reverse();
    if (logs.length === 0) continue;
    found.push({
      sessionId,
      logPath: path.join(candidate, logs[0]),
      compressed: logs[0].endsWith('.zstd'),
    });
    break;
  }
  return found;
}

/** 读一条日志的正文；压缩日志先解压，解压失败按原字节保留，避免整个导出失败。 */
async function readLogBody(
  session: FoundSession,
): Promise<{ name: string; body: Uint8Array }> {
  const raw = await fs.promises.readFile(session.logPath);
  const base = path.basename(session.logPath).replace(/\.zstd$/, '');
  if (!session.compressed) {
    return { name: `sessions/${session.sessionId}/${base}`, body: raw };
  }
  try {
    const expanded = await zstdDecompressAsync(raw);
    return { name: `sessions/${session.sessionId}/${base}`, body: expanded };
  } catch {
    return {
      name: `sessions/${session.sessionId}/${base}.zstd`,
      body: raw,
    };
  }
}

/** 从会话日志的首行读出根会话与它的全部后代（引擎把父会话 id 写在元数据里）。 */
function collectDescendants(
  sessionsRoot: string,
  rootId: string,
): string[] {
  const ids = [rootId];
  const seen = new Set(ids);
  if (!fs.existsSync(sessionsRoot)) return ids;

  for (const workspaceDir of fs.readdirSync(sessionsRoot)) {
    const dir = path.join(sessionsRoot, workspaceDir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const logs = fs
        .readdirSync(path.join(dir, entry.name))
        .filter((name) => LOG_FILE_PATTERN.test(name));
      if (logs.length === 0) continue;
      // 只有根会话自己可能带后代：其他会话的父子关系在元数据里，成本高且非必需
      const owner = entry.name;
      try {
        const raw = fs.readFileSync(path.join(dir, entry.name, logs[0]));
        const text = raw.subarray(0, Math.min(raw.length, 65536)).toString('utf8');
        if (text.includes(`"${rootId}"`)) {
          ids.push(owner);
          seen.add(owner);
        }
      } catch {
        // 读不到就跳过，不阻断导出
      }
    }
  }
  return ids;
}

/**
 * 把一棵会话树导出为 ZIP。
 *
 * 对齐官方 `/export` 的产物：根会话与子会话各一份 session JSONL，按
 * sessions/<id>/ 归档。官方还会打包引用到的图片附件；青梧这一版先只导出
 * 日志文本，附件目录的归属需要引擎侧的映射，留到后续单独补。
 */
export async function exportSessionArchive(
  sessionsRoot: string,
  sessionId: string,
  downloadDir: string,
): Promise<SessionExportResult> {
  try {
    const ids = collectDescendants(sessionsRoot, sessionId);
    const files: Record<string, Uint8Array> = {};
    let sessionCount = 0;

    for (const id of ids) {
      for (const session of findSessionLogs(sessionsRoot, id)) {
        const { name, body } = await readLogBody(session);
        files[name] = body;
        sessionCount += 1;
      }
    }

    if (sessionCount === 0) {
      return {
        ok: false,
        message: '未找到当前会话的日志文件，可能尚未落盘',
      };
    }

    const archive = zipSync(files, { level: 6 });
    await fs.promises.mkdir(downloadDir, { recursive: true });
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
    const filePath = uniquePath(downloadDir, `dsh-session-${safeId}.zip`);
    await fs.promises.writeFile(filePath, archive);

    return { ok: true, filePath, sessionCount, mediaCount: 0 };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 目标文件已存在时追加 (n)，绝不静默覆盖用户已有的导出。 */
function uniquePath(dir: string, filename: string): string {
  const target = path.join(dir, filename);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return target;
}
