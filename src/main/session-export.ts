import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';
import { zip } from 'fflate';

const zstdDecompressAsync = promisify(zstdDecompress);

/** 导出结果：成功带回落地路径与统计，失败带回可直接展示的原因。 */
export type SessionExportResult =
  | {
      ok: true;
      filePath: string;
      sessionCount: number;
      mediaCount: number;
      /**
       * 有日志超过解压上限，按原始压缩格式原样打包。
       * 打包本身成功，但内容不是纯文本 JSONL，界面要如实说明。
       */
      oversized?: true;
    }
  | { ok: false; message: string };

/**
 * 会话日志文件名：当前代次是 `session.jsonl.zstd`，历史代次带 `.vN` 后缀。
 * 捕获组一是版本号（当前代次为 0）。
 */
const LOG_FILE_PATTERN = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/;

/** Zstandard 帧的起始魔数（小端 0xFD2FB528）。 */
const ZSTD_MAGIC = 0xfd2fb528;

/** 解压后的日志上限，防止异常文件把进程内存撑爆。 */
const MAX_LOG_BYTES = 256 * 1024 * 1024;

interface FoundLog {
  sessionId: string;
  logPath: string;
  compressed: boolean;
}

/** 一个会话的元数据：父子关系取自日志头部的第一条记录。 */
interface SessionMeta {
  sessionId: string;
  parentSessionId: string | null;
}

interface LogFile {
  /** 版本代次：`session.jsonl` 这类当前代次为 0。 */
  version: number;
  /** 同代次下压缩编码优先（与引擎当前的默认一致）。 */
  compressed: boolean;
  name: string;
}

/**
 * 按数值挑选最新代次的日志。
 *
 * 文件名不能按字符串排序：`session.v3` 会排在 `session.jsonl.zstd` 前面，
 * `v9` 也会排在 `v10` 前面，结果可能把过期历史当成当前日志导出。
 *
 * 代次的真实语义是「有没有后缀」：引擎当前写的是无后缀的 `session.jsonl`，
 * 带 `.vN` 的全部是历史迁移留下的旧格式。所以先比「是否当前代次」，
 * 再看版本号数值，同版本压缩编码优先。
 */
function pickLatestLog(names: string[]): LogFile | null {
  let best: LogFile | null = null;
  for (const name of names) {
    const match = LOG_FILE_PATTERN.exec(name);
    if (!match) continue;
    const candidate: LogFile = {
      version: match[1] === undefined ? 0 : Number(match[1]),
      compressed: name.endsWith('.zstd'),
      name,
    };
    if (best === null) {
      best = candidate;
      continue;
    }
    // 当前代次（无后缀）永远压过任何带后缀的旧代次
    const candidateCurrent = !name.includes('.v');
    const bestCurrent = !best.name.includes('.v');
    if (candidateCurrent !== bestCurrent) {
      if (candidateCurrent) best = candidate;
      continue;
    }
    if (candidate.version > best.version) {
      best = candidate;
    } else if (
      candidate.version === best.version &&
      candidate.compressed &&
      !best.compressed
    ) {
      best = candidate;
    }
  }
  return best;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * 遍历 `~/.dsh/sessions/<workspace>/<sessionId>/` 下的全部会话目录。
 *
 * 工作区目录名是会话 cwd 的转义结果，调用方给不出，只能整棵扫描。
 */
function listSessionDirs(sessionsRoot: string): Map<string, string> {
  const dirs = new Map<string, string>();
  let workspaces: string[];
  try {
    workspaces = fs.readdirSync(sessionsRoot);
  } catch {
    return dirs;
  }
  for (const workspace of workspaces) {
    const workspaceDir = path.join(sessionsRoot, workspace);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.set(entry.name, path.join(workspaceDir, entry.name));
      }
    }
  }
  return dirs;
}

/** 在缓冲区里向后找下一个 Zstandard 魔数；找不到返回 -1。 */
function findMagic(raw: Buffer, from: number): number {
  for (let i = from; i + 4 <= raw.length; i += 1) {
    if (raw.readUInt32LE(i) === ZSTD_MAGIC) return i;
  }
  return -1;
}

