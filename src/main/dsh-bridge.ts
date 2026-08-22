import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { DshRpcReceipt, DshRpcResult } from '../shared/types';

interface ClientRequestEnvelope {
  type: 'client-request';
  rpcId: string;
  method: string;
  payload: unknown;
}

interface ClientResponseEnvelope {
  type: 'client-response';
  rpcId: string;
  result: DshRpcResult<unknown>;
}

interface ClientResponseEnvelope {
  type: 'client-response';
  rpcId: string;
  result: DshRpcResult<unknown>;
}

interface ServerRequestEnvelope {
  type: 'server-request';
  rpcId: string;
  method: string;
  payload: unknown;
}

const RECONNECT_DELAY_MS = 3000;

function isRpcResultShape(value: unknown): value is DshRpcResult<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean';
}

function isEnvelopeShape(value: unknown, type: string): value is { type: string; result?: unknown } {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === type;
}

function preview(value: unknown): string {
  return JSON.stringify(value)?.slice(0, 200) ?? String(value);
}

/**
 * 引擎通信桥：renderer 不能直连引擎（/api 信任栅栏要求浏览器 Origin 与
 * Host 权威一致），因此 fetch 与 WebSocket 均由主进程代理，经 IPC 转发。
 * 这与官方 web-server 文档描述的 Electron 宿主模式一致（经 IPC 桥接发送 fetch）。
 */
export class DshBridge {
  private getServiceUrl: () => string;
  private getMainWindow: () => BrowserWindow | null;
  private sockets = new Map<'mux' | 'host', WebSocket>();
  private reconnectTimers = new Map<'mux' | 'host', NodeJS.Timeout>();
  private stopped = false;

  constructor(getServiceUrl: () => string, getMainWindow: () => BrowserWindow | null) {
    this.getServiceUrl = getServiceUrl;
    this.getMainWindow = getMainWindow;
  }

  start(): void {
    this.stopped = false;
    this.openStream('mux');
    this.openStream('host');
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
  }

  /** 单次 RPC 调用：POST /api/<method>，body 为完整 ClientRequest 信封，返回解包后的业务结果。 */
  async call(method: string, payload: unknown): Promise<DshRpcResult<unknown>> {
    const envelope: ClientRequestEnvelope = {
      type: 'client-request',
      rpcId: randomUUID(),
      method,
      payload,
    };
    const body = await this.post(`/api/${method}`, envelope);
    // post 的错误折叠（连接失败/HTTP错误/坏JSON）已是 RpcResult 形态
    if (isRpcResultShape(body)) return body;
    if (isEnvelopeShape(body, 'server-response') && isRpcResultShape(body.result)) {
      return body.result;
    }
    return {
      ok: false,
      error: { code: 'internal', message: `引擎响应信封不合法: ${preview(body)}` },
    };
  }

  /** 回应下行请求（审批/问答）：POST /api/respond，回显原帧 rpcId。 */
  async respond(rpcId: string, result: DshRpcResult<unknown>): Promise<DshRpcReceipt> {
    const envelope: ClientResponseEnvelope = {
      type: 'client-response',
      rpcId,
      result,
    };
    const body = await this.post('/api/respond', envelope);
    if (isRpcResultShape(body)) {
      return { accepted: false, reason: body.ok ? 'unexpected' : body.error.message };
    }
    if (typeof body === 'object' && body !== null && 'accepted' in body) {
      return body as DshRpcReceipt;
    }
    return { accepted: false, reason: `引擎回执不合法: ${preview(body)}` };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const base = this.getServiceUrl();
    let response: Response;
    try {
      response = await fetch(new URL(path, base), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        error: { code: 'internal', message: `引擎连接失败: ${err instanceof Error ? err.message : String(err)}` },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: { code: 'internal', message: `引擎返回 HTTP ${response.status}` },
      };
    }

    try {
      return await response.json();
    } catch {
      return {
        ok: false,
        error: { code: 'internal', message: '引擎响应不是有效 JSON' },
      };
    }
  }

  private openStream(stream: 'mux' | 'host'): void {
    if (this.stopped) return;
    const base = this.getServiceUrl();
    const url = new URL(`/api/events.${stream}`, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      console.error(`[DshBridge] ${stream} 流创建失败:`, err);
      this.scheduleReconnect(stream);
      return;
    }
    this.sockets.set(stream, socket);

    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      let envelope: ServerRequestEnvelope;
      try {
        envelope = JSON.parse(event.data) as ServerRequestEnvelope;
      } catch {
        console.error(`[DshBridge] ${stream} 流收到无法解析的帧，已丢弃`);
        return;
      }
      if (envelope?.type !== 'server-request') return;
      const win = this.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('dsh:event', { stream, rpcId: envelope.rpcId, payload: envelope.payload });
      }
    };

    socket.onclose = () => {
      this.sockets.delete(stream);
      if (!this.stopped) {
        this.scheduleReconnect(stream);
      }
    };

    socket.onerror = () => {
      console.error(`[DshBridge] ${stream} 流连接错误`);
    };
  }

  private scheduleReconnect(stream: 'mux' | 'host'): void {
    if (this.stopped || this.reconnectTimers.has(stream)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(stream);
      this.openStream(stream);
    }, RECONNECT_DELAY_MS);
    this.reconnectTimers.set(stream, timer);
  }
}
