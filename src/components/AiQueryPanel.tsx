import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Plus, Trash2, Sparkles, X, AlertTriangle, History, MessageSquare, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import { aiFetch } from '../utils/server';
import { copyToClipboard } from '../utils/clipboard';
import { uid } from '../utils/id';
import type { ChatMessage } from './AiMessage';
import AiMessage from './AiMessage';
import './AiQueryPanel.css';

/** 已保存的对话历史 */
interface SavedConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const HISTORY_KEY = 'iotedge-ai-conversations';
const MAX_HISTORY = 50;

function loadHistory(): SavedConversation[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: SavedConversation[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function formatTime(ts: number, t: (key: string, options?: any) => string): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return t('ai.justNow');
  if (diff < 3600000) return t('ai.minutesAgo', { count: Math.floor(diff / 60000) });
  if (diff < 86400000) return t('ai.hoursAgo', { count: Math.floor(diff / 3600000) });
  return `${d.getMonth() + 1}/${d.getDate()} ${
    String(d.getHours()).padStart(2, '0')
  }:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface AiQueryPanelProps {
  open: boolean;
  onClose: () => void;
  selectedDb: string;
  databases: Array<{ name: string; measurement_count: number }>;
  tableSchemas: Record<string, { tags: string[]; fields: string[]; types?: Record<string, string> }>;
  measurements: Array<{ name: string }>;
  /** 将 SQL 插入到当前编辑器 Tab */
  onInsertToEditor: (sql: string) => void;
  /** 将 SQL 插入编辑器并自动执行 */
  onRunQuery: (sql: string) => void;
  /** 通知父组件切换查询模式为 SQL */
  onSwitchToSqlMode?: () => void;
  /** 编辑器当前 SQL，用于 diff 对比 */
  editorSql?: string;
  /** 接受 AI 建议的 SQL */
  onAcceptSql?: (sql: string) => void;
  /** 当用户点击编辑器中的 AI 按钮时触发的预设问题（直接发送） */
  presetQuestion?: string;
  /** 预设输入文本（仅填入输入框，不发送） */
  presetInput?: string;
  /** SQL 引用上下文（作为附件展示，不占输入框，随消息发送） */
  sqlContext?: string;
  /** 清除 SQL 上下文回调 */
  onClearSqlContext?: () => void;
  /** 错误引用上下文（作为附件展示，不占输入框，随消息发送） */
  errorContext?: string;
  /** 清除错误上下文回调 */
  onClearErrorContext?: () => void;
  /** 跳转到应用集成页面（AI 连接失败时使用） */
  onNavigateToIntegrations?: () => void;
}

interface ProviderConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  customInstructions: string;
}

/** 读取 AI 提供商配置 */
function getProviderConfig(): ProviderConfig {
  return {
    provider: localStorage.getItem('iotedge-ai-provider') || 'lmstudio',
    apiKey: localStorage.getItem('iotedge-ai-apikey') || '',
    baseUrl: localStorage.getItem('iotedge-ai-baseurl') || 'http://localhost:1234/v1',
    model: localStorage.getItem('iotedge-ai-model') || '',
    customInstructions: localStorage.getItem('iotedge-ai-instructions') || '',
  };
}

/** 获取默认模型 ID */
function getDefaultModelId(provider: string): string {
  const map: Record<string, string> = {
    openai: 'gpt-5.5',
    qwen: 'qwen3.7-max',
    deepseek: 'deepseek-v4-flash',
    zhipu: 'glm-5.2',
    moonshot: 'kimi-k2.7-code',
    doubao: 'doubao-pro-32k',
    'tencent-hunyuan': 'hunyuan-turbos-latest',
    'baidu-qianfan': 'ernie-4.0',
    'iflytek-spark': '4.0Ultra',
  };
  return map[provider] || 'local-model';
}

/** 构建系统提示词 */
function buildSystemPrompt(
  selectedDb: string,
  databases: AiQueryPanelProps['databases'],
  tableSchemas: AiQueryPanelProps['tableSchemas'],
  measurements: AiQueryPanelProps['measurements'],
  customInstructions: string
): string {
  const dbList = databases.map(d => d.name).join(', ');
  let schemaDesc = '';
  for (const m of measurements) {
    const s = tableSchemas[m.name];
    if (s) {
      schemaDesc += `\n- ${m.name}: tags=[${s.tags.join(', ')}], fields=[${s.fields.join(', ')}]`;
    } else {
      schemaDesc += `\n- ${m.name}: schema unknown`;
    }
  }

  return [
    `You are an AI SQL assistant for IotEdge DB (DuckDB / InfluxDB SQL compatible).`,
    ``,
    `## Your capabilities:`,
    `1. Generate SELECT SQL queries from natural language questions`,
    `2. Explain and optimize existing SQL queries`,
    `3. Help analyze query results when provided`,
    ``,
    `## Important rules:`,
    `- ONLY output SELECT statements. Never output INSERT/UPDATE/DELETE/DDL.`,
    `- When a query uses a SINGLE table (no JOIN), do NOT prefix column names with the table name.`,
    `  Example: write \`AVG(usage)\` not \`AVG(cpu.usage)\`.`,
    `- Always include a time filter using \`time >= now() - interval '...' \` unless user specifies otherwise.`,
    `- Default to \`LIMIT 1000\` unless user specifies a different limit.`,
    `- Format SQL nicely with proper indentation.`,
    `- When explaining results, be concise and highlight key insights.`,
    ``,
    `## Current database context:`,
    `- Selected database: ${selectedDb}`,
    `- Available databases: ${dbList}`,
    `- Tables in ${selectedDb}:${schemaDesc || ' (none)'}`,
    ``,
    customInstructions ? `## User custom instructions:\n${customInstructions}\n` : '',
    ``,
    `## Response format:`,
    `- When providing SQL, wrap it in \`\`\`sql code blocks`,
    `- Before the SQL, briefly explain what the query does`,
    `- After the SQL, mention any assumptions or caveats`,
    `- Use markdown formatting for readability`,
    `- Keep explanations concise (2-4 sentences max)`,
  ].join('\n');
}

