import { spawn, exec } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { CONFIG } from './config';

interface HarnessManagerOptions {
  host?: string;
  port?: number;
  /** 主进程此刻是否已有控制台（含从终端继承的）；见 console.ts。 */
  hasConsole?: boolean;
}

/** 引擎运行时解析结果。 */
interface EngineRuntime {
  command: string;
  env: NodeJS.ProcessEnv;
  /** true = 控制台子系统程序（node.exe），可继承主进程隐藏控制台；false = 退回 electron.exe。 */
  consoleSubsystem: boolean;
  /** 日志展示用的来源说明。 */
  source: string;
}

type ExitCallback = (code: number | null, signal: NodeJS.Signals | null) => void;

/** 在 PATH 中按序查找可执行文件（不派生子进程，避免自身弹窗）。 */
function findExecutablesOnPath(name: string): string[] {
  const separator = process.platform === 'win32' ? ';' : ':';
  return (process.env.PATH ?? '')
    .split(separator)
    .filter((dir) => dir.length > 0)
    .map((dir) => path.join(dir, name));
}

export class HarnessManager {
  private readonly host: string;
  private readonly port: number;
  private readonly hasConsole: boolean;
  private process: ChildProcess | null = null;
  private isStopping = false;
  private onExitCallback: ExitCallback | null = null;
  /** 引擎启动日志打印的带 token Web 地址（0.1.2 起 Web 面强制 token 鉴权）；未解析到时退回裸地址。 */
  private webUrl: string | null = null;

  constructor(options: HarnessManagerOptions = {}) {
    this.host = options.host || CONFIG.defaultHost;
    this.port = options.port || CONFIG.defaultPort;
    this.hasConsole = options.hasConsole ?? false;
  }

  getServiceUrl(): string {
    return this.webUrl ?? `http://${this.host}:${this.port}`;
  }

  resolveBinPath(): string {
    const relativePath = path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');

    if (app.isPackaged) {
      const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
      if (fs.existsSync(unpackedPath)) {
        return unpackedPath;
      }
      const asarPath = path.join(app.getAppPath(), relativePath);
      if (fs.existsSync(asarPath)) {
        return asarPath;
      }
    }

    return path.join(app.getAppPath(), relativePath);
  }

