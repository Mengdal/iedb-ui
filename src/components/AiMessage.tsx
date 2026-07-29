import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Copy, Code2, Play, Check, Loader2, AlertCircle, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SqlDiffView from './SqlDiffView';
import './AiMessage.css';

/** 翻译回退辅助：有翻译函数时翻译，否则返回默认文本 */
const makeTn = (t?: (key: string) => string) =>
  (key: string, fallback: string): string => t ? t(key) : fallback;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 思考过程（部分模型返回的 reasoning_content） */
  reasoning?: string;
  timestamp: number;
  status?: 'streaming' | 'complete' | 'error' | 'aborted';
  error?: string;
  /** 附加的 SQL 上下文（不显示在消息内容中，发送时附带） */
  sqlContext?: string;
  /** 附加的错误上下文（不显示在消息内容中，发送时附带） */
  errorContext?: string;
  /** 回答元信息：模型、token、速度 */
  meta?: {
    model: string;
    totalTokens?: number;
    tokensPerSecond?: number;
  };
  /** 本轮助手回复过程中的工具调用记录 */
  toolCalls?: ToolCallRecord[];
}

/** 工具调用记录（一次助手回复可能包含多轮工具调用） */
export interface ToolCallRecord {
  id: string;
  /** 工具唯一标识 `${serverId}__${toolName}` */
  toolUid: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
  error?: string;
  durationMs?: number;
}

interface AiMessageProps {
  message: ChatMessage;
  onCopySql: (sql: string) => void;
  onInsertSql: (sql: string) => void;
  onRunSql: (sql: string) => void;
  onRetry: () => void;
  /** 可选：提供 i18n 翻译函数或直接传文本 */
  t?: (key: string) => string;
  /** 编辑器当前 SQL，用于与 AI 建议 SQL 做 diff 对比 */
  editorSql?: string;
  /** 用户接受 AI 的 SQL 变更 */
  onAcceptSql?: (sql: string) => void;
  /** 编辑已发送的用户消息并重新生成 */
  onEditMessage?: (messageId: string, newContent: string) => void;
}

/**
 * 解析消息内容，将纯文本、SQL 代码块、普通代码块分段
 */
const SQL_START_RE = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|EXPLAIN|SHOW|DESCRIBE|GRANT|REVOKE|TRUNCATE|SET|USE|BEGIN|CALL)\b/im;

/** 判断代码内容是否像 SQL 语句 */
function isSqlLike(code: string): boolean {
  return SQL_START_RE.test(code.trim());
}

/** 完整可执行 SQL（以语句关键字开头）；表达式片段不做变更建议 */
function isCompleteSqlStatement(code: string): boolean {
  const body = code
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
    .join('\n');
  return body.length > 0 && SQL_START_RE.test(body);
}

/** 是否像 GFM Markdown 表格（含表头分隔行） */
function isMarkdownTable(text: string): boolean {
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  // 至少两行以 | 开头/包含 |，且有 --- 分隔行
  const pipeLines = lines.filter((l) => l.includes('|'));
  const hasSep = lines.some((l) => /^\|?[\s:|-]+$/.test(l) && l.includes('-'));
  return pipeLines.length >= 2 && hasSep;
}

/**
 * 规范化 Markdown 表格，提高 remark-gfm 识别成功率：
 * - 去掉行首多余缩进
 * - 确保表格块前后有空行
 * - 补齐不完整的分隔行
 */
