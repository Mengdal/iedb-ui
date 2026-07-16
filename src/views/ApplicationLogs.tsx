import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { useDebounce } from '../hooks/useDebounce';
import { usePolling } from '../hooks/usePolling';
import './ApplicationLogs.css';

interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
}

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

const TIME_RANGES = [
  { key: '15m', minutes: 15 },
  { key: '1h', minutes: 60 },
  { key: '6h', minutes: 360 },
  { key: '24h', minutes: 1440 },
  { key: '7d', minutes: 10080 },
  { key: 'all', minutes: 0 },
] as const;

function formatLogTime(ts: string | number, locale?: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  return date.toLocaleString(locale, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function normalizeLevel(level: string): string {
  return String(level).toUpperCase();
}

function levelClass(level: string): string {
  switch (normalizeLevel(level)) {
    case 'DEBUG':
      return 'log-level-debug';
    case 'INFO':
      return 'log-level-info';
    case 'WARN':
    case 'WARNING':
      return 'log-level-warn';
    case 'ERROR':
    case 'FATAL':
      return 'log-level-error';
    default:
      return 'log-level-info';
  }
}

function rowClass(level: string): string {
  switch (normalizeLevel(level)) {
    case 'DEBUG':
      return 'log-row-debug';
    case 'INFO':
      return 'log-row-info';
    case 'WARN':
    case 'WARNING':
      return 'log-row-warn';
    case 'ERROR':
    case 'FATAL':
      return 'log-row-error';
    default:
      return 'log-row-info';
  }
}

const ApplicationLogs: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { apiFetch, activeServer } = useApiFetch({
    handleLicense: false,
    handleFeature: false,
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [levelFilter, setLevelFilter] = useState('');
  const [timeRange, setTimeRange] = useState('1h');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const debouncedSearch = useDebounce(search, 300);

  const fetchLogs = useCallback(async () => {
    if (!activeServer) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch(`/api/v1/logs?${new URLSearchParams({ limit: '200' }).toString()}`);
      let entries: LogEntry[] = [];
      let total = 0;
      if (resp) {
        if (Array.isArray(resp.logs)) {
          entries = resp.logs as LogEntry[];
          total = typeof resp.count === 'number' ? resp.count : entries.length;
        } else if (Array.isArray(resp.data)) {
          entries = resp.data as LogEntry[];
          total = typeof resp.count === 'number' ? resp.count : entries.length;
        } else if (Array.isArray(resp)) {
          entries = resp as LogEntry[];
          total = entries.length;
        }
      }
      // Normalize levels and sort descending by timestamp
      entries = entries
        .map(e => ({
          ...e,
          level: normalizeLevel(e.level || 'INFO'),
        }))
        .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
      setLogs(entries);
      setTotalCount(total);
    } catch (err: any) {
      setError(err.message || t('views.systemOverview.applicationLogs.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [activeServer, apiFetch, t]);

  useEffect(() => {
    if (activeServer) fetchLogs();
  }, [activeServer, fetchLogs]);

  usePolling(fetchLogs, 5000, { enabled: autoRefresh && !!activeServer });

  const filteredLogs = useMemo(() => {
    const range = TIME_RANGES.find(r => r.key === timeRange);
    const cutoff = range && range.minutes > 0
      ? Date.now() - range.minutes * 60_000
      : 0;

    const q = debouncedSearch.trim().toLowerCase();

    return logs.filter(log => {
      if (levelFilter && normalizeLevel(log.level) !== levelFilter) return false;
      if (cutoff > 0 && +new Date(log.timestamp) < cutoff) return false;
      if (q) {
        const text = `${log.component || ''} ${log.message || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [logs, levelFilter, timeRange, debouncedSearch]);

  const levelLabel = (level: string) =>
    t(`views.systemOverview.applicationLogs.level${level}`, level);

  const levelOptions = [
    { value: '', label: t('views.systemOverview.applicationLogs.levelAll') },
    ...LEVELS.map(level => ({
      value: level,
      label: levelLabel(level),
    })),
  ];

  return (
    <div className="app-logs-section">
      <div className="app-logs-header">
        <h2 className="app-logs-title">{t('views.systemOverview.applicationLogs.title')}</h2>
        <div className="app-logs-toolbar">
          <select
            className="app-logs-select"
            value={levelFilter}
            onChange={e => setLevelFilter(e.target.value)}
          >
            {levelOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <select
            className="app-logs-select"
            value={timeRange}
            onChange={e => setTimeRange(e.target.value)}
          >
            {TIME_RANGES.map(r => (
              <option key={r.key} value={r.key}>
                {t(`views.systemOverview.applicationLogs.timeRange${r.key}`)}
              </option>
            ))}
          </select>

          <div className="app-logs-search-wrap">
            <input
              type="text"
              className="app-logs-search"
              placeholder={t('views.systemOverview.applicationLogs.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <button
            type="button"
            className={`app-logs-toggle ${autoRefresh ? 'active' : ''}`}
            onClick={() => setAutoRefresh(v => !v)}
            title={t('views.systemOverview.applicationLogs.autoRefresh')}
          >
            {autoRefresh ? <Pause size={16} /> : <Play size={16} />}
            {t('views.systemOverview.applicationLogs.autoRefresh')}
          </button>

          <button
            type="button"
            className="app-logs-refresh"
            onClick={fetchLogs}
            disabled={loading || !activeServer}
            title={t('views.systemOverview.applicationLogs.refresh')}
          >
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">{error}</div>
      )}

      {!activeServer && (
        <div className="app-logs-empty">
          {t('views.systemOverview.noServerHint')}
        </div>
      )}

      {activeServer && loading && filteredLogs.length === 0 && (
        <div className="app-logs-loading">
          <RefreshCw size={18} className="spinning" />
          {t('views.systemOverview.applicationLogs.loading')}
        </div>
      )}

      {activeServer && !loading && filteredLogs.length === 0 && !error && (
        <div className="app-logs-empty">
          {t('views.systemOverview.applicationLogs.noData')}
        </div>
      )}

      {filteredLogs.length > 0 && (
        <div className="app-logs-table-wrap">
          <table className="app-logs-table">
            <thead>
              <tr>
                <th className="col-time">{t('views.systemOverview.applicationLogs.colTime')}</th>
                <th className="col-level">{t('views.systemOverview.applicationLogs.colLevel')}</th>
                <th className="col-component">{t('views.systemOverview.applicationLogs.colComponent')}</th>
                <th className="col-message">{t('views.systemOverview.applicationLogs.colMessage')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, idx) => (
                <tr key={idx} className={rowClass(log.level)}>
                  <td className="col-time" title={log.timestamp}>
                    {formatLogTime(log.timestamp, i18n.language)}
                  </td>
                  <td className="col-level">
                    <span className={levelClass(log.level)}>{log.level}</span>
                  </td>
                  <td className="col-component" title={log.component}>
                    {log.component || '—'}
                  </td>
                  <td className="col-message" title={log.message}>
                    {log.message || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="app-logs-footer">
        {t('views.systemOverview.applicationLogs.showingCount', {
          count: filteredLogs.length,
          total: totalCount,
        })}
      </div>
    </div>
  );
};

export default ApplicationLogs;
