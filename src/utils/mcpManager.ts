/**
 * MCP 客户端池化管理器（单例）
 *
 * 硬性规则：
 *  1. enabled=true 表示用户希望保持连接；刷新后由 restoreEnabledConnections 恢复
 *  2. AI 侧只能调用 getAvailableTools()，禁止在对话时主动连接
 *  3. callTool 只在 status===connected 时执行；session 失效不偷偷重连
 *  4. 点击「断开」同步写 enabled=false 并清空池状态
 */

import {
  McpClient,
  McpServerConfig,
  McpTool,
  McpToolResult,
  loadMcpServers,
  saveMcpServers,
} from './mcpClient';

const TOOL_CALL_TIMEOUT_MS = 30_000;

export interface AvailableTool {
  uid: string;
  serverId: string;
  serverName: string;
  toolName: string;
  description?: string;
  inputSchema?: McpTool['inputSchema'];
}

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'error';

type StatusListener = (serverId: string, status: ConnStatus, tools: McpTool[]) => void;

interface PoolEntry {
  client: McpClient;
  status: ConnStatus;
  tools: McpTool[];
  connectingPromise: Promise<McpTool[]> | null;
}

class McpClientManager {
  private pool = new Map<string, PoolEntry>();
  private listeners = new Set<StatusListener>();
  private lastCreds = new Map<string, { url: string; token: string | null }>();