function normalizeMarkdownTables(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    // 检测表头行：含 | 且下一行是分隔行
    const next = lines[i + 1]?.trim() ?? '';
    const nextIsSep = /^\|?[\s:|-]+$/.test(next) && next.includes('-') && next.includes('|');

    if (trimmed.includes('|') && nextIsSep) {
      // 表格前补空行
      if (out.length > 0 && out[out.length - 1].trim() !== '') {
        out.push('');
      }
      // 收集连续表格行
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (!cur.includes('|') && cur !== '') break;
        if (cur === '') {
          // 表格内空行结束
          break;
        }
        // 保证以 | 开头，便于 GFM 识别
        out.push(cur.startsWith('|') ? cur : `| ${cur}`);
        i++;
        // 下一行不是表格行则结束
        const peek = lines[i]?.trim() ?? '';
        if (peek && !peek.includes('|')) break;
      }
      // 表格后补空行
      if (i < lines.length && lines[i]?.trim() !== '') {
        out.push('');
      }
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join('\n');
}

function parseContent(content: string): Array<{ type: 'text' | 'sql' | 'code'; value: string }> {
  const segments: Array<{ type: 'text' | 'sql' | 'code'; value: string }> = [];
  const codeBlockRegex = /```(\w*)\s*\n?([\s\S]*?)```/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index).trim();
    if (textBefore) {
      segments.push({ type: 'text', value: textBefore });
    }
    const lang = match[1].toLowerCase();
    const code = match[2].trim();
    // 模型常把查询结果表格包进代码块 → 当 Markdown 表格渲染
    if (isMarkdownTable(code) && lang !== 'sql') {
      segments.push({ type: 'text', value: code });
    } else if (lang === 'sql' || (!lang && isSqlLike(code))) {
      segments.push({ type: 'sql', value: code });
    } else if (lang === 'markdown' || lang === 'md') {
      segments.push({ type: 'text', value: code });
    } else {
      segments.push({ type: 'code', value: code });
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  const textAfter = content.slice(lastIndex).trim();
  if (textAfter) {
    segments.push({ type: 'text', value: textAfter });
  }

  // If no code blocks found at all, treat as plain text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', value: content.trim() });
  }

  return segments;
}

/** 使用 react-markdown 统一渲染 Markdown 文本，保持原有 CSS 类名 */
const MarkdownText: React.FC<{ text: string }> = ({ text }) => {
  const normalized = useMemo(() => normalizeMarkdownTables(text), [text]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="ai-md-paragraph">{children}</p>,
        h1: ({ children }) => <h4 className="ai-md-heading">{children}</h4>,
        h2: ({ children }) => <h5 className="ai-md-heading">{children}</h5>,
        h3: ({ children }) => <h6 className="ai-md-heading">{children}</h6>,
        h4: ({ children }) => <h6 className="ai-md-heading">{children}</h6>,
        h5: ({ children }) => <h6 className="ai-md-heading">{children}</h6>,
        h6: ({ children }) => <h6 className="ai-md-heading">{children}</h6>,
        ul: ({ children }) => <ul className="ai-md-list">{children}</ul>,
        ol: ({ children }) => <ol className="ai-md-list">{children}</ol>,
        table: ({ children }) => (
          <div className="ai-md-table-wrap">
            <table className="ai-md-table">{children}</table>
          </div>
        ),
        code: ({ className, children }) => {
          const isBlock = typeof className === 'string' && className.includes('language-');
          if (isBlock) return <code className={className}>{children}</code>;
          return <code className="ai-md-inline-code">{children}</code>;
        },
        pre: ({ children }) => <pre className="ai-md-code-inline">{children}</pre>,
      }}
    >
      {normalized}
    </ReactMarkdown>
  );
};

/**
 * 工具调用卡片 — 复用思考过程 (ai-reasoning) 的 details 折叠样式
 */
