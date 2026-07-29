import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Plus, Trash2, Sparkles, X, AlertTriangle, History, MessageSquare, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import { aiFetch } from '../utils/server';
import { copyToClipboard } from '../utils/clipboard';
import { uid } from '../utils/id';
import { mcpManager, toOpenAiTool, AvailableTool } from '../utils/mcpManager';
import { useChatAutoScroll } from '../hooks/useChatAutoScroll';
import type { ChatMessage, ToolCallRecord } from './AiMessage';
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

/** 原生支持 OpenAI tools 参数的 provider */
const NATIVE_TOOLS_PROVIDERS = new Set([
  'openai', 'qwen', 'deepseek', 'moonshot', 'zhipu', 'doubao', 'tencent-hunyuan', 'custom',
]);

function supportsNativeTools(provider: string): boolean {
  return NATIVE_TOOLS_PROVIDERS.has(provider);
}

/** 构建 MCP 工具描述文本（注入 system prompt；硬约束防幻觉） */
function buildToolsPromptSection(tools: AvailableTool[]): string {
  const connectedNames = mcpManager.getConnectedServerNames();

  if (tools.length === 0 || connectedNames.length === 0) {
    return [
      '',
      '## MCP / 工具（权威状态，必须遵守）',
      'RUNTIME_MCP_STATUS: NONE_CONNECTED',
      '当前已连接 MCP 服务数量: 0',
      '当前可用工具数量: 0',
      '',
      '硬性规则：',
      '1. 若用户问「支持哪些 MCP / 有哪些工具」，必须回答：当前没有任何已连接的 MCP 服务。',
      '2. 引导用户到「应用集成」页面手动点击「连接」后再使用。',
      '3. 绝对禁止编造、猜测、回忆或列举任何 MCP 服务名或工具名。',
      '4. 即使你曾在历史对话里见过某些 MCP，也一律视为无效。',
      '',
    ].join('\n');
  }

  const byServer = new Map<string, AvailableTool[]>();
  for (const t of tools) {
    const list = byServer.get(t.serverName) || [];
    list.push(t);
    byServer.set(t.serverName, list);
  }
  const serverLines = Array.from(byServer.entries()).map(
    ([name, list]) => `- ${name}（${list.length} 个工具）`
  );
  const toolLines = tools.map((t) =>
    `- [${t.serverName}] ${t.toolName}: ${t.description || '(无描述)'}`
  );
  return [
    '',
    '## MCP / 工具（权威状态，必须遵守）',
    `RUNTIME_MCP_STATUS: CONNECTED`,
    `当前已连接 MCP 服务: ${connectedNames.join(', ')}`,
    `当前可用工具数量: ${tools.length}`,
    '',
    '已连接服务列表（仅可回答这些）：',
    ...serverLines,
    '',
    '可用工具列表（仅可调用这些）：',
    ...toolLines,
    '',
    '硬性规则：',
    '1. 若用户问支持哪些 MCP，只能列出上面「已连接服务列表」。',
    '2. 禁止列举任何不在列表中的 MCP 或工具。',
    '3. 调用工具前先判断是否真的需要。',
    '',
  ].join('\n');
}

/** 降级模式：从 LLM 文本输出中解析工具调用 JSON */
function parsePromptToolCalls(
  text: string,
  tools: AvailableTool[]
): Array<{ id: string; toolUid: string; args: Record<string, unknown> }> {
  const results: Array<{ id: string; toolUid: string; args: Record<string, unknown> }> = [];
  // 匹配 ```json ... ``` 或裸 JSON 对象，含 "tool" / "name" 字段
  const jsonRegex = /```(?:json)?\s*([\s\S]*?)```|(\{[^{}]*"tool"[\s\S]*?\})/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = jsonRegex.exec(text)) !== null) {
    const raw = (m[1] || m[2] || '').trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      const name = obj.tool || obj.name;
      if (!name) continue;
      // 支持用户写 serverName.toolName 或直接 uid
      const matched = tools.find(
        (t) => t.uid === name || `${t.serverName}.${t.toolName}` === name || t.toolName === name
      );
      if (!matched) continue;
      const args = (obj.args || obj.arguments || obj.parameters || {}) as Record<string, unknown>;
      results.push({ id: `prompt_call_${idx++}`, toolUid: matched.uid, args });
    } catch {
      /* ignore malformed */
    }
  }
  return results;
}

