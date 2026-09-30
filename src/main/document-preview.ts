import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { resolveFileOrDirectory } from './terminal';

export interface RenderDocumentResult {
  success: boolean;
  error?: string;
  pageCount?: number;
  pages?: string[]; // data URLs
}

/** 仅允许在面板内转码预览的文档后缀。 */
const SUPPORTED_DOC_EXTS = new Set([
  'doc',
  'docx',
  'odt',
  'xls',
  'xlsx',
  'ods',
  'ppt',
  'pptx',
  'odp',
  'pdf',
]);

/** 内存与磁盘缓存，key: absolutePath + mtime + size */
interface CacheEntry {
  cacheKey: string;
  pageCount: number;
  pages: string[];
}

const previewCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 20;

/** 最大预览页数，防止极大文档导致转码过慢或内存撑爆 */
const MAX_PREVIEW_PAGES = 30;

function resolveCliPath(): string | null {
  const relativePath = path.join(
    'node_modules',
    '@deepseek-ai',
    'libreoffice-kit',
    'lib',
    'cli.js'
  );

  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
    if (fs.existsSync(unpacked)) return unpacked;
  }
  const local = path.join(app.getAppPath(), relativePath);
  if (fs.existsSync(local)) return local;
  return null;
}

function resolveNodePath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath ?? '', 'node', 'node.exe')]
    : [
        path.join(app.getAppPath(), 'build', 'node-runtime', 'node.exe'),
        process.env.npm_node_execpath ?? '',
      ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

/**
 * 将 Office/PDF 渲染为预览图片数据流（PNG Data URLs）。
 */
export async function renderDocumentPreview(
  inputPath: string
): Promise<RenderDocumentResult> {
  if (!inputPath || typeof inputPath !== 'string') {
    return { success: false, error: 'invalid-path' };
  }

  const targetPath = resolveFileOrDirectory(inputPath);
  if (!fs.existsSync(targetPath)) {
    return { success: false, error: 'not-found' };
  }

  let fileStat: fs.Stats;
  try {
    fileStat = await fs.promises.stat(targetPath);
  } catch {
    return { success: false, error: 'stat-failed' };
  }

  if (!fileStat.isFile()) {
    return { success: false, error: 'not-a-file' };
  }

  const ext = path.extname(targetPath).slice(1).toLowerCase();
  if (!SUPPORTED_DOC_EXTS.has(ext)) {
    return { success: false, error: 'unsupported-format' };
  }

  const cacheKey = `${targetPath}:${fileStat.mtimeMs}:${fileStat.size}`;
  const cached = previewCache.get(targetPath);
  if (cached && cached.cacheKey === cacheKey) {
    return {
      success: true,
      pageCount: cached.pageCount,
      pages: cached.pages,
    };
  }

  const cliPath = resolveCliPath();
  if (!cliPath) {
    return { success: false, error: 'libreoffice-kit-not-found' };
  }

  const nodePath = resolveNodePath();
  const runEnv = { ...process.env };
  if (nodePath === process.execPath) {
    runEnv.ELECTRON_RUN_AS_NODE = '1';
  } else {
    delete runEnv.ELECTRON_RUN_AS_NODE;
  }

  const tempOutputDir = path.join(
    app.getPath('temp'),
    `qingwu-preview-${crypto.randomBytes(8).toString('hex')}`
  );
  let tempPdfPath: string | null = null;

  try {
    const runCli = (cliArgs: string[]) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(nodePath, cliArgs, {
          env: runEnv,
          windowsHide: true,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(
              new Error(
                `Process exited with code ${code}: ${stderr || stdout}`
              )
            );
          }
        });
      });

    let renderInputPath = targetPath;

    // 对 Office 非 PDF 文档（PPT/Word/Excel 等），直接走 native paintTile 在 Windows 高分屏缩放下
    // 会受系统 DPI 比例干扰产生裁剪放大（表现为仅显示 PPT 或 Word 的左上角）。
    // 先经 LibreOfficeKit 导出为保真矢量 PDF，再交由 PDFium 渲染为像素 PNG，能够确保 100% 完整展现页面内容。
    if (ext !== 'pdf') {
      tempPdfPath = path.join(
        app.getPath('temp'),
        `qingwu-conv-${crypto.randomBytes(8).toString('hex')}.pdf`
      );
      await runCli([
        cliPath,
        'convert',
        '--input',
        targetPath,
        '--output',
        tempPdfPath,
      ]);
      renderInputPath = tempPdfPath;
    }

    const renderArgs = [
      cliPath,
      'render',
      '--input',
      renderInputPath,
      '--output-dir',
      tempOutputDir,
      '--max-pages',
      '1000',
      '--dpi',
      '144',
    ];

    const procOutput = await runCli(renderArgs);

    let manifest: {
      pageCount: number;
      images: Array<{ path: string; index: number }>;
    };
    try {
      manifest = JSON.parse(procOutput.stdout.trim());
    } catch {
      // 尝试从 manifest.json 读取
      const manifestFile = path.join(tempOutputDir, 'manifest.json');
      if (fs.existsSync(manifestFile)) {
        manifest = JSON.parse(
          await fs.promises.readFile(manifestFile, 'utf8')
        );
      } else {
        throw new Error('Missing render manifest output');
      }
    }

    const previewImages = (manifest.images || []).slice(0, MAX_PREVIEW_PAGES);
    const pages: string[] = [];
    for (const img of previewImages) {
      const imgPath = path.isAbsolute(img.path)
        ? img.path
        : path.join(tempOutputDir, img.path);
      if (fs.existsSync(imgPath)) {
        const buf = await fs.promises.readFile(imgPath);
        pages.push(`data:image/png;base64,${buf.toString('base64')}`);
      }
    }

    const resultEntry: CacheEntry = {
      cacheKey,
      pageCount: manifest.pageCount || pages.length,
      pages,
    };

    if (previewCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = previewCache.keys().next().value;
      if (oldest) previewCache.delete(oldest);
    }
    previewCache.set(targetPath, resultEntry);

    return {
      success: true,
      pageCount: resultEntry.pageCount,
      pages,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[DocumentPreview] Render failed:', errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  } finally {
    // 异步清理临时生成目录与转换文件
    if (tempPdfPath) {
      fs.promises.unlink(tempPdfPath).catch(() => {});
    }
    fs.promises.rm(tempOutputDir, { recursive: true, force: true }).catch(() => {});
  }
}