const ToolCallCard: React.FC<{
  record: ToolCallRecord;
  t?: (key: string) => string;
}> = ({ record, t: translate }) => {
  const tn = makeTn(translate);
  const isRunning = record.status === 'pending' || record.status === 'running';

  const statusIcon = {
    pending: <Loader2 size={11} className="spin" />,
    running: <Loader2 size={11} className="spin" />,
    success: <Check size={11} />,
    error: <AlertCircle size={11} />,
  }[record.status];

  const statusLabel = {
    pending: tn('ai.toolCalling', '调用中'),
    running: tn('ai.toolCalling', '调用中'),
    success: tn('ai.toolSuccess', '成功'),
    error: tn('ai.toolError', '失败'),
  }[record.status];

  const sections: Array<{ label: string; content: string }> = [];
  if (Object.keys(record.args).length > 0) {
    sections.push({
      label: tn('ai.toolArgs', '参数'),
      content: '```json\n' + JSON.stringify(record.args, null, 2) + '\n```',
    });
  }
  if (record.result) {
    const label = record.status === 'error' ? tn('ai.toolError', '失败') : tn('ai.toolResult', '结果');
    const text = record.result.length > 4000 ? `${record.result.slice(0, 4000)}\n...` : record.result;
    sections.push({ label, content: text });
  } else if (record.error) {
    sections.push({ label: tn('ai.toolError', '失败'), content: record.error });
  }

  return (
    <details className="ai-reasoning ai-tool-call" open={isRunning}>
      <summary className="ai-reasoning-summary">
        <span className="ai-reasoning-label">
          {record.serverName}
          <span className="ai-tool-call-sep">·</span>
          <code className="ai-tool-call-tool-name">{record.toolName}</code>
        </span>
        <span className={`ai-reasoning-meta ai-tool-call-status ai-tool-call-status-${record.status}`}>
          {statusIcon}
          <span>{statusLabel}</span>
          {record.durationMs != null && <span>{record.durationMs}ms</span>}
        </span>
      </summary>
      {sections.length > 0 && (
        <div className="ai-reasoning-content ai-tool-call-body">
          {sections.map((sec, i) => (
            <div key={i} className="ai-tool-call-section">
              <div className="ai-tool-call-section-label">{sec.label}</div>
              <MarkdownText text={sec.content} />
            </div>
          ))}
        </div>
      )}
    </details>
  );
};

/**
 * SQL 代码块操作栏组件
 */
const SqlCodeBlock: React.FC<{
  sql: string;
  onCopy: (sql: string) => void;
  onInsert: (sql: string) => void;
  onRun: (sql: string) => void;
  messageComplete: boolean;
  t?: (key: string) => string;
  /** 编辑器当前 SQL，用于 diff 对比 */
  editorSql?: string;
  /** 接受 AI SQL 变更 */
  onAcceptSql?: (sql: string) => void;
}> = ({ sql, onCopy, onInsert, onRun, messageComplete, t: translate, editorSql, onAcceptSql }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [diffResolved, setDiffResolved] = useState<'none' | 'accepted' | 'rejected'>('none');

  // 重置状态当 SQL 改变时
  const prevSqlRef = useRef(sql);
  useEffect(() => {
    if (prevSqlRef.current !== sql) {
      setDiffResolved('none');
      prevSqlRef.current = sql;
    }
  }, [sql]);

  const handleCopy = useCallback(() => {
    onCopy(sql);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  }, [sql, onCopy]);

  const tn = makeTn(translate);

  // 完整可执行语句才参与「变更建议」；片段只作解释展示
  const isStatement = useMemo(() => isCompleteSqlStatement(sql), [sql]);

  // 判断是否需要显示 diff：完整 SQL + 编辑器有内容且与 AI 不同
  const showDiff = messageComplete
    && isStatement
    && diffResolved === 'none'
    && editorSql
    && editorSql.trim() !== ''
    && editorSql.trim() !== sql.trim();

  const handleAccept = useCallback((newSql: string) => {
    setDiffResolved('accepted');
    onAcceptSql?.(newSql);
  }, [onAcceptSql]);

  const handleReject = useCallback(() => {
    setDiffResolved('rejected');
  }, []);

  return (
    <div className="sql-block-wrapper">
      {/* 仅完整 SQL 且与编辑器不同时显示变更建议 */}
      {showDiff ? (
        <SqlDiffView
          originalSql={editorSql!}
          newSql={sql}
          onAccept={handleAccept}
          onReject={handleReject}
          t={translate}
        />
      ) : (
        <>
          <div className="sql-block-header">
            <span className="sql-block-label">
              {diffResolved === 'accepted' ? '✓ SQL' : isStatement ? 'SQL' : 'SQL 片段'}
            </span>
            <div className="sql-block-actions">
              <button
                className="sql-action-btn"
                onClick={handleCopy}
                title={tn('ai.copySql', '复制 SQL')}
              >
                {copyState === 'copied' ? (
                  <><Check size={14} /><span>{tn('ai.copied', '已复制')}</span></>
                ) : (
                  <><Copy size={14} /><span>{tn('ai.copy', '复制')}</span></>
                )}
              </button>
              {/* 完整语句才提供插入/运行；片段仅复制，避免误替换编辑器 */}
              {messageComplete && isStatement && (
                <>
                  <button
                    className="sql-action-btn"
                    onClick={() => onInsert(sql)}
                    title={tn('ai.insertToEditor', '插入编辑器')}
                  >
                    <Code2 size={14} />
                    <span>{tn('ai.insert', '插入')}</span>
                  </button>
                  <button
                    className="sql-action-btn sql-action-run"
                    onClick={() => onRun(sql)}
                    title={tn('ai.runQuery', '运行查询')}
                  >
                    <Play size={14} />
                    <span>{tn('ai.run', '运行')}</span>
                  </button>
                </>
              )}
            </div>
          </div>
          <pre className="sql-block-code">
            <code>{sql}</code>
          </pre>
        </>
      )}
    </div>
  );
};

