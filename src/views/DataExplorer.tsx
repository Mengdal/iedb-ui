import React, { useState, useEffect, useRef } from 'react';
import { Play, History, Plus, Database, Table2, LineChart, BarChart2, Search, Download, Loader2, Activity, ChevronLeft, ChevronRight, RefreshCw, Sparkles, X, Clock, Tag, Hash, Filter, LayoutDashboard, ArrowRight, Star } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import type { CurrentView } from '../App';
import { buildChartOption, downloadFile, isChartError } from '../utils/chartUtils';
import './DataExplorer.css';

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

const defaultQuery = "SELECT\n  *\nFROM cpu\nWHERE\n  time >= now() - interval '1 hour'\nLIMIT 1000";



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

const TagDropdown = ({ tableName, columnName, activeServer, selectedDb, onSelectValue, initialChecked, children }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedValues, setCheckedValues] = useState<string[]>([]);
  const { t } = useTranslation();

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen) {
      setIsOpen(true);
      setSearchQuery('');
      setCheckedValues(initialChecked || []);
      if (values.length === 0) {
        setIsLoading(true);
        const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, "");
        fetch(`${baseUrl}/api/v1/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeServer.token}`,
            'x-iedb-database': selectedDb
          },
          body: JSON.stringify({
            sql: `SELECT DISTINCT ${columnName} FROM ${tableName} LIMIT 1000`
          })
        })
          .then(r => r.json())
          .then((data: QueryResponse) => {
            if (data.success && data.data) {
              const vals = data.data.map(row => row[0]?.toString() || '');
              setValues(vals.filter(v => v !== ''));
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
      <div className="tree-leaf" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '8px' }}>
        {children}
        <button
          type="button"
          className="icon-btn-small"
          onClick={handleToggle}
          title={t('views.dataExplorer.filterTag', 'Filter Tag')}
          style={{ padding: '2px', marginLeft: '4px', opacity: 0.7 }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
        >
          <Filter size={12} color={isOpen ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
        </button>
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
  const { t, i18n } = useTranslation();
  const [databases, setDatabases] = useState<DatabaseItem[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [measurements, setMeasurements] = useState<MeasurementItem[]>([]);
  const [tableColumns, setTableColumns] = useState<Record<string, string[]>>({});
  const [tableSchemas, setTableSchemas] = useState<Record<string, { tags: string[], fields: string[] }>>({});

  const [tabs, setTabs] = useState<QueryTab[]>([{
    id: '1',
    count: 1,
    queryCode: defaultQuery,
    queryResult: null,
    expandedTable: null,
    selectedColumns: [],
    timeRange: '1 hour',
    customStart: '',
    customEnd: '',
    visualization: 'table',
    currentPage: 1,
    pageSize: 32
  }]);
  const [activeTabId, setActiveTabId] = useState('1');
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
  const [drawerTab, setDrawerTab] = useState<'history' | 'favorites'>('history');

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
  const [prevTimeRange, setPrevTimeRange] = useState("1 hour");

  const [queryMode, setQueryMode] = useState<'sql' | 'nl'>('sql');
  const [nlQuery, setNlQuery] = useState('');
  const [isGeneratingSql, setIsGeneratingSql] = useState(false);

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

  const schemaCacheRef = useRef<Record<string, any>>({});
  const selectedDbRef = useRef(selectedDb);
  selectedDbRef.current = selectedDb;
  const editingCellIdRef = useRef(editingCellId);
  editingCellIdRef.current = editingCellId;
  const editingDashboardIdRef = useRef(editingDashboardId);
  editingDashboardIdRef.current = editingDashboardId;

  const updateActiveTab = (updates: Partial<QueryTab>) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, ...updates } : t));
  };

  useEffect(() => {
    try {
      const pending = localStorage.getItem('iotedge-pending-query');
      if (pending) {
        const { text, database, cellId, dashboardId, cellName, cellType } = JSON.parse(pending);
        const newId = Date.now().toString();
        setTabs(prev => [
          ...prev,
          {
            id: newId,
            count: prev.length + 1,
            queryCode: text || defaultQuery,
            queryResult: null,
            expandedTable: null,
            selectedColumns: [],
            timeRange: '1 hour',
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
    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, "");
    fetch(`${baseUrl}/api/v1/databases`, {
      headers: {
        'Authorization': `Bearer ${activeServer.token}`
      }
    })
      .then(r => r.json())
      .then(data => {
        if (data && data.databases) {
          setDatabases(data.databases);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoadingDbs(false));
  }, [activeServer]);

  const handleRefreshDatabases = () => {
    if (!activeServer) return;
    setIsRefreshingDbs(true);
    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, "");
    fetch(`${baseUrl}/api/v1/databases`, {
      headers: {
        'Authorization': `Bearer ${activeServer.token}`
      }
    })
      .then(r => r.json())
      .then(data => {
        if (data && data.databases) {
          setDatabases(data.databases);
          if (data.databases.length > 0) {
            const match = data.databases.find((d: any) => d.name === selectedDb);
            if (!match) setSelectedDb('');
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

  // Fetch Measurements
  useEffect(() => {
    if (selectedDb && activeServer) {
      const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, "");
      fetch(`${baseUrl}/api/v1/databases/${selectedDb}/measurements`, {
        headers: {
          'Authorization': `Bearer ${activeServer.token}`
        }
      })
        .then(r => r.json())
        .then(data => {
          if (data && data.measurements) {
            setMeasurements(data.measurements);
            // Optionally, prefetch schemas to power autocomplete instantly
            data.measurements.forEach((m: MeasurementItem) => {
              if (!tableColumns[m.name]) {
                fetch(`${baseUrl}/api/v1/databases/${selectedDb}/measurements/${m.name}/schema`, {
                  headers: { 'Authorization': `Bearer ${activeServer.token}` }
                })
                  .then(r => r.json())
                  .then(schemaData => {
                    if (schemaData.success) {
                      const tags = schemaData.tags || [];
                      const fields = schemaData.fields || [];
                      const cols = ['time', ...tags, ...fields];
                      if (cols.length > 0) {
                        setTableColumns(prev => ({ ...prev, [m.name]: cols }));
                        setTableSchemas(prev => ({ ...prev, [m.name]: { tags, fields } }));
                      }
                    }
                  })
                  .catch(() => { }); // silent catch for background prefetch
              }
            });
          }
        })
        .catch(console.error);
    }
  }, [selectedDb, activeServer]);

  const updateSQL = (table: string | null, columns: string[], timeR: string, start?: string, end?: string) => {
    let timeClause = `time >= now() - interval '${timeR}'`;

    if (timeR === 'custom') {
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
    }

    const isNewTable = table && table !== activeTab.expandedTable;

    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        let updatedCode = t.queryCode;

        // Option 2: Completely overwrite SQL when switching to a new table to avoid regex corruption
        if (isNewTable && table) {
          const colsStr = columns.length > 0 ? columns.join(',\n  ') : '*';
          updatedCode = `SELECT\n  ${colsStr}\nFROM ${table}\nWHERE\n  ${timeClause}\nLIMIT 1000`;
          return { ...t, queryCode: updatedCode };
        }

        if (!updatedCode && table) {
          const colsStr = columns.length > 0 ? columns.join(',\n  ') : '*';
          updatedCode = `SELECT\n  ${colsStr}\nFROM ${table}\nWHERE\n  ${timeClause}\nLIMIT 1000`;
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
          if (!updatedCode.includes('WHERE')) {
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

          const head = updatedCode.substring(0, whereIndex + 5);
          const tail = updatedCode.substring(limitIndex);

          updatedCode = `${head}\n  ${timeClause}`;
          if (tagFilters) updatedCode += `\n  AND ${tagFilters.replace(/^AND\s+/i, '')}`;
          if (tail.trim()) updatedCode += `\n${tail.trimStart()}`;
        } else {
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
        const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, "");
        fetch(`${baseUrl}/api/v1/databases/${selectedDb}/measurements/${tableName}/schema`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${activeServer.token}`
          }
        })
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              const tags = data.tags || [];
              const fields = data.fields || [];
              const cols = ['time', ...tags, ...fields];
              if (cols.length > 0) {
                setTableColumns(prev => ({ ...prev, [tableName]: cols }));
                setTableSchemas(prev => ({ ...prev, [tableName]: { tags, fields } }));
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

    // Only replace existing time conditions. If user's SQL has no time condition,
    // we respect their intent (e.g. LIMIT 1 "get latest" queries, WHERE path='/' etc.)
    // and do NOT force-inject a time filter.
    return sql;
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

  const handleRunQuery = () => {
    const sql = activeTab.queryCode.trim();
    if (!sql || !activeServer) return;
    setIsQuerying(true);

    setQueryHistory(prev => {
      // Don't duplicate the very last query
      if (prev.length > 0 && prev[0].query === sql) return prev;

      const newItem = { id: Date.now().toString(), query: sql, timestamp: Date.now() };
      const newHistory = [newItem, ...prev].slice(0, 50); // Keep top 50
      localStorage.setItem('queryHistory', JSON.stringify(newHistory));
      return newHistory;
    });

    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, "");
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${activeServer.token}`,
    };
    if (selectedDb) {
      headers['x-iedb-database'] = selectedDb;
    }
    fetch(`${baseUrl}/api/v1/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sql: activeTab.queryCode
      })
    })
      .then(r => r.json())
      .then((data: QueryResponse) => {
        updateActiveTab({ queryResult: data, currentPage: 1 });
        setIsQuerying(false);
      })
      .catch(err => {
        console.error(err);
        setIsQuerying(false);
      });
  };

  const handleGenerateSQL = async () => {
    if (!nlQuery.trim() || !activeServer) return;

    const provider = localStorage.getItem('iotedge-ai-provider') || 'lmstudio';
    const apiKey = localStorage.getItem('iotedge-ai-apikey') || '';
    const baseUrl = localStorage.getItem('iotedge-ai-baseurl') || 'http://localhost:1234/v1';
    const customInstructions = localStorage.getItem('iotedge-ai-instructions') || '';

    if (!baseUrl) {
      alert(t('views.dataExplorer.aiProviderBaseUrlMissing'));
      return;
    }

    if (!selectedDb) {
      alert(t('views.dataExplorer.selectDatabaseFirst'));
      return;
    }

    setIsGeneratingSql(true);

    try {
      const serverBaseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, "");

      // 1. Get or Build Schema Snapshot
      let schemaSnapshot = schemaCacheRef.current[selectedDb];

      if (!schemaSnapshot) {
        // Fetch all measurements
        const measurementsRes = await fetch(`${serverBaseUrl}/api/v1/databases/${encodeURIComponent(selectedDb)}/measurements`, {
          headers: { 'Authorization': `Bearer ${activeServer.token}` }
        });
        const measurementsData = await measurementsRes.json();
        const measurementsList = measurementsData.measurements || [];

        schemaSnapshot = {
          database: selectedDb,
          measurements: [] as any[]
        };

        // Fetch columns for all measurements in parallel
        await Promise.all(measurementsList.map(async (m: { name: string }) => {
          try {
            const queryRes = await fetch(`${serverBaseUrl}/api/v1/query`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${activeServer.token}`,
                'x-iedb-database': selectedDb
              },
              body: JSON.stringify({
                sql: `SELECT * FROM ${m.name} LIMIT 1`
              })
            });
            const data = await queryRes.json();
            if (data.success && data.columns) {
              schemaSnapshot.measurements.push({
                name: m.name,
                columns: data.columns.filter((c: string) => c !== 'row_id')
              });
            } else {
              schemaSnapshot.measurements.push({ name: m.name, columns: [] });
            }
          } catch (e) {
            schemaSnapshot.measurements.push({ name: m.name, columns: [] });
          }
        }));

        schemaCacheRef.current[selectedDb] = schemaSnapshot;
      }

      // 2. Build Prompt Matches
      const systemPrompt = `You are an NL2SQL assistant for IotEdge DB (DuckDB/InfluxDB SQL compatible). You MUST call tools to get schema/context before generating SQL. Only output SQL, no markdown, no explanation. Only SELECT is allowed.`;

      let userPrompt = `Database: ${selectedDb}\n\n`;

      if (customInstructions) {
        userPrompt += `User Custom Instructions:\n${customInstructions}\n\n`;
      }

      userPrompt += `Important Rule: 单表列引用规则。当查询只有一张表（无 JOIN）时，列名不要加表名前缀。例如写 AVG(usage)，不要写 AVG(cpu.usage)。\n\n`;

      userPrompt += `Schema:\n${JSON.stringify(schemaSnapshot, null, 2)}\n\n`;
      userPrompt += `Question: ${nlQuery}\n\nNow output one SELECT SQL only.`;

      let modelId = 'local-model';
      if (provider === 'openai') modelId = 'gpt-3.5-turbo';
      else if (provider === 'qwen') modelId = 'qwen-max';
      else if (provider === 'deepseek') modelId = 'deepseek-chat';
      else if (provider === 'zhipu') modelId = 'glm-4';
      else if (provider === 'moonshot') modelId = 'moonshot-v1-8k';
      else if (provider === 'doubao') modelId = 'doubao-lite-4k';
      else if (provider === 'tencent-hunyuan') modelId = 'hunyuan-lite';
      else if (provider === 'baidu-qianfan') modelId = 'ernie-4.0';
      else if (provider === 'iflytek-spark') modelId = 'spark-4.0';

      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      let generatedSql = data.choices?.[0]?.message?.content || '';

      // Cleanup markdown artifacts
      generatedSql = generatedSql.trim();
      if (generatedSql.startsWith('\`\`\`sql')) {
        generatedSql = generatedSql.substring(6);
      } else if (generatedSql.startsWith('\`\`\`')) {
        generatedSql = generatedSql.substring(3);
      }
      if (generatedSql.endsWith('\`\`\`')) {
        generatedSql = generatedSql.substring(0, generatedSql.length - 3);
      }
      generatedSql = generatedSql.trim();

      updateActiveTab({ queryCode: generatedSql });

    } catch (err: any) {
      console.error(err);
      alert(t('views.dataExplorer.failedToGenerateSql', { error: err?.message || '' }));
    } finally {
      setIsGeneratingSql(false);
    }
  };

  const handleAddTab = () => {
    const newId = Date.now().toString();
    setTabs(prev => [
      ...prev,
      {
        id: newId,
        count: prev.length + 1,
        queryCode: defaultQuery,
        queryResult: null,
        expandedTable: null,
        selectedColumns: [],
        timeRange: '1 hour',
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
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cellName,
      type: saveCellType,
      queries: [{
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      targetId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
                id: c.queries?.[0]?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
        timeRange: '1 hour',
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
          <input type="text" placeholder={t('views.dataExplorer.searchTablesPlaceholder')} className="table-search" />
        </div>

        <div className="schema-tree">
          {measurements.map(m => (
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
                      const schema = tableSchemas[m.name] || { tags: [], fields: [] };
                      const isTime = col === 'time';
                      const isTag = schema.tags.includes(col);
                      const isField = schema.fields.includes(col) || (!isTime && !isTag);

                      return isTag ? (
                        <div key={col} style={{ position: 'relative' }}>
                          <TagDropdown
                            tableName={m.name}
                            columnName={col}
                            activeServer={activeServer}
                            selectedDb={selectedDb}
                            initialChecked={getSelectedTagValues(activeTab.queryCode, col)}
                            onSelectValue={(val: string[]) => handleTagValueSelect(col, val)}
                          >
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <input
                                type="checkbox"
                                checked={activeTab.selectedColumns.includes(col)}
                                onChange={(e) => handleColumnSelect(m.name, col, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Tag size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={col}>{col}</span>
                            </label>
                          </TagDropdown>
                        </div>
                      ) : (
                        <div key={col} className="tree-leaf" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              checked={activeTab.selectedColumns.includes(col)}
                              onChange={(e) => handleColumnSelect(m.name, col, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            {isTime && <Clock size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />}
                            {isField && <Hash size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={col}>{col}</span>
                          </label>
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
          <button className="icon-btn-small" style={{ marginBottom: '6px' }} onClick={handleAddTab}><Plus size={16} /></button>

          <div style={{ flex: 1 }}></div>

          <button
            className="icon-btn history-btn"
            title={t('views.dataExplorer.queryHistoryTitle')}
            onClick={() => { setShowDrawer(true); setDrawerTab('history'); }}
            style={{ marginRight: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}
          >
            <History size={14} />
            <span style={{ fontSize: '13px' }}>{t('views.dataExplorer.historyButton')}</span>
          </button>
        </div>

        <div className="query-toolbar">
          <div className="query-modes">
            <button
              className={`mode-btn ${queryMode === 'sql' ? 'active' : ''}`}
              onClick={() => setQueryMode('sql')}
            >
              {t('views.dataExplorer.sql')}
            </button>
            <button
              className={`mode-btn ${queryMode === 'nl' ? 'active' : ''}`}
              onClick={() => setQueryMode('nl')}
            >
              {t('views.dataExplorer.naturalLanguage')}
            </button>
          </div>

          <div className="query-actions">
            {queryMode !== 'nl' && (
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
                <option value="custom">{t('views.dataExplorer.custom')}</option>
              </select>
            )}

            {queryMode === 'nl' && (
              <button
                className="btn btn-primary"
                onClick={handleGenerateSQL}
                disabled={isGeneratingSql || !nlQuery.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {isGeneratingSql ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} fill="white" />}
                {t('views.dataExplorer.generateSql')}
              </button>
            )}

            <button
              className="btn btn-primary run-query"
              onClick={handleRunQuery}
              disabled={isQuerying || isLoadingDbs || isRefreshingDbs}
            >
              {isQuerying ? <Loader2 size={16} className="spin" /> : <Play size={16} fill="white" />}
              {t('views.dataExplorer.runQuery')}
            </button>
          </div>
        </div>

        {queryMode === 'nl' && (
          <div className="nl-query-container">
            <textarea
              className="nl-textarea"
              placeholder={t('views.dataExplorer.askPlaceholder')}
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              disabled={isGeneratingSql}
            />
          </div>
        )}

        <div className="query-editor-area">
          <CodeMirror
            value={activeTab.queryCode}
            height="100%"
            theme={vscodeDark}
            extensions={[sql({ schema: cmSchema })]}
            onChange={(value) => updateActiveTab({ queryCode: value })}
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
      {showDrawer && (
        <div className="drawer-overlay" onClick={() => setShowDrawer(false)}>
          <div className="drawer-content" onClick={e => e.stopPropagation()}>
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
                            {new Date(item.timestamp).toLocaleString(i18n.language)}
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
                            {new Date(item.timestamp).toLocaleString(i18n.language)}
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
    </div>
  );
};

export default DataExplorer;