const AiQueryPanel: React.FC<AiQueryPanelProps> = ({
  open,
  onClose,
  selectedDb,
  databases,
  tableSchemas,
  measurements,
  onInsertToEditor,
  onRunQuery,
  onSwitchToSqlMode,
  editorSql,
  onAcceptSql,
  presetQuestion,
  presetInput,
  sqlContext,
  onClearSqlContext,
  errorContext,
  onClearErrorContext,
  onNavigateToIntegrations,
}) => {
  const { activeServer } = useServers();
  const { t } = useTranslation();

  // ---- State ----
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [animPhase, setAnimPhase] = useState<'entering' | 'open' | 'exiting' | 'hidden'>('hidden');

  // ---- Animation lifecycle ----
  useEffect(() => {
    if (open) {
      setAnimPhase('entering');
      const t = requestAnimationFrame(() => setAnimPhase('open'));
      return () => cancelAnimationFrame(t);
    } else {
      if (animPhase === 'hidden') return;
      setAnimPhase('exiting');
      const timer = setTimeout(() => setAnimPhase('hidden'), 300);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showConfigWarning, setShowConfigWarning] = useState(false);
  const [aiStatus, setAiStatus] = useState<'unknown' | 'checking' | 'ok' | 'failed'>('unknown');
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  // ---- Refs ----
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // ---- Auto scroll to bottom ----
  useEffect(() => {
    const container = inputContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  // ---- Focus textarea on open ----
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 150);
    }
  }, [open]);

  // ---- Auto-save conversation periodically ----
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeConvId || messages.length === 0) return;
    // Debounce save: wait 2s after last message change
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const list = loadHistory();
      const idx = list.findIndex(c => c.id === activeConvId);
      const title = messages.find(m => m.role === 'user')?.content?.slice(0, 40) || t('ai.newConversation');
      const conv: SavedConversation = {
        id: activeConvId,
        title,
        messages,
        createdAt: idx >= 0 ? list[idx].createdAt : Date.now(),
        updatedAt: Date.now(),
      };
      if (idx >= 0) {
        list[idx] = conv;
      } else {
        list.unshift(conv);
      }
      saveHistory(list.slice(0, MAX_HISTORY));
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, activeConvId]);

  // ---- Check AI config & connection status on open ----
  useEffect(() => {
    if (!open) return;
    const config = getProviderConfig();
    if (!config.baseUrl) {
      setShowConfigWarning(true);
      setAiStatus('failed');
      return;
    }
    setAiStatus('checking');
    const controller = new AbortController();
    aiFetch(config.baseUrl, '/chat/completions', {
      apiKey: config.apiKey,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model || getDefaultModelId(config.provider),
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) { setAiStatus('failed'); return; }
      const data = await res.json().catch(() => null);
      setAiStatus(data?.error ? 'failed' : 'ok');
    }).catch(() => setAiStatus('failed'));
    return () => controller.abort();
  }, [open]);

  // ---- Handle preset question from editor (auto-send) ----
  const hasHandledPreset = useRef<string | null>(null);
  useEffect(() => {
    if (open && presetQuestion && presetQuestion.trim() && hasHandledPreset.current !== presetQuestion) {
      hasHandledPreset.current = presetQuestion;
      // 延迟一下确保面板完全打开
      setTimeout(() => {
        setInputValue(presetQuestion);
        // 自动发送预设问题
        const question = presetQuestion.trim();
        const config = getProviderConfig();
        if (!config.baseUrl) {
          setShowConfigWarning(true);
          return;
        }

        const userMsg: ChatMessage = {
          id: uid(),
          role: 'user',
          content: question,
          timestamp: Date.now(),
          status: 'complete',
        };
        const assistantMsg: ChatMessage = {
          id: uid(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          status: 'streaming',
        };

        setMessages(prev => [...prev, userMsg, assistantMsg]);

        const systemPrompt = buildSystemPrompt(
          selectedDb, databases, tableSchemas, measurements, config.customInstructions
        );
        const apiMessages: Array<{ role: string; content: string }> = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ];

        streamResponse(apiMessages, assistantMsg.id);
      }, 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetQuestion]);

  // ---- Handle preset input from editor (fill input only, don't send) ----
  const hasHandledPresetInput = useRef<string | null>(null);
  useEffect(() => {
    if (open && presetInput && presetInput.trim() && hasHandledPresetInput.current !== presetInput) {
      hasHandledPresetInput.current = presetInput;
      setTimeout(() => {
        setInputValue(presetInput);
        textareaRef.current?.focus({ preventScroll: true });
      }, 150);
    }
  }, [open, presetInput]);

  // ---- Streaming logic ----
  const streamResponse = useCallback(async (
    conversationMessages: Array<{ role: string; content: string }>,
    assistantMsgId: string
  ) => {
    if (!activeServer) return;

    const config = getProviderConfig();
    const modelId = config.model || getDefaultModelId(config.provider);
    // 直接调用 AI 提供商的 API，而不是走 IotEdge 数据库服务器

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsStreaming(true);

    try {
      const response = await aiFetch(config.baseUrl, '/chat/completions', {
        apiKey: config.apiKey,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: conversationMessages,
          stream: true,
          temperature: 0,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          response.status === 404
            ? t('ai.apiNotFound', 'AI 服务端点未找到，请检查集成配置')
            : response.status === 401
            ? t('ai.apiUnauthorized', 'API Key 无效，请检查配置')
            : `${response.status} ${response.statusText}${errorText ? ': ' + errorText : ''}`
        );
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let fullReasoning = '';
      let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
      const startTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            // Stream complete
            const duration = (Date.now() - startTime) / 1000;
            const completionTokens = usage?.completion_tokens || 0;
            const totalTokens = usage?.total_tokens || 0;
            const tokensPerSecond = duration > 0 && completionTokens > 0 ? Math.round(completionTokens / duration) : 0;
            setMessages(prev => prev.map(m =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: fullContent,
                    reasoning: fullReasoning || undefined,
                    status: 'complete' as const,
                    meta: { model: modelId, totalTokens, tokensPerSecond },
                  }
                : m
            ));
            setIsStreaming(false);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const reasoningDelta = parsed.choices?.[0]?.delta?.reasoning_content;
            if (reasoningDelta) {
              fullReasoning += reasoningDelta;
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
            }
            if (parsed.usage) {
              usage = parsed.usage;
            }
            if (delta || reasoningDelta) {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, content: fullContent, reasoning: fullReasoning || undefined, status: 'streaming' as const }
                  : m
              ));
            }
          } catch {
            // Ignore malformed JSON in stream chunks
          }
        }
      }

      // If loop exits without [DONE], still mark complete
      {
        const duration = (Date.now() - startTime) / 1000;
        const completionTokens = usage?.completion_tokens || 0;
        const totalTokens = usage?.total_tokens || 0;
        const tokensPerSecond = duration > 0 && completionTokens > 0 ? Math.round(completionTokens / duration) : 0;
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: fullContent,
                reasoning: fullReasoning || undefined,
                status: 'complete' as const,
                meta: { model: modelId, totalTokens, tokensPerSecond },
              }
            : m
        ));
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User cancelled
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, status: 'aborted' as const }
            : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, status: 'error' as const, error: err.message || String(err) }
            : m
        ));
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [activeServer, t]);

  // ---- Send message ----
  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;

    const config = getProviderConfig();
    if (!config.baseUrl) {
      setShowConfigWarning(true);
      return;
    }

    setInputValue('');

    if (!activeConvId) {
      setActiveConvId(uid());
    }

    // Combine user question with SQL context and error context if present
    const currentSqlContext = sqlContext;
    const currentErrorContext = errorContext;
    const userContent = trimmed;

    // Clear contexts after sending
    if (currentSqlContext) {
      onClearSqlContext?.();
    }
    if (currentErrorContext) {
      onClearErrorContext?.();
    }

    // Add user message
    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
      status: 'complete',
      sqlContext: currentSqlContext,
      errorContext: currentErrorContext,
    };

    // Prepare assistant placeholder
    const assistantMsg: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);

    // Build conversation for API (last 20 messages for context)
    const systemPrompt = buildSystemPrompt(
      selectedDb,
      databases,
      tableSchemas,
      measurements,
      config.customInstructions
    );

    const apiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Include recent history
    const recentMessages = [...messages, userMsg].slice(-20);
    for (const msg of recentMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        let content = msg.content;
        // Append SQL and/or error context if this user message has them
        if (msg.role === 'user' && (msg.sqlContext || msg.errorContext)) {
          const parts: string[] = [];
          if (msg.sqlContext) {
            parts.push(`[SQL 上下文]:\n\`\`\`sql\n${msg.sqlContext}\n\`\`\``);
          }
          if (msg.errorContext) {
            parts.push(`[错误信息]:\n\`\`\`\n${msg.errorContext}\n\`\`\``);
          }
          content = `${parts.join('\n\n')}\n\n[用户问题]:\n${content}`;
        }
        apiMessages.push({
          role: msg.role,
          content,
        });
      }
    }

    await streamResponse(apiMessages, assistantMsg.id);
  }, [inputValue, isStreaming, selectedDb, databases, tableSchemas, measurements, messages, streamResponse, sqlContext, onClearSqlContext, activeConvId]);

  // ---- Stop generation ----
  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // ---- Retry last message ----
  const handleRetry = useCallback(async () => {
    if (messages.length < 2) return;

    // Remove the failed assistant message
    setMessages(prev => {
      const updated = prev.slice(0, -1);
      const lastUserMsg = updated[updated.length - 1];
      if (!lastUserMsg || lastUserMsg.role !== 'user') return prev;

      // Re-create assistant placeholder
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'streaming',
      };

      const config = getProviderConfig();
      const systemPrompt = buildSystemPrompt(
        selectedDb, databases, tableSchemas, measurements, config.customInstructions
      );

      const apiMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
      ];
      const recentMessages = updated.slice(-20);
      for (const msg of recentMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          let content = msg.content;
          if (msg.role === 'user' && (msg.sqlContext || msg.errorContext)) {
            const parts: string[] = [];
            if (msg.sqlContext) {
              parts.push(`[SQL 上下文]:\n\`\`\`sql\n${msg.sqlContext}\n\`\`\``);
            }
            if (msg.errorContext) {
              parts.push(`[错误信息]:\n\`\`\`\n${msg.errorContext}\n\`\`\``);
            }
            content = `${parts.join('\n\n')}\n\n[用户问题]:\n${content}`;
          }
          apiMessages.push({ role: msg.role, content });
        }
      }

      streamResponse(apiMessages, assistantMsg.id);
      return [...updated, assistantMsg];
    });
  }, [messages, selectedDb, databases, tableSchemas, measurements, streamResponse]);

  // ---- Edit & resend a user message ----
  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    const trimmed = newContent.trim();
    if (!trimmed || isStreaming) return;

    const config = getProviderConfig();
    if (!config.baseUrl) {
      setShowConfigWarning(true);
      return;
    }

    const editIdx = messages.findIndex(m => m.id === messageId);
    if (editIdx < 0) return;

    const keptMessages = messages.slice(0, editIdx);
    const originalSqlContext = messages[editIdx].sqlContext;
    const originalErrorContext = messages[editIdx].errorContext;

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      status: 'complete',
      sqlContext: originalSqlContext,
      errorContext: originalErrorContext,
    };

    const assistantMsg: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    };

    setMessages([...keptMessages, userMsg, assistantMsg]);

    const systemPrompt = buildSystemPrompt(selectedDb, databases, tableSchemas, measurements, config.customInstructions);
    const apiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    const recentMessages = [...keptMessages, userMsg].slice(-20);
    for (const msg of recentMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        let content = msg.content;
        if (msg.role === 'user' && (msg.sqlContext || msg.errorContext)) {
          const parts: string[] = [];
          if (msg.sqlContext) {
            parts.push(`[SQL 上下文]:\n\`\`\`sql\n${msg.sqlContext}\n\`\`\``);
          }
          if (msg.errorContext) {
            parts.push(`[错误信息]:\n\`\`\`\n${msg.errorContext}\n\`\`\``);
          }
          content = `${parts.join('\n\n')}\n\n[用户问题]:\n${content}`;
        }
        apiMessages.push({ role: msg.role, content });
      }
    }

    await streamResponse(apiMessages, assistantMsg.id);
  }, [messages, isStreaming, selectedDb, databases, tableSchemas, measurements, streamResponse]);

  // ---- Copy SQL ----
  const handleCopySql = useCallback(async (sql: string) => {
    await copyToClipboard(sql);
  }, []);

  // ---- Insert SQL to editor ----
  const handleInsertSql = useCallback((sql: string) => {
    onInsertToEditor(sql);
    onSwitchToSqlMode?.();
  }, [onInsertToEditor, onSwitchToSqlMode]);

  // ---- Run SQL (直接后台执行，不修改编辑器) ----
  const handleRunSql = useCallback((sql: string) => {
    onRunQuery(sql);
  }, [onRunQuery]);

  // ---- New conversation ----
  const handleNewConversation = useCallback(() => {
    // 先保存当前对话到历史
    if (activeConvId && messages.length > 0) {
      const list = loadHistory();
      const idx = list.findIndex(c => c.id === activeConvId);
      const title = messages.find(m => m.role === 'user')?.content?.slice(0, 40) || t('ai.newConversation');
      const conv: SavedConversation = {
        id: activeConvId,
        title,
        messages,
        createdAt: idx >= 0 ? list[idx].createdAt : Date.now(),
        updatedAt: Date.now(),
      };
      if (idx >= 0) {
        list[idx] = conv;
      } else {
        list.unshift(conv);
      }
      saveHistory(list.slice(0, MAX_HISTORY));
    }

    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setMessages([]);
    setInputValue('');
    setActiveConvId(null);
  }, [messages, activeConvId]);

  // ---- Clear conversation ----
  const handleClearConversation = useCallback(() => {
    // 从历史中删除当前对话
    if (activeConvId) {
      const list = loadHistory().filter(c => c.id !== activeConvId);
      saveHistory(list);
    }
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setMessages([]);
    setInputValue('');
    setActiveConvId(null);
  }, [activeConvId]);

  // ---- History handlers ----
  const handleToggleHistory = useCallback(() => {
    if (showHistory) {
      setShowHistory(false);
    } else {
      setConversations(loadHistory());
      setShowHistory(true);
    }
  }, [showHistory]);

  const handleLoadConversation = useCallback((conv: SavedConversation) => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setMessages(conv.messages);
    setInputValue('');
    setActiveConvId(conv.id);
    setShowHistory(false);
  }, []);

  const handleDeleteConversation = useCallback((convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const list = loadHistory().filter(c => c.id !== convId);
    saveHistory(list);
    setConversations(list);
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
  }, [activeConvId]);

  // ---- Auto-save on close ----
  const handleClose = useCallback(() => {
    if (activeConvId && messages.length > 0) {
      const list = loadHistory();
      const idx = list.findIndex(c => c.id === activeConvId);
      const title = messages.find(m => m.role === 'user')?.content?.slice(0, 40) || t('ai.newConversation');
      const conv: SavedConversation = {
        id: activeConvId,
        title,
        messages,
        createdAt: idx >= 0 ? list[idx].createdAt : Date.now(),
        updatedAt: Date.now(),
      };
      if (idx >= 0) {
        list[idx] = conv;
      } else {
        list.unshift(conv);
      }
      saveHistory(list.slice(0, MAX_HISTORY));
    }
    onClose();
  }, [messages, activeConvId, onClose]);

  // ---- Suggestion click ----
  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInputValue(suggestion);
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  // ---- Keyboard handling ----
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组词期间的回车不触发发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ---- Auto-resize textarea ----
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  // ---- i18n helper ----
  const tn = useCallback((key: string) => t(key), [t]);

  // Don't render fully hidden
  if (animPhase === 'hidden') return null;

  const hasMessages = messages.length > 0;
  const canSend = inputValue.trim().length > 0 && !isStreaming && aiStatus !== 'failed';

  const welcomeSuggestions = [
    t('ai.suggestion1'),
    t('ai.suggestion2'),
    t('ai.suggestion3'),
    t('ai.suggestion4'),
    t('ai.suggestion5'),
  ];

  return (
    <div className="ai-panel-overlay ai-panel-nonblocking">
      <div className={`ai-panel ai-panel-${animPhase}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="ai-panel-header">
          <div className="ai-panel-title">
            <Sparkles size={18} className="ai-panel-title-icon" />
            <span>{t('ai.panelTitle', 'AI 查询助手')}</span>
            {aiStatus !== 'unknown' && (
              <span
                className={`ai-status-dot ai-status-${aiStatus}`}
                title={
                  aiStatus === 'ok'
                    ? t('ai.statusOk', 'AI 服务连接正常')
                    : aiStatus === 'checking'
                    ? t('ai.statusChecking', '正在检测连接…')
                    : t('ai.statusFailed', 'AI 服务连接失败，点击前往配置')
                }
                onClick={() => { if (aiStatus === 'failed') onNavigateToIntegrations?.(); }}
                style={{ cursor: aiStatus === 'failed' ? 'pointer' : 'default' }}
              />
            )}
          </div>
          <div className="ai-panel-header-actions">
            <button
              className="ai-header-btn"
              onClick={handleToggleHistory}
              title={t('ai.history', '历史记录')}
            >
              <History size={16} />
            </button>
            <button
              className="ai-header-btn"
              onClick={handleNewConversation}
              title={t('ai.newConversation', '新建对话')}
              disabled={!hasMessages && !isStreaming}
            >
              <Plus size={16} />
            </button>
            <button
              className="ai-header-btn"
              onClick={handleClearConversation}
              title={t('ai.clearConversation', '清空对话')}
              disabled={!hasMessages}
            >
              <Trash2 size={16} />
            </button>
            <button
              className="ai-header-btn ai-close-btn"
              onClick={handleClose}
              title={t('common.close', '关闭')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="ai-history-panel">
            <div className="ai-history-header">
              <span>{t('ai.conversationHistory', '历史记录')}</span>
              <button className="ai-history-close" onClick={() => setShowHistory(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="ai-history-list">
              {conversations.length === 0 ? (
                <div className="ai-history-empty">
                  <MessageSquare size={20} />
                  <span>{t('ai.noHistory', '暂无对话记录')}</span>
                </div>
              ) : (
                conversations.map(conv => (
                  <div
                    key={conv.id}
                    className={`ai-history-item ${conv.id === activeConvId ? 'ai-history-item-active' : ''}`}
                    onClick={() => handleLoadConversation(conv)}
                  >
                    <div className="ai-history-item-main">
                      <span className="ai-history-item-title">{conv.title}</span>
                      <span className="ai-history-item-time">{formatTime(conv.updatedAt, t)}</span>
                    </div>
                    <div className="ai-history-item-meta">
                      <span className="ai-history-item-msgs">
                        {t('ai.messages', { count: conv.messages.filter(m => m.role !== 'system').length })}
                      </span>
                      <button
                        className="ai-history-item-delete"
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        title={t('ai.deleteConversation', '删除此对话')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Config warning */}
        {showConfigWarning && (
          <div className="ai-config-warning">
            <AlertTriangle size={16} />
            <span>{t('ai.configWarning', '请先在集成页面配置 AI 服务')}</span>
            <button
              className="ai-config-warning-dismiss"
              onClick={() => setShowConfigWarning(false)}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Database context badge */}
        {selectedDb && (
          <div className="ai-db-badge">
            <span className="ai-db-badge-label">{t('ai.currentDb', '当前数据库')}:</span>
            <span className="ai-db-badge-name">{selectedDb}</span>
            <span className="ai-db-badge-count">
              ({measurements.length} {t('ai.tables', '张表')})
            </span>
          </div>
        )}

        {/* Messages area */}
        <div className="ai-messages-area" ref={inputContainerRef}>
          {!hasMessages ? (
            /* Welcome screen */
            <div className="ai-welcome">
              <div className="ai-welcome-icon">
                <Sparkles size={32} />
              </div>
              <h3 className="ai-welcome-title">{t('ai.welcomeTitle', 'AI 查询助手')}</h3>
              <p className="ai-welcome-desc">
                {selectedDb
                  ? t('ai.welcomeDesc', '用自然语言描述你的查询需求，我将为你生成精确的 SQL。')
                  : t('ai.welcomeNoDb', '请先在左侧选择一个数据库，然后我就可以帮你查询数据了。')}
              </p>

              {selectedDb && (
                <div className="ai-welcome-context">
                  <p>{t('ai.contextInfo', '我可以访问以下数据库表的信息来生成准确的查询：')}</p>
                  <div className="ai-welcome-tables">
                    {measurements.slice(0, 8).map(m => (
                      <span key={m.name} className="ai-table-tag">
                        {m.name}
                        {tableSchemas[m.name] && (
                          <span className="ai-table-tag-cols">
                            ({tableSchemas[m.name].tags.length + tableSchemas[m.name].fields.length})
                          </span>
                        )}
                      </span>
                    ))}
                    {measurements.length > 8 && (
                      <span className="ai-table-tag ai-table-more">
                        +{measurements.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="ai-welcome-suggestions">
                <p className="ai-suggestions-label">
                  {t('ai.tryAsking', '试试这样问我：')}
                </p>
                {welcomeSuggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    className="ai-suggestion-chip"
                    onClick={() => handleSuggestionClick(suggestion)}
                    disabled={!selectedDb}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message list */
            <>
              {messages.map((msg) => (
                <AiMessage
                  key={msg.id}
                  message={msg}
                  onCopySql={handleCopySql}
                  onInsertSql={handleInsertSql}
                  onRunSql={handleRunSql}
                  onRetry={handleRetry}
                  t={tn}
                  editorSql={editorSql}
                  onAcceptSql={onAcceptSql}
                  onEditMessage={handleEditMessage}
                />
              ))}
            </>
          )}
        </div>

        {/* Input area */}
        <div className="ai-composer">
          {aiStatus === 'failed' && (
            <div className="ai-composer-warning" onClick={() => onNavigateToIntegrations?.()}>
              <AlertTriangle size={14} />
              <span>{t('ai.composerConfigHint', 'AI 服务连接失败，点击前往应用集成配置')}</span>
            </div>
          )}
          {/* SQL context chip */}
          {sqlContext && (
            <div className="ai-sql-context-chip">
              <span className="ai-sql-context-icon">
                <Sparkles size={12} />
              </span>
              <code className="ai-sql-context-preview" title={sqlContext}>
                {sqlContext.slice(0, 120)}{sqlContext.length > 120 ? '...' : ''}
              </code>
              <button
                className="ai-sql-context-clear"
                onClick={() => onClearSqlContext?.()}
                title={t('common.clear', '清除')}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {/* Error context chip */}
          {errorContext && (
            <div className="ai-error-context-chip">
              <span className="ai-error-context-icon">
                <AlertTriangle size={12} />
              </span>
              <code className="ai-error-context-preview" title={errorContext}>
                {errorContext.slice(0, 120)}{errorContext.length > 120 ? '...' : ''}
              </code>
              <button
                className="ai-error-context-clear"
                onClick={() => onClearErrorContext?.()}
                title={t('common.clear', '清除')}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="ai-composer-inner">
            <textarea
              ref={textareaRef}
              className="ai-composer-input"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedDb
                  ? t('ai.inputPlaceholder', '描述你想查询的数据... (Enter 发送)')
                  : t('ai.selectDbFirst', '请先选择数据库')
              }
              disabled={isStreaming || !selectedDb || aiStatus === 'failed'}
              rows={1}
            />
            {isStreaming ? (
              <button
                className="ai-send-btn ai-send-btn-stop"
                onClick={handleStopGeneration}
                title={t('ai.stopGenerating', '停止生成')}
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                className={`ai-send-btn ${canSend ? 'active' : ''}`}
                onClick={handleSend}
                disabled={!canSend}
                title={t('ai.send', '发送')}
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiQueryPanel;
