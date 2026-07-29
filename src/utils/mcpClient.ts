/**
 * 通用 MCP Streamable HTTP 客户端
 * 支持 iedb 自带 MCP 和用户自定义的 MCP 服务
 *
 * 协议要点（modelcontextprotocol/go-sdk v1.6.1 StreamableHTTPHandler）：
 *  - 传输：JSON-RPC 2.0 over HTTP，端点 POST /api/v1/mcp
 *  - 请求头：必须同时 Accept application/json 和 text/event-stream
 *  - 请求头：后续请求必须带 Mcp-Protocol-Version（协商后的版本）
 *  - 请求头：initialize 后服务端在响应头返回 Mcp-Session-Id，后续请求必须带上
 *  - 通知（notifications/*）不带 id 字段，返回 202 + 空 body
 *  - 普通请求默认以 text/event-stream(SSE) 响应，单条 data 事件里是 JSON-RPC 响应
 */

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

let _id = 0;
function nextId(): number {
  _id += 1;
  return _id;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  ok: boolean;
  text: string;
  isError: boolean;
  raw: unknown;
}

export type McpTransportType = 'streamablehttp' | 'sse' | 'stdio';

export interface McpServerConfig {
  id: string;
  name: string;
  /** builtin = IotEdgeDB 自带（streamablehttp）；custom = 用户自定义 */
  type: 'builtin' | 'custom';
  /** 传输类型（仅 custom 有效，builtin 固定 streamablehttp） */
  transport: McpTransportType;
  url: string;
  /** stdio 模式下的命令 */
  command?: string;
  enabled: boolean;
  authType: 'bearer' | 'none';
  token?: string;
  /** 被禁用的工具名列表 */
  disabledTools?: string[];
}

export class McpClientError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'McpClientError';
  }
}

export class McpClient {
  private endpoint: string;
  private token: string | null;
  private sessionId: string | null = null;
  private protocolVersion: string = DEFAULT_PROTOCOL_VERSION;
  private initialized = false;
  /** 当前选中的数据库，请求时自动带 x-iedb-database（IotEdgeDB MCP 依赖此头） */
  private database: string | null = null;

  constructor(endpoint: string, token: string | null = null) {
    this.endpoint = endpoint;
    this.token = token;
  }

  get connected(): boolean {
    return this.initialized && !!this.sessionId;
  }

  /** 设置当前数据库上下文，后续 MCP 请求会带 x-iedb-database */
  setDatabase(database: string | null): void {
    this.database = database?.trim() || null;
  }

  reset(): void {
    this.sessionId = null;
    this.initialized = false;
    this.protocolVersion = DEFAULT_PROTOCOL_VERSION;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Protocol-Version': this.protocolVersion,
      ...extra,
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }
    // IotEdgeDB 服务端用此头识别当前库；与 REST API 一致
    if (this.database) {
      headers['x-iedb-database'] = this.database;
    }
    return headers;
  }

  /**
   * 发送一个 JSON-RPC 请求，兼容 SSE（text/event-stream）与 JSON 两种响应。
   * 通知（notification）不带 id 字段，返回 202 + 空 body。
   */
  private async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    const isNotification = method.startsWith('notifications/');
    const body: Record<string, unknown> = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };
    if (!isNotification) {
      body.id = nextId();
    }

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        credentials: 'omit',
      });
    } catch (err) {
      throw new McpClientError(`MCP 请求失败: ${method}`, err);
    }

    // 捕获并保存 session id（initialize 响应头返回）
    const sid = res.headers.get('Mcp-Session-Id');
    if (sid) {
      this.sessionId = sid;
    }

    // 通知类请求：SDK 返回 202 Accepted + 空 body
    if (isNotification) {
      if (!res.ok && res.status !== 202) {
        let detail = '';
        try {
          detail = await res.text();
        } catch {
          /* ignore */
        }
        throw new McpClientError(`MCP 通知错误 ${res.status}: ${detail.slice(0, 300)}`);
      }
      return undefined as T;
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new McpClientError(`MCP 响应错误 ${res.status}: ${detail.slice(0, 300)}`);
    }

    const contentType = res.headers.get('Content-Type') || '';
    let payload: string;
    if (contentType.includes('text/event-stream')) {
      payload = await this.readSse(res);
    } else {
      payload = await res.text();
    }

    if (!payload.trim()) {
      return undefined as T;
    }

    let json: any;
    try {
      json = JSON.parse(payload);
    } catch (err) {
      throw new McpClientError(`MCP 响应非 JSON: ${payload.slice(0, 200)}`, err);
    }

    if (json.error) {
      throw new McpClientError(`MCP error ${json.error.code}: ${json.error.message}`);
    }
    return json.result as T;
  }

  /**
   * 解析 SSE 流，取最后一个含 jsonrpc 的 data 事件。
   * go-sdk 的 StreamableHTTPHandler 默认以 SSE 响应，每条 data 是一个 JSON-RPC 消息。
   */
  private async readSse(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let buffer = '';
    let lastJson = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const evt of events) {
        const dataLines = evt
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
        const data = dataLines.join('');
        if (data) lastJson = data;
      }
    }
    if (buffer.trim()) {
      const dataLines = buffer
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      const data = dataLines.join('');
      if (data) lastJson = data;
    }
    return lastJson;
  }

  /** 初始化会话并协商协议版本 */
  async initialize(): Promise<void> {
    this.reset();
    const result = await this.rpc<{ protocolVersion?: string }>('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: { tools: {} },
      clientInfo: { name: 'iedb-front', version: '0.1.0' },
    });
    // 保存服务端协商后的协议版本，后续请求的 Mcp-Protocol-Version 头用这个值
    if (result?.protocolVersion) {
      this.protocolVersion = result.protocolVersion;
    }
    // 发送 initialized 通知（无 id，返回 202 + 空 body）
    await this.rpc('notifications/initialized');
    this.initialized = true;
  }

  /** 列出全部工具 */
  async listTools(): Promise<McpTool[]> {
    const result = await this.rpc<{ tools: McpTool[] }>('tools/list', {});
    return result?.tools ?? [];
  }

  /** 调用工具 */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.rpc<{
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    }>('tools/call', { name, arguments: args });

    const content = result?.content ?? [];
    const text = content
      .filter((c) => c.type === 'text' || c.text)
      .map((c) => c.text || '')
      .join('\n')
      .trim();
    const isError = result?.isError ?? false;

    return {
      ok: !isError,
      text,
      isError,
      raw: result,
    };
  }
}

/** 从 localStorage 读取 MCP 服务配置 */
export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem('iotedge-mcp-servers');
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

/** 保存 MCP 服务配置到 localStorage */
export function saveMcpServers(servers: McpServerConfig[]) {
  localStorage.setItem('iotedge-mcp-servers', JSON.stringify(servers));
}

/** 生成唯一 ID */
export function generateMcpServerId(): string {
  return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