/**
 * 从帧起点计算一帧的结束偏移（含可选的 4 字节校验和）。
 *
 * 帧头布局见 RFC 8878：魔数 4 字节 → 描述符 1 字节 → 可选窗口描述符 →
 * 可选字典 id → 帧内容尺寸 → 若干块。任一步越界或遇到保留位时返回 -1，
 * 由调用方按损坏处理。
 */
function frameEndOffset(raw: Buffer, start: number): number {
  let pos = start + 4;
  if (pos >= raw.length) return -1;
  const descriptor = raw[pos];
  pos += 1;

  const fcsFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const hasChecksum = (descriptor >> 2) & 1;
  const dictFlag = descriptor & 3;
  if ((descriptor & 0x08) !== 0) return -1; // 保留位必须为 0

  if (!singleSegment) pos += 1; // Window_Descriptor
  pos += dictFlag === 3 ? 4 : dictFlag;
  pos += [singleSegment ? 1 : 0, 2, 4, 8][fcsFlag];
  if (pos > raw.length) return -1;

  // 逐块跳过：块头 3 字节，末块标志在最低位
  for (;;) {
    if (pos + 3 > raw.length) return -1;
    const blockHeader = raw[pos] | (raw[pos + 1] << 8) | (raw[pos + 2] << 16);
    pos += 3;
    const lastBlock = blockHeader & 1;
    const blockType = (blockHeader >> 1) & 3;
    const blockSize = blockHeader >>> 3;
    if (blockType === 3) return -1; // 保留块类型
    pos += blockType === 1 ? 1 : blockSize; // RLE 块只占 1 字节
    if (pos > raw.length) return -1;
    if (lastBlock) break;
  }

  if (hasChecksum) pos += 4;
  return pos > raw.length ? -1 : pos;
}

/**
 * 把 Zstandard 多帧数据完整解压。
 *
 * 引擎按「头部一帧 + 每次追加一批一帧」写日志，一次性解压只还原第一帧
 * （实测 380KB 的会话只剩 255 字节的头部，对话全部丢失），因此必须逐帧
 * 推进：解出一帧后按帧结构算出结束位置，从那里继续下一帧。
 * 尾部被截断（写入中断）时保留已解出的部分，不让整份导出失败。
 */
async function decompressAllFrames(raw: Buffer): Promise<Buffer> {
  const parts: Buffer[] = [];
  let offset = 0;
  let produced = 0;

  while (offset + 4 <= raw.length) {
    if (raw.readUInt32LE(offset) !== ZSTD_MAGIC) {
      const next = findMagic(raw, offset + 1);
      if (next < 0) break;
      offset = next;
      continue;
    }
    const end = frameEndOffset(raw, offset);
    if (end < 0) break;
    let chunk: Buffer;
    try {
      chunk = await zstdDecompressAsync(raw.subarray(offset, end));
    } catch {
      break;
    }
    parts.push(chunk);
    produced += chunk.length;
    // 超限绝不能当作正常结束：调用方会把只解了一半的内容当成完整日志打包，
    // 用户拿到一份「导出成功」但对话残缺的压缩包。抛给上层按失败处理。
    if (produced > MAX_LOG_BYTES) {
      throw new Error('OVERSIZED_LOG');
    }
    offset = end;
  }

  return Buffer.concat(parts);
}

/** 读一份日志的正文；压缩日志逐帧解压，失败时退回原始字节，避免整个导出失败。 */
async function readLogBody(
  log: FoundLog,
): Promise<{ name: string; body: Uint8Array; oversized?: boolean }> {
  const raw = await fs.promises.readFile(log.logPath);
  const base = path.basename(log.logPath).replace(/\.zstd$/, '');
  const target = `sessions/${log.sessionId}/${base}`;
  if (!log.compressed) return { name: target, body: raw };
  try {
    return { name: target, body: await decompressAllFrames(raw) };
  } catch (err) {
    if (err instanceof Error && err.message === 'OVERSIZED_LOG') {
      // 解压后超过上限：保留原始压缩日志，导出照常完成但不谎报内容完整
      return { name: `${target}.zstd`, body: raw, oversized: true };
    }
    return { name: `${target}.zstd`, body: raw };
  }
}