  /**
   * 解析引擎运行时：优先使用控制台子系统（console subsystem）的 Node。
   *
   * 为什么不能直接用 electron.exe：它是 GUI 子系统程序，而 **GUI 进程不继承
   * 父进程的控制台**。dsh 用 process.execPath 逐层派生 Windows Job runner 与
   * windows-acl runner，整条链因此都没有控制台，最后那条 pwsh 只能自己新建
   * 一个可见控制台窗口——表现为 Agent 每执行一条命令就闪一个黑窗。
   * 换成控制台子系统的 node.exe 后，引擎、runner 与 pwsh 全部继承主进程
   * acquireHiddenConsole() 申请并隐藏的那个控制台，窗口不再出现。
   *
   * 找不到 Node 运行时（例如未执行 npm run runtime:node 的开发机）时退回原有
   * electron.exe + ELECTRON_RUN_AS_NODE 方式，行为与修复前一致。
   */
  private resolveRuntime(): EngineRuntime {
    const nativeEnv = { ...process.env };
    delete nativeEnv.ELECTRON_RUN_AS_NODE;

    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath ?? '', 'node', 'node.exe')]
      : [
          path.join(app.getAppPath(), 'build', 'node-runtime', 'node.exe'),
          process.env.npm_node_execpath ?? '',
          ...findExecutablesOnPath('node.exe'),
        ];

    for (const candidate of candidates) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      return {
        command: candidate,
        env: nativeEnv,
        consoleSubsystem: true,
        source: candidate,
      };
    }

    console.warn(
      '[Harness] 未找到控制台子系统的 Node 运行时，退回 Electron 运行时：' +
        'Agent 执行命令时仍会新建可见控制台窗口（见 docs/tech-architecture.md）'
    );
    return {
      command: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      consoleSubsystem: false,
      source: `${process.execPath} (ELECTRON_RUN_AS_NODE)`,
    };
  }

  async start(): Promise<void> {
    const binPath = this.resolveBinPath();
    if (!fs.existsSync(binPath)) {
      throw new Error(`未找到 DeepSeek Harness 引擎入口文件: ${binPath}`);
    }

    console.log(`[Harness] 启动引擎: ${binPath} (Host: ${this.host}, Port: ${this.port})`);
    const runtime = this.resolveRuntime();
    console.log(`[Harness] 引擎运行时: ${runtime.source}`);

    const args = [
      '--expose-internals',
      binPath,
      'web',
      '--host', this.host,
      '--port', String(this.port),
      '--no-open'
    ];

    // windowsHide 会剥掉子进程的控制台（CREATE_NO_WINDOW）：控制台子系统运行时
    // 必须保留继承，否则 dsh 派生出的 pwsh 仍会各自新建可见控制台窗口。
    // 只有主进程确实没有控制台时，才用它兜住「引擎自己新建一个可见控制台窗口」。
    const windowsHide = runtime.consoleSubsystem ? !this.hasConsole : true;
    if (runtime.consoleSubsystem && !this.hasConsole) {
      console.warn(
        '[Harness] 主进程没有控制台，引擎将不继承隐藏控制台：Agent 执行命令仍会闪窗'
      );
    }

    const child = spawn(runtime.command, args, {
      env: runtime.env,
      // 引擎工作目录：无项目会话的 cwd 落点。用程序目录会把 AI 的文件
      // 读写引进安装目录，故取用户主目录（官方 web 无此问题：开发者
      // 总是从项目目录启动，cwd 天然正确；桌面应用必须显式指定）。
      cwd: app.getPath('home'),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide
    });
    this.process = child;

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      // 引擎以整行打印启动信息，按行分派避免 chunk 边界截断 token 地址。
      const lines = text.split(/\r?\n/);
      const pending = lines.pop() ?? '';
      for (const line of lines) {
        console.log(`[Harness stdout] ${line.trim()}`);
        const match = line.match(/dsh web: (http:\/\/\S+token=\S+)/);
        if (match) this.webUrl = match[1];
      }
      if (pending) {
        console.log(`[Harness stdout] ${pending.trim()}`);
      }
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      console.error(`[Harness stderr] ${text.trim()}`);
    });

    child.on('exit', (code, signal) => {
      console.log(`[Harness] 子进程退出，退出码: ${code}，信号: ${signal}`);
      const wasRunning = !this.isStopping;
      this.process = null;
      if (wasRunning && this.onExitCallback) {
        this.onExitCallback(code, signal);
      }
    });

    child.on('error', (err) => {
      console.error('[Harness] 子进程启动或运行异常:', err);
    });

    await this.waitForReady(CONFIG.readinessTimeoutMs, CONFIG.readinessPollIntervalMs);
    console.log(`[Harness] 服务已就绪: ${this.getServiceUrl()}`);
  }

  async waitForReady(timeoutMs = 25000, intervalMs = 300): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (!this.process) {
        throw new Error('Harness 引擎在就绪前已意外退出');
      }

      const isReady = await new Promise<boolean>((resolve) => {
        // 就绪探测：解析到带 token 的地址后用它（0.1.2 以 303 跳转应答，<400 即就绪）；
        // 未解析到时探测裸地址（0.1.1 直接 200）。
        const req = http.get(this.getServiceUrl(), (res) => {
          if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400) {
            resolve(true);
          } else {
            resolve(false);
          }
          res.resume();
        });

        req.on('error', () => {
          resolve(false);
        });

        req.setTimeout(intervalMs, () => {
          req.destroy();
          resolve(false);
        });
      });

      if (isReady) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`等待 Harness 服务就绪超时 (${timeoutMs}ms): ${this.getServiceUrl()}`);
  }

  onUnexpectedExit(callback: ExitCallback): void {
    this.onExitCallback = callback;
  }

  stop(): Promise<void> {
    if (!this.process || this.isStopping) {
      return Promise.resolve();
    }

    this.isStopping = true;
    const child = this.process;
    const pid = child.pid;
    console.log(`[Harness] 正在停止引擎进程 (PID: ${pid})...`);

    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          this.process = null;
          this.isStopping = false;
          resolve();
        }
      };

      if (process.platform === 'win32' && pid) {
        exec(`taskkill /pid ${pid} /T /F`, () => {
          done();
        });
      } else {
        child.kill('SIGTERM');
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          done();
        }, 2000);
        child.once('exit', () => {
          clearTimeout(timer);
          done();
        });
      }
    });
  }
}
