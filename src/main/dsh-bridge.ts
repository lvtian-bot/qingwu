import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import WebSocket from 'ws';
import type { DshRpcResult } from '../shared/types';

interface ClientRequestEnvelope {
  type: 'client-request';
  rpcId: string;
  method: string;
  payload: unknown;
}

interface ServerResponseEnvelope {
  type: 'server-response';
  rpcId: string;
  result: DshRpcResult<unknown>;
}

interface RemoteStreamServerMessage {
  type: 'item' | 'error' | 'end';
  streamId: string;
  value?: unknown;
  error?: { code: string; message: string; details?: object };
}

interface ActiveStream {
  endpoint: string;
  payload: unknown;
}

const RECONNECT_DELAY_MS = 3000;
const REMOTE_STREAM_MUX_PATH = '/api/remote.mux';
const REMOTE_EVENT_RESULT_ENDPOINT = '$events/result';
/** endpoint 路径段校验：与引擎 endpointFromPath 的段规则保持同宽（$events 内部端点含 $）。 */
const ENDPOINT_PATTERN = /^[A-Za-z0-9_$][\w$.-]*(?:\/[A-Za-z0-9_$][\w$.-]*)*$/;

/**
 * 引擎通信桥：renderer 不能直连引擎（/api 信任栅栏要求浏览器 Origin 与
 * Host 权威一致），因此一元 RPC 与事件流均由主进程代理，经 IPC 转发。
 * 0.1.2 契约：一元调用 POST /api/<endpoint>（client-request/server-response
 * 信封，result 为 RemoteResult）；全部逻辑流复用 /api/remote.mux 一条
 * WebSocket（鉴权只认握手 cookie，token 查询参数无效）。
 */
export class DshBridge {
  private getServiceUrl: () => string;
  private getMainWindow: () => BrowserWindow | null;
  private authCookie: string | null = null;
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** 已打开的逻辑流（WS 重连后按此重放 open）。 */
  private streams = new Map<string, ActiveStream>();

  constructor(getServiceUrl: () => string, getMainWindow: () => BrowserWindow | null) {
    this.getServiceUrl = getServiceUrl;
    this.getMainWindow = getMainWindow;
  }

