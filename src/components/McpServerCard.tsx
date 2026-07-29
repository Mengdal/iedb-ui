import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Plug,
  Trash2,
  Pencil,
  Wrench,
  Check,
  X,
  Loader2,
  Server,
  ExternalLink,
} from 'lucide-react';
import { McpServerConfig, McpTool } from '../utils/mcpClient';
import { mcpManager, ConnStatus } from '../utils/mcpManager';
import './McpServerCard.css';

interface McpServerCardProps {
  config: McpServerConfig;
  onUpdate: (config: McpServerConfig) => void;
  onDelete?: (id: string) => void;
  t?: (key: string) => string;
}

const tn = (t: ((k: string) => string) | undefined, key: string, fallback: string) =>
  t ? t(key) : fallback;

/**
 * MCP 服务卡片。
 * 用户点「连接」才连；enabled 时刷新恢复连接（与 App.restoreEnabledConnections 一致）。
 * AI 对话侧禁止自动连。
 */
const McpServerCard: React.FC<McpServerCardProps> = ({
  config,
  onUpdate,
  onDelete,
  t,
}) => {
  const [tools, setTools] = useState<McpTool[]>(() => mcpManager.getTools(config.id));
  const [status, setStatus] = useState<ConnStatus>(() => mcpManager.getStatus(config.id));
  const [errorMsg, setErrorMsg] = useState('');
  const [showTools, setShowTools] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(config.name);
  const [editUrl, setEditUrl] = useState(config.url);
  const [editToken, setEditToken] = useState(config.token || '');
  const [editTransport, setEditTransport] = useState(config.transport);
  const [editCommand, setEditCommand] = useState(config.command || '');
  const editFormRef = useRef<HTMLDivElement>(null);

  // 仅同步 UI 状态，禁止在回调里改 enabled
  useEffect(() => {
    const unsub = mcpManager.subscribe((serverId, newStatus, newTools) => {
      if (serverId !== config.id) return;
      setStatus(newStatus);
      if (newStatus === 'connected') {
        setTools(newTools);
        setErrorMsg('');
      } else if (newStatus === 'error') {
        setTools([]);
      } else if (newStatus === 'idle') {
        setTools([]);
        setShowTools(false);
      }
    });
    setStatus(mcpManager.getStatus(config.id));
    setTools(mcpManager.getTools(config.id));
    return unsub;
  }, [config.id]);

  useEffect(() => {
    if (isEditing && editFormRef.current) {
      editFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isEditing]);

  // 配置变更只刷新池元数据；禁用时断开；已启用但未连接时恢复连接（刷新后）
  useEffect(() => {
    mcpManager.refreshConfigs();
    if (!config.enabled) {
      if (mcpManager.getStatus(config.id) === 'connected' || mcpManager.getStatus(config.id) === 'connecting') {
        mcpManager.disconnect(config.id, { skipPersist: true });
      }
      return;
    }
    // enabled 且尚未连接：恢复连接（页面刷新后或首次进入）
    const st = mcpManager.getStatus(config.id);
    if (st === 'idle' || st === 'error') {
      mcpManager.ensureConnected(config.id).catch((err: any) => {
        setErrorMsg(err?.message || '连接失败');
      });
    }
  }, [config.url, config.token, config.enabled, config.id]);

  /** 用户点连接 */
  const handleConnect = useCallback(async () => {
    setErrorMsg('');
    const next = mcpManager.setEnabled(config.id, true);
    if (next) onUpdate(next);
    try {
      await mcpManager.ensureConnected(config.id);
    } catch (err: any) {
      setErrorMsg(err?.message || '连接失败');
    }
  }, [config.id, onUpdate]);

  /** 用户点断开 */
  const handleDisconnect = useCallback(() => {
    const next = mcpManager.setEnabled(config.id, false);
    if (next) {
      onUpdate(next);
    } else {
      mcpManager.disconnect(config.id);
      onUpdate({ ...config, enabled: false });
    }
  }, [config, onUpdate]);

  const handleToggle = useCallback(async () => {
    if (status === 'connected' || status === 'connecting') {
      handleDisconnect();
      return;
    }
    await handleConnect();
  }, [status, handleConnect, handleDisconnect]);

  const handleToggleTool = useCallback(
    (toolName: string, enabled: boolean) => {
      const disabledTools = config.disabledTools || [];
      const next = enabled
        ? disabledTools.filter((n) => n !== toolName)
        : [...disabledTools, toolName];
      onUpdate({ ...config, disabledTools: next });
    },
    [config, onUpdate]
  );

  const handleSaveEdit = useCallback(() => {
    const updated: McpServerConfig = {
      ...config,
      name: editName.trim() || config.name,
      url: editTransport === 'stdio' ? '' : (editUrl.trim() || config.url),
      token: editToken.trim() || undefined,
      transport: editTransport,
      command: editTransport === 'stdio' ? (editCommand.trim() || config.command) : undefined,
    };
    setIsEditing(false);
    // URL 或 command 变了：断开，等用户手动重连
    const connectionChanged =
      (editTransport !== 'stdio' && editUrl.trim() && editUrl.trim() !== config.url) ||
      (editTransport === 'stdio' && editCommand.trim() && editCommand.trim() !== config.command);
    if (connectionChanged) {
      mcpManager.setEnabled(config.id, false);
      onUpdate({ ...updated, enabled: false });
    } else {
      onUpdate(updated);
    }
  }, [config, editName, editUrl, editToken, editTransport, editCommand, onUpdate]);

  const handleCancelEdit = useCallback(() => {
    setEditName(config.name);
    setEditUrl(config.url);
    setEditToken(config.token || '');
    setEditTransport(config.transport);
    setEditCommand(config.command || '');
    setIsEditing(false);
  }, [config]);

  const isBuiltin = config.type === 'builtin';
  const isCustom = config.type === 'custom';
  const isConnected = status === 'connected';

  return (
    <div className="mcp-server-card">
      <div className="mcp-server-header">
        <div className="mcp-server-info">
          <div className="mcp-server-icon-wrap">
            {isBuiltin ? <Server size={16} /> : <ExternalLink size={16} />}
          </div>
          <div className="mcp-server-meta">
            <div className="mcp-server-name-row">
              <span className="mcp-server-name">{config.name}</span>
              {isBuiltin && (
                <span className="mcp-server-badge">
                  {tn(t, 'mcp.builtin', '内置')}
                </span>
              )}
              <span className={`mcp-server-status mcp-server-status-${status}`}>
                {status === 'idle' && tn(t, 'mcp.statusIdle', '未连接')}
                {status === 'connecting' && (
                  <>
                    <Loader2 size={10} className="spin" />
                    {tn(t, 'mcp.statusConnecting', '连接中')}
                  </>
                )}
                {status === 'connected' && (
                  <>
                    <Check size={10} />
                    {tn(t, 'mcp.statusConnected', '已连接')}
                  </>
                )}
                {status === 'error' && (
                  <>
                    <X size={10} />
                    {tn(t, 'mcp.statusError', '错误')}
                  </>
                )}
              </span>
            </div>
            <code className="mcp-server-url">{config.url}</code>
          </div>
        </div>

        <div className="mcp-server-actions">
          {isCustom && !isEditing && (
            <button
              className="mcp-btn-icon"
              onClick={() => setIsEditing(true)}
              title={tn(t, 'mcp.edit', '编辑')}
            >
              <Pencil size={14} />
            </button>
          )}
          {isCustom && onDelete && !isEditing && (
            <button
              className="mcp-btn-icon"
              onClick={() => onDelete(config.id)}
              title={tn(t, 'mcp.delete', '删除')}
            >
              <Trash2 size={14} />
            </button>
          )}
          {isConnected && tools.length > 0 && !isEditing && (
            <button
              className={`mcp-btn-icon ${showTools ? 'mcp-btn-active' : ''}`}
              onClick={() => setShowTools(!showTools)}
              title={showTools
                ? tn(t, 'mcp.hideTools', '收起工具')
                : tn(t, 'mcp.showTools', '展开工具')}
            >
              <Wrench size={14} />
            </button>
          )}
          <button
            className="mcp-btn"
            onClick={handleToggle}
            disabled={status === 'connecting'}
            title={
              isConnected
                ? tn(t, 'mcp.disconnect', '断开')
                : tn(t, 'mcp.connect', '连接')
            }
          >
            {status === 'connecting' ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Plug size={14} />
            )}
            <span>
              {isConnected
                ? tn(t, 'mcp.disconnect', '断开')
                : tn(t, 'mcp.connect', '连接')}
            </span>
          </button>
        </div>
      </div>

      {isEditing && (
        <div className="mcp-edit-form" ref={editFormRef}>
          <div className="form-group">
            <label>{tn(t, 'views.integrations.mcpNameLabel', '名称')}</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="integration-input"
            />
          </div>
          <div className="form-group">
            {editTransport === 'stdio' ? (
              <>
                <label>{tn(t, 'views.integrations.mcpCommandLabel', '命令')}</label>
                <input
                  type="text"
                  value={editCommand}
                  onChange={(e) => setEditCommand(e.target.value)}
                  placeholder={tn(t, 'views.integrations.mcpCommandPlaceholder', '例如：npx -y @modelcontextprotocol/server-sqlite')}
                  className="integration-input"
                />
              </>
            ) : (
              <>
                <label>{tn(t, 'views.integrations.mcpUrlLabel', '端点 URL')}</label>
                <input
                  type="text"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder={tn(t, 'views.integrations.mcpUrlPlaceholder', '例如：http://localhost:8080/api/v1/mcp')}
                  className="integration-input"
                />
              </>
            )}
          </div>
          <div className="form-group">
            <label>{tn(t, 'views.integrations.mcpTransportLabel', '传输类型')}</label>
            <select
              className="integration-select"
              value={editTransport}
              onChange={(e) => setEditTransport(e.target.value as 'streamablehttp' | 'sse' | 'stdio')}
            >
              <option value="streamablehttp">Streamable HTTP</option>
              <option value="sse">SSE</option>
              <option value="stdio">Stdio</option>
            </select>
          </div>
          <div className="form-group">
            <label>{tn(t, 'views.integrations.mcpTokenLabel', 'Token')}</label>
            <input
              type="password"
              value={editToken}
              onChange={(e) => setEditToken(e.target.value)}
              className="integration-input"
            />
          </div>
          <div className="mcp-edit-actions">
            <button className="btn-text" onClick={handleCancelEdit}>
              {tn(t, 'common.cancel', '取消')}
            </button>
            <button className="btn-filled-light" onClick={handleSaveEdit}>
              {t ? t('common.save') : '保存'}
            </button>
          </div>
        </div>
      )}

      {errorMsg && !isEditing && (
        <div className="mcp-server-error-msg">
          <X size={12} />
          <span>{errorMsg}</span>
        </div>
      )}

      {isConnected && tools.length > 0 && !isEditing && (
        <div className="mcp-server-tools">
          {showTools && (
            <div className="mcp-tools-list">
              {tools.map((tool) => {
                const isDisabled = config.disabledTools?.includes(tool.name);
                const isExpanded = expandedTool === tool.name;
                return (
                  <div
                    key={tool.name}
                    className={`mcp-tool-item ${isDisabled ? 'mcp-tool-disabled' : ''}`}
                  >
                    <div className="mcp-tool-header">
                      <code className="mcp-tool-name">{tool.name}</code>
                      <label className="mcp-tool-toggle">
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          onChange={(e) => handleToggleTool(tool.name, e.target.checked)}
                        />
                        <span className="mcp-tool-toggle-slider" />
                      </label>
                    </div>
                    {tool.description && (
                      <p className="mcp-tool-desc">{tool.description}</p>
                    )}
                    {tool.inputSchema && (
                      <button
                        className="mcp-tool-schema-toggle"
                        onClick={() =>
                          setExpandedTool(isExpanded ? null : tool.name)
                        }
                      >
                        {isExpanded
                          ? tn(t, 'mcp.hideSchema', '隐藏参数')
                          : tn(t, 'mcp.showSchema', '查看参数')}
                      </button>
                    )}
                    {isExpanded && tool.inputSchema && (
                      <pre className="mcp-tool-schema">
                        <code>{JSON.stringify(tool.inputSchema, null, 2)}</code>
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default McpServerCard;
