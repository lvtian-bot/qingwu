import { spawn, exec } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { CONFIG } from './config.js';

export class HarnessManager {
  constructor(options = {}) {
    this.host = options.host || CONFIG.defaultHost;
    this.port = options.port || CONFIG.defaultPort;
    this.process = null;
    this.isStopping = false;
    this.onExitCallback = null;
  }

  getServiceUrl() {
    return `http://${this.host}:${this.port}`;
  }

  resolveBinPath() {
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

  async start() {
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

    this.process = spawn(process.execPath, args, {
      env,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.process.stdout.on('data', (data) => {
      const text = data.toString();
      console.log(`[Harness stdout] ${text.trim()}`);
    });

    this.process.stderr.on('data', (data) => {
      const text = data.toString();
      console.error(`[Harness stderr] ${text.trim()}`);
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[Harness] 子进程退出，退出码: ${code}, 信号: ${signal}`);
      const wasRunning = !this.isStopping;
      this.process = null;
      if (wasRunning && this.onExitCallback) {
        this.onExitCallback(code, signal);
      }
    });

    this.process.on('error', (err) => {
      console.error('[Harness] 子进程启动或运行异常:', err);
    });

    await this.waitForReady(CONFIG.readinessTimeoutMs, CONFIG.readinessPollIntervalMs);
    console.log(`[Harness] 服务已就绪: ${this.getServiceUrl()}`);
  }

  async waitForReady(timeoutMs = 25000, intervalMs = 300) {
    const startTime = Date.now();
    const url = this.getServiceUrl();

    while (Date.now() - startTime < timeoutMs) {
      if (!this.process) {
        throw new Error('Harness 引擎在就绪前已意外退出');
      }

      const isReady = await new Promise((resolve) => {
        const req = http.get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
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

  onUnexpectedExit(callback) {
    this.onExitCallback = callback;
  }

  async stop() {
    if (!this.process || this.isStopping) {
      return;
    }

    this.isStopping = true;
    const pid = this.process.pid;
    console.log(`[Harness] 正在停止引擎进程 (PID: ${pid})...`);

    return new Promise((resolve) => {
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
      } else if (this.process) {
        this.process.kill('SIGTERM');
        const timer = setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGKILL');
          }
          done();
        }, 2000);
        this.process.once('exit', () => {
          clearTimeout(timer);
          done();
        });
      } else {
        done();
      }
    });
  }
}
