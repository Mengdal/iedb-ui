import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Loader2, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { useDebounce } from '../hooks/useDebounce';
import { formatTime } from '../utils/formatTime';
import Pagination from '../components/Pagination';
import './PageLayout.css';
import './AuditLog.css';

interface AuditEntry {
  id: number;
  timestamp: string;
  event_type: string;
  actor: string;
  database: string;
  user_agent: string;
  ip_address: string;
}

const PAGE_SIZE = 50;

const TIME_RANGES: { key: string; value: string }[] = [
  { key: 'past1h', value: '1h' },
  { key: 'past6h', value: '6h' },
  { key: 'past24h', value: '24h' },
  { key: 'past7d', value: '168h' },
  { key: 'past30d', value: '720h' },
];

function rfc3339Since(duration: string): string {
  const map: Record<string, number> = {
    '1h': 1, '6h': 6, '24h': 24, '168h': 168, '720h': 720,
  };
  const hours = map[duration] ?? 24;
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

const AuditLog: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { apiFetch, activeServer, noLicense, featureNotEnabled, resetGate } = useApiFetch();

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [stats, setStats] = useState<Record<string, number>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters — raw input values (debounced before fetch)
  const [filterType, setFilterType] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterDatabase, setFilterDatabase] = useState('');
  const [timeRange, setTimeRange] = useState('24h');

  const debouncedActor = useDebounce(filterActor, 300);
  const debouncedDatabase = useDebounce(filterDatabase, 300);

  const onActorChange = useCallback((val: string) => {
    setFilterActor(val);
  }, []);

  const onDatabaseChange = useCallback((val: string) => {
    setFilterDatabase(val);
  }, []);

  const fetchStats = useCallback(async () => {
    if (!activeServer) return;
    try {
      const resp = await apiFetch(`/api/v1/audit/stats?since=${encodeURIComponent(rfc3339Since(timeRange))}`);
      if (resp) {
        const raw = resp.data ?? resp;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          setStats(raw as Record<string, number>);
        } else {
          setStats({});
        }
      }
    } catch {
      // silently ignore stats errors
    }
  }, [activeServer, timeRange]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Track previous filters to detect changes
  const filtersKey = `${timeRange}|${filterType}|${debouncedActor}|${debouncedDatabase}`;
  const prevFiltersRef = useRef(filtersKey);

  useEffect(() => {
    if (!activeServer) {
      setLogs([]);
      return;
    }

    // If filters changed, reset offset (will trigger re-render + re-fetch)
    if (prevFiltersRef.current !== filtersKey) {
      prevFiltersRef.current = filtersKey;
      if (offset !== 0) {
        setOffset(0);
        return; // offset change will re-trigger this effect
      }
    }

    let cancelled = false;
    const doFetch = async () => {
      setLoading(true);
      setErrorMsg('');
      resetGate();
      try {
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));
        params.set('since', rfc3339Since(timeRange));
        if (filterType) params.set('event_type', filterType);
        if (debouncedActor.trim()) params.set('actor', debouncedActor.trim());
        if (debouncedDatabase.trim()) params.set('database', debouncedDatabase.trim());

        const resp = await apiFetch(`/api/v1/audit/logs?${params.toString()}`);
        if (cancelled) return;
        if (resp) {
          const entries = Array.isArray(resp.data) ? resp.data : [];
          setLogs(entries as AuditEntry[]);
        }
      } catch (err: any) {
        if (cancelled) return;
        setErrorMsg(err.message || t('views.auditLog.failedToLoad'));
        setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    doFetch();
    return () => { cancelled = true; };
  }, [activeServer, offset, filtersKey, refreshKey, t]);

  const eventTypes = useMemo(() => {
    return Object.keys(stats).sort();
  }, [stats]);

  // Derive total from stats: filtered type uses its count, otherwise sum all
  const total = useMemo(() => {
    if (filterType && stats[filterType] != null) return stats[filterType];
    return Object.values(stats).reduce((sum, n) => sum + n, 0);
  }, [stats, filterType]);

  const translateEventType = (et: string) => {
    const key = `views.auditLog.eventTypes.${et}`;
    const translated = t(key);
    return translated === key ? et : translated;
  };

  return (
    <div className="page-container audit-log-page">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('views.auditLog.title')}</h1>
          <p>{t('views.auditLog.pageSubtitle')}</p>
        </div>
      </div>

      <div className="page-section">
        <div className="section-header">
          <div className="section-header-text">
            <h2>{t('views.auditLog.sectionTitle')}</h2>
            <p>{t('views.auditLog.sectionDesc')}</p>
          </div>
          <div className="page-toolbar">
            <select className="audit-time-select" value={timeRange} onChange={e => setTimeRange(e.target.value)}>
              {TIME_RANGES.map(r => (
                <option key={r.value} value={r.value}>{t(`views.auditLog.${r.key}`)}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-outlined"
              onClick={() => { fetchStats(); setRefreshKey(k => k + 1); }}
              disabled={!activeServer || loading}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              {t('views.auditLog.refresh')}
            </button>
          </div>
        </div>

        {!activeServer && (
          <div className="tokens-empty">
            {t('views.pluginsMqtt.selectServerHint')}
          </div>
        )}

        {activeServer && noLicense && (
          <div className="audit-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.auditLog.noLicense')}</p>
          </div>
        )}

        {activeServer && featureNotEnabled && (
          <div className="audit-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.auditLog.featureNotEnabled')}</p>
          </div>
        )}

        {activeServer && !noLicense && !featureNotEnabled && errorMsg && (
          <div className="tokens-alert">{errorMsg}</div>
        )}

        {activeServer && !noLicense && !featureNotEnabled && (
          <>
            {/* Filter bar */}
            <div className="audit-filters">
              <label>
                {t('views.auditLog.filterEventType')}
                <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="">{t('views.auditLog.filterAllTypes')}</option>
                  {eventTypes.map(et => (
                    <option key={et} value={et}>{translateEventType(et)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t('views.auditLog.filterActor')}
                <input
                  type="text"
                  value={filterActor}
                  onChange={e => onActorChange(e.target.value)}
                  placeholder={t('views.auditLog.filterActorPlaceholder')}
                />
              </label>
              <label>
                {t('views.auditLog.filterDatabase')}
                <input
                  type="text"
                  value={filterDatabase}
                  onChange={e => onDatabaseChange(e.target.value)}
                  placeholder={t('views.auditLog.filterDatabasePlaceholder')}
                />
              </label>
            </div>

            {/* Loading */}
            {loading && logs.length === 0 && (
              <div className="loading-inline">
                <Loader2 className="spin" size={18} />
                {t('views.auditLog.loading')}
              </div>
            )}

            {/* Empty */}
            {!loading && logs.length === 0 && !errorMsg && (
              <div className="tokens-empty">{t('views.auditLog.noData')}</div>
            )}

            {/* Table */}
            {logs.length > 0 && (
              <>
                <div className="tokens-table-wrap">
                  <table className="tokens-table">
                    <colgroup>
                      <col className="audit-col-time" />
                      <col className="audit-col-type" />
                      <col className="audit-col-actor" />
                      <col className="audit-col-db" />
                      <col className="audit-col-ip" />
                      <col className="audit-col-ua" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>{t('views.auditLog.colTime')}</th>
                        <th>{t('views.auditLog.colEventType')}</th>
                        <th>{t('views.auditLog.colActor')}</th>
                        <th>{t('views.auditLog.colDatabase')}</th>
                        <th>{t('views.auditLog.colIP')}</th>
                        <th>{t('views.auditLog.colUA')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(entry => (
                        <tr key={entry.id}>
                          <td title={entry.timestamp}>{formatTime(entry.timestamp, i18n.language)}</td>
                          <td><span className="audit-type-badge">{translateEventType(entry.event_type)}</span></td>
                          <td title={entry.actor}>{entry.actor || '—'}</td>
                          <td title={entry.database}>{entry.database || '—'}</td>
                          <td>{entry.ip_address || '—'}</td>
                          <td title={entry.user_agent} className="audit-ua-cell">{entry.user_agent || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Pagination
                  offset={offset}
                  pageSize={PAGE_SIZE}
                  total={total}
                  onOffsetChange={setOffset}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AuditLog;
