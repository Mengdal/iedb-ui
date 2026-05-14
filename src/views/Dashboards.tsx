import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Plus, Search, Upload, MoreVertical, Edit, Trash2, Download,
  ArrowLeft, RefreshCw, Maximize2, Minimize2, X, ChevronDown,
  LayoutDashboard, Clock, Table2, LineChart, BarChart2
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import type { CurrentView } from '../App';
import { GridLayout } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';

const useResizeObserver = () => {
  const [width, setWidth] = useState(1200);
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) return;
    // Set initial width immediately
    if (node.offsetWidth > 0) {
      setWidth(node.offsetWidth);
    }
    const observer = new ResizeObserver((entries) => {
      window.requestAnimationFrame(() => {
        if (!Array.isArray(entries) || !entries.length) return;
        const entry = entries[0];
        if (entry.contentRect.width > 0) {
          setWidth(entry.contentRect.width);
        }
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { width, containerRef };
};
import { buildChartOption, downloadFile, isChartError } from '../utils/chartUtils';
import type { QueryResponse } from './DataExplorer';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './Dashboards.css';

interface DashboardQuery {
  id: string;
  text: string;
  database: string;
}

interface DashboardCell {
  id: string;
  name: string;
  type: 'table' | 'line' | 'bar';
  queries: DashboardQuery[];
  w: number;
  h: number;
  x?: number;
  y?: number;
}

interface Dashboard {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  cells: DashboardCell[];
  timeRange: string;
  customStart?: string;
  customEnd?: string;
  autoRefresh: number;
}

const getStorageKey = (serverId?: string) => `iotedge-dashboards-${serverId || 'default'}`;
const VALID_TIME_RANGES = ['15 minutes', '1 hour', '6 hours', '24 hours', '7 days', '30 days', 'custom'];
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;


interface DashboardsProps {
  onNavigate?: (view: CurrentView) => void;
}

const Dashboards: React.FC<DashboardsProps> = ({ onNavigate }) => {
  const { activeServer } = useServers();
  const { t, i18n } = useTranslation();

  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dashboards, setDashboards] = useState<Dashboard[]>(() => {
    try {
      const key = getStorageKey(activeServer?.id);
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [searchQuery, setSearchQuery] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDashboard, setEditingDashboard] = useState<Dashboard | null>(null);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);

  const [cellResults, setCellResults] = useState<Record<string, QueryResponse>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [contextMenu, setContextMenu] = useState<{ dashboardId: string; x: number; y: number } | null>(null);
  const [cellMenuOpen, setCellMenuOpen] = useState<string | null>(null);
  const [renameCellId, setRenameCellId] = useState<string | null>(null);
  const [renameCellName, setRenameCellName] = useState('');
  const [renameCellType, setRenameCellType] = useState<'table' | 'line' | 'bar'>('line');
  const [refreshMenuOpen, setRefreshMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [showCustomTimeModal, setShowCustomTimeModal] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [cellSearch, setCellSearch] = useState('');
  const [showAddCellModal, setShowAddCellModal] = useState(false);
  const [newCellName, setNewCellName] = useState('');

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const chartRefs = useRef<Map<string, any>>(new Map());

  const { width: gridWidth, containerRef: gridObserveRef } = useResizeObserver();

  useEffect(() => {
    chartRefs.current.forEach((instance) => {
      if (instance && !instance.isDisposed()) {
        instance.resize();
      }
    });
  }, [gridWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(getStorageKey(activeServer?.id), JSON.stringify(dashboards));
    } catch {
      // ignore
    }
  }, [dashboards]);

  // Reload dashboards when switching servers
  useEffect(() => {
    try {
      const key = getStorageKey(activeServer?.id);
      const stored = localStorage.getItem(key);
      setDashboards(stored ? JSON.parse(stored) : []);
      setSelectedId(null);
    } catch {
      setDashboards([]);
    }
  }, [activeServer?.id]);
  const currentDashboard = useMemo(
    () => dashboards.find(d => d.id === selectedId) || null,
    [dashboards, selectedId]
  );

  const filteredDashboards = useMemo(
    () => dashboards.filter(d =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.description.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [dashboards, searchQuery]
  );

  const filteredCells = useMemo(
    () => currentDashboard?.cells.filter(c =>
      c.name.toLowerCase().includes(cellSearch.toLowerCase())
    ) || [],
    [currentDashboard, cellSearch]
  );

  const currentTimeRange = useMemo(
    () => currentDashboard?.timeRange && VALID_TIME_RANGES.includes(currentDashboard.timeRange)
      ? currentDashboard.timeRange
      : '1 hour',
    [currentDashboard]
  );

  const handleCreateDashboard = () => {
    if (!createName.trim()) return;
    const now = Date.now();
    const newDashboard: Dashboard = {
      id: generateId(),
      name: createName.trim(),
      description: createDescription.trim(),
      createdAt: now,
      updatedAt: now,
      cells: [],
      timeRange: '1 hour',
      autoRefresh: 0
    };
    setDashboards(prev => [...prev, newDashboard]);
    setCreateName('');
    setCreateDescription('');
    setShowCreateModal(false);
  };

  const handleUpdateDashboard = () => {
    if (!editingDashboard || !createName.trim()) return;
    setDashboards(prev => prev.map(d =>
      d.id === editingDashboard.id
        ? { ...d, name: createName.trim(), description: createDescription.trim(), updatedAt: Date.now() }
        : d
    ));
    setEditingDashboard(null);
    setCreateName('');
    setCreateDescription('');
    setShowCreateModal(false);
  };

  const openEditModal = (dashboard: Dashboard) => {
    setEditingDashboard(dashboard);
    setCreateName(dashboard.name);
    setCreateDescription(dashboard.description);
    setShowCreateModal(true);
  };

  const openCreateModal = () => {
    setEditingDashboard(null);
    setCreateName('');
    setCreateDescription('');
    setShowCreateModal(true);
  };

  const handleDeleteDashboard = (id: string) => {
    setDashboards(prev => prev.filter(d => d.id !== id));
    setShowDeleteModal(null);
  };

  const handleExportDashboard = (dashboard: Dashboard) => {
    const json = JSON.stringify(dashboard, null, 2);
    downloadFile(json, `${dashboard.name.replace(/\s+/g, '_')}.json`, 'application/json');
  };

  const handleImportDashboard = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (!json.id || !json.name || !Array.isArray(json.cells)) {
          throw new Error('Invalid format');
        }
        const imported: Dashboard = {
          id: generateId(),
          name: json.name || 'Imported Dashboard',
          description: json.description || '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          cells: (json.cells || []).map((c: any) => ({
            id: generateId(),
            name: c.name || 'Cell',
            type: c.type || 'table',
            queries: c.queries || [{ id: generateId(), text: '', database: '' }],
            w: c.w || 4,
            h: c.h || 3,
            x: c.x || 0,
            y: c.y || 0
          })),
          timeRange: json.timeRange || '1 hour',
          autoRefresh: json.autoRefresh || 0
        };
        setDashboards(prev => [...prev, imported]);
      } catch {
        alert(t('views.dashboards.importFailed'));
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const navigateToDetail = (id: string) => {
    setSelectedId(id);
    setCellResults({});
    setViewMode('detail');
  };

  const navigateToList = () => {
    setViewMode('list');
    setSelectedId(null);
    setCellResults({});
    stopAutoRefresh();
  };

  const stopAutoRefresh = () => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
  };

  const executeQuery = useCallback(async (queryText: string, database: string): Promise<QueryResponse> => {
    if (!activeServer || !queryText.trim()) {
      return { success: false, error: 'No query to execute' };
    }
    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
    try {
      const resp = await fetch(`${baseUrl}/api/v1/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeServer.token}`,
          ...(database ? { 'x-iedb-database': database } : {})
        },
        body: JSON.stringify({ sql: queryText })
      });
      return await resp.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
  }, [activeServer]);

  const applyTimeRangeToQuery = (sql: string, timeRange: string, customStart?: string, customEnd?: string) => {
    if (!sql || !sql.trim()) return sql;
    let timeCondition = '';
    if (timeRange === 'custom') {
      if (!customStart || !customEnd) return sql;
      timeCondition = `time >= '${customStart}' AND time <= '${customEnd}'`;
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

    // If we didn't find our specific time macro patterns, we respect the user's custom SQL 
    // and DO NOT forcefully inject a time condition. This allows queries like `ORDER BY time DESC LIMIT 1` 
    // to work globally without being restricted by the dashboard time range.
    return sql;
  };

  const refreshAllCells = useCallback(async () => {
    if (!currentDashboard || currentDashboard.cells.length === 0) return;
    setIsRefreshing(true);
    const results: Record<string, QueryResponse> = {};
    const promises = currentDashboard.cells.map(async (cell) => {
      if (cell.queries.length > 0 && cell.queries[0].text.trim()) {
        const timeRange = currentDashboard.timeRange || '1 hour';
        const finalSql = applyTimeRangeToQuery(cell.queries[0].text, timeRange, currentDashboard.customStart, currentDashboard.customEnd);
        results[cell.id] = await executeQuery(finalSql, cell.queries[0].database);
      }
    });
    await Promise.all(promises);
    setCellResults(results);
    setIsRefreshing(false);
  }, [currentDashboard, executeQuery]);

  const handleRefresh = () => {
    if (isRefreshing) return;
    refreshAllCells();
  };

  const handleAutoRefreshChange = (seconds: number) => {
    if (!currentDashboard) return;
    stopAutoRefresh();
    setDashboards(prev => prev.map(d =>
      d.id === selectedId ? { ...d, autoRefresh: seconds } : d
    ));
    if (seconds > 0) {
      autoRefreshRef.current = setInterval(() => {
        refreshAllCells();
      }, seconds * 1000);
    }
  };

  const handleTimeRangeChange = (timeRange: string) => {
    if (!currentDashboard) return;
    if (timeRange === 'custom') {
      setCustomStart('');
      setCustomEnd('');
      setShowCustomTimeModal(true);
      return;
    }
    setDashboards(prev => prev.map(d =>
      d.id === selectedId ? { ...d, timeRange } : d
    ));
  };

  const handleCustomTimeApply = () => {
    if (!currentDashboard) return;
    setDashboards(prev => prev.map(d =>
      d.id === selectedId ? { ...d, timeRange: 'custom', customStart, customEnd } : d
    ));
    setShowCustomTimeModal(false);
  };

  useEffect(() => {
    if (currentDashboard && currentDashboard.autoRefresh > 0) {
      stopAutoRefresh();
      autoRefreshRef.current = setInterval(() => {
        refreshAllCells();
      }, currentDashboard.autoRefresh * 1000);
    }
    return () => stopAutoRefresh();
  }, [currentDashboard?.autoRefresh, selectedId, refreshAllCells]);

  useEffect(() => {
    if (currentDashboard && currentDashboard.cells.length > 0 && viewMode === 'detail') {
      refreshAllCells();
    }
    return () => stopAutoRefresh();
  }, [selectedId, currentDashboard?.timeRange, currentDashboard?.customStart, currentDashboard?.customEnd]);

  const toggleFullscreen = async () => {
    if (!fullscreenRef.current) return;
    if (!isFullscreen) {
      try {
        await fullscreenRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch { /* ignore */ }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch { /* ignore */ }
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleAddCell = () => {
    setNewCellName('');
    setShowAddCellModal(true);
  };

  const handleCreateNewCell = () => {
    if (!currentDashboard || !newCellName.trim()) return;
    const newCell: DashboardCell = {
      id: generateId(),
      name: newCellName.trim(),
      type: 'line',
      queries: [],
      w: 4,
      h: 3,
      x: 0,
      y: 9999 // push to bottom
    };
    setDashboards(prev => prev.map(d => {
      if (d.id !== selectedId) return d;
      return { ...d, updatedAt: Date.now(), cells: [...d.cells, newCell] };
    }));
    setShowAddCellModal(false);
  };

  const handleAddQueryToCell = (cell: DashboardCell) => {
    const pending = {
      text: '',
      database: '',
      cellName: cell.name,
      cellId: cell.id,
      dashboardId: currentDashboard?.id || ''
    };
    localStorage.setItem('iotedge-pending-query', JSON.stringify(pending));
    if (onNavigate) onNavigate('data-explorer');
  };

  const handleDeleteCell = (cellId: string) => {
    if (!currentDashboard) return;
    setDashboards(prev => prev.map(d => {
      if (d.id !== selectedId) return d;
      return { ...d, updatedAt: Date.now(), cells: d.cells.filter(c => c.id !== cellId) };
    }));
    setCellMenuOpen(null);
  };

  const handleConfigureQuery = (cell: DashboardCell) => {
    const pending = {
      text: cell.queries[0]?.text || '',
      database: cell.queries[0]?.database || '',
      cellName: cell.name,
      cellId: cell.id,
      cellType: cell.type,
      dashboardId: currentDashboard?.id || ''
    };
    localStorage.setItem('iotedge-pending-query', JSON.stringify(pending));
    setCellMenuOpen(null);
    if (onNavigate) onNavigate('data-explorer');
  };

  const handleOpenRename = (cellId: string) => {
    const cell = currentDashboard?.cells.find(c => c.id === cellId);
    if (cell) {
      setRenameCellName(cell.name);
      setRenameCellType(cell.type);
      setRenameCellId(cellId);
    }
    setCellMenuOpen(null);
  };

  const handleRenameCell = () => {
    if (!renameCellId || !renameCellName.trim() || !currentDashboard) return;
    setDashboards(prev => prev.map(d => {
      if (d.id !== selectedId) return d;
      return {
        ...d,
        updatedAt: Date.now(),
        cells: d.cells.map(c => c.id === renameCellId ? { ...c, name: renameCellName.trim(), type: renameCellType } : c)
      };
    }));
    setRenameCellId(null);
    setRenameCellName('');
  };

  const handleLayoutChange = useCallback((newLayout: Layout) => {
    setDashboards(prev => prev.map(d => {
      if (d.id !== selectedId) return d;
      const cellsChanged = d.cells.some(c => {
        const item = newLayout.find(l => l.i === c.id);
        return item && (c.w !== item.w || c.h !== item.h || c.x !== item.x || c.y !== item.y);
      });
      if (!cellsChanged) return d;
      return {
        ...d,
        cells: d.cells.map(c => {
          const item = newLayout.find(l => l.i === c.id);
          if (item) {
            return { ...c, w: item.w, h: item.h, x: item.x, y: item.y };
          }
          return c;
        })
      };
    }));
  }, [selectedId]);

  const handleContextMenu = (e: React.MouseEvent, dashboardId: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ dashboardId, x: rect.right - 120, y: rect.top + 32 });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu]);

  useEffect(() => {
    if (!cellMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.cell-menu-dropdown') || target.closest('.cell-header-actions')) return;
      setCellMenuOpen(null);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [cellMenuOpen]);

  useEffect(() => {
    if (!refreshMenuOpen && !moreMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.combo-refresh') || target.closest('.header-more-menu')) return;
      setRefreshMenuOpen(false);
      setMoreMenuOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [refreshMenuOpen, moreMenuOpen]);

  const layout = useMemo(
    () => currentDashboard?.cells.map(c => ({ i: c.id, x: c.x || 0, y: c.y || 0, w: c.w, h: c.h })) || [],
    [currentDashboard?.cells]
  );

  const gridConfig = useMemo(() => ({ cols: 12, rowHeight: 80, margin: [16, 16] as [number, number], maxRows: Infinity }), []);
  const dragConfig = useMemo(() => ({ enabled: true, handle: '.cell-drag-handle' }), []);
  const resizeConfig = useMemo(() => ({ enabled: true }), []);

  if (!activeServer) {
    return (
      <div className="dashboards-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column' }}>
        <h2>{t('views.databases.noServerTitle', 'No Server Connected')}</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{t('views.databases.noServerHint', 'Please select an active server from the sidebar.')}</p>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="dashboards-container">
        <div className="dashboards-toolbar">
          <div className="toolbar-search">
            <Search size={16} color="var(--text-secondary)" />
            <input
              type="text"
              placeholder={t('views.dashboards.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="toolbar-search-input"
            />
          </div>
          <div className="toolbar-actions">
            <button className="btn btn-primary" onClick={openCreateModal}>
              <Plus size={16} />
              {t('views.dashboards.createDashboard')}
            </button>
            <button className="btn btn-outlined" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} />
              {t('views.dashboards.importDashboard')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportDashboard}
            />
          </div>
        </div>

        {filteredDashboards.length === 0 ? (
          <div className="dashboards-empty">
            <LayoutDashboard size={48} color="var(--text-muted)" />
            <h3>{t('views.dashboards.noDashboards')}</h3>
            <p>{t('views.dashboards.noDashboardsHint')}</p>
            <button className="btn btn-primary" onClick={openCreateModal}>
              <Plus size={16} />
              {t('views.dashboards.createFirstDashboard')}
            </button>
          </div>
        ) : (
          <div className="dashboards-grid">
            {filteredDashboards.map(dashboard => (
              <div
                key={dashboard.id}
                className="dashboard-card"
                onClick={() => navigateToDetail(dashboard.id)}
              >
                <div className="dashboard-card-header">
                  <h3 className="dashboard-card-name">{dashboard.name}</h3>
                  <div className="dashboard-card-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="icon-btn-small"
                      onClick={(e) => handleContextMenu(e, dashboard.id)}
                      title="More"
                    >
                      <MoreVertical size={16} />
                    </button>
                    {contextMenu && contextMenu.dashboardId === dashboard.id && (
                      <div
                        className="context-menu"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                      >
                        <button onClick={() => { setContextMenu(null); openEditModal(dashboard); }}>
                          <Edit size={14} /> {t('views.dashboards.editDashboard')}
                        </button>
                        <button onClick={() => { setContextMenu(null); handleExportDashboard(dashboard); }}>
                          <Download size={14} /> {t('views.dashboards.exportDashboard')}
                        </button>
                        <button className="danger" onClick={() => { setContextMenu(null); setShowDeleteModal(dashboard.id); }}>
                          <Trash2 size={14} /> {t('views.dashboards.deleteDashboard')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {dashboard.description && (
                  <p className="dashboard-card-desc">{dashboard.description}</p>
                )}
                <div className="dashboard-card-meta">
                  <Clock size={12} />
                  <span>{new Date(dashboard.createdAt).toLocaleString(i18n.language)}</span>
                  <span className="cell-count">{dashboard.cells.length} cells</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {showCreateModal && (
          <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{editingDashboard ? t('views.dashboards.editDashboard') : t('views.dashboards.createDashboard')}</h3>
                <button className="icon-btn" onClick={() => setShowCreateModal(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>{t('views.dashboards.nameLabel')}</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t('views.dashboards.namePlaceholder')}
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>{t('views.dashboards.descriptionLabel')}</label>
                  <textarea
                    className="form-textarea"
                    placeholder={t('views.dashboards.descriptionPlaceholder')}
                    value={createDescription}
                    onChange={e => setCreateDescription(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outlined" onClick={() => setShowCreateModal(false)}>
                  {t('views.dashboards.cancel')}
                </button>
                <button className="btn btn-primary" onClick={editingDashboard ? handleUpdateDashboard : handleCreateDashboard}>
                  {editingDashboard ? t('views.dashboards.update') : t('views.dashboards.create')}
                </button>
              </div>
            </div>
          </div>
        )}

        {showDeleteModal && (
          <div className="modal-overlay" onClick={() => setShowDeleteModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{t('views.dashboards.confirmDeleteTitle')}</h3>
                <button className="icon-btn" onClick={() => setShowDeleteModal(null)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <p>{t('views.dashboards.confirmDeleteMessage', { name: dashboards.find(d => d.id === showDeleteModal)?.name || '' })}</p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outlined" onClick={() => setShowDeleteModal(null)}>
                  {t('views.dashboards.cancel')}
                </button>
                <button className="btn btn-danger" onClick={() => handleDeleteDashboard(showDeleteModal)}>
                  {t('views.dashboards.confirmDeleteYes')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }



  return (
    <div className="dashboards-container dashboards-detail" ref={fullscreenRef}>
      <div className="detail-header">
        <div className="detail-header-left">
          <button className="icon-btn" onClick={navigateToList} title={t('views.dashboards.backToList')}>
            <ArrowLeft size={20} />
          </button>
          <h2 className="detail-title">{currentDashboard?.name}</h2>
        </div>
        <div className="detail-header-right">
          <div className="header-control-group">
            <select
              className="header-control"
              value={currentTimeRange}
              onChange={e => handleTimeRangeChange(e.target.value)}
            >
              <option value="15 minutes">{t('views.dashboards.past15m')}</option>
              <option value="1 hour">{t('views.dashboards.past1h')}</option>
              <option value="6 hours">{t('views.dashboards.past6h')}</option>
              <option value="24 hours">{t('views.dashboards.past24h')}</option>
              <option value="7 days">{t('views.dashboards.past7d')}</option>
              <option value="30 days">{t('views.dashboards.past30d')}</option>
              <option value="custom">{t('views.dashboards.custom')}</option>
            </select>

            <div className="combo-refresh header-control" style={{ padding: 0, position: 'relative' }}>
              <button
                className="combo-refresh-btn"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title={t('views.dashboards.refresh')}
              >
                <RefreshCw size={16} className={isRefreshing ? 'spin' : ''} />
              </button>
              <span className="combo-separator" />
              <button
                className="combo-refresh-arrow"
                onClick={(e) => { e.stopPropagation(); setRefreshMenuOpen(!refreshMenuOpen); }}
                title={t('views.dashboards.autoRefresh')}
              >
                <ChevronDown size={12} />
              </button>
              {refreshMenuOpen && (
                <div className="refresh-dropdown" onClick={e => e.stopPropagation()}>
                  {[0, 5, 10, 30, 60, 300].map(v => {
                    const labels: Record<number, string> = {
                      0: t('views.dashboards.autoRefreshOff'),
                      5: t('views.dashboards.autoRefresh5s'),
                      10: t('views.dashboards.autoRefresh10s'),
                      30: t('views.dashboards.autoRefresh30s'),
                      60: t('views.dashboards.autoRefresh1m'),
                      300: t('views.dashboards.autoRefresh5m')
                    };
                    const isActive = (currentDashboard?.autoRefresh || 0) === v;
                    return (
                      <button
                        key={v}
                        className={isActive ? 'active' : ''}
                        onClick={() => { handleAutoRefreshChange(v); setRefreshMenuOpen(false); }}
                      >
                        {labels[v]}
                        {isActive && <span className="check-mark">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="toolbar-search header-control" style={{ flex: 1, maxWidth: '260px' }}>
            <Search size={14} color="var(--text-secondary)" />
            <input
              type="text"
              placeholder={t('views.dashboards.searchCellsPlaceholder')}
              value={cellSearch}
              onChange={e => setCellSearch(e.target.value)}
              className="toolbar-search-input"
            />
          </div>

          <button className="header-control header-add-cell" onClick={handleAddCell} title={t('views.dashboards.addCell')}>
            <Plus size={16} />
          </button>

          <div style={{ position: 'relative' }}>
            <button
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); setMoreMenuOpen(!moreMenuOpen); }}
              title="More"
            >
              <MoreVertical size={18} />
            </button>
            {moreMenuOpen && (
              <div className="header-more-menu" onClick={e => e.stopPropagation()}>
                <button onClick={() => { setMoreMenuOpen(false); openEditModal(currentDashboard!); }}>
                  <Edit size={14} /> {t('views.dashboards.editDashboard')}
                </button>
                <button onClick={() => { setMoreMenuOpen(false); handleExportDashboard(currentDashboard!); }}>
                  <Download size={14} /> {t('views.dashboards.exportDashboard')}
                </button>
              </div>
            )}
          </div>

          <button
            className="icon-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? t('views.dashboards.exitFullscreen') : t('views.dashboards.fullscreen')}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>

      <div className="detail-content" ref={gridObserveRef}>
        {(!currentDashboard || currentDashboard.cells.length === 0) ? (
          <div className="detail-empty">
            <LayoutDashboard size={48} color="var(--text-muted)" />
            <h3>{t('views.dashboards.emptyDashboard')}</h3>
            <button className="btn btn-primary" onClick={handleAddCell}>
              <Plus size={16} />
              {t('views.dashboards.addCell')}
            </button>
          </div>
        ) : (
          <>
            <GridLayout
              className="dashboard-grid"
              width={gridWidth || 1200}
              layout={layout}
              gridConfig={gridConfig}
              onLayoutChange={handleLayoutChange}
              dragConfig={dragConfig}
              resizeConfig={resizeConfig}
              autoSize={true}
            >
              {filteredCells.map(cell => {
                const result = cellResults[cell.id];
                const hasData = result?.success && result?.data && result.data.length > 0;
                return (
                  <div key={cell.id} className="dashboard-cell">
                    <div className="cell-header">
                      <div className="cell-drag-handle">
                        <span className="cell-name">{cell.name}</span>
                      </div>
                      <div className="cell-header-actions">
                        <div style={{ position: 'relative' }}>
                          <button
                            className="icon-btn-small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCellMenuOpen(cellMenuOpen === cell.id ? null : cell.id);
                            }}
                            title="More"
                          >
                            <MoreVertical size={14} />
                          </button>
                          {cellMenuOpen === cell.id && (
                            <div
                              className="cell-menu-dropdown"
                              onClick={e => e.stopPropagation()}
                            >
                              <button onClick={() => handleOpenRename(cell.id)}>
                                <Edit size={13} /> {t('views.dashboards.renameCell')}
                              </button>
                              <button onClick={() => handleConfigureQuery(cell)}>
                                <LayoutDashboard size={13} /> {t('views.dashboards.configureQuery')}
                              </button>
                              <button className="danger" onClick={() => handleDeleteCell(cell.id)}>
                                <Trash2 size={13} /> {t('views.dashboards.deleteCell')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="cell-content">
                      {cell.queries.length === 0 ? (
                        <div className="cell-placeholder" style={{ flexDirection: 'column', gap: '8px' }}>
                          <button className="btn btn-outlined" onClick={() => handleAddQueryToCell(cell)}>
                            <Plus size={14} />
                            {t('views.dashboards.addQuery')}
                          </button>
                        </div>
                      ) : !result ? (
                        <div className="cell-placeholder">
                          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                            {t('views.dashboards.noQueryResult')}
                          </span>
                        </div>
                      ) : cell.type === 'table' ? (
                        <div className="cell-table-wrapper">
                          <table className="results-table">
                            {result.columns && (
                              <thead>
                                <tr>
                                  {result.columns.map((col, idx) => (
                                    <th key={idx}>{col}</th>
                                  ))}
                                </tr>
                              </thead>
                            )}
                            <tbody>
                              {hasData && result.data!.slice(0, 50).map((row, rowIdx) => (
                                <tr key={rowIdx}>
                                  {row.map((val: any, valIdx: number) => (
                                    <td key={valIdx}>{val?.toString()}</td>
                                  ))}
                                </tr>
                              ))}
                              {!hasData && (
                                <tr>
                                  <td colSpan={result.columns?.length || 1} style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
                                    {result.error || t('views.dashboards.noDataToChart')}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : hasData ? (() => {
                        const chartOption = buildChartOption(cell.type as 'line' | 'bar', result);
                        if (isChartError(chartOption)) {
                          return (
                            <div className="cell-placeholder" style={{ flexDirection: 'column', gap: 6 }}>
                              <span style={{ color: '#f59e0b', fontSize: 13 }}>{t('views.dashboards.chartError')}</span>
                              <span style={{ color: 'var(--text-secondary)', fontSize: 12, textAlign: 'center', maxWidth: '90%' }}>
                                {chartOption.chartError}
                              </span>
                            </div>
                          );
                        }
                        return chartOption ? (
                          <ReactECharts
                            ref={(e) => {
                              if (e) {
                                chartRefs.current.set(cell.id, e.getEchartsInstance());
                              } else {
                                chartRefs.current.delete(cell.id);
                              }
                            }}
                            option={chartOption}
                            notMerge={true}
                            style={{ height: '100%', width: '100%' }}
                            opts={{ renderer: 'canvas' }}
                          />
                        ) : (
                          <div className="cell-placeholder" style={{ flexDirection: 'column', gap: 6 }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                              {t('views.dashboards.noNumericColumns')}
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                              {t('views.dashboards.noNumericColumnsHint')}
                            </span>
                          </div>
                        );
                      })() : (
                        <div className="cell-placeholder cell-placeholder-error">
                          <span style={{ color: '#f59e0b', fontSize: 13 }}>
                            {result.error || t('views.dashboards.noDataToChart')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </GridLayout>
          </>
        )}
      </div>

      {renameCellId && (
        <div className="modal-overlay" onClick={() => { setRenameCellId(null); setRenameCellName(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.dashboards.renameCell')}</h3>
              <button className="icon-btn" onClick={() => { setRenameCellId(null); setRenameCellName(''); }}>
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
                  value={renameCellName}
                  onChange={e => setRenameCellName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label>{t('views.dashboards.visualizationType', 'Visualization Type')}</label>
                <div className="viz-type-switcher">
                  <button className={`viz-btn ${renameCellType === 'table' ? 'active' : ''}`} onClick={() => setRenameCellType('table')}>
                    <Table2 size={16} />
                  </button>
                  <button className={`viz-btn ${renameCellType === 'line' ? 'active' : ''}`} onClick={() => setRenameCellType('line')}>
                    <LineChart size={16} />
                  </button>
                  <button className={`viz-btn ${renameCellType === 'bar' ? 'active' : ''}`} onClick={() => setRenameCellType('bar')}>
                    <BarChart2 size={16} />
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outlined" onClick={() => { setRenameCellId(null); setRenameCellName(''); }}>
                {t('views.dashboards.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleRenameCell}>
                {t('views.dashboards.rename')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCustomTimeModal && (
        <div className="modal-overlay" onClick={() => setShowCustomTimeModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.dashboards.selectCustomTimeRangeTitle')}</h3>
              <button className="icon-btn" onClick={() => setShowCustomTimeModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t('views.dashboards.startTimeLabel')}</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>{t('views.dashboards.endTimeLabel')}</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outlined" onClick={() => setShowCustomTimeModal(false)}>
                {t('views.dashboards.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleCustomTimeApply}>
                {t('views.dashboards.apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingDashboard ? t('views.dashboards.editDashboard') : t('views.dashboards.createDashboard')}</h3>
              <button className="icon-btn" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t('views.dashboards.nameLabel')}</label>
                <input type="text" className="form-input" placeholder={t('views.dashboards.namePlaceholder')}
                  value={createName} onChange={e => setCreateName(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label>{t('views.dashboards.descriptionLabel')}</label>
                <textarea className="form-textarea" placeholder={t('views.dashboards.descriptionPlaceholder')}
                  value={createDescription} onChange={e => setCreateDescription(e.target.value)} rows={3} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outlined" onClick={() => setShowCreateModal(false)}>
                {t('views.dashboards.cancel')}
              </button>
              <button className="btn btn-primary" onClick={editingDashboard ? handleUpdateDashboard : handleCreateDashboard}>
                {editingDashboard ? t('views.dashboards.update') : t('views.dashboards.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.dashboards.confirmDeleteTitle')}</h3>
              <button className="icon-btn" onClick={() => setShowDeleteModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>{t('views.dashboards.confirmDeleteMessage', { name: dashboards.find(d => d.id === showDeleteModal)?.name || '' })}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outlined" onClick={() => setShowDeleteModal(null)}>
                {t('views.dashboards.cancel')}
              </button>
              <button className="btn btn-danger" onClick={() => handleDeleteDashboard(showDeleteModal)}>
                {t('views.dashboards.confirmDeleteYes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCellModal && (
        <div className="modal-overlay" onClick={() => setShowAddCellModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.dashboards.addCellTitle')}</h3>
              <button className="icon-btn" onClick={() => setShowAddCellModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t('views.dashboards.cellNameLabel')}</label>
                <input type="text" className="form-input" placeholder={t('views.dashboards.cellNamePlaceholder')}
                  value={newCellName} onChange={e => setNewCellName(e.target.value)} autoFocus />
              </div>

            </div>
            <div className="modal-footer">
              <button className="btn btn-outlined" onClick={() => setShowAddCellModal(false)}>
                {t('views.dashboards.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleCreateNewCell}>
                {t('views.dashboards.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboards;
