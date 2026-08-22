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
}

type ExitCallback = (code: number | null, signal: NodeJS.Signals | null) => void;

export class HarnessManager {
  private readonly host: string;
  private readonly port: number;
  private process: ChildProcess | null = null;
  private isStopping = false;
  private onExitCallback: ExitCallback | null = null;

  constructor(options: HarnessManagerOptions = {}) {
    this.host = options.host || CONFIG.defaultHost;
    this.port = options.port || CONFIG.defaultPort;
  }

  getServiceUrl(): string {
    return `http://${this.host}:${this.port}`;
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

  async start(): Promise<void> {
    const binPath = this.resolveBinPath();
    if (!fs.existsSync(binPath)) {
      throw new Error(`未找到 DeepSeek Harness 引擎入口文件: ${binPath}`);
    }

    console.log(`[Harness] 启动引擎: ${binPath} (Host: ${this.host}, Port: ${this.port})`);

    const args = [
      '--expose-internals',
      binPath,
      'web',
      '--host', this.host,
      '--port', String(this.port),
      '--no-open'
    ];

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    };

    const child = spawn(process.execPath, args, {
      env,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.process = child;

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      console.log(`[Harness stdout] ${text.trim()}`);
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
    const url = this.getServiceUrl();

    while (Date.now() - startTime < timeoutMs) {
      if (!this.process) {
        throw new Error('Harness 引擎在就绪前已意外退出');
      }

      const isReady = await new Promise<boolean>((resolve) => {
        const req = http.get(url, (res) => {
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

    throw new Error(`等待 Harness 服务就绪超时 (${timeoutMs}ms): ${url}`);
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