/** 从解压后的日志读取会话元数据（首条记录的 id 与 parentSessionId）。 */
async function readSessionMeta(log: FoundLog): Promise<SessionMeta | null> {
  try {
    const raw = await fs.promises.readFile(log.logPath);
    // 头部单独一帧：解出第一帧就够读元数据，不必展开整份日志
    const head = log.compressed ? await zstdDecompressAsync(raw) : raw;
    const firstLine = head.toString('utf8').split('\n', 1)[0];
    const record = JSON.parse(firstLine) as {
      type?: string;
      id?: unknown;
      parentSessionId?: unknown;
    };
    if (record?.type !== 'session' || typeof record.id !== 'string') return null;
    return {
      sessionId: record.id,
      parentSessionId:
        typeof record.parentSessionId === 'string' && record.parentSessionId
          ? record.parentSessionId
          : null,
    };
  } catch {
    return null;
  }
}

/** 逐个会话读取元数据并建出父子索引（父 id → 子 id 列表）。 */
async function buildSessionTree(sessionsRoot: string): Promise<{
  logs: Map<string, FoundLog>;
  children: Map<string, string[]>;
}> {
  const logs = new Map<string, FoundLog>();
  const children = new Map<string, string[]>();

  for (const [sessionId, dir] of listSessionDirs(sessionsRoot)) {
    const picked = pickLatestLog(safeReaddir(dir));
    if (!picked) continue;
    const log: FoundLog = {
      sessionId,
      logPath: path.join(dir, picked.name),
      compressed: picked.compressed,
    };
    logs.set(sessionId, log);
    const meta = await readSessionMeta(log);
    if (meta?.parentSessionId) {
      const siblings = children.get(meta.parentSessionId) ?? [];
      siblings.push(sessionId);
      children.set(meta.parentSessionId, siblings);
    }
  }
  return { logs, children };
}

/**
 * 把一棵会话树导出为 ZIP。
 *
 * 对齐官方 `/export` 的产物：根会话与全部后代各一份 session JSONL，按
 * `sessions/<id>/` 归档。官方还会打包引用到的图片附件；青梧这一版只导出
 * 日志文本，附件与会话的映射归引擎侧管理，留待后续单独补。
 */
export async function exportSessionArchive(
  sessionsRoot: string,
  sessionId: string,
  downloadDir: string,
): Promise<SessionExportResult> {
  try {
    const { logs, children } = await buildSessionTree(sessionsRoot);
    if (!logs.has(sessionId)) {
      return { ok: false, message: '未找到当前会话的日志文件，可能尚未落盘' };
    }

    // 广度优先收集全部后代：按父 id 关系传递，多层子代理都不会漏
    const ordered: FoundLog[] = [];
    const seen = new Set<string>();
    const queue = [sessionId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const log = logs.get(id);
      if (log) ordered.push(log);
      for (const child of children.get(id) ?? []) queue.push(child);
    }

    const files: Record<string, Uint8Array> = {};
    let oversized = false;
    for (const log of ordered) {
      const body = await readLogBody(log);
      if (body.oversized) oversized = true;
      files[body.name] = body.body;
    }

    const archive = await compressAsync(files);
    await fs.promises.mkdir(downloadDir, { recursive: true });
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
    const filePath = uniquePath(downloadDir, `dsh-session-${safeId}.zip`);
    if (!filePath) {
      return {
        ok: false,
        message: '下载目录中同名文件过多，请先清理后再导出',
      };
    }
    await fs.promises.writeFile(filePath, archive);

    return {
      ok: true,
      filePath,
      sessionCount: ordered.length,
      mediaCount: 0,
      ...(oversized ? { oversized: true as const } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 异步压缩：`zipSync` 会在主线程一次性跑完整份压缩，长会话会把窗口卡住；
 * fflate 的异步版本把压缩交给它自己的 worker，界面保持响应。
 */
function compressAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * 目标文件已存在时追加 (n)，绝不静默覆盖用户已有的导出。
 * 候选名全部用尽时返回 null，由调用方报错——退回已存在的路径会把用户
 * 更早的导出覆盖掉，违背这个函数存在的意义。
 */
function uniquePath(dir: string, filename: string): string | null {
  const target = path.join(dir, filename);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return null;
}