interface StreamChunk {
  content: string;
  reasoning: string;
  toolCalls: Array<{
    id: string;
    toolUid: string;
    args: Record<string, unknown>;
  }>;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

/** 读取流式响应，聚合 content / reasoning / tool_calls */
async function readStream(
  response: Response,
  onChunk: (chunk: { content: string; reasoning: string }) => void,
  signal: AbortSignal
): Promise<StreamChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let fullReasoning = '';
  const toolCallMap = new Map<number, { id: string; toolUid: string; argsStr: string }>();
  let usage: StreamChunk['usage'] = null;

  while (true) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
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
        const toolCalls = Array.from(toolCallMap.values()).map((tc) => {
          let args: Record<string, unknown> = {};
          try {
            args = tc.argsStr ? JSON.parse(tc.argsStr) : {};
          } catch {
            /* ignore */
          }
          return { id: tc.id, toolUid: tc.toolUid, args };
        });
        return { content: fullContent, reasoning: fullReasoning, toolCalls, usage };
      }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        const reasoningDelta = delta?.reasoning_content;
        if (reasoningDelta) fullReasoning += reasoningDelta;
        const contentDelta = delta?.content;
        if (contentDelta) {
          fullContent += contentDelta;
          onChunk({ content: fullContent, reasoning: fullReasoning });
        }
        // 原生 tool_calls 流式片段
        const tcs = delta?.tool_calls;
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const idx: number = tc.index ?? 0;
            const existing = toolCallMap.get(idx);
            const fn = tc.function || {};
            if (!existing) {
              toolCallMap.set(idx, {
                id: tc.id || `call_${idx}`,
                toolUid: fn.name || '',
                argsStr: fn.arguments || '',
              });
            } else {
              if (fn.name) existing.toolUid = fn.name;
              if (fn.arguments) existing.argsStr += fn.arguments;
            }
          }
        }
        if (parsed.usage) usage = parsed.usage;
      } catch {
        /* ignore malformed JSON */
      }
    }
  }

  const toolCalls = Array.from(toolCallMap.values()).map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = tc.argsStr ? JSON.parse(tc.argsStr) : {};
    } catch {
      /* ignore */
    }
    return { id: tc.id, toolUid: tc.toolUid, args };
  });
  return { content: fullContent, reasoning: fullReasoning, toolCalls, usage };
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

  // 对话列表滚动（useChatAutoScroll）：contentKey 跟最新一条变化；中间增高靠 ResizeObserver
  const lastMsg = messages[messages.length - 1];
  const chatScrollKey = `${messages.length}:${lastMsg?.id ?? ''}:${lastMsg?.content?.length ?? 0}:${lastMsg?.status ?? ''}:${lastMsg?.toolCalls?.length ?? 0}:${isStreaming}`;
  const {
    scrollerRef,
    setContentNode,
    showJumpToBottom,
    onScroll: onChatScroll,
    onWheel: onChatWheel,
    onTouchStart: onChatTouchStart,
    onTouchMove: onChatTouchMove,
    jumpToBottom,
    enableStick,
  } = useChatAutoScroll(chatScrollKey);

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
        // 未选数据库：只填入输入框，不自动发送
        if (!selectedDb) {
          return;
        }
        // 自动发送预设问题
        const question = presetQuestion.trim();
        const config = getProviderConfig();
        if (!config.baseUrl) {
          setShowConfigWarning(true);
          return;
        }

        // 新一轮生成：开启自动滚底
        enableStick();

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
        const apiMessages: Array<Record<string, unknown>> = [
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

  // ---- 引用错误时：输入框默认填入分析提示（错误本身在 chip 附件里，不占输入框） ----
  const hasFilledErrorPrompt = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !errorContext?.trim()) {
      if (!errorContext) hasFilledErrorPrompt.current = null;
      return;
    }
    // 同一条错误只自动填一次；用户已输入则不覆盖
    if (hasFilledErrorPrompt.current === errorContext) return;
    hasFilledErrorPrompt.current = errorContext;
    setInputValue((prev) => {
      if (prev.trim()) return prev;
      return t(
        'ai.errorFixPrompt',
        '请分析这个 SQL 错误的原因，并给出修复后的完整 SQL。'
      );
    });
    setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 100);
  }, [open, errorContext, t]);

  // ---- Streaming logic ----
  // conversationMessages 支持原生 tool calling 的完整消息格式
  const streamResponse = useCallback(async (
    conversationMessagesIn: Array<Record<string, unknown>>,
    assistantMsgId: string
  ) => {
    if (!activeServer) return;

    const config = getProviderConfig();
    const modelId = config.model || getDefaultModelId(config.provider);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);

    // 只使用「当前已连接」的 MCP 工具，绝不自动连接任何服务。
    // 否则 AI 一对话就会把 enabled 的服务全部连上，覆盖用户的断开操作。
    // 用户需在「应用集成」页手动连接后，工具才会出现在这里。
    const availableTools: AvailableTool[] = mcpManager.getAvailableTools();
    const nativeTools = supportsNativeTools(config.provider) && availableTools.length > 0;
    const openaiTools = nativeTools ? availableTools.map(toOpenAiTool) : undefined;

    // 注入工具提示到 system 消息（始终注入，无工具时明确告知「没有已连接的 MCP」）
    let conversationMessages = [...conversationMessagesIn];
    const toolsPrompt = buildToolsPromptSection(availableTools);
    if (conversationMessages.length > 0 && conversationMessages[0].role === 'system') {
      const sysContent = String(conversationMessages[0].content || '');
      const extra =
        nativeTools
          ? toolsPrompt
          : availableTools.length > 0
          ? `${toolsPrompt}\n## 工具调用方式（本模型不支持原生 function calling）\n需要调用工具时，输出如下 JSON 代码块（可多个）：\n\`\`\`json\n{"tool":"<工具名>","args":{...}}\n\`\`\`\n我会执行工具并把结果回传给你，你再继续回答。\n`
          : toolsPrompt;
      conversationMessages[0] = { ...conversationMessages[0], content: sysContent + extra };
    }

    const MAX_TOOL_ROUNDS = 5;
    let allToolRecords: ToolCallRecord[] = [];
    let finalContent = '';
    let finalReasoning = '';
    let totalUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
    const startTime = Date.now();

    const updateMsg = (patch: Partial<ChatMessage>) => {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId ? { ...m, ...patch } as ChatMessage : m
      ));
    };

    // 追加一条工具调用记录并更新 UI
    const appendToolRecord = (rec: ToolCallRecord) => {
      allToolRecords = [...allToolRecords, rec];
      updateMsg({ toolCalls: allToolRecords });
    };
    const updateToolRecord = (recId: string, patch: Partial<ToolCallRecord>) => {
      allToolRecords = allToolRecords.map(r => r.id === recId ? { ...r, ...patch } : r);
      updateMsg({ toolCalls: allToolRecords });
    };

    try {
      // ---- Tool calling 循环 ----
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await aiFetch(config.baseUrl, '/chat/completions', {
          apiKey: config.apiKey,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            messages: conversationMessages,
            stream: true,
            temperature: 0,
            stream_options: { include_usage: true },
            ...(openaiTools ? { tools: openaiTools, tool_choice: 'auto' } : {}),
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

        // 读取流式响应
        const chunk = await readStream(
          response,
          ({ content, reasoning }) => {
            updateMsg({ content, reasoning: reasoning || undefined, status: 'streaming' });
          },
          controller.signal
        );

        finalContent = chunk.content;
        finalReasoning = chunk.reasoning;
        if (chunk.usage) totalUsage = chunk.usage;

        // 解析本轮工具调用
        let toolCallsThisRound: Array<{ id: string; toolUid: string; args: Record<string, unknown> }> = [];

        if (nativeTools) {
          toolCallsThisRound = chunk.toolCalls;
        } else if (availableTools.length > 0) {
          // 降级模式：从文本中解析工具调用 JSON
          toolCallsThisRound = parsePromptToolCalls(chunk.content, availableTools);
          // 如果解析到工具调用，清除文本中的工具调用 JSON 片段，避免展示噪声
          if (toolCallsThisRound.length > 0) {
            finalContent = finalContent
              .replace(/```(?:json)?\s*[\s\S]*?```/g, '')
              .replace(/\{[^{}]*"tool"[\s\S]*?\}/g, '')
              .trim();
            updateMsg({ content: finalContent, status: 'streaming' });
          }
        }

        // 没有工具调用，结束循环
        if (toolCallsThisRound.length === 0) {
          break;
        }

        // 追加 assistant 消息（含 tool_calls）到对话
        if (nativeTools) {
          conversationMessages = [
            ...conversationMessages,
            {
              role: 'assistant',
              content: finalContent || '',
              tool_calls: chunk.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.toolUid, arguments: JSON.stringify(tc.args) },
              })),
            },
          ];
        } else {
          // 降级模式：assistant 文本已经包含工具调用意图，直接追加
          conversationMessages = [
            ...conversationMessages,
            { role: 'assistant', content: finalContent },
          ];
        }

        // 并行执行所有工具调用
        // 选中库由代码注入（参数 + x-iedb-database 头），不依赖模型是否记得传 database
        const toolResults = await Promise.all(
          toolCallsThisRound.map(async (tc) => {
            // 查找工具元信息
            const meta = availableTools.find(t => t.uid === tc.toolUid);
            const recId = uid();
            const rec: ToolCallRecord = {
              id: recId,
              toolUid: tc.toolUid,
              serverName: meta?.serverName || '?',
              toolName: meta?.toolName || tc.toolUid,
              args: tc.args,
              status: 'running',
            };
            appendToolRecord(rec);
            const t0 = Date.now();
            try {
              const result = await mcpManager.callToolByUid(tc.toolUid, tc.args, {
                database: selectedDb,
              });
              const durationMs = Date.now() - t0;
              // 展示实际发出的参数（含注入后的 database）
              updateToolRecord(recId, {
                status: result.ok ? 'success' : 'error',
                args: result.args,
                result: result.text,
                error: result.isError ? result.text : undefined,
                durationMs,
              });
              return { id: tc.id, toolUid: tc.toolUid, content: result.text, isError: result.isError };
            } catch (err: any) {
              const durationMs = Date.now() - t0;
              const errMsg = err?.message || String(err);
              updateToolRecord(recId, { status: 'error', error: errMsg, durationMs });
              return { id: tc.id, toolUid: tc.toolUid, content: `工具调用失败: ${errMsg}`, isError: true };
            }
          })
        );

        // 追加 tool 结果消息
        if (nativeTools) {
          for (const tr of toolResults) {
            conversationMessages = [
              ...conversationMessages,
              { role: 'tool', tool_call_id: tr.id, content: tr.content },
            ];
          }
        } else {
          // 降级模式：把工具结果以 user 消息形式回传
          const resultText = toolResults
            .map(tr => `[工具 ${tr.toolUid} 返回]: ${tr.content}`)
            .join('\n\n');
          conversationMessages = [
            ...conversationMessages,
            { role: 'user', content: `[工具调用结果]\n${resultText}\n\n请根据以上工具返回结果继续回答用户问题。` },
          ];
          // 降级模式下一轮需要清空 finalContent，让模型重新生成
          finalContent = '';
          updateMsg({ content: '', status: 'streaming' });
        }
      }

      // ---- 完成 ----
      const duration = (Date.now() - startTime) / 1000;
      const completionTokens = totalUsage?.completion_tokens || 0;
      const totalTokens = totalUsage?.total_tokens || 0;
      const tokensPerSecond = duration > 0 && completionTokens > 0 ? Math.round(completionTokens / duration) : 0;
      updateMsg({
        content: finalContent,
        reasoning: finalReasoning || undefined,
        status: 'complete',
        toolCalls: allToolRecords.length > 0 ? allToolRecords : undefined,
        meta: { model: modelId, totalTokens, tokensPerSecond },
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        updateMsg({ status: 'aborted' });
      } else {
        updateMsg({ status: 'error', error: err.message || String(err) });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [activeServer, selectedDb, t]);

  // ---- Send message ----
  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;

    // 未选数据库：禁止询问 AI（顶部已有提示）
    if (!selectedDb) return;

    const config = getProviderConfig();
    if (!config.baseUrl) {
      setShowConfigWarning(true);
      return;
    }

    setInputValue('');
    // 用户主动发送：重新开启自动滚底，便于看新回复
    enableStick();

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

    const apiMessages: Array<Record<string, unknown>> = [
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
  }, [inputValue, isStreaming, selectedDb, databases, tableSchemas, measurements, messages, streamResponse, sqlContext, onClearSqlContext, activeConvId, enableStick, errorContext, onClearErrorContext]);

  // ---- Stop generation ----
  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // ---- Retry last message ----
  const handleRetry = useCallback(async () => {
    if (messages.length < 2) return;
    if (!selectedDb) return;

    // 重试视为新一轮生成：重新开启跟滚
    enableStick();

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

      const apiMessages: Array<Record<string, unknown>> = [
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
  }, [messages, selectedDb, databases, tableSchemas, measurements, streamResponse, enableStick]);

  // ---- Edit & resend a user message ----
  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    const trimmed = newContent.trim();
    if (!trimmed || isStreaming) return;

    if (!selectedDb) return;

    const config = getProviderConfig();
    if (!config.baseUrl) {
      setShowConfigWarning(true);
      return;
    }

    // 编辑重发：重新开启跟滚
    enableStick();

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
    const apiMessages: Array<Record<string, unknown>> = [
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
  }, [messages, isStreaming, selectedDb, databases, tableSchemas, measurements, streamResponse, enableStick]);

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
    enableStick();
    setMessages(conv.messages);
    setInputValue('');
    setActiveConvId(conv.id);
    setShowHistory(false);
  }, [enableStick]);

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

  // Don't render fully hidden
  if (animPhase === 'hidden') return null;

  const hasMessages = messages.length > 0;
  const canSend =
    inputValue.trim().length > 0 &&
    !isStreaming &&
    aiStatus !== 'failed' &&
    !!selectedDb;

  const welcomeSuggestions = [
    t('ai.suggestion1'),
    t('ai.suggestion2'),
    t('ai.suggestion3'),
    t('ai.suggestion4'),
    t('ai.suggestion5'),
  ];

  return (
    <div className="ai-panel-overlay">
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
                        {t('ai.messages', { count: conv.messages.length })}
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

        {/* Database context badge / 未选库提示 */}
        {selectedDb ? (
          <div className="ai-db-badge">
            <span className="ai-db-badge-label">{t('ai.currentDb', '当前数据库')}:</span>
            <span className="ai-db-badge-name">{selectedDb}</span>
            <span className="ai-db-badge-count">
              ({measurements.length} {t('ai.tables', '张表')})
            </span>
          </div>
        ) : (
          <div className="ai-config-warning">
            <AlertTriangle size={16} />
            <span>{t('ai.selectDbFirst', '请先选择数据库')}</span>
          </div>
        )}

        {/* Messages area */}
        <div className="ai-messages-area-wrap">
          <div
            className="ai-messages-area"
            ref={scrollerRef}
            onScroll={onChatScroll}
            onWheel={onChatWheel}
            onTouchStart={onChatTouchStart}
            onTouchMove={onChatTouchMove}
          >
            <div className="ai-messages-content" ref={setContentNode}>
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
                    t={t}
                    editorSql={editorSql}
                    onAcceptSql={onAcceptSql}
                    onEditMessage={handleEditMessage}
                  />
                ))}
              </>
            )}
            </div>
          </div>
          {showJumpToBottom && hasMessages && (
            <button
              type="button"
              className="ai-scroll-to-bottom"
              onClick={jumpToBottom}
              title={t('ai.scrollToBottom', '回到底部')}
            >
              ↓ {t('ai.scrollToBottom', '回到底部')}
              {isStreaming ? ` · ${t('ai.thinking', '生成中...')}` : ''}
            </button>
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
              placeholder={t('ai.inputPlaceholder', '描述你想查询的数据... (Enter 发送)')}
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