  subscribe(fn: StatusListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(serverId: string) {
    const entry = this.pool.get(serverId);
    this.listeners.forEach((fn) =>
      fn(serverId, entry?.status ?? 'idle', entry?.tools ?? [])
    );
  }

  private getConfig(serverId: string): McpServerConfig | undefined {
    return loadMcpServers().find((s) => s.id === serverId);
  }

  /** 同步配置到池：只创建/更新 client，绝不发起连接 */
  refreshConfigs(): void {
    const configs = loadMcpServers();
    const seen = new Set<string>();

    for (const cfg of configs) {
      seen.add(cfg.id);
      const existing = this.pool.get(cfg.id);
      const prev = this.lastCreds.get(cfg.id);
      const credsChanged =
        !prev || prev.url !== cfg.url || prev.token !== (cfg.token || null);

      if (!existing) {
        this.pool.set(cfg.id, {
          client: new McpClient(cfg.url, cfg.token || null),
          status: 'idle',
          tools: [],
          connectingPromise: null,
        });
      } else if (credsChanged) {
        existing.client = new McpClient(cfg.url, cfg.token || null);
        existing.status = 'idle';
        existing.tools = [];
        existing.connectingPromise = null;
        this.emit(cfg.id);
      }

      this.lastCreds.set(cfg.id, { url: cfg.url, token: cfg.token || null });

      // enabled=false 时强制 idle
      if (!cfg.enabled) {
        const entry = this.pool.get(cfg.id);
        if (entry && entry.status !== 'idle') {
          entry.client.reset();
          entry.status = 'idle';
          entry.tools = [];
          entry.connectingPromise = null;
          this.emit(cfg.id);
        }
      }
    }

    for (const id of Array.from(this.pool.keys())) {
      if (!seen.has(id)) {
        this.pool.delete(id);
        this.lastCreds.delete(id);
        this.emit(id);
      }
    }
  }

  /**
   * 同步写 enabled，禁用时立刻断开。
   * 这是改 enabled 的唯一推荐入口（避免 React setState 竞态）。
   */
  setEnabled(serverId: string, enabled: boolean): McpServerConfig | undefined {
    const list = loadMcpServers();
    const idx = list.findIndex((s) => s.id === serverId);
    if (idx < 0) return undefined;
    const next = { ...list[idx], enabled };
    list[idx] = next;
    saveMcpServers(list);
    if (!enabled) {
      this.forceIdle(serverId);
    }
    return next;
  }

  private forceIdle(serverId: string) {
    const entry = this.pool.get(serverId);
    if (!entry) {
      this.emit(serverId);
      return;
    }
    entry.client.reset();
    entry.status = 'idle';
    entry.tools = [];
    entry.connectingPromise = null;
    this.emit(serverId);
  }

  /**
   * 页面加载时调用：恢复所有 enabled=true 的连接。
   * AI 对话路径禁止调用此方法。
   */
  async restoreEnabledConnections(): Promise<void> {
    this.refreshConfigs();
    const configs = loadMcpServers().filter((c) => c.enabled);
    await Promise.all(configs.map((c) => this.ensureConnected(c.id).catch(() => [])));
  }

  /**
   * 建立连接（用户点「连接」或 restoreEnabledConnections 时调用）。
   * AI 对话路径禁止调用。
   */
  async ensureConnected(serverId: string): Promise<McpTool[]> {
    this.refreshConfigs();
    const cfg = this.getConfig(serverId);
    if (!cfg || !cfg.enabled) return [];

    let entry = this.pool.get(serverId);
    if (!entry) {
      this.refreshConfigs();
      entry = this.pool.get(serverId);
      if (!entry) return [];
    }

    if (entry.status === 'connected') {
      return this.filterDisabled(cfg, entry.tools);
    }
    if (entry.connectingPromise) {
      try {
        const tools = await entry.connectingPromise;
        if (!this.getConfig(serverId)?.enabled) return [];
        return this.filterDisabled(cfg, tools);
      } catch {
        return [];
      }
    }

    entry.status = 'connecting';
    this.emit(serverId);

    entry.connectingPromise = (async () => {
      try {
        if (!this.getConfig(serverId)?.enabled) {
          entry!.status = 'idle';
          entry!.tools = [];
          this.emit(serverId);
          return [];
        }
        await entry!.client.initialize();
        if (!this.getConfig(serverId)?.enabled) {
          entry!.client.reset();
          entry!.status = 'idle';
          entry!.tools = [];
          this.emit(serverId);
          return [];
        }
        const tools = await entry!.client.listTools();
        if (!this.getConfig(serverId)?.enabled) {
          entry!.client.reset();
          entry!.status = 'idle';
          entry!.tools = [];
          this.emit(serverId);
          return [];
        }
        entry!.status = 'connected';
        entry!.tools = tools;
        this.emit(serverId);
        return tools;
      } catch (err) {
        entry!.status = 'error';
        entry!.tools = [];
        this.emit(serverId);
        throw err;
      } finally {
        entry!.connectingPromise = null;
      }
    })();

    try {
      const tools = await entry.connectingPromise;
      return this.filterDisabled(cfg, tools);
    } catch {
      return [];
    }
  }

  /** 用户点击「断开」 */
  disconnect(serverId: string, options?: { skipPersist?: boolean }): void {
    if (!options?.skipPersist) {
      const list = loadMcpServers();
      const idx = list.findIndex((s) => s.id === serverId);
      if (idx >= 0 && list[idx].enabled) {
        list[idx] = { ...list[idx], enabled: false };
        saveMcpServers(list);
      }
    }
    this.forceIdle(serverId);
  }

  getStatus(serverId: string): ConnStatus {
    return this.pool.get(serverId)?.status ?? 'idle';
  }

  getTools(serverId: string): McpTool[] {
    return this.pool.get(serverId)?.tools ?? [];
  }

  /**
   * AI 唯一入口：只返回「此刻 status===connected」的工具。
   * 不连接、不重连、不读 enabled 就去连。
   */
  getAvailableTools(): AvailableTool[] {
    const configs = loadMcpServers();
    const result: AvailableTool[] = [];
    for (const cfg of configs) {
      const entry = this.pool.get(cfg.id);
      // 必须当前已连接；enabled 只是配置偏好，不能代替连接状态
      if (!entry || entry.status !== 'connected') continue;
      if (!cfg.enabled) continue;
      const disabled = cfg.disabledTools || [];
      for (const tool of entry.tools) {
        if (disabled.includes(tool.name)) continue;
        result.push({
          uid: `${cfg.id}__${tool.name}`,
          serverId: cfg.id,
          serverName: cfg.name,
          toolName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return result;
  }

  /** 当前已连接的服务名列表（给 AI prompt / UI） */
  getConnectedServerNames(): string[] {
    const configs = loadMcpServers();
    const names: string[] = [];
    for (const cfg of configs) {
      const entry = this.pool.get(cfg.id);
      if (entry?.status === 'connected' && cfg.enabled) {
        names.push(cfg.name);
      }
    }
    return names;
  }

  async callToolByUid(
    uid: string,
    args: Record<string, unknown>,
    options?: { database?: string }
  ): Promise<{
    ok: boolean;
    text: string;
    isError: boolean;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
  }> {
    const sepIdx = uid.indexOf('__');
    if (sepIdx < 0) throw new Error(`无效的工具标识: ${uid}`);
    return this.callTool(uid.slice(0, sepIdx), uid.slice(sepIdx + 2), args, options);
  }

  /**
   * 仅在已连接时调用。绝不自动连接 / 重连。
   * session 失效直接报错，让用户手动重连。
   *
   * options.database：UI 当前选中库。会：
   *  1) 写入 x-iedb-database 请求头（IotEdgeDB MCP 依赖）
   *  2) 按工具 inputSchema 注入 database 类参数（模型常漏传）
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { database?: string }
  ): Promise<{
    ok: boolean;
    text: string;
    isError: boolean;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
  }> {
    const cfg = this.getConfig(serverId);
    if (!cfg) throw new Error(`未找到 MCP 服务: ${serverId}`);
    const serverName = cfg.name;

    if (!cfg.enabled) {
      return {
        ok: false,
        text: `MCP 服务 ${serverName} 未启用`,
        isError: true,
        serverName,
        toolName,
        args,
      };
    }
    if (cfg.disabledTools?.includes(toolName)) {
      return {
        ok: false,
        text: `工具 ${toolName} 已被禁用`,
        isError: true,
        serverName,
        toolName,
        args,
      };
    }

    const entry = this.pool.get(serverId);
    if (!entry || entry.status !== 'connected') {
      return {
        ok: false,
        text: `MCP 服务 ${serverName} 当前未连接，请先在应用集成中手动连接`,
        isError: true,
        serverName,
        toolName,
        args,
      };
    }

    // 按工具 schema 注入当前选中库；UI 选库为真相，覆盖模型漏传/错传
    const toolMeta = entry.tools.find((t) => t.name === toolName);
    const finalArgs = injectSelectedDatabase(args, toolMeta?.inputSchema, options?.database);

    try {
      // 请求头同步当前库（与 REST API 的 x-iedb-database 一致）
      entry.client.setDatabase(options?.database || null);
      const result: McpToolResult = await this.withTimeout(
        entry.client.callTool(toolName, finalArgs),
        TOOL_CALL_TIMEOUT_MS
      );
      return {
        ok: result.ok,
        text: result.text,
        isError: result.isError,
        serverName,
        toolName,
        args: finalArgs,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // session 失效：标记 idle，不自动重连
      if (/initialize|session|连接|network|fetch/i.test(errMsg)) {
        this.forceIdle(serverId);
      }
      return {
        ok: false,
        text: errMsg,
        isError: true,
        serverName,
        toolName,
        args: finalArgs,
      };
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`工具调用超时 (${ms}ms)`)), ms);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  private filterDisabled(cfg: McpServerConfig, tools: McpTool[]): McpTool[] {
    const disabled = cfg.disabledTools || [];
    if (disabled.length === 0) return tools;
    return tools.filter((t) => !disabled.includes(t.name));
  }
}

export const mcpManager = new McpClientManager();
mcpManager.refreshConfigs();

/** 常见数据库参数名；UI 选库会注入/覆盖 */
const DATABASE_ARG_KEYS = ['database', 'db', 'database_name', 'db_name', 'dbname', 'dbName'];

/** 把 UI 当前选中库注入工具参数（覆盖模型漏传/错传） */
export function injectSelectedDatabase(
  args: Record<string, unknown>,
  inputSchema: McpTool['inputSchema'] | undefined,
  selectedDb?: string
): Record<string, unknown> {
  const db = selectedDb?.trim();
  if (!db) return { ...args };

  const next: Record<string, unknown> = { ...args };
  const props = (inputSchema?.properties || {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(props), ...(inputSchema?.required || [])]);

  for (const key of keys) {
    if (DATABASE_ARG_KEYS.includes(key) || /^(database|db)(_?name)?$/i.test(key)) {
      next[key] = db;
    }
  }
  // 兜底：IotEdgeDB MCP 常用 database
  next.database = db;
  return next;
}

export function toOpenAiTool(tool: AvailableTool) {
  return {
    type: 'function' as const,
    function: {
      name: tool.uid,
      description: `[${tool.serverName}] ${tool.description || tool.toolName}`,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  };
}
