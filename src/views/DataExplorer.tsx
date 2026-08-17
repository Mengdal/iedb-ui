import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, History, Plus, Database, Table2, LineChart, BarChart2, Search, Download, Loader2, Activity, ChevronLeft, ChevronRight, RefreshCw, Sparkles, X, Clock, Tag, Hash, Filter, LayoutDashboard, ArrowRight, Star, AlignLeft, CornerDownLeft, Command } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { sql, type SQLConfig } from '@codemirror/lang-sql';
import { Compartment, Prec } from '@codemirror/state';
import { gutter, GutterMarker, ViewPlugin, lineNumbers, keymap } from '@codemirror/view';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import { useApiFetch } from '../hooks/useApiFetch';
import { generateId } from '../utils/id';
import { debounce } from '../utils/debounce';
import { formatTime } from '../utils/formatTime';
import type { CurrentView } from '../App';
import { buildChartOption, downloadFile, isChartError } from '../utils/chartUtils';
import AiQueryPanel from '../components/AiQueryPanel';
import './DataExplorer.css';

// Compartment allows dynamic reconfiguration of SQL schema without rebuilding the editor
const sqlCompartment = new Compartment();
const aiGutterCompartment = new Compartment();

// ---- CodeMirror AI Gutter ----
// Module-level click callbacks and error state (set by the React component)
let _onAiGutterClick: ((lineText: string) => void) | null = null;
let _onAiGutterErrorClick: ((lineText: string, error: string) => void) | null = null;
let _onRunGutterClick: ((sql: string) => void) | null = null;
let _currentError: string | null = null;
// 记录最近一次出错的 SQL 文本，用于在 gutter 上只标注出错的那一条语句
let _erroredSql: string | null = null;

const AI_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`;
const ERROR_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
const RUN_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

/** SQL 语句起始关键字 */
const SQL_START_KEYWORDS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
  'WITH', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'GRANT', 'REVOKE', 'TRUNCATE',
  'SET', 'USE', 'BEGIN', 'CALL',
]);

/** 判断当前行是否是一个 SQL 语句的起始行 */
function isSqlStatementStart(view: { state: { doc: { line(n: number): { from: number; to: number; text: string }; lines: number; sliceString(from: number, to: number): string } } }, lineNumber: number): boolean {
  const doc = view.state.doc;
  if (lineNumber < 1 || lineNumber > doc.lines) return false;
  const line = doc.line(lineNumber);
  const text = doc.sliceString(line.from, line.to).trim();
  // 空行或注释行不算
  if (!text || text.startsWith('--')) return false;
  // 第一行非空非注释一定是起始行
  if (lineNumber === 1) return true;
  // 前一行是空行或注释行，则当前行是起始行
  const prevLine = doc.line(lineNumber - 1);
  const prevText = doc.sliceString(prevLine.from, prevLine.to).trim();
  if (!prevText || prevText.startsWith('--')) return true;
  // 前一行以分号结尾，则当前行是新语句的起始行
  if (prevText.endsWith(';')) return true;
  // 当前行以 SQL 关键字开头，则认为是新语句起始
  const firstWord = text.split(/\s+/)[0].toUpperCase();
  if (SQL_START_KEYWORDS.has(firstWord)) return true;
  return false;
}

/** Build the gutter marker for SQL statement start lines; shows run button, AI button, and error button when there is an active error */
function createAiGutterMarker(hasError: boolean, line?: number): GutterMarker {
  return new class extends GutterMarker {
    toDOM() {
      const el = document.createElement('span');
      el.className = 'cm-ai-gutter-cell';

      const runBtn = document.createElement('span');
      runBtn.className = 'cm-run-gutter-btn';
      runBtn.innerHTML = RUN_ICON_SVG;
      runBtn.title = i18n.t('views.dataExplorer.runStatement', '执行此语句');
      if (line != null) runBtn.dataset.line = String(line);
      el.appendChild(runBtn);

      const aiBtn = document.createElement('span');
      aiBtn.className = 'cm-ai-gutter-btn';
      aiBtn.innerHTML = AI_ICON_SVG;
      aiBtn.title = i18n.t('views.dataExplorer.askAi', '向 AI 提问此查询');
      if (line != null) aiBtn.dataset.line = String(line);
      el.appendChild(aiBtn);

      if (hasError) {
        const errBtn = document.createElement('span');
        errBtn.className = 'cm-ai-gutter-error-btn';
        errBtn.innerHTML = ERROR_ICON_SVG;
        errBtn.title = i18n.t('views.dataExplorer.askAiAboutError', '向 AI 询问此错误');
        if (line != null) errBtn.dataset.line = String(line);
        el.appendChild(errBtn);
      }

      return el;
    }
    eq(_other: GutterMarker): boolean { return false; }
  };
}

/** Extract a complete SQL statement starting at the given line (1-indexed). Stops at ';', blank line, comment line, or EOF. */
function extractStatementAtLine(view: { state: { doc: { line(n: number): { from: number; to: number; text: string }; lines: number; sliceString(from: number, to: number): string } } }, startLineNum: number): string {
  const doc = view.state.doc;
  const lines: string[] = [];
  for (let i = startLineNum; i <= doc.lines; i++) {
    const l = doc.line(i);
    const t = doc.sliceString(l.from, l.to);
    const trimmed = t.trim();
    if (!trimmed || trimmed.startsWith('--')) {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(t);
    if (trimmed.endsWith(';')) break;
  }
  return lines.join('\n').trim();
}

/** Gutter extension factory: show AI icon on SQL statement start lines, and error icon on the specific statement that errored */
function createAiGutter() {
  return gutter({
    class: 'cm-ai-gutter',
    lineMarker(view, line) {
      const lineNum = view.state.doc.lineAt(line.from).number; // 1-indexed
      if (!isSqlStatementStart(view, lineNum)) return null;
      // 仅在出错的语句起始行显示错误按钮
      if (_currentError && _erroredSql) {
        const stmt = extractStatementAtLine(view, lineNum);
        if (stmt && stmt.trim() === _erroredSql.trim()) return createAiGutterMarker(true, lineNum);
      }
      return createAiGutterMarker(false, lineNum);
    },
    initialSpacer: () => new class extends GutterMarker {
      toDOM(): HTMLElement { return document.createElement('span'); }
      eq(_other: GutterMarker): boolean { return true; }
    },
  });
}

/** ViewPlugin: handle clicks on the gutter markers (run button, AI button, or error button) */
const aiGutterClickPlugin = ViewPlugin.define((view) => {
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const runBtn = target.closest('.cm-run-gutter-btn');
    const aiBtn = target.closest('.cm-ai-gutter-btn');
    const errBtn = target.closest('.cm-ai-gutter-error-btn');
    if (!runBtn && !aiBtn && !errBtn) return;
    e.preventDefault();
    // 优先使用按钮上记录的语句起始行号，避免 posAtCoords 在多行语句上因坐标偏移解析到错误的行
    const lineBtn = target.closest<HTMLElement>('[data-line]');
    const dataLine = lineBtn?.dataset.line ? Number(lineBtn.dataset.line) : NaN;
    let startLineNum: number;
    if (Number.isInteger(dataLine) && dataLine >= 1) {
      startLineNum = dataLine;
    } else {
      // 用坐标定位点击行，避免 gutter DOM 元素索引偏移导致行号错位
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return;
      startLineNum = view.state.doc.lineAt(pos).number; // 1-indexed
    }
    const lineText = extractStatementAtLine(view, startLineNum);
    if (runBtn) {
      _onRunGutterClick?.(lineText);
    } else if (aiBtn) {
      _onAiGutterClick?.(lineText);
    } else if (errBtn && _currentError) {
      _onAiGutterErrorClick?.(lineText, _currentError);
    }
  };
  view.dom.addEventListener('mousedown', handler, true);
  return {
    destroy() {
      view.dom.removeEventListener('mousedown', handler, true);
    },
  };
});

interface DatabaseItem {
  name: string;
  measurement_count: number;
}

interface MeasurementItem {
  name: string;
}

export interface QueryResponse {
  success: boolean;
  columns?: string[];
  data?: any[][];
  row_count?: number;
  execution_time_ms?: number;
  timestamp?: string;
  error?: string;
}

interface QueryTab {
  id: string;
  count: number;
  queryCode: string;
  queryResult: QueryResponse | null;
  expandedTable: string | null;
  selectedColumns: string[];
  timeRange: string;
  customStart: string;
  customEnd: string;
  visualization: 'table' | 'line' | 'bar';
  currentPage: number;
  pageSize: number;
}

interface QueryHistoryItem {
  id: string;
  query: string;
  timestamp: number;
}

const defaultQuery = "";

// 模块级缓存：在 SPA 内切换页面（组件卸载/重挂）时保留 tabs 状态，刷新页面时模块重新加载自然清空
let _cachedTabs: QueryTab[] | null = null;
let _cachedActiveTabId: string | null = null;

// Lightweight SQL formatter that follows the project's default SQL style:
// uppercase keywords, two-space indentation, one item per line in SELECT/GROUP BY/ORDER BY,
// and AND/OR conditions on separate lines in WHERE. No external dependency.
const formatSql = (input: string): string => {
  if (!input || !input.trim()) return input;

  // Protect string literals so formatting doesn't touch their contents.
  const literals: string[] = [];
  let sql = input.replace(/'([^']|'')*'/g, (match) => {
    literals.push(match);
    return `__LIT_${literals.length - 1}__`;
  });

  // Normalize whitespace and comma spacing.
  sql = sql.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  // Uppercase keywords.
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT',
    'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'CROSS JOIN',
    'ON', 'UNION', 'ALL', 'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
    'BETWEEN', 'LIKE', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
  ];
  keywords.forEach(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'gi');
    sql = sql.replace(regex, kw);
  });

  // Split into clauses by major block keywords.
  const splitRegex = /\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|UNION|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER JOIN|CROSS JOIN|ON)\b/gi;
  const tokens = sql.split(splitRegex).filter(s => s.trim() !== '');

  // Build keyword/content clauses.
  const clauses: { keyword: string; content: string }[] = [];
  let currentKeyword = '';
  let currentContent = '';

  tokens.forEach(token => {
    const trimmed = token.trim();
    if (/^(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|UNION|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER JOIN|CROSS JOIN|ON)$/i.test(trimmed)) {
      if (currentKeyword || currentContent) {
        clauses.push({ keyword: currentKeyword, content: currentContent.trim() });
      }
      currentKeyword = trimmed.toUpperCase();
      currentContent = '';
    } else {
      currentContent += (currentContent ? ' ' : '') + trimmed;
    }
  });
  if (currentKeyword || currentContent) {
    clauses.push({ keyword: currentKeyword, content: currentContent.trim() });
  }

  // Format each clause.
  const formattedClauses = clauses.map(clause => {
    const { keyword, content } = clause;
    if (!keyword) return content;

    if (keyword === 'SELECT') {
      const cols = splitTopLevel(content, ',');
      return `SELECT\n  ${cols.join(',\n  ')}`;
    }

    if (keyword === 'WHERE') {
      const conditions = splitWhereConditions(content);
      return `WHERE\n  ${conditions.join('\n  ')}`;
    }

    if (keyword === 'GROUP BY' || keyword === 'ORDER BY') {
      const items = splitTopLevel(content, ',');
      return `${keyword}\n  ${items.join(',\n  ')}`;
    }

    if (keyword === 'FROM' || keyword === 'HAVING' || keyword === 'LIMIT') {
      return `${keyword} ${content}`;
    }

    // JOIN, ON, UNION, etc.
    return `${keyword} ${content}`;
  });

  let result = formattedClauses.join('\n');

  // Restore protected string literals.
  literals.forEach((literal, idx) => {
    result = result.replace(`__LIT_${idx}__`, literal);
  });

  return result.replace(/\n\s*\n/g, '\n').trim();
};

const splitTopLevel = (input: string, delimiter: string): string[] => {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (ch === delimiter && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
};

const splitWhereConditions = (input: string): string[] => {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  const words = input.split(' ');
  let pendingOp = '';

  for (const word of words) {
    for (const ch of word) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
    }
    if (depth === 0 && /^(AND|OR)$/i.test(word)) {
      if (current.trim()) {
        result.push(pendingOp ? `${pendingOp} ${current.trim()}` : current.trim());
      }
      pendingOp = word.toUpperCase();
      current = '';
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  if (current.trim()) {
    result.push(pendingOp ? `${pendingOp} ${current.trim()}` : current.trim());
  }
  return result;
};

export const getSelectedTagValues = (sql: string, column: string): string[] => {
  if (!sql) return [];
  const inRegex = new RegExp(`\\b${column}\\s+IN\\s*\\((.*?)\\)`, 'i');
  const inMatch = sql.match(inRegex);
  if (inMatch) {
    return inMatch[1].split(',').map(s => s.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')).filter(s => s.length > 0);
  }

  const eqRegex = new RegExp(`\\b${column}\\s*=\\s*'([^']+)'`, 'i');
  const eqMatch = sql.match(eqRegex);
  if (eqMatch) {
    return [eqMatch[1]];
  }
  return [];
};