const AiMessage: React.FC<AiMessageProps> = ({
  message,
  onCopySql,
  onInsertSql,
  onRunSql,
  onRetry,
  t: translate,
  editorSql,
  onAcceptSql,
  onEditMessage,
}) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isStreaming = message.status === 'streaming';
  const isError = message.status === 'error';
  const isAborted = message.status === 'aborted';
  const isComplete = message.status === 'complete';

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);

  const tn = makeTn(translate);

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    onEditMessage?.(message.id, trimmed);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditText(message.content);
    setIsEditing(false);
  };

  const segments = useMemo(() => {
    if (!isAssistant) return [];
    return parseContent(message.content);
  }, [message.content, isAssistant]);

  return (
    <div className={`ai-message ${isUser ? 'ai-message-user' : 'ai-message-assistant'} ${isError ? 'ai-message-error' : ''}`}>
      {/* Content body — 紧凑纯文本气泡，无头像 */}
      <div className="ai-message-bubble">
        {/* Content area */}
        {isUser ? (
          <>
            {/* 引用内容在编辑态也始终展示，避免「找不到引用」 */}
            {message.sqlContext && (
              <div className="ai-user-sql-context" title={message.sqlContext}>
                <span className="ai-user-sql-label">SQL</span>
                <code className="ai-user-sql-preview">{message.sqlContext.slice(0, 180)}{message.sqlContext.length > 180 ? '...' : ''}</code>
              </div>
            )}
            {message.errorContext && (
              <div className="ai-user-error-context" title={message.errorContext}>
                <span className="ai-user-error-label">Error</span>
                <code className="ai-user-error-preview">{message.errorContext.slice(0, 180)}{message.errorContext.length > 180 ? '...' : ''}</code>
              </div>
            )}
            {isEditing ? (
              <div className="ai-edit-area">
                <textarea
                  className="ai-edit-textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                />
                <div className="ai-edit-actions">
                  <button className="ai-edit-btn ai-edit-save" onClick={handleSaveEdit}>
                    {tn('ai.saveAndSubmit', '保存并提交')}
                  </button>
                  <button className="ai-edit-btn ai-edit-cancel" onClick={handleCancelEdit}>
                    {tn('common.cancel', '取消')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="ai-user-text-wrap">
                <p className="ai-user-text">{message.content}</p>
                {isComplete && onEditMessage && (
                  <button className="ai-edit-trigger" onClick={() => { setEditText(message.content); setIsEditing(true); }} title={tn('ai.editMessage', '编辑')}>
                    <Pencil size={12} />
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* 思考过程（置于回复前，streaming 时展开，完成后默认折叠） */}
            {message.reasoning ? (
              <details className="ai-reasoning" open={isStreaming && !message.content}>
                <summary className="ai-reasoning-summary">
                  <span className="ai-reasoning-label">
                    {isStreaming && !message.content ? (
                      <><Loader2 size={12} className="spin" /> {tn('ai.thinking', '思考中...')}</>
                    ) : (
                      <>{tn('ai.thinkingProcess', '思考过程')}</>
                    )}
                  </span>
                  {isComplete && message.meta && (
                    <span className="ai-reasoning-meta">
                      <Check size={11} className="ai-meta-check" />
                      {message.meta.model && <span>{message.meta.model}</span>}
                      {message.meta.totalTokens ? <span>· {message.meta.totalTokens} tokens</span> : null}
                      {message.meta.tokensPerSecond ? <span>· {message.meta.tokensPerSecond} tok/s</span> : null}
                    </span>
                  )}
                </summary>
                <div className="ai-reasoning-content">{message.reasoning}</div>
              </details>
            ) : (
              isComplete && message.meta && (
                <div className="ai-message-meta">
                  <Check size={11} className="ai-meta-check" />
                  {message.meta.model && <span>{message.meta.model}</span>}
                  {message.meta.totalTokens ? <span>· {message.meta.totalTokens} tokens</span> : null}
                  {message.meta.tokensPerSecond ? <span>· {message.meta.tokensPerSecond} tok/s</span> : null}
                </div>
              )
            )}

            {/* 模型开始思考前的 loading 占位 */}
            {isStreaming && !message.content && !message.reasoning && (!message.toolCalls || message.toolCalls.length === 0) && (
              <div className="ai-thinking">
                <Loader2 size={14} className="spin" />
                <span>{tn('ai.thinking', '思考中...')}</span>
              </div>
            )}

            {/* 工具调用记录 */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="ai-tool-calls">
                {message.toolCalls.map((tc) => (
                  <ToolCallCard key={tc.id} record={tc} t={translate} />
                ))}
              </div>
            )}

            {/* Rendered content */}
            {segments.map((seg, idx) => {
              if (seg.type === 'sql') {
                const blockId = `${message.id}-sql-${idx}`;
                return (
                  <SqlCodeBlock
                    key={blockId}
                    sql={seg.value}
                    onCopy={onCopySql}
                    onInsert={onInsertSql}
                    onRun={onRunSql}
                    messageComplete={isComplete}
                    t={translate}
                    editorSql={editorSql}
                    onAcceptSql={onAcceptSql}
                  />
                );
              }
              if (seg.type === 'code') {
                return (
                  <pre key={`${message.id}-code-${idx}`} className="sql-block-code">
                    <code>{seg.value}</code>
                  </pre>
                );
              }
              return (
                <div key={`${message.id}-text-${idx}`} className="ai-md-content">
                  <MarkdownText text={seg.value} />
                </div>
              );
            })}

            {/* Streaming cursor */}
            {isStreaming && message.content && (
              <span className="ai-streaming-cursor">▊</span>
            )}
          </>
        )}

        {/* Error */}
        {isError && (
          <div className="ai-error-block">
            <AlertCircle size={14} />
            <span>{message.error || tn('ai.unknownError', '未知错误')}</span>
            <button className="ai-retry-btn" onClick={onRetry}>
              {tn('ai.retry', '重试')}
            </button>
          </div>
        )}

        {/* Aborted */}
        {isAborted && (
          <div className="ai-aborted-block">
            <span>{tn('ai.generationAborted', '生成已中断')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiMessage;
