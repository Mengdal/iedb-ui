import React, { useRef, useState, useEffect, useCallback } from 'react';
import { BrainCircuit, Settings2, Eye, EyeOff, FileText, X, Upload, ChevronDown, ChevronUp, RefreshCw, Zap, CheckCircle2, XCircle, Plus, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { aiFetch } from '../utils/server';
import { useServers } from '../contexts/ServerContext';
import McpServerCard from '../components/McpServerCard';
import {
  McpServerConfig,
  loadMcpServers,
  saveMcpServers,
  generateMcpServerId,
} from '../utils/mcpClient';
import { mcpManager } from '../utils/mcpManager';
import './Integrations.css';

type AIProviderId =
  | 'custom'
  | 'lmstudio'
  | 'openai'
  | 'qwen'
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'doubao'
  | 'tencent-hunyuan'
  | 'baidu-qianfan'
  | 'iflytek-spark';

const AI_PROVIDERS: Array<{
  id: AIProviderId;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
}> = [
  { id: 'custom', defaultBaseUrl: '', defaultModel: '', requiresApiKey: false },
  { id: 'lmstudio', defaultBaseUrl: 'http://localhost:1234/v1', defaultModel: 'local-model', requiresApiKey: false },
  { id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.5', requiresApiKey: true },

  // China-friendly / domestic vendors (OpenAI-compatible where possible)
  { id: 'qwen', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3.7-max', requiresApiKey: true },
  { id: 'deepseek', defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-flash', requiresApiKey: true },
  { id: 'zhipu', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-5.2', requiresApiKey: true },
  { id: 'moonshot', defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.7-code', requiresApiKey: true },
  { id: 'doubao', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-pro-32k', requiresApiKey: true },
  { id: 'tencent-hunyuan', defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbos-latest', requiresApiKey: true },
  { id: 'baidu-qianfan', defaultBaseUrl: 'https://qianfan.baidubce.com/v2', defaultModel: 'ernie-4.0', requiresApiKey: true },
  { id: 'iflytek-spark', defaultBaseUrl: 'https://spark-api-open.xf-yun.com/v1', defaultModel: '4.0Ultra', requiresApiKey: true },
];

function providerConfig(id: string) {
  return AI_PROVIDERS.find((p) => p.id === id) || AI_PROVIDERS[0];
}

function isAllowedInstructionsFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) return true;
  const type = file.type.toLowerCase();
  return type === 'text/plain' || type === 'text/markdown' || type === 'text/x-markdown';
}

const Integrations: React.FC = () => {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const [provider, setProvider] = useState(() => localStorage.getItem('iotedge-ai-provider') || 'lmstudio');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('iotedge-ai-apikey') || '');
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('iotedge-ai-baseurl') || 'http://localhost:1234/v1');
  const [modelName, setModelName] = useState(() => localStorage.getItem('iotedge-ai-model') || providerConfig(provider).defaultModel);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [hasFetchedModels, setHasFetchedModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [instructions, setInstructions] = useState(() => localStorage.getItem('iotedge-ai-instructions') || '');
  const [isInstructionsExpanded, setIsInstructionsExpanded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // MCP 服务管理
  const { activeServer } = useServers();
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [showAddMcpForm, setShowAddMcpForm] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpToken, setNewMcpToken] = useState('');
  const [newMcpAuthType, setNewMcpAuthType] = useState<'bearer' | 'none'>('none');
  const [newMcpTransport, setNewMcpTransport] = useState<'streamablehttp' | 'sse' | 'stdio'>('streamablehttp');
  const [newMcpCommand, setNewMcpCommand] = useState('');

  const currentProvider = providerConfig(provider);
  const effectiveDefaultBaseUrl = currentProvider.defaultBaseUrl || t('views.integrations.baseUrlPlaceholder');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstructions, setModalInstructions] = useState('');
  const [activeTab, setActiveTab] = useState<'instructions' | 'template'>('instructions');
  const [instructionsUploadError, setInstructionsUploadError] = useState<string | null>(null);
  const instructionsFileInputRef = useRef<HTMLInputElement>(null);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    setProvider(newProvider);
    const cfg = providerConfig(newProvider);
    if (newProvider !== 'custom') {
      setBaseUrl(cfg.defaultBaseUrl);
    }
    setModelName(cfg.defaultModel);
    setAvailableModels([]);
    setHasFetchedModels(false);
    setFetchModelsError('');
    setShowModelDropdown(false);
  };

  const handleFetchModels = async () => {
    if (!baseUrl) {
      setFetchModelsError(t('views.integrations.fetchModelsErrorNoUrl'));
      return;
    }
    setFetchingModels(true);
    setFetchModelsError('');
    setAvailableModels([]);
    try {
      const res = await aiFetch(baseUrl, '/models', { apiKey });
      if (!res.ok) {
        const statusMap: Record<number, string> = {
          401: t('views.integrations.fetchModelsError401'),
          403: t('views.integrations.fetchModelsError403'),
          404: t('views.integrations.fetchModelsError404'),
          408: t('views.integrations.fetchModelsError408'),
          429: t('views.integrations.fetchModelsError429'),
        };
        throw new Error(statusMap[res.status] || t('views.integrations.fetchModelsErrorHttp', { status: res.status }));
      }
      const data = await res.json();
      const models: string[] = (data.data || [])
        .map((m: { id: string }) => m.id)
        .filter(Boolean)
        .sort();
      if (models.length === 0) {
        throw new Error(t('views.integrations.fetchModelsEmpty'));
      }
      setAvailableModels(models);
      setHasFetchedModels(true);
      if (models.length > 0) setShowModelDropdown(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
        setFetchModelsError(t('views.integrations.fetchModelsErrorNetwork'));
      } else {
        setFetchModelsError(msg);
      }
    } finally {
      setFetchingModels(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Base URL 或 API Key 变化时，重置模型列表缓存与测试连接结果，
  // 确保下次检测使用最新配置，避免缓存导致误判可用性
  useEffect(() => {
    setAvailableModels([]);
    setHasFetchedModels(false);
    setFetchModelsError('');
    setShowModelDropdown(false);
    setTestResult(null);
  }, [baseUrl, apiKey]);

  const handleModelFocus = () => {
    if (!hasFetchedModels) {
      if (!fetchingModels) handleFetchModels();
    } else {
      setShowModelDropdown(true);
    }
  };

  const handleModelInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setModelName(e.target.value);
    setShowModelDropdown(true);
  };

  const handleChevronMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (fetchingModels) return;
    if (!hasFetchedModels) {
      handleFetchModels();
    } else {
      setShowModelDropdown(!showModelDropdown);
    }
  };

  const handleOpenModal = () => {
    setModalInstructions(instructions);
    setInstructionsUploadError(null);
    setIsModalOpen(true);
  };

  const handleSaveModal = () => {
    setInstructions(modalInstructions);
    localStorage.setItem('iotedge-ai-instructions', modalInstructions);
    setIsModalOpen(false);
  };

  const EXAMPLE_TEMPLATE = t('views.integrations.exampleTemplate');

  const handleUseTemplate = () => {
    setModalInstructions(EXAMPLE_TEMPLATE);
    setActiveTab('instructions');
  };

  const handleInstructionsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setInstructionsUploadError(null);
    if (!file) return;
    if (!isAllowedInstructionsFile(file)) {
      setInstructionsUploadError(t('views.integrations.uploadInvalidType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setModalInstructions(text);
    };
    reader.onerror = () => {
      setInstructionsUploadError(t('views.integrations.uploadReadFailed'));
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleSave = () => {
    localStorage.setItem('iotedge-ai-provider', provider);
    localStorage.setItem('iotedge-ai-apikey', apiKey);
    localStorage.setItem('iotedge-ai-baseurl', baseUrl);
    localStorage.setItem('iotedge-ai-model', modelName);
    localStorage.setItem('iotedge-ai-instructions', instructions);
    setSaveStatus(t('views.integrations.saveStatusSaved'));
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const handleTestConnection = async () => {
    if (!baseUrl) {
      setTestResult({ type: 'error', message: t('views.integrations.testErrorNoUrl') });
      return;
    }
    if (!modelName) {
      setTestResult({ type: 'error', message: t('views.integrations.testErrorNoModel') });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await aiFetch(baseUrl, '/chat/completions', {
        apiKey,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });
      if (!res.ok) {
        throw new Error();
      }
      // 部分网关/代理会用 200 状态码返回错误体，需检查响应内容是否包含 error 字段
      const data = await res.json().catch(() => null);
      if (data?.error) {
        throw new Error();
      }
      setTestResult({ type: 'success', message: t('views.integrations.testSuccess') });
    } catch {
      setTestResult({ type: 'error', message: t('views.integrations.testErrorFailed') });
    } finally {
      setTesting(false);
    }
  };

  // ---------- MCP 服务管理 ----------

  /** 同步 iedb 自带 MCP：当 activeServer 变化时自动更新/创建 */
  useEffect(() => {
    if (!activeServer) return;
    // 自带 MCP 使用相对路径，dev 模式下走 vite proxy，生产同源直接访问，
    // 避免跨域问题。token 从 activeServer 取。
    const builtinUrl = '/api/v1/mcp';
    setMcpServers((prev) => {
      const existing = prev.find((s) => s.type === 'builtin');
      let next: McpServerConfig[];
      if (existing) {
        next = prev.map((s) =>
          s.type === 'builtin'
            ? {
                ...s,
                name: 'IotEdgeDB MCP',
                url: builtinUrl,
                token: activeServer.token,
              }
            : s
        );
      } else {
        next = [
          {
            id: 'builtin',
            name: 'IotEdgeDB MCP',
            type: 'builtin',
            transport: 'streamablehttp',
            url: builtinUrl,
            enabled: true,
            authType: 'bearer',
            token: activeServer.token,
          },
          ...prev,
        ];
      }
      saveMcpServers(next);
      return next;
    });
  }, [activeServer]);

  const handleUpdateMcpServer = useCallback(
    (config: McpServerConfig) => {
      setMcpServers((prev) => {
        const next = prev.map((s) => (s.id === config.id ? config : s));
        saveMcpServers(next);
        // 同步 manager 池状态（enabled=false 时会强制断开）
        mcpManager.refreshConfigs();
        return next;
      });
    },
    []
  );

  const handleDeleteMcpServer = useCallback(
    (id: string) => {
      mcpManager.disconnect(id);
      setMcpServers((prev) => {
        const next = prev.filter((s) => s.id !== id);
        saveMcpServers(next);
        mcpManager.refreshConfigs();
        return next;
      });
    },
    []
  );

  const handleAddMcpServer = useCallback(() => {
    if (!newMcpName.trim() || !newMcpUrl.trim()) return;
    const config: McpServerConfig = {
      id: generateMcpServerId(),
      name: newMcpName.trim(),
      type: 'custom',
      transport: newMcpTransport,
      url: newMcpUrl.trim(),
      enabled: true,
      authType: newMcpAuthType,
      token: newMcpToken.trim() || undefined,
      command: newMcpTransport === 'stdio' ? newMcpCommand.trim() : undefined,
    };
    setMcpServers((prev) => {
      const next = [...prev, config];
      saveMcpServers(next);
      return next;
    });
    setNewMcpName('');
    setNewMcpUrl('');
    setNewMcpToken('');
    setNewMcpAuthType('none');
    setNewMcpTransport('streamablehttp');
    setNewMcpCommand('');
    setShowAddMcpForm(false);
  }, [newMcpName, newMcpUrl, newMcpToken, newMcpAuthType, newMcpTransport, newMcpCommand]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('views.integrations.title')}</h1>
          <p>{t('views.integrations.subtitle')}</p>
        </div>
      </div>

      <div className="integrations-section">
        <div className="integration-card">
          <div className="integration-header">
            <BrainCircuit size={24} className="integration-icon" />
            <div className="integration-title-wrap">
              <h3>{t('views.integrations.aiConfigTitle')}</h3>
              <p>{t('views.integrations.aiConfigSubtitle')}</p>
            </div>
          </div>

          <div className="integration-form">
            <div className="form-group">
              <label>{t('views.integrations.aiProviderLabel')}</label>
              <select className="integration-select" value={provider} onChange={handleProviderChange}>
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(`views.integrations.providers.${p.id}`)}
                  </option>
                ))}
              </select>
              <span className="help-text">{t('views.integrations.aiProviderHelp')}</span>
            </div>

            <div className="form-group">
              <label>{t('views.integrations.baseUrlLabel')}</label>
              <input
                type="text"
                placeholder={effectiveDefaultBaseUrl}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="integration-input"
              />
              <span className="help-text">{t('views.integrations.baseUrlHelp', { url: effectiveDefaultBaseUrl })}</span>
            </div>

            <div className="form-group">
              <label>{t('views.integrations.apiKeyLabel')}</label>
              <div className="input-with-icon">
                <input
                  type={showApiKey ? "text" : "password"}
                  placeholder={t('views.integrations.apiKeyPlaceholder')}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="integration-input"
                />
                <button 
                  className="toggle-visibility" 
                  onClick={() => setShowApiKey(!showApiKey)}
                  type="button"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <span className="help-text">{t('views.integrations.apiKeyHelp')}</span>
            </div>

            <div className="form-group">
              <label>{t('views.integrations.modelNameLabel')}</label>
              <div className="model-combobox" ref={modelDropdownRef}>
                <div className="model-combobox-input-wrap">
                  <input
                    type="text"
                    placeholder={t('views.integrations.modelNamePlaceholder')}
                    value={modelName}
                    onChange={handleModelInputChange}
                    onFocus={handleModelFocus}
                    className="integration-input model-combobox-input"
                  />
                  {fetchingModels ? (
                    <RefreshCw size={14} className="spinning model-combobox-icon" />
                  ) : (
                    <>
                      {modelName && (
                        <X
                          size={14}
                          className="model-combobox-icon model-combobox-clear"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setModelName('');
                            setShowModelDropdown(true);
                          }}
                        />
                      )}
                      <ChevronDown
                        size={14}
                        className="model-combobox-icon model-combobox-chevron"
                        onMouseDown={handleChevronMouseDown}
                      />
                    </>
                  )}
                </div>
                {showModelDropdown && (() => {
                  const combined = new Set<string>();
                  if (modelName) combined.add(modelName);
                  availableModels.forEach((m) => combined.add(m));
                  const query = modelName.toLowerCase();
                  const filtered = Array.from(combined)
                    .filter((m) => m.toLowerCase().includes(query))
                    .sort();
                  if (filtered.length === 0) return null;
                  return (
                    <ul className="model-dropdown">
                      {filtered.map((m) => (
                        <li
                          key={m}
                          className={`model-dropdown-item${m === modelName ? ' selected' : ''}`}
                          onClick={() => { setModelName(m); setShowModelDropdown(false); }}
                        >
                          {m}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
              {fetchModelsError && (
                <span className="help-text" style={{ color: '#ff6e6e' }}>{fetchModelsError}</span>
              )}
              <span className="help-text">{t('views.integrations.modelNameHelp')}</span>
            </div>

            <div className="form-group">
              <label>{t('views.integrations.customInstructionsLabel')}</label>
              <div className="instructions-row">
                <div className="instructions-textarea-wrapper">
                  <div 
                    className={`instructions-summary-box ${isInstructionsExpanded ? 'expanded' : ''}`}
                    onClick={() => instructions && setIsInstructionsExpanded(!isInstructionsExpanded)}
                    style={{ cursor: instructions ? 'pointer' : 'default' }}
                  >
                    <span>
                      {instructions 
                        ? t('views.integrations.customInstructionsSummaryWithCount', { count: instructions.length })
                        : t('views.integrations.customInstructionsSummaryEmpty')}
                    </span>
                    {instructions && (
                      <span className="chevron-icon">
                        {isInstructionsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    )}
                  </div>
                  {isInstructionsExpanded && instructions && (
                    <textarea 
                      className="integration-textarea instructions-preview" 
                      readOnly
                      value={instructions}
                    />
                  )}
                </div>
                <button 
                  className="btn-outlined btn-manage"
                  onClick={handleOpenModal}
                >
                  <FileText size={16} /> {t('views.integrations.customInstructionsManage')}
                </button>
              </div>
              <span className="help-text">{t('views.integrations.customInstructionsHelp')}</span>
            </div>

            <div className="integration-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button 
                className="btn-filled-light" 
                disabled={!apiKey && currentProvider.requiresApiKey}
                onClick={handleSave}
              >
                <Settings2 size={16} /> {t('views.integrations.saveAiConfigButton')}
              </button>
              <button 
                className="btn-filled-light" 
                disabled={testing || (!apiKey && currentProvider.requiresApiKey)}
                onClick={handleTestConnection}
              >
                {testing ? <RefreshCw size={16} className="spinning" /> : <Zap size={16} />} {t('views.integrations.testConnectionButton')}
              </button>
              {saveStatus && <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{saveStatus}</span>}
              {testResult && (
                <span className={`test-result test-result-${testResult.type}`}>
                  {testResult.type === 'success' ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {testResult.message}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MCP 服务配置 */}
      <div className="integrations-section">
        <div className="integration-card">
          <div className="integration-header">
            <Server size={24} className="integration-icon" />
            <div className="integration-title-wrap">
              <h3>{t('views.integrations.mcpConfigTitle', 'MCP 服务')}</h3>
              <p>{t('views.integrations.mcpConfigSubtitle', '配置 AI 助手可使用的 MCP 工具服务')}</p>
            </div>
          </div>

          <div className="mcp-servers-list">
            {mcpServers.map((server) => (
              <McpServerCard
                key={server.id}
                config={server}
                onUpdate={handleUpdateMcpServer}
                onDelete={server.type === 'custom' ? handleDeleteMcpServer : undefined}
                t={t}
              />
            ))}
          </div>

          {!showAddMcpForm ? (
            <button
              className="btn-outlined mcp-add-btn"
              onClick={() => setShowAddMcpForm(true)}
            >
              <Plus size={16} />
              {t('views.integrations.addMcpServer', '添加 MCP 服务')}
            </button>
          ) : (
            <div className="mcp-add-form">
              <h4>{t('views.integrations.addMcpFormTitle', '添加自定义 MCP 服务')}</h4>
              <div className="form-group">
                <label>{t('views.integrations.mcpTransportLabel', '传输类型')}</label>
                <select
                  className="integration-select"
                  value={newMcpTransport}
                  onChange={(e) => setNewMcpTransport(e.target.value as 'streamablehttp' | 'sse' | 'stdio')}
                >
                  <option value="streamablehttp">Streamable HTTP</option>
                  <option value="sse">SSE</option>
                  <option value="stdio">Stdio</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('views.integrations.mcpNameLabel', '名称')}</label>
                <input
                  type="text"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder={t('views.integrations.mcpNamePlaceholder', '例如：我的 MCP')}
                  className="integration-input"
                />
              </div>
              {newMcpTransport === 'stdio' ? (
                <div className="form-group">
                  <label>{t('views.integrations.mcpCommandLabel', '命令')}</label>
                  <input
                    type="text"
                    value={newMcpCommand}
                    onChange={(e) => setNewMcpCommand(e.target.value)}
                    placeholder={t('views.integrations.mcpCommandPlaceholder', '例如：npx -y @modelcontextprotocol/server-sqlite')}
                    className="integration-input"
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label>{t('views.integrations.mcpUrlLabel', '端点 URL')}</label>
                  <input
                    type="text"
                    value={newMcpUrl}
                    onChange={(e) => setNewMcpUrl(e.target.value)}
                    placeholder={t('views.integrations.mcpUrlPlaceholder', '例如：http://localhost:8080/api/v1/mcp')}
                    className="integration-input"
                  />
                </div>
              )}
              <div className="form-group">
                <label>{t('views.integrations.mcpAuthLabel', '认证方式')}</label>
                <select
                  className="integration-select"
                  value={newMcpAuthType}
                  onChange={(e) => setNewMcpAuthType(e.target.value as 'bearer' | 'none')}
                >
                  <option value="none">{t('views.integrations.mcpAuthNone', '无认证')}</option>
                  <option value="bearer">{t('views.integrations.mcpAuthBearer', 'Bearer Token')}</option>
                </select>
              </div>
              {newMcpAuthType === 'bearer' && (
                <div className="form-group">
                  <label>{t('views.integrations.mcpTokenLabel', 'Token')}</label>
                  <input
                    type="password"
                    value={newMcpToken}
                    onChange={(e) => setNewMcpToken(e.target.value)}
                    placeholder={t('views.integrations.mcpTokenPlaceholder', '输入 Bearer Token')}
                    className="integration-input"
                  />
                </div>
              )}
              <div className="mcp-add-form-actions">
                <button className="btn-text" onClick={() => setShowAddMcpForm(false)}>
                  {t('common.cancel', '取消')}
                </button>
                <button
                  className="btn-filled-light"
                  disabled={
                    !newMcpName.trim() ||
                    (newMcpTransport === 'stdio'
                      ? !newMcpCommand.trim()
                      : !newMcpUrl.trim())
                  }
                  onClick={handleAddMcpServer}
                >
                  {t('views.integrations.addMcpServerConfirm', '添加')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="instructions-modal-content">
            <div className="modal-header">
              <div>
                <h3>{t('views.integrations.modalTitle')}</h3>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
                  {t('views.integrations.modalDescription')}
                </p>
              </div>
              <button className="icon-btn-bordered" onClick={() => setIsModalOpen(false)} style={{ border: 'none', background: 'transparent' }}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-tabs">
              <button 
                className={`tab-btn ${activeTab === 'instructions' ? 'active' : ''}`}
                onClick={() => setActiveTab('instructions')}
              >
                {t('views.integrations.modalTabInstructions')}
              </button>
              <button 
                className={`tab-btn ${activeTab === 'template' ? 'active' : ''}`}
                onClick={() => setActiveTab('template')}
              >
                {t('views.integrations.modalTabTemplate')}
              </button>
            </div>

            <div className="modal-body">
              {activeTab === 'instructions' ? (
                <textarea
                  className="modal-textarea"
                  placeholder={t('views.integrations.modalTextareaPlaceholder')}
                  value={modalInstructions}
                  onChange={(e) => setModalInstructions(e.target.value)}
                />
              ) : (
                <div className="template-preview">
                  <pre>
{EXAMPLE_TEMPLATE}
                  </pre>
                </div>
              )}
            </div>

            <div className="modal-tab-actions" style={{ padding: '0 24px 16px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
              {activeTab === 'instructions' ? (
                <>
                  <input
                    ref={instructionsFileInputRef}
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    style={{ display: 'none' }}
                    onChange={handleInstructionsFileChange}
                  />
                  <button className="btn-outlined btn-small" type="button" onClick={() => setModalInstructions('')}>
                    <FileText size={14} /> {t('views.integrations.clearButton')}
                  </button>
                  <button
                    type="button"
                    className="btn-outlined btn-small"
                    onClick={() => instructionsFileInputRef.current?.click()}
                  >
                    <Upload size={14} /> {t('views.integrations.uploadButton')}
                  </button>
                  {instructionsUploadError && (
                    <span style={{ color: '#ff6e6e', fontSize: '13px', width: '100%' }}>{instructionsUploadError}</span>
                  )}
                </>
              ) : (
                <button
                  className="btn-outlined btn-small"
                  onClick={handleUseTemplate}
                  style={{ color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}
                >
                  {t('views.integrations.useTemplateButton')}
                </button>
              )}
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-surface)' }}>
              <button className="btn-text" onClick={() => setIsModalOpen(false)}>{t('common.cancel')}</button>
              <button className="btn-filled-light" onClick={handleSaveModal}>
                {t('views.integrations.saveInstructionsButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Integrations;