const TagDropdown = ({ tableName, columnName, selectedDb, onSelectValue, initialChecked, children, trailing }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedValues, setCheckedValues] = useState<string[]>([]);
  const { t } = useTranslation();
  const { apiFetch } = useApiFetch({ handleLicense: false, handleFeature: false });

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen) {
      setIsOpen(true);
      setSearchQuery('');
      setCheckedValues(initialChecked || []);
      if (values.length === 0) {
        setIsLoading(true);
        apiFetch('/api/v1/query', {
          method: 'POST',
          headers: selectedDb ? { 'x-iedb-database': selectedDb } : {},
          body: JSON.stringify({
            sql: `SELECT DISTINCT ${columnName} FROM ${tableName} LIMIT 1000`
          })
        })
          .then((data: any) => {
            if (data.success && data.data) {
              const vals = data.data.map((row: any) => row[0]?.toString() || '');
              setValues(vals.filter((v: string) => v !== ''));
            }
          })
          .catch(console.error)
          .finally(() => setIsLoading(false));
      }
    } else {
      setIsOpen(false);
    }
  };

  const filteredValues = values.filter(v => v.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }} className={isOpen ? "h-full flex flex-col overflow-hidden" : ""}>
      <div className="tree-leaf" style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '8px' }}>
        {children}
        <button
          type="button"
          className="icon-btn-small tag-filter-btn"
          onClick={handleToggle}
          title={t('views.dataExplorer.filterTag', 'Filter Tag')}
        >
          <Filter size={12} color={isOpen ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
        </button>
        {trailing}
      </div>
      {isOpen && (
        <div
          className="tag-dropdown-menu flex flex-col overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderTop: 'none',
            borderRadius: '0 0 4px 4px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '8px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-surface)', borderRadius: '4px', padding: '4px 8px' }}>
              <Search size={12} color="var(--text-secondary)" style={{ marginRight: '6px' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('views.dataExplorer.searchPlaceholder', 'Search...')}
                style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', width: '100%', fontSize: '12px' }}
              />
            </div>
          </div>

          <div style={{ maxHeight: '180px', overflowY: 'auto', padding: '4px 0' }}>
            {isLoading ? (
              <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                <Loader2 size={14} className="spin" style={{ margin: '0 auto' }} />
              </div>
            ) : filteredValues.length > 0 ? (
              filteredValues.map((v, i) => (
                <label
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    gap: '8px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-surface)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <input
                    type="checkbox"
                    checked={checkedValues.includes(v)}
                    onChange={(e) => {
                      let newChecked = [];
                      if (e.target.checked) {
                        newChecked = [...checkedValues, v];
                      } else {
                        newChecked = checkedValues.filter(item => item !== v);
                      }
                      setCheckedValues(newChecked);
                      onSelectValue(newChecked);
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                </label>
              ))
            ) : (
              <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {t('views.dataExplorer.noData', 'No values found')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface DataExplorerProps {
  onNavigate?: (view: CurrentView) => void;
}

const DataExplorer: React.FC<DataExplorerProps> = ({ onNavigate }) => {
  const { activeServer } = useServers();
  const { apiFetch } = useApiFetch({ handleLicense: false, handleFeature: false });
  const { t, i18n } = useTranslation();
  const [databases, setDatabases] = useState<DatabaseItem[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>(() => {
    try { return localStorage.getItem('iotedge-selected-db') || ''; } catch { return ''; }
  });
  const [measurements, setMeasurements] = useState<MeasurementItem[]>([]);
  const [tableSearch, setTableSearch] = useState('');
  const [tableColumns, setTableColumns] = useState<Record<string, string[]>>({});
  const [tableSchemas, setTableSchemas] = useState<Record<string, { tags: string[], fields: string[], types: Record<string, string> }>>({});

  const [tabs, setTabs] = useState<QueryTab[]>(() => {
    if (_cachedTabs) return _cachedTabs;
    return [{
      id: '1',
      count: 1,
      queryCode: defaultQuery,
      queryResult: null,
      expandedTable: null,
      selectedColumns: [],
      timeRange: 'none',
      customStart: '',
      customEnd: '',
      visualization: 'table',
      currentPage: 1,
      pageSize: 32
    }];
  });
  const [activeTabId, setActiveTabId] = useState(() => _cachedActiveTabId ?? '1');
  const activeTab = tabs.find(t => t.id === activeTabId)!;

  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>(() => {
    try {
      const stored = localStorage.getItem('queryHistory');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [favoriteQueries, setFavoriteQueries] = useState<QueryHistoryItem[]>(() => {
    try {
      const stored = localStorage.getItem('favoriteQueries');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawerAnim, setDrawerAnim] = useState<'entering' | 'open' | 'exiting' | 'hidden'>('hidden');
  const [drawerTab, setDrawerTab] = useState<'history' | 'favorites'>('history');

  useEffect(() => {
    if (showDrawer) {
      setDrawerAnim('entering');
      const raf = requestAnimationFrame(() => setDrawerAnim('open'));
      return () => cancelAnimationFrame(raf);
    } else {
      if (drawerAnim === 'hidden') return;
      setDrawerAnim('exiting');
      const timer = setTimeout(() => setDrawerAnim('hidden'), 300);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDrawer]);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiPresetQuestion, setAiPresetQuestion] = useState<string | undefined>(undefined);
  const [aiPresetInput, setAiPresetInput] = useState<string | undefined>(undefined);
  const [aiSqlContext, setAiSqlContext] = useState<string | undefined>(undefined);
  const [aiErrorContext, setAiErrorContext] = useState<string | undefined>(undefined);

  // Register AI gutter click handlers — 将 SQL / 错误信息作为引用附件，不占输入框
  useEffect(() => {
    _onAiGutterClick = (lineText: string) => {
      setShowAiPanel(true);
      setAiSqlContext(lineText);
      setAiErrorContext(undefined);
      setAiPresetQuestion(undefined);
      setAiPresetInput(undefined);
    };
    _onAiGutterErrorClick = (lineText: string, error: string) => {
      setShowAiPanel(true);
      setAiSqlContext(lineText);
      setAiErrorContext(error);
      setAiPresetQuestion(undefined);
      setAiPresetInput(undefined);
    };
    return () => { _onAiGutterClick = null; _onAiGutterErrorClick = null; };
  }, []);

  // Detect platform for shortcut hints (Mac vs Windows/Linux)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // 持久化选中的数据库
  useEffect(() => {
    try { localStorage.setItem('iotedge-selected-db', selectedDb); } catch { /* ignore */ }
  }, [selectedDb]);

  // 恢复并监听编辑器高度变化，持久化用户调整的高度
  useEffect(() => {
    const el = editorAreaRef.current;
    if (!el) return;
    try {
      const savedHeight = localStorage.getItem('iotedge-editor-height');
      if (savedHeight) el.style.height = savedHeight;
    } catch { /* ignore */ }
    const saveHeight = debounce((height: string) => {
      try { localStorage.setItem('iotedge-editor-height', height); } catch { /* ignore */ }
    }, 300);
    const observer = new ResizeObserver(() => {
      const h = el.style.height;
      if (h) saveHeight(h);
    });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  const toggleFavorite = (item: QueryHistoryItem) => {
    setFavoriteQueries(prev => {
      const exists = prev.some(f => f.id === item.id);
      const updated = exists
        ? prev.filter(f => f.id !== item.id)
        : [item, ...prev].slice(0, 50);
      localStorage.setItem('favoriteQueries', JSON.stringify(updated));
      return updated;
    });
  };

  const isFavorite = (id: string) => favoriteQueries.some(f => f.id === id);

  const [isQuerying, setIsQuerying] = useState(false);
  const [isRefreshingDbs, setIsRefreshingDbs] = useState(false);
  const [isLoadingDbs, setIsLoadingDbs] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);

  // Ref to access the CodeMirror EditorView for dynamic extension reconfiguration
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [prevTimeRange, setPrevTimeRange] = useState("none");

  const [showSaveDashboardModal, setShowSaveDashboardModal] = useState(false);
  const [saveCellName, setSaveCellName] = useState('');
  const [saveDashboardId, setSaveDashboardId] = useState('');
  const [saveNewName, setSaveNewName] = useState('');
  const [saveNewDesc, setSaveNewDesc] = useState('');
  const [saveCellType, setSaveCellType] = useState<'table' | 'line' | 'bar'>('line');
  const [saveSelectedDb, setSaveSelectedDb] = useState('');
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [editingCellName, setEditingCellName] = useState<string>('');
  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);

  const selectedDbRef = useRef(selectedDb);
  selectedDbRef.current = selectedDb;

  // 始终指向最新的 activeTabId，避免异步回调里使用陈旧闭包导致结果写到错误的 tab
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const editorAreaRef = useRef<HTMLDivElement>(null);
  const editingCellIdRef = useRef(editingCellId);
  editingCellIdRef.current = editingCellId;
  const editingDashboardIdRef = useRef(editingDashboardId);
  editingDashboardIdRef.current = editingDashboardId;

  const updateActiveTab = (updates: Partial<QueryTab>, tabId?: string) => {
    const targetId = tabId ?? activeTabIdRef.current;
    setTabs(prev => prev.map(t => t.id === targetId ? { ...t, ...updates } : t));
  };

  // 将 tabs 和 activeTabId 同步到模块级缓存，切换页面后组件重挂时可恢复，刷新页面时自然清空
  useEffect(() => {
    _cachedTabs = tabs;
    _cachedActiveTabId = activeTabId;
  }, [tabs, activeTabId]);

  useEffect(() => {
    try {
      const pending = localStorage.getItem('iotedge-pending-query');
      if (pending) {
        const { text, database, cellId, dashboardId, cellName, cellType } = JSON.parse(pending);
        const newId = generateId();
        setTabs(prev => [
          ...prev,
          {
            id: newId,
            count: prev.length + 1,
            queryCode: text || defaultQuery,
            queryResult: null,
            expandedTable: null,
            selectedColumns: [],
            timeRange: 'none',
            customStart: '',
            customEnd: '',
            visualization: (cellType === 'line' || cellType === 'bar' || cellType === 'table') ? cellType : 'table',
            currentPage: 1,
            pageSize: 32
          }
        ]);
        setActiveTabId(newId);
        if (database) setSelectedDb(database);
        if (cellId) setEditingCellId(cellId);
        if (cellName) setEditingCellName(cellName);
        if (dashboardId) setEditingDashboardId(dashboardId);
        localStorage.removeItem('iotedge-pending-query');
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch Databases
  useEffect(() => {
    if (!activeServer) return;
    setIsLoadingDbs(true);
    apiFetch('/api/v1/databases')
      .then(data => {
        if (data && (data as any).databases) {
          setDatabases((data as any).databases);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoadingDbs(false));
  }, [activeServer, apiFetch]);

  const forceRefreshSchemaRef = useRef(false);

  // Fetch measurements and schemas for a database
  const fetchMeasurementsForDb = (db: string) => {
    if (!activeServer) return;
    apiFetch(`/api/v1/databases/${db}/measurements`)
      .then(data => {
        const forceRefresh = forceRefreshSchemaRef.current;
        forceRefreshSchemaRef.current = false;
        if (data && (data as any).measurements) {
          setMeasurements((data as any).measurements);
          // Optionally, prefetch schemas to power autocomplete instantly
          (data as any).measurements.forEach((m: MeasurementItem) => {
            if (forceRefresh || !tableColumns[m.name]) {
              apiFetch(`/api/v1/databases/${db}/measurements/${m.name}/schema`)
                .then(schemaData => {
                  if ((schemaData as any).success) {
                    const tags = (schemaData as any).tags || [];
                    const fields = (schemaData as any).fields || [];
                    const types = (schemaData as any).types || {};
                    const cols = ['time', ...tags, ...fields];
                    if (cols.length > 0) {
                      setTableColumns(prev => ({ ...prev, [m.name]: cols }));
                      setTableSchemas(prev => ({ ...prev, [m.name]: { tags, fields, types } }));
                    }
                  }
                })
                .catch(() => { }); // silent catch for background prefetch
            }
          });
        }
      })
      .catch(console.error);
  };

  const handleRefreshDatabases = () => {
    if (!activeServer) return;
    setIsRefreshingDbs(true);
    apiFetch('/api/v1/databases')
      .then(data => {
        if (data && (data as any).databases) {
          setDatabases((data as any).databases);
          if ((data as any).databases.length > 0) {
            const match = (data as any).databases.find((d: any) => d.name === selectedDb);
            if (!match) {
              setSelectedDb('');
            } else {
              // Refresh measurements and schemas for the currently selected database
              forceRefreshSchemaRef.current = true;
              fetchMeasurementsForDb(selectedDb);
            }
          } else {
            setSelectedDb('');
          }
        }
      })
      .catch(console.error)
      .finally(() => setIsRefreshingDbs(false));
  };

  // Convert our state to the format required by CodeMirror
  const cmSchema = React.useMemo(() => {
    const s: Record<string, string[]> = {};
    measurements.forEach(m => {
      s[m.name] = tableColumns[m.name] || [];
    });
    return s;
  }, [measurements, tableColumns]);

  // Static CodeMirror extensions — SQL compartment will be dynamically reconfigured
  const staticExtensions = useMemo(() => [
    sqlCompartment.of(sql({})),
    aiGutterCompartment.of(createAiGutter()),
    lineNumbers(),
    aiGutterClickPlugin,
    // 覆盖 CodeMirror 默认 keymap 的 Mod-Enter(insertBlankLine)：阻止插入空行，
    // 查询执行由全局 keydown 监听处理（事件仍会冒泡到 document，不重复触发）
    Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => true }])),
  ], []);

  // Dynamically update the SQL schema/table when cmSchema or expanded table changes
  useEffect(() => {
    const view = editorRef.current?.view;
    if (view) {
      const sqlConfig: SQLConfig = { schema: cmSchema };
      if (activeTab.expandedTable) {
        sqlConfig.defaultTable = activeTab.expandedTable;
      }
      view.dispatch({
        effects: sqlCompartment.reconfigure(sql(sqlConfig))
      });
    }
  }, [cmSchema, activeTab.expandedTable]);

  // Dynamically show/hide the gutter error icon based on the latest query error
  useEffect(() => {
    const error = activeTab.queryResult?.error || null;
    _currentError = error;
    // 出错时记录对应的 SQL，成功时清空；lineMarker 据此只标注出错的语句
    _erroredSql = error ? (activeTab.queryResult as any)?.erroredSql || null : null;
    const view = editorRef.current?.view;
    if (view) {
      view.dispatch({
        effects: aiGutterCompartment.reconfigure(createAiGutter())
      });
    }
  }, [activeTab.queryResult]);

  // Fetch Measurements
  useEffect(() => {
    if (selectedDb && activeServer) {
      fetchMeasurementsForDb(selectedDb);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDb, activeServer]);

  const updateSQL = (table: string | null, columns: string[], timeR: string, start?: string, end?: string) => {
    let timeClause = '';

    if (timeR === 'none') {
      timeClause = '';
    } else if (timeR === 'custom') {
      const conditions = [];
      if (start) {
        try { conditions.push(`time >= '${new Date(start).toISOString()}'`); } catch (e) { }
      }
      if (end) {
        try { conditions.push(`time <= '${new Date(end).toISOString()}'`); } catch (e) { }
      }

      if (conditions.length > 0) {
        timeClause = conditions.join(' AND ');
      } else {
        timeClause = `time >= now() - interval '1 hour'`;
      }
    } else {
      timeClause = `time >= now() - interval '${timeR}'`;
    }

    const isNewTable = table && table !== activeTab.expandedTable;

    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        let updatedCode = t.queryCode;

        // Option 2: Completely overwrite SQL when switching to a new table to avoid regex corruption
        if (isNewTable && table) {
          const colsStr = columns.length > 0 ? columns.join(',\n  ') : '*';
          updatedCode = timeClause
            ? `SELECT\n  ${colsStr}\nFROM ${table}\nWHERE\n  ${timeClause}\nLIMIT 1000`
            : `SELECT\n  ${colsStr}\nFROM ${table}\nLIMIT 1000`;
          return { ...t, queryCode: updatedCode };
        }

        if (!updatedCode && table) {
          const colsStr = columns.length > 0 ? columns.join(',\n  ') : '*';
          updatedCode = timeClause
            ? `SELECT\n  ${colsStr}\nFROM ${table}\nWHERE\n  ${timeClause}\nLIMIT 1000`
            : `SELECT\n  ${colsStr}\nFROM ${table}\nLIMIT 1000`;
          return { ...t, queryCode: updatedCode };
        }

        let tagFilters = '';
        if (!isNewTable) {
          const whereMatch = updatedCode.match(/WHERE([\s\S]*?)(?=LIMIT|$)/i);
          if (whereMatch) {
            tagFilters = whereMatch[1];
            tagFilters = tagFilters.replace(/\btime\s*[<>=]+\s*(?:now\(\)(?:\s*-\s*interval\s+'[^']+')?|'[^']+')/gi, '___TIME___');
            tagFilters = tagFilters.replace(/___TIME___\s+AND\s+/gi, '');
            tagFilters = tagFilters.replace(/\s+AND\s+___TIME___/gi, '');
            tagFilters = tagFilters.replace(/___TIME___/gi, '');
            tagFilters = tagFilters.trim();
          }
        }

        if (table) {
          const colsStr = columns.length > 0 ? columns.join(',\n  ') : '*';
          if (updatedCode.match(/SELECT\s+[\s\S]*?\s+FROM/i)) {
            updatedCode = updatedCode.replace(/SELECT\s+[\s\S]*?\s+FROM/i, `SELECT\n  ${colsStr}\nFROM`);
          }
          if (updatedCode.match(/FROM\s+"?[a-zA-Z0-9_-]+"?(?=\s*(?:WHERE|LIMIT|$))/i)) {
            updatedCode = updatedCode.replace(/FROM\s+"?[a-zA-Z0-9_-]+"?(?=\s*(?:WHERE|LIMIT|$))/i, `FROM ${table}`);
          }
          if (timeClause && !updatedCode.includes('WHERE')) {
            if (updatedCode.includes('LIMIT')) {
              updatedCode = updatedCode.replace(/LIMIT/i, `WHERE\n  ${timeClause}\nLIMIT`);
            } else {
              updatedCode += `\nWHERE\n  ${timeClause}`;
            }
          }
        }

        const whereIndex = updatedCode.toUpperCase().indexOf('WHERE');
        if (whereIndex !== -1) {
          let limitIndex = updatedCode.toUpperCase().indexOf('LIMIT', whereIndex);
          if (limitIndex === -1) limitIndex = updatedCode.length;

          const head = updatedCode.substring(0, whereIndex);
          const tail = updatedCode.substring(limitIndex);

          const whereParts: string[] = [];
          if (timeClause) whereParts.push(timeClause);
          if (tagFilters) whereParts.push(tagFilters.replace(/^AND\s+/i, ''));

          if (whereParts.length > 0) {
            updatedCode = `${head}WHERE\n  ${whereParts.join('\n  AND ')}`;
            if (tail.trim()) updatedCode += `\n${tail.trimStart()}`;
          } else {
            // No conditions — remove WHERE entirely
            updatedCode = head.trimEnd();
            if (tail.trim()) updatedCode += `\n${tail.trimStart()}`;
          }
        } else if (timeClause) {
          const limitIndex = updatedCode.toUpperCase().indexOf('LIMIT');
          if (limitIndex !== -1) {
            updatedCode = updatedCode.substring(0, limitIndex) + `WHERE\n  ${timeClause}\n` + updatedCode.substring(limitIndex);
          } else {
            updatedCode += `\nWHERE\n  ${timeClause}`;
          }
        }

        updatedCode = updatedCode.replace(/\n\s*\n/g, '\n').trim();
        return { ...t, queryCode: updatedCode };
      }
      return t;
    }));
  };

  const toggleTableExpand = (tableName: string) => {
    if (activeTab.expandedTable === tableName) {
      updateActiveTab({ expandedTable: null });
    } else {
      updateActiveTab({ expandedTable: tableName, selectedColumns: [] });
      updateSQL(tableName, [], activeTab.timeRange, activeTab.customStart, activeTab.customEnd);

      if (!tableColumns[tableName] && activeServer) {
        apiFetch(`/api/v1/databases/${selectedDb}/measurements/${tableName}/schema`)
          .then(data => {
            if ((data as any).success) {
              const tags = (data as any).tags || [];
              const fields = (data as any).fields || [];
              const types = (data as any).types || {};
              const cols = ['time', ...tags, ...fields];
              if (cols.length > 0) {
                setTableColumns(prev => ({ ...prev, [tableName]: cols }));
                setTableSchemas(prev => ({ ...prev, [tableName]: { tags, fields, types } }));
              }
            }
          })
          .catch(console.error);
      }
    }
  };

  const handleColumnSelect = (tableName: string, column: string, checked: boolean) => {
    let newCols = activeTab.selectedColumns;
    if (checked) {
      newCols = [...activeTab.selectedColumns, column];
    } else {
      newCols = activeTab.selectedColumns.filter(c => c !== column);
    }
    updateActiveTab({ selectedColumns: newCols });
    updateSQL(tableName, newCols, activeTab.timeRange, activeTab.customStart, activeTab.customEnd);
  };

  const handleTagValueSelect = (column: string, values: string[] | string) => {
    const vals = Array.isArray(values) ? values : [values];
    const escapeString = (str: string) => typeof str === 'string' ? str.replace(/'/g, "''") : str;

    let newCondition = '';
    if (vals.length === 1) {
      newCondition = `${column} = '${escapeString(vals[0])}'`;
    } else if (vals.length > 1) {
      const inVals = vals.map(v => `'${escapeString(v)}'`).join(", ");
      newCondition = `${column} IN (${inVals})`;
    }

    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        let sql = t.queryCode;
        if (!sql) return t;

        const singleInRegex = new RegExp(`\\b${column}\\s+IN\\s*\\(.*?\\)`, 'i');
        const singleEqRegex = new RegExp(`\\b${column}\\s*=\\s*'[^']+'`, 'i');

        let hasOld = false;

        if (singleInRegex.test(sql)) {
          hasOld = true;
          if (newCondition) {
            sql = sql.replace(singleInRegex, newCondition);
          } else {
            sql = sql.replace(singleInRegex, '___TO_REMOVE___');
          }
        } else if (singleEqRegex.test(sql)) {
          hasOld = true;
          if (newCondition) {
            sql = sql.replace(singleEqRegex, newCondition);
          } else {
            sql = sql.replace(singleEqRegex, '___TO_REMOVE___');
          }
        }

        if (!hasOld && newCondition) {
          if (sql.includes('WHERE')) {
            sql = sql.replace(/WHERE/i, `WHERE\n  ${newCondition} AND`);
          } else if (sql.match(/LIMIT/i)) {
            sql = sql.replace(/LIMIT/i, `WHERE\n  ${newCondition}\nLIMIT`);
          } else {
            sql += `\nWHERE\n  ${newCondition}`;
          }
        }

        if (sql.includes('___TO_REMOVE___')) {
          sql = sql.replace(/AND\s+___TO_REMOVE___\s+AND/gi, 'AND ');
          sql = sql.replace(/WHERE\s+___TO_REMOVE___\s+AND/gi, 'WHERE\n  ');
          sql = sql.replace(/AND\s+___TO_REMOVE___(\s+LIMIT|\s*$)/gi, '$1');
          sql = sql.replace(/WHERE\s+___TO_REMOVE___(\s+LIMIT|\s*$)/gi, '$1');
          sql = sql.replace(/___TO_REMOVE___/g, '');
          sql = sql.replace(/WHERE\s*(LIMIT|\s*$)/i, '$1');
        }

        sql = sql.replace(/\n\s*\n/g, '\n');
        return { ...t, queryCode: sql };
      }
      return t;
    }));
  };

  const applyTimeRangeToQuery = (sql: string, timeRange: string, customStart?: string, customEnd?: string) => {
    if (!sql || !sql.trim()) return sql;

    // "none" = remove all time conditions from existing SQL
    if (timeRange === 'none') {
      const intervalRegex = /time\s*>=\s*now\(\)\s*-\s*interval\s+'[^']+'/ig;
      const customRegex = /time\s*>=\s*'[^']+'\s*AND\s*time\s*<=\s*'[^']+'/ig;

      let result = sql.replace(intervalRegex, '___TIME_PH___');
      result = result.replace(customRegex, '___TIME_PH___');
      // Clean up dangling AND around placeholder
      result = result.replace(/___TIME_PH___\s+AND\s+/gi, '');
      result = result.replace(/\s+AND\s+___TIME_PH___/gi, '');
      result = result.replace(/___TIME_PH___/gi, '');
      // Remove empty WHERE clause
      result = result.replace(/WHERE\s*\n?\s*LIMIT/gi, 'LIMIT');
      result = result.replace(/WHERE\s*$/gi, '');
      return result.replace(/\n\s*\n/g, '\n').trim();
    }

    let timeCondition = '';
    if (timeRange === 'custom') {
      if (!customStart || !customEnd) return sql;
      timeCondition = `time >= '${new Date(customStart).toISOString()}' AND time <= '${new Date(customEnd).toISOString()}'`;
    } else {
      timeCondition = `time >= now() - interval '${timeRange}'`;
    }

    const intervalRegex = /time\s*>=\s*now\(\)\s*-\s*interval\s+'[^']+'/ig;
    if (intervalRegex.test(sql)) {
      return sql.replace(intervalRegex, timeCondition);
    }
    const customRegex = /time\s*>=\s*'[^']+'\s*AND\s*time\s*<=\s*'[^']+'/ig;
    if (customRegex.test(sql)) {
      return sql.replace(customRegex, timeCondition);
    }

    // 无既有时间条件 → 注入时间过滤，保证所选时间范围始终生效
    const upper = sql.toUpperCase();
    const whereIdx = upper.indexOf('WHERE');
    const clauseKeywords = ['GROUP BY', 'ORDER BY', 'LIMIT', 'HAVING', 'UNION', 'OFFSET'];

    if (whereIdx !== -1) {
      // 在现有 WHERE 子句条件末尾追加 AND 时间条件
      let insertAt = sql.length;
      let matchedKw = '';
      for (const kw of clauseKeywords) {
        const idx = upper.indexOf(kw, whereIdx + 5);
        if (idx !== -1 && idx < insertAt) { insertAt = idx; matchedKw = kw; }
      }
      const head = sql.slice(0, insertAt).trimEnd();
      const tail = matchedKw ? `\n${sql.slice(insertAt).trimStart()}` : '';
      return `${head}\n  AND ${timeCondition}${tail}`.replace(/\n\s*\n/g, '\n').trim();
    }

    // 无 WHERE：在 LIMIT 前插入，或直接追加 WHERE；去掉结尾分号避免产生非法 SQL
    const stripped = sql.replace(/;\s*$/, '').trimEnd();
    const limitIdx = upper.indexOf('LIMIT');
    if (limitIdx !== -1) {
      return `${stripped.slice(0, limitIdx)}\nWHERE\n  ${timeCondition}\n${stripped.slice(limitIdx)}`.replace(/\n\s*\n/g, '\n').trim();
    }
    return `${stripped}\nWHERE\n  ${timeCondition}`.replace(/\n\s*\n/g, '\n').trim();
  };

  const handleTimeRangeChange = (val: string) => {
    if (val === 'custom') {
      setPrevTimeRange(activeTab.timeRange);
      updateActiveTab({ timeRange: val });
      setShowTimeModal(true);
    } else {
      updateActiveTab({ timeRange: val });
      setTabs(prev => prev.map(t => {
        if (t.id === activeTabId) {
          const newSql = applyTimeRangeToQuery(t.queryCode, val);
          return { ...t, queryCode: newSql };
        }
        return t;
      }));
    }
  };

  const handleFormatSql = () => {
    const formatted = formatSql(activeTab.queryCode);
    if (formatted !== activeTab.queryCode) {
      updateActiveTab({ queryCode: formatted });
    }
  };

  const handleRunQuery = () => {
    const sql = activeTab.queryCode.trim();
    if (!sql || !activeServer) return;
    setIsQuerying(true);

    setQueryHistory(prev => {
      // Don't duplicate the very last query
      if (prev.length > 0 && prev[0].query === sql) return prev;

      const newItem = { id: generateId(), query: sql, timestamp: Date.now() };
      const newHistory = [newItem, ...prev].slice(0, 50); // Keep top 50
      localStorage.setItem('queryHistory', JSON.stringify(newHistory));
      return newHistory;
    });

    apiFetch('/api/v1/query', {
      method: 'POST',
      headers: selectedDb ? { 'x-iedb-database': selectedDb } : {},
      body: JSON.stringify({
        sql: activeTab.queryCode
      })
    })
      .then((data: any) => {
        const result = data as QueryResponse;
        // 后端返回错误时，记录出错的 SQL 以便 gutter 精确标注
        if (!result.success && result.error) {
          (result as any).erroredSql = sql;
        }
        updateActiveTab({ queryResult: result, currentPage: 1 });
        setIsQuerying(false);
      })
      .catch(err => {
        console.error(err);
        updateActiveTab({
          queryResult: { success: false, error: err?.message || String(err), erroredSql: sql } as QueryResponse,
          currentPage: 1,
        });
        setIsQuerying(false);
      });
  };

  // Global Mod+Enter shortcut to run query regardless of focus
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRunQuery();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleRunQuery]);

  // ---- AI Query Panel callbacks ----
  const handleAiInsertToEditor = (sql: string) => {
    updateActiveTab({ queryCode: sql });
  };

  const handleAiRunQuery = (sql: string) => {
    const trimmed = sql.trim();
    // 与 handleRunQuery 保持一致的前置校验：无 server 或空 SQL 时不发起请求
    if (!trimmed || !activeServer) return;
    // 捕获发起查询时的 tabId，确保异步结果写回正确的 tab，避免用户切换 tab 后结果错位
    const targetTabId = activeTabIdRef.current;
    const db = selectedDbRef.current;
    setIsQuerying(true);

    setQueryHistory(prev => {
      if (prev.length > 0 && prev[0].query === trimmed) return prev;
      const newItem = { id: generateId(), query: trimmed, timestamp: Date.now() };
      const newHistory = [newItem, ...prev].slice(0, 50);
      localStorage.setItem('queryHistory', JSON.stringify(newHistory));
      return newHistory;
    });

    apiFetch('/api/v1/query', {
      method: 'POST',
      headers: db ? { 'x-iedb-database': db } : {},
      body: JSON.stringify({ sql: trimmed })
    })
      .then((data: any) => {
        const result = data as QueryResponse;
        if (!result.success && result.error) {
          (result as any).erroredSql = trimmed;
        }
        updateActiveTab({ queryResult: result, currentPage: 1 }, targetTabId);
        setIsQuerying(false);
      })
      .catch(err => {
        console.error(err);
        // 将错误信息写入结果栏，避免结果区停留在上一次查询的结果
        updateActiveTab({
          queryResult: { success: false, error: err?.message || String(err), erroredSql: trimmed } as QueryResponse,
          currentPage: 1,
        }, targetTabId);
        setIsQuerying(false);
      });
  };

  // Keep the gutter run-button callback in sync so it always calls the latest executor.
  // 使用 ref 存储最新函数引用，确保 gutter 的同步 mousedown 事件不会命中过期的闭包。
  const handleAiRunQueryRef = useRef(handleAiRunQuery);
  handleAiRunQueryRef.current = handleAiRunQuery;
  useEffect(() => {
    _onRunGutterClick = (sql: string) => handleAiRunQueryRef.current(sql);
    return () => { _onRunGutterClick = null; };
  }, []);

  const handleAddTab = () => {
    const newId = generateId();
    setTabs(prev => [
      ...prev,
      {
        id: newId,
        count: prev.length + 1,
        queryCode: defaultQuery,
        queryResult: null,
        expandedTable: null,
        selectedColumns: [],
        timeRange: 'none',
        customStart: '',
        customEnd: '',
        visualization: 'table',
        currentPage: 1,
        pageSize: 32
      }
    ]);
    setActiveTabId(newId);
  };

  const handleDeleteTab = (tabId: string) => {
    // Keep at least one tab
    if (tabs.length <= 1) return;

    const deletingIndex = tabs.findIndex(t => t.id === tabId);
    const nextTabs = tabs.filter(t => t.id !== tabId);
    const nextActiveId =
      activeTabId === tabId
        ? (nextTabs[Math.max(0, deletingIndex - 1)]?.id ?? nextTabs[0]?.id ?? activeTabId)
        : activeTabId;

    setTabs(() =>
      nextTabs.map((t, idx) => ({
        ...t,
        count: idx + 1, // Re-number titles
      }))
    );
    setActiveTabId(nextActiveId);
  };

  const handleExport = (format: string) => {
    const { queryResult } = activeTab;
    if (!queryResult || !queryResult.data || !queryResult.columns) return;

    if (format === 'csv') {
      const header = queryResult.columns.join(',');
      const rows = queryResult.data.map(row => row.map(val => {
        if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
        return val;
      }).join(','));
      const csv = [header, ...rows].join('\n');
      downloadFile(csv, 'export.csv', 'text/csv');
    } else if (format === 'json') {
      const jsonData = queryResult.data.map(row => {
        const obj: any = {};
        queryResult.columns!.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        return obj;
      });
      downloadFile(JSON.stringify(jsonData, null, 2), 'export.json', 'application/json');
    }
  };

  const handleOpenSaveDashboard = () => {
    setSaveCellName(editingCellId ? editingCellName : (activeTab.expandedTable || 'Query Cell'));
    setSaveDashboardId(editingDashboardId || '');
    setSaveNewName('');
    setSaveNewDesc('');
    setSaveCellType(activeTab.visualization as 'table' | 'line' | 'bar');
    setSaveSelectedDb(selectedDb);
    setShowSaveDashboardModal(true);
  };

  const handleSaveToDashboard = () => {
    if (!saveCellName.trim()) return;
    const cellName = saveCellName.trim();
    const DASH_KEY = `iotedge-dashboards-${activeServer?.id || 'default'}`;
    let dashboards: any[];
    try {
      dashboards = JSON.parse(localStorage.getItem(DASH_KEY) || '[]');
    } catch {
      dashboards = [];
    }

    const newCell = {
      id: generateId(),
      name: cellName,
      type: saveCellType,
      queries: [{
        id: generateId(),
        text: activeTab.queryCode,
        database: saveSelectedDb
      }],
      w: 4,
      h: 3,
      x: 0,
      y: 9999
    };

    let targetId = saveDashboardId;
    if (!targetId) {
      targetId = generateId();
    }

    if (editingCellIdRef.current && editingDashboardIdRef.current) {
      dashboards = dashboards.map(d => {
        if (d.id !== editingDashboardIdRef.current) return d;
        return {
          ...d,
          updatedAt: Date.now(),
          cells: d.cells.map((c: any) => {
            if (c.id !== editingCellIdRef.current) return c;
            return {
              ...c,
              name: cellName,
              type: saveCellType,
              queries: [{
                id: c.queries?.[0]?.id || generateId(),
                text: activeTab.queryCode,
                database: saveSelectedDb
              }]
            };
          })
        };
      });
      setEditingCellId(null);
      setEditingCellName('');
      setEditingDashboardId(null);
    } else if (!saveDashboardId) {
      dashboards.push({
        id: targetId,
        name: saveNewName.trim() || 'New Dashboard',
        description: saveNewDesc.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cells: [newCell],
        timeRange: 'none',
        autoRefresh: 0
      });
    } else {
      dashboards = dashboards.map(d => {
        if (d.id === targetId) {
          return { ...d, updatedAt: Date.now(), cells: [...(d.cells || []), newCell] };
        }
        return d;
      });
    }

    try {
      localStorage.setItem(DASH_KEY, JSON.stringify(dashboards));
    } catch { /* ignore */ }

    setShowSaveDashboardModal(false);
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 5000);
  };

  const handleGoToDashboards = () => {
    setShowSavedToast(false);
    if (onNavigate) onNavigate('dashboards');
  };

  if (!activeServer) {
    return (
      <div className="explorer-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column' }}>
        <h2>{t('views.dataExplorer.noServerTitle')}</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{t('views.dataExplorer.noServerHint')}</p>
      </div>
    );
  }

  const hasData = !!(activeTab.queryResult?.success && activeTab.queryResult.data && activeTab.queryResult.data.length > 0);

  const PAGE_SIZE = activeTab.pageSize || 32;
  const currentPage = activeTab.currentPage || 1;
  const totalRows = activeTab.queryResult?.data?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const currentData = activeTab.queryResult?.data?.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="explorer-container">
      {/* Schema Browser Side Panel */}
      <div className="schema-browser">
        <div className="schema-header">
          <h3>{t('views.dataExplorer.schemaTitle')}</h3>
          <div className="schema-actions">
            <button
              className="icon-btn-small"
              title={t('views.dataExplorer.refreshDatabasesTooltip')}
              onClick={handleRefreshDatabases}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isRefreshingDbs ? 0.5 : 1 }}
              disabled={isRefreshingDbs}
            >
              <RefreshCw size={14} className={isRefreshingDbs ? 'spin' : ''} />
            </button>
          </div>
        </div>

        <div className="schema-search">
          <Database size={14} className="input-icon" />
          <select
            className="db-select"
            value={selectedDb}
            onChange={(e) => setSelectedDb(e.target.value)}
          >
            <option value="">{t('views.dataExplorer.noDatabaseSelected')}</option>
            {databases.map(db => (
              <option key={db.name} value={db.name}>{db.name}</option>
            ))}
            {databases.length === 0 && <option value="">{t('views.dataExplorer.loading')}</option>}
          </select>
        </div>

        <div className="schema-search" style={{ marginTop: '8px' }}>
          <Search size={14} className="input-icon" />
          <input type="text" placeholder={t('views.dataExplorer.searchTablesPlaceholder')} className="table-search" value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} />
        </div>

        <div className="schema-tree">
          {measurements.filter(m => m.name.toLowerCase().includes(tableSearch.toLowerCase())).map(m => (
            <React.Fragment key={m.name}>
              <div
                className={`tree-item ${activeTab.expandedTable === m.name ? 'active' : ''}`}
                onClick={() => toggleTableExpand(m.name)}
              >
                <Table2 size={14} /> {m.name}
              </div>
              {activeTab.expandedTable === m.name && (
                <div className="tree-children">
                  {tableColumns[m.name] ? (
                    tableColumns[m.name].map(col => {
                      const schema = tableSchemas[m.name] || { tags: [], fields: [], types: {} };
                      const isTime = col === 'time';
                      const isTag = schema.tags.includes(col);
                      const isField = schema.fields.includes(col) || (!isTime && !isTag);
                      const colType = schema.types?.[col] || (isTime ? 'timestamp' : isTag ? 'string' : '');

                      return isTag ? (
                        <div key={col} style={{ position: 'relative' }}>
                          <TagDropdown
                            tableName={m.name}
                            columnName={col}
                            selectedDb={selectedDb}
                            initialChecked={getSelectedTagValues(activeTab.queryCode, col)}
                            onSelectValue={(val: string[]) => handleTagValueSelect(col, val)}
                            trailing={colType && <span className="col-type-badge" data-type={colType} title={colType}>{colType}</span>}
                          >
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', minWidth: 0, overflow: 'hidden' }}>
                              <input
                                type="checkbox"
                                checked={activeTab.selectedColumns.includes(col)}
                                onChange={(e) => handleColumnSelect(m.name, col, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Tag size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
                              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={col}>{col}</span>
                            </label>
                          </TagDropdown>
                        </div>
                      ) : (
                        <div key={col} className="tree-leaf" style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', minWidth: 0, overflow: 'hidden' }}>
                            <input
                              type="checkbox"
                              checked={activeTab.selectedColumns.includes(col)}
                              onChange={(e) => handleColumnSelect(m.name, col, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            {isTime && <Clock size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />}
                            {isField && <Hash size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />}
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={col}>{col}</span>
                          </label>
                          {colType && <span className="col-type-badge" data-type={colType} title={colType}>{colType}</span>}
                        </div>
                      );
                    })
                  ) : (
                    <div className="tree-leaf" style={{ opacity: 0.5 }}>{t('views.dataExplorer.loading')}</div>
                  )}
                </div>
              )}
            </React.Fragment>
          ))}
          {measurements.length === 0 && selectedDb && (
            <div className="tree-item" style={{ opacity: 0.5, fontSize: '12px' }}>
              {t('views.dataExplorer.noTablesFound')}
            </div>
          )}
        </div>
      </div>

      {/* Query Workspace */}
      <div className="query-workspace">
        <div className="query-tabs">
          <div className="query-tabs-scroll">
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`tab ${activeTabId === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span>{t('views.dataExplorer.queryTabTitle', { count: tab.count })}</span>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn-small tab-delete-btn"
                    title="Delete tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTab(tab.id);
                    }}
                    aria-label="Delete tab"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button className="icon-btn-small" onClick={handleAddTab}><Plus size={16} /></button>
          </div>

          <div className="query-tabs-actions">
            <button
              className="icon-btn ai-query-btn"
              title={t('views.dataExplorer.aiAssistant')}
              onClick={() => setShowAiPanel(true)}
            >
              <Sparkles size={14} />
              <span>{t('views.dataExplorer.aiAssistant')}</span>
            </button>

            <button
              className="icon-btn history-btn"
              title={t('views.dataExplorer.queryHistoryTitle')}
              onClick={() => { setShowDrawer(true); setDrawerTab('history'); }}
            >
              <History size={14} />
              <span>{t('views.dataExplorer.historyButton')}</span>
            </button>
          </div>
        </div>

        <div className="query-toolbar">
          <button
            className="btn btn-primary run-query"
            onClick={handleRunQuery}
            disabled={isQuerying || isLoadingDbs || isRefreshingDbs}
            title={`${t('views.dataExplorer.runQuery')} (${isMac ? '⌘' : 'Ctrl'}+Enter)`}
          >
            <Play size={16} />
            {t('views.dataExplorer.runQuery')}
            <span className="run-query-kbd">
              {isMac ? <Command size={13} /> : <span className="kbd-ctrl-text">Ctrl</span>}
              <CornerDownLeft size={13} />
            </span>
          </button>

          <div className="query-actions">
            <select
              className="time-range"
              value={activeTab.timeRange}
              onChange={(e) => handleTimeRangeChange(e.target.value)}
            >
              <option value="15 minutes">{t('views.dataExplorer.past15m')}</option>
              <option value="1 hour">{t('views.dataExplorer.past1h')}</option>
              <option value="6 hours">{t('views.dataExplorer.past6h')}</option>
              <option value="24 hours">{t('views.dataExplorer.past24h')}</option>
              <option value="7 days">{t('views.dataExplorer.past7d')}</option>
              <option value="30 days">{t('views.dataExplorer.past30d')}</option>
              <option value="none">{t('views.dataExplorer.allTime')}</option>
              <option value="custom">{t('views.dataExplorer.custom')}</option>
            </select>

            <button
              className="btn btn-outlined run-query"
              onClick={handleFormatSql}
              title={t('views.dataExplorer.formatSql')}
              disabled={!activeTab.queryCode.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
            >
              <AlignLeft size={16} />
              {t('views.dataExplorer.formatSql')}
            </button>

          </div>
        </div>

        <div className="query-editor-area" ref={editorAreaRef}>
          <CodeMirror
            ref={editorRef}
            value={activeTab.queryCode}
            height="100%"
            theme={vscodeDark}
            basicSetup={{ foldGutter: false, lineNumbers: false }}
            extensions={staticExtensions}
            onChange={(value) => { updateActiveTab({ queryCode: value }); }}
            className="code-editor-cm"
          />
        </div>

        <div className="results-toolbar">
          <div className="visualizations" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                className={`icon-btn ${activeTab.visualization === 'table' ? 'active' : ''}`}
                onClick={() => updateActiveTab({ visualization: 'table' })}
              >
                <Table2 size={18} />
              </button>
              <button
                className={`icon-btn ${activeTab.visualization === 'line' ? 'active' : ''}`}
                onClick={() => updateActiveTab({ visualization: 'line' })}
              >
                <LineChart size={18} />
              </button>
              <button
                className={`icon-btn ${activeTab.visualization === 'bar' ? 'active' : ''}`}
                onClick={() => updateActiveTab({ visualization: 'bar' })}
              >
                <BarChart2 size={18} />
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {hasData && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                <Activity size={14} />
                <span>
                  {t('views.dataExplorer.rowsInTime', { rows: (activeTab.queryResult?.row_count || 0).toLocaleString(i18n.language), ms: activeTab.queryResult?.execution_time_ms || 0 })}
                </span>
              </div>
            )}
            <button
              className="btn btn-outlined"
              onClick={handleOpenSaveDashboard}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
            >
              <LayoutDashboard size={14} />
              {t('views.dataExplorer.saveToDashboard')}
            </button>
            {hasData && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Download size={14} className="text-secondary" style={{ color: 'var(--text-secondary)' }} />
                <select className="time-range" value="" onChange={(e) => handleExport(e.target.value)}>
                  <option value="" disabled>{t('views.dataExplorer.export')}</option>
                  <option value="csv">{t('views.dataExplorer.exportCsv')}</option>
                  <option value="json">{t('views.dataExplorer.exportJson')}</option>
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="results-pane">
          <div className="mock-table-container">
            {activeTab.visualization === 'table' ? (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table className="results-table">
                  {activeTab.queryResult?.success && activeTab.queryResult.columns ? (
                    <>
                      <thead>
                        <tr>
                          {activeTab.queryResult.columns.map((col, idx) => (
                            <th key={idx}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {currentData?.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {row.map((val, valIdx) => (
                              <td key={valIdx}>{val?.toString()}</td>
                            ))}
                          </tr>
                        ))}
                        {(!activeTab.queryResult.data || activeTab.queryResult.data.length === 0) && (
                          <tr>
                            <td colSpan={activeTab.queryResult.columns.length} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                              {t('views.dataExplorer.noDataReturned')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </>
                  ) : (
                    <tbody>
                      <tr>
                        <td style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                          {isQuerying ? t('views.dataExplorer.executingQuery') : (activeTab.queryResult?.error || t('views.dataExplorer.runAQueryToSeeResults'))}
                        </td>
                      </tr>
                    </tbody>
                  )}
                </table>
              </div>
            ) : (
              (activeTab.queryResult?.success && activeTab.queryResult.data && activeTab.queryResult.data.length > 0) ? (() => {
                const chartOption = buildChartOption(activeTab.visualization, activeTab.queryResult);
                if (isChartError(chartOption)) {
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '200px', gap: '10px', padding: '20px' }}>
                      <span style={{ color: '#f59e0b', fontSize: '15px', fontWeight: 500 }}>{t('views.dataExplorer.chartError')}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', maxWidth: '480px', lineHeight: 1.6 }}>
                        {chartOption.chartError}
                      </span>
                    </div>
                  );
                }
                return chartOption ? (
                  <div style={{ padding: '16px', height: '100%', minHeight: '300px', display: 'flex', flexDirection: 'column' }}>
                    <ReactECharts
                      option={chartOption}
                      notMerge={true}
                      style={{ flex: 1, minHeight: '300px', width: '100%' }}
                      opts={{ renderer: 'canvas' }}
                    />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                    {t('views.dataExplorer.noDataToChart')}
                  </div>
                );
              })() : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                  {isQuerying ? t('views.dataExplorer.executingQuery') : t('views.dataExplorer.noDataToChart')}
                </div>
              )
            )}

            {hasData && activeTab.visualization === 'table' && (
              <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)', gap: '24px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{t('views.dataExplorer.rowsPerPage')}</span>
                  <select
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }}
                    value={PAGE_SIZE}
                    onChange={(e) => updateActiveTab({ pageSize: Number(e.target.value), currentPage: 1 })}
                  >
                    <option style={{ color: '#000' }} value={16}>16</option>
                    <option style={{ color: '#000' }} value={32}>32</option>
                    <option style={{ color: '#000' }} value={128}>128</option>
                  </select>
                </div>

                <div>
                  {t('views.dataExplorer.rowsRangeOf', {
                    from: (currentPage - 1) * PAGE_SIZE + 1,
                    to: Math.min(currentPage * PAGE_SIZE, totalRows),
                    total: totalRows
                  })}
                </div>

                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="icon-btn-small"
                    disabled={currentPage === 1}
                    onClick={() => updateActiveTab({ currentPage: currentPage - 1 })}
                    style={{ padding: '4px', opacity: currentPage === 1 ? 0.3 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="icon-btn-small"
                    disabled={currentPage === totalPages}
                    onClick={() => updateActiveTab({ currentPage: currentPage + 1 })}
                    style={{ padding: '4px', opacity: currentPage === totalPages ? 0.3 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {showSaveDashboardModal && (() => {
              const DASH_KEY = `iotedge-dashboards-${activeServer?.id || 'default'}`;
              let existingDashboards: any[];
              try {
                existingDashboards = JSON.parse(localStorage.getItem(DASH_KEY) || '[]');
              } catch {
                existingDashboards = [];
              }
              return (
                <div className="modal-overlay" onClick={() => setShowSaveDashboardModal(false)}>
                  <div className="modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                      <h3>{t('views.dataExplorer.saveToDashboard')}</h3>
                      <button className="icon-btn" onClick={() => setShowSaveDashboardModal(false)}>
                        <X size={20} />
                      </button>
                    </div>
                    <div className="modal-body">
                      <div className="form-group">
                        <label>{t('views.dashboards.cellNameLabel')}</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder={t('views.dashboards.cellNamePlaceholder')}
                          value={saveCellName}
                          onChange={e => setSaveCellName(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('views.dashboards.visualizationType')}</label>
                        <div className="viz-type-switcher">
                          <button className={`viz-btn ${saveCellType === 'table' ? 'active' : ''}`}
                            onClick={() => setSaveCellType('table')}>
                            <Table2 size={16} />
                          </button>
                          <button className={`viz-btn ${saveCellType === 'line' ? 'active' : ''}`}
                            onClick={() => setSaveCellType('line')}>
                            <LineChart size={16} />
                          </button>
                          <button className={`viz-btn ${saveCellType === 'bar' ? 'active' : ''}`}
                            onClick={() => setSaveCellType('bar')}>
                            <BarChart2 size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="form-group">
                        <label>{t('views.dataExplorer.database')}</label>
                        <select
                          className="form-select"
                          value={saveSelectedDb}
                          onChange={e => setSaveSelectedDb(e.target.value)}
                        >
                          <option value="">-- {t('views.dataExplorer.selectDatabase')} --</option>
                          {databases.map(db => (
                            <option key={db.name} value={db.name}>{db.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>{t('views.dashboards.title')}</label>
                        <select
                          className="form-select"
                          value={saveDashboardId}
                          onChange={e => {
                            setSaveDashboardId(e.target.value);
                            if (e.target.value !== '__new__') {
                              setSaveNewName('');
                              setSaveNewDesc('');
                            }
                          }}
                        >
                          <option value="">-- {t('views.dashboards.createDashboard')} --</option>
                          {existingDashboards.map((d: any) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                      {saveDashboardId === '' && (
                        <>
                          <div className="form-group">
                            <label>{t('views.dashboards.nameLabel')}</label>
                            <input
                              type="text"
                              className="form-input"
                              placeholder={t('views.dashboards.namePlaceholder')}
                              value={saveNewName}
                              onChange={e => setSaveNewName(e.target.value)}
                            />
                          </div>
                          <div className="form-group">
                            <label>{t('views.dashboards.descriptionLabel')}</label>
                            <textarea
                              className="form-textarea"
                              placeholder={t('views.dashboards.descriptionPlaceholder')}
                              value={saveNewDesc}
                              onChange={e => setSaveNewDesc(e.target.value)}
                              rows={2}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="modal-footer">
                      <button className="btn btn-outlined" onClick={() => setShowSaveDashboardModal(false)}>
                        {t('views.dataExplorer.cancel')}
                      </button>
                      <button className="btn btn-primary" onClick={handleSaveToDashboard}>
                        {t('views.dashboards.save')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {showSavedToast && (
              <div className="saved-toast">
                <span>{t('views.dataExplorer.savedToDashboard')}</span>
                <button className="saved-toast-link" onClick={handleGoToDashboards}>
                  {t('views.dataExplorer.goToDashboards')}
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom Time Modal */}
      {showTimeModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{t('views.dataExplorer.selectCustomTimeRangeTitle')}</h3>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t('views.dataExplorer.startTimeLabel')}</label>
                <input
                  type="datetime-local"
                  className="time-range"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={activeTab.customStart}
                  onChange={(e) => updateActiveTab({ customStart: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>{t('views.dataExplorer.endTimeLabel')}</label>
                <input
                  type="datetime-local"
                  className="time-range"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={activeTab.customEnd}
                  onChange={(e) => updateActiveTab({ customEnd: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-outlined"
                onClick={() => {
                  setShowTimeModal(false);
                  updateActiveTab({ timeRange: prevTimeRange });
                }}
              >
                {t('views.dataExplorer.cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowTimeModal(false);
                  setTabs(prev => prev.map(t => {
                    if (t.id === activeTabId) {
                      const newSql = applyTimeRangeToQuery(t.queryCode, 'custom', activeTab.customStart, activeTab.customEnd);
                      return { ...t, queryCode: newSql };
                    }
                    return t;
                  }));
                }}
              >
                {t('views.dataExplorer.apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Query History & Favorites Drawer */}
      {drawerAnim !== 'hidden' && (
        <div className={`drawer-overlay drawer-overlay-${drawerAnim}`} onClick={() => setShowDrawer(false)}>
          <div className={`drawer-content drawer-content-${drawerAnim}`} onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h3>{t('views.dataExplorer.queryHistoryTitle')}</h3>
              <button className="icon-btn" onClick={() => setShowDrawer(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="drawer-tabs">
              <div
                className={`drawer-tab${drawerTab === 'history' ? ' active' : ''}`}
                onClick={() => setDrawerTab('history')}
              >
                {t('views.dataExplorer.historyTab')}
              </div>
              <div
                className={`drawer-tab${drawerTab === 'favorites' ? ' active' : ''}`}
                onClick={() => setDrawerTab('favorites')}
              >
                {t('views.dataExplorer.favoritesTab')}
              </div>
            </div>

            <div className="drawer-body">
              {drawerTab === 'history' ? (
                queryHistory.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px' }}>{t('views.dataExplorer.noHistoryYet')}</p>
                ) : (
                  <div>
                    {queryHistory.map(item => (
                      <div key={item.id} className="history-item">
                        <div className="history-item-header">
                          <div className="history-time">
                            {formatTime(item.timestamp, i18n.language)}
                          </div>
                          <div className="history-item-actions">
                            <button
                              className={`history-action-btn star${isFavorite(item.id) ? ' active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(item);
                              }}
                              title={isFavorite(item.id) ? t('views.dataExplorer.removeFromFavorites') : t('views.dataExplorer.addToFavorites')}
                            >
                              <Star size={14} fill={isFavorite(item.id) ? '#fadb14' : 'none'} />
                            </button>
                          </div>
                        </div>
                        <pre
                          className="history-query history-query-clickable"
                          onClick={() => {
                            updateActiveTab({ queryCode: item.query });
                            setShowDrawer(false);
                          }}
                        >
                          {item.query}
                        </pre>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                favoriteQueries.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px' }}>{t('views.dataExplorer.noFavoritesYet')}</p>
                ) : (
                  <div>
                    {favoriteQueries.map(item => (
                      <div key={item.id} className="history-item">
                        <div className="history-item-header">
                          <div className="history-time">
                            {formatTime(item.timestamp, i18n.language)}
                          </div>
                          <div className="history-item-actions">
                            <button
                              className="history-action-btn star active"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(item);
                              }}
                              title={t('views.dataExplorer.removeFromFavorites')}
                            >
                              <Star size={14} fill="#fadb14" />
                            </button>
                          </div>
                        </div>
                        <pre
                          className="history-query history-query-clickable"
                          onClick={() => {
                            updateActiveTab({ queryCode: item.query });
                            setShowDrawer(false);
                          }}
                        >
                          {item.query}
                        </pre>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            <div className="drawer-footer">
              {drawerTab === 'history' && (
                <button
                  className="btn btn-outlined"
                  onClick={() => {
                    setQueryHistory([]);
                    localStorage.removeItem('queryHistory');
                  }}
                  disabled={queryHistory.length === 0}
                >
                  {t('views.dataExplorer.clearHistory')}
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => setShowDrawer(false)}
              >
                {t('views.dataExplorer.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Query Assistant Panel */}
      <AiQueryPanel
        open={showAiPanel}
        onClose={() => {
          setShowAiPanel(false);
          setAiPresetQuestion(undefined);
          setAiPresetInput(undefined);
          setAiSqlContext(undefined);
          setAiErrorContext(undefined);
        }}
        selectedDb={selectedDb}
        databases={databases}
        tableSchemas={tableSchemas}
        measurements={measurements}
        onInsertToEditor={handleAiInsertToEditor}
        onRunQuery={handleAiRunQuery}
        editorSql={activeTab.queryCode}
        onAcceptSql={(sql: string) => {
          updateActiveTab({ queryCode: sql });
        }}
        presetQuestion={aiPresetQuestion}
        presetInput={aiPresetInput}
        sqlContext={aiSqlContext}
        onClearSqlContext={() => setAiSqlContext(undefined)}
        errorContext={aiErrorContext}
        onClearErrorContext={() => setAiErrorContext(undefined)}
        onNavigateToIntegrations={() => onNavigate?.('integrations')}
      />
    </div>
  );
};

export default DataExplorer;