  start(): void {
    this.stopped = false;
    void this.acquireAuthCookie().finally(() => {
      this.connectStreamSocket();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.streams.clear();
    this.ws?.close();
    this.ws = null;
    this.wsConnected = false;
  }

  /** 一元 RPC：POST /api/<endpoint>，payload 为具名参数，桥统一包 {args} 信封。 */
  async call(endpoint: string, payload: unknown): Promise<DshRpcResult<unknown>> {
    if (!ENDPOINT_PATTERN.test(endpoint)) {
      return {
        ok: false,
        error: { code: 'internal', message: `非法 RPC endpoint: ${endpoint}` },
      };
    }
    const envelope: ClientRequestEnvelope = {
      type: 'client-request',
      rpcId: randomUUID(),
      method: endpoint,
      payload: { args: payload },
    };
    let response: Response;
    try {
      response = await fetch(new URL(`/api/${endpoint}`, this.getServiceUrl()), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.authCookie ? { cookie: this.authCookie } : {}),
        },
        body: JSON.stringify(envelope),
      });
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: `引擎连接失败: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: { code: 'internal', message: `引擎返回 HTTP ${response.status}` },
      };
    }

    try {
      const body = (await response.json()) as ServerResponseEnvelope;
      if (body?.type !== 'server-response' || body.rpcId !== envelope.rpcId) {
        return {
          ok: false,
          error: { code: 'internal', message: '引擎响应信封不合法' },
        };
      }
      return body.result;
    } catch {
      return {
        ok: false,
        error: { code: 'internal', message: '引擎响应不是有效 JSON' },
      };
    }
  }

  /** 在 remote.mux 上打开一条逻辑流，payload 为具名参数（桥包 {args} 信封）。 */
  openStream(endpoint: string, payload: unknown): string {
    const streamId = randomUUID();
    this.streams.set(streamId, { endpoint, payload });
    this.sendStreamOpen(streamId, endpoint, payload);
    return streamId;
  }

  cancelStream(streamId: string): void {
    this.streams.delete(streamId);
    this.sendWhenOpen({ type: 'cancel', streamId });
  }

  /** 回应 $events 瀑布（审批/问答）：POST /api/$events/result，载荷不走 args 包装。 */
  async eventResult(clientId: string, eventId: string, outcome: unknown): Promise<void> {
    if (!ENDPOINT_PATTERN.test(REMOTE_EVENT_RESULT_ENDPOINT)) return;
    const envelope: ClientRequestEnvelope = {
      type: 'client-request',
      rpcId: randomUUID(),
      method: REMOTE_EVENT_RESULT_ENDPOINT,
      payload: { clientId, eventId, outcome },
    };
    try {
      const response = await fetch(
        new URL(`/api/${REMOTE_EVENT_RESULT_ENDPOINT}`, this.getServiceUrl()),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.authCookie ? { cookie: this.authCookie } : {}),
          },
          body: JSON.stringify(envelope),
        }
      );
      if (!response.ok) {
        console.error(`[DshBridge] 事件回执失败: HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('[DshBridge] 事件回执失败:', err);
    }
  }

  /**
   * 用带 token 的 Web 地址换取会话 cookie：GET 一次（手动跟随跳转并收集
   * Set-Cookie）。0.1.1 无鉴权时地址不含 token，直接跳过。
   */
  private async acquireAuthCookie(): Promise<void> {
    const base = this.getServiceUrl();
    if (!new URL(base).searchParams.has('token')) return;
    try {
      let url = new URL(base);
      for (let i = 0; i < 5; i += 1) {
        const response = await fetch(url, { redirect: 'manual' });
        const setCookies = response.headers.getSetCookie();
        if (setCookies.length > 0) {
          this.authCookie = setCookies.map((c) => c.split(';')[0]).join('; ');
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (location) {
            url = new URL(location, url);
            continue;
          }
        }
        break;
      }
    } catch (err) {
      console.error('[DshBridge] 鉴权握手失败:', err);
    }
  }

  private connectStreamSocket(): void {
    if (this.stopped || this.ws) return;
    const base = new URL(this.getServiceUrl());
    const url = new URL(REMOTE_STREAM_MUX_PATH, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    let socket: WebSocket;
    try {
      socket = new WebSocket(url, {
        headers: this.authCookie ? { cookie: this.authCookie } : undefined,
      });
    } catch (err) {
      console.error('[DshBridge] 流连接创建失败:', err);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.on('open', () => {
      this.wsConnected = true;
      for (const [streamId, stream] of this.streams) {
        this.sendStreamOpen(streamId, stream.endpoint, stream.payload);
      }
    });

    socket.on('message', (data) => {
      let message: RemoteStreamServerMessage;
      try {
        message = JSON.parse(String(data)) as RemoteStreamServerMessage;
      } catch {
        return;
      }
      const stream = this.streams.get(message.streamId);
      if (!stream) return;
      // error/end 为终态帧，转译为保留 shape 投递后保留注册（由渲染层决定是否关闭流）
      let value: unknown = message.value;
      if (message.type === 'error') {
        value = { type: 'stream/error', error: message.error };
      } else if (message.type === 'end') {
        value = { type: 'stream/end' };
      }
      this.sendToRenderer('dsh:stream-item', {
        streamId: message.streamId,
        endpoint: stream.endpoint,
        value,
      });
    });

    socket.on('close', () => {
      this.ws = null;
      this.wsConnected = false;
      if (!this.stopped) this.scheduleReconnect();
    });

    socket.on('error', () => {
      // close 事件随后必然到达，重连调度以 close 为准
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectStreamSocket();
    }, RECONNECT_DELAY_MS);
  }

  private sendStreamOpen(streamId: string, endpoint: string, payload: unknown): void {
    this.sendWhenOpen({ type: 'open', streamId, endpoint, payload: { args: payload } });
  }

  private sendWhenOpen(message: Record<string, unknown>): void {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
