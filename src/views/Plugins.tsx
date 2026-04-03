import React, { useEffect, useMemo, useRef, useState } from 'react';
import { History, Plus, RefreshCw, Play, Pencil, Trash2, X, AlertTriangle, Loader2 } from 'lucide-react';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';
import './Tokens.css';
import './Plugins.css';

interface ContinuousQuery {
  id: number;
  name: string;
  description?: string | null;
  database: string;
  source_measurement: string;
  destination_measurement: string;
  query: string;
  interval: string;
  retention_days?: number | null;
  delete_source_after_days?: number | null;
  is_active: boolean;
  last_execution_time?: string | null;
  last_execution_status?: string | null;
  last_processed_time?: string | null;
  last_records_written?: number | null;
  created_at: string;
  updated_at: string;
}

interface CQExecution {
  id: number;
  query_id: number;
  execution_id: string;
  execution_time: string;
  status: string;
  start_time: string;
  end_time: string;
  records_read?: number | null;
  records_written: number;
  execution_duration_seconds: number;
  error_message?: string | null;
}

interface CQFormState {
  name: string;
  description: string;
  database: string;
  source_measurement: string;
  destination_measurement: string;
  query: string;
  interval: string;
  retention_days: string;
  delete_source_after_days: string;
  is_active: boolean;
}

const DEFAULT_CQ_QUERY = `SELECT
  time,
  AVG(value) AS avg_value
FROM production.cpu
WHERE time >= {start_time} AND time < {end_time}
GROUP BY time`;

const buildCQTemplate = (database?: string, measurement?: string) => {
  const db = database?.trim() || 'your_database';
  const src = measurement?.trim() || 'your_measurement';
  return `SELECT
  time,
  AVG(value) AS avg_value
FROM ${db}.${src}
WHERE time >= {start_time} AND time < {end_time}
GROUP BY time`;
};

const Plugins: React.FC = () => {
  const { activeServer } = useServers();
  const { t } = useTranslation();

  const [cqs, setCqs] = useState<ContinuousQuery[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [databaseFilter, setDatabaseFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCQ, setEditingCQ] = useState<ContinuousQuery | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExecutingId, setIsExecutingId] = useState<number | null>(null);
  const [isTogglingStatusId, setIsTogglingStatusId] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<ContinuousQuery | null>(null);
  const [history, setHistory] = useState<CQExecution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
  const [availableMeasurements, setAvailableMeasurements] = useState<string[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isLoadingMeasurements, setIsLoadingMeasurements] = useState(false);

  const cqModalBodyRef = useRef<HTMLDivElement | null>(null);
  const [cqFormErrorMsg, setCqFormErrorMsg] = useState('');
  const [lastAutoQuery, setLastAutoQuery] = useState(DEFAULT_CQ_QUERY);

  const [form, setForm] = useState<CQFormState>({
    name: '',
    description: '',
    database: '',
    source_measurement: '',
    destination_measurement: '',
    query: DEFAULT_CQ_QUERY,
    interval: '1h',
    retention_days: '',
    delete_source_after_days: '',
    is_active: true
  });

  const baseUrl = useMemo(
    () => (activeServer ? `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '') : ''),
    [activeServer]
  );

  const cqApiFetch = async (path: string, init?: RequestInit) => {
    if (!activeServer) throw new Error('No active server');
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeServer.token}`,
        ...(init?.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `Request failed: ${res.status}`);
    }
    return data;
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 2200);
  };

  const fetchCQs = async () => {
    if (!activeServer) {
      setCqs([]);
      return;
    }
    setIsLoading(true);
    setErrorMsg('');
    try {
      const params = new URLSearchParams();
      if (databaseFilter) params.set('database', databaseFilter);
      if (activeFilter !== 'all') params.set('is_active', activeFilter);
      const query = params.toString();
      const data = await cqApiFetch(`/api/v1/continuous_queries${query ? `?${query}` : ''}`);
      setCqs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToLoad'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCQs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServer, databaseFilter, activeFilter]);

  useEffect(() => {
    const fetchDatabaseOptions = async () => {
      if (!isFormOpen || !activeServer) return;
      setIsLoadingDatabases(true);
      try {
        const data = await cqApiFetch('/api/v1/databases');
        const names = Array.isArray(data?.databases) ? data.databases.map((d: { name: string }) => d.name) : [];
        setAvailableDatabases(names);
      } catch {
        setAvailableDatabases([]);
      } finally {
        setIsLoadingDatabases(false);
      }
    };

    fetchDatabaseOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen, activeServer]);

  useEffect(() => {
    const fetchMeasurementOptions = async () => {
      if (!isFormOpen || !activeServer || !form.database) {
        setAvailableMeasurements([]);
        return;
      }
      setIsLoadingMeasurements(true);
      try {
        const data = await cqApiFetch(`/api/v1/databases/${encodeURIComponent(form.database)}/measurements`);
        const names = Array.isArray(data?.measurements) ? data.measurements.map((m: { name: string }) => m.name) : [];
        setAvailableMeasurements(names);
      } catch {
        setAvailableMeasurements([]);
      } finally {
        setIsLoadingMeasurements(false);
      }
    };

    fetchMeasurementOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen, activeServer, form.database]);

  const openCreate = () => {
    setEditingCQ(null);
    const initialTemplate = buildCQTemplate('', '');
    setForm({
      name: '',
      description: '',
      database: '',
      source_measurement: '',
      destination_measurement: '',
      query: initialTemplate,
      interval: '1h',
      retention_days: '',
      delete_source_after_days: '',
      is_active: true
    });
    setLastAutoQuery(initialTemplate);
    setCqFormErrorMsg('');
    setIsFormOpen(true);
    setTimeout(() => {
      cqModalBodyRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const openEdit = (cq: ContinuousQuery) => {
    setEditingCQ(cq);
    setForm({
      name: cq.name || '',
      description: cq.description || '',
      database: cq.database || '',
      source_measurement: cq.source_measurement || '',
      destination_measurement: cq.destination_measurement || '',
      query: cq.query || '',
      interval: cq.interval || '1h',
      retention_days: cq.retention_days == null ? '' : String(cq.retention_days),
      delete_source_after_days: cq.delete_source_after_days == null ? '' : String(cq.delete_source_after_days),
      is_active: !!cq.is_active
    });
    setLastAutoQuery(cq.query || '');
    setCqFormErrorMsg('');
    setIsFormOpen(true);
    setTimeout(() => {
      cqModalBodyRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingCQ(null);
    setCqFormErrorMsg('');
  };

  const handleDatabaseChange = (database: string) => {
    const shouldAutoUpdateTemplate = !editingCQ && (form.query === lastAutoQuery || !form.query.trim());
    const nextTemplate = buildCQTemplate(database, '');

    setForm((prev) => ({
      ...prev,
      database,
      source_measurement: '',
      query: shouldAutoUpdateTemplate ? nextTemplate : prev.query,
    }));

    if (shouldAutoUpdateTemplate) {
      setLastAutoQuery(nextTemplate);
    }
  };

  const handleSourceMeasurementChange = (sourceMeasurement: string) => {
    const shouldAutoUpdateTemplate = !editingCQ && (form.query === lastAutoQuery || !form.query.trim());
    const nextTemplate = buildCQTemplate(form.database, sourceMeasurement);

    setForm((prev) => ({
      ...prev,
      source_measurement: sourceMeasurement,
      query: shouldAutoUpdateTemplate ? nextTemplate : prev.query,
    }));

    if (shouldAutoUpdateTemplate) {
      setLastAutoQuery(nextTemplate);
    }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeServer) return;
    setIsSaving(true);
    setCqFormErrorMsg('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        database: form.database.trim(),
        source_measurement: form.source_measurement.trim(),
        destination_measurement: form.destination_measurement.trim(),
        query: form.query,
        interval: form.interval.trim(),
        retention_days: form.retention_days.trim() ? Number(form.retention_days) : null,
        delete_source_after_days: form.delete_source_after_days.trim() ? Number(form.delete_source_after_days) : null,
        is_active: form.is_active
      };

      if (editingCQ) {
        await cqApiFetch(`/api/v1/continuous_queries/${editingCQ.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await cqApiFetch('/api/v1/continuous_queries', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      closeForm();
      fetchCQs();
    } catch (err: any) {
      setCqFormErrorMsg(err.message || t('views.plugins.failedToSave'));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCQ = async (cq: ContinuousQuery) => {
    if (!window.confirm(t('views.plugins.deleteConfirm', { name: cq.name }))) return;
    try {
      await cqApiFetch(`/api/v1/continuous_queries/${cq.id}`, { method: 'DELETE' });
      fetchCQs();
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToDelete'));
    }
  };

  const executeCQ = async (cq: ContinuousQuery, dryRun = false) => {
    setIsExecutingId(cq.id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await cqApiFetch(`/api/v1/continuous_queries/${cq.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ dry_run: dryRun })
      });
      showSuccess(t('views.plugins.cqStartedSuccess', { name: cq.name }));
      fetchCQs();
      if (historyFor?.id === cq.id) {
        viewHistory(cq);
      }
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToExecute'));
    } finally {
      setIsExecutingId(null);
    }
  };

  const toggleCQStatus = async (cq: ContinuousQuery) => {
    setIsTogglingStatusId(cq.id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await cqApiFetch(`/api/v1/continuous_queries/${cq.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: cq.name,
          description: cq.description || null,
          database: cq.database,
          source_measurement: cq.source_measurement,
          destination_measurement: cq.destination_measurement,
          query: cq.query,
          interval: cq.interval,
          retention_days: cq.retention_days ?? null,
          delete_source_after_days: cq.delete_source_after_days ?? null,
          is_active: !cq.is_active,
        }),
      });
      showSuccess(cq.is_active ? t('views.plugins.cqDisabledSuccess', { name: cq.name }) : t('views.plugins.cqEnabledSuccess', { name: cq.name }));
      fetchCQs();
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToToggle'));
    } finally {
      setIsTogglingStatusId(null);
    }
  };

  const viewHistory = async (cq: ContinuousQuery) => {
    setHistoryFor(cq);
    setHistoryLoading(true);
    try {
      const data = await cqApiFetch(`/api/v1/continuous_queries/${cq.id}/executions?limit=30`);
      setHistory(Array.isArray(data?.executions) ? data.executions : []);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToLoadHistory'));
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="tokens-container plugins-cq-page">
      <div className="page-header">
        <div>
          <h1 className="page-title-main">{t('views.plugins.title')}</h1>
          <p className="page-subtitle">
            {t('views.plugins.pageSubtitle')}
          </p>
        </div>
      </div>

      <div className="tokens-section">
        <div className="section-header">
          <div className="cq-section-left">
            <h2 className="section-title-large">{t('views.plugins.sectionTitle')}</h2>
            <p className="section-desc cq-desc">
              {t('views.plugins.sectionDesc')}
            </p>
          </div>
          <div className="tokens-toolbar cq-toolbar">
            <input
              className="tokens-search"
              type="search"
              value={databaseFilter}
              onChange={(e) => setDatabaseFilter(e.target.value)}
              placeholder={t('views.plugins.filterPlaceholder')}
            />
            <select
              className="tokens-search cq-toolbar-select"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as 'all' | 'true' | 'false')}
            >
              <option value="all">{t('views.plugins.allStatus')}</option>
              <option value="true">{t('views.plugins.activeOnly')}</option>
              <option value="false">{t('views.plugins.inactiveOnly')}</option>
            </select>
            <button type="button" className="btn btn-outlined" onClick={() => fetchCQs()} disabled={!activeServer || isLoading}>
              <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
              {t('views.plugins.refresh')}
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate} disabled={!activeServer}>
              <Plus size={16} />
              {t('views.plugins.newCQ')}
            </button>
          </div>
        </div>

        {!activeServer && (
          <div className="tokens-empty">
            <AlertTriangle size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            {t('views.plugins.selectServerHint')}
          </div>
        )}

        {activeServer && errorMsg && <div className="tokens-alert">{errorMsg}</div>}
        {activeServer && successMsg && <div className="tokens-alert cq-success-alert">{successMsg}</div>}

        {activeServer && isLoading && cqs.length === 0 && !errorMsg && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.plugins.loadingCqs')}
          </div>
        )}

        {activeServer && !isLoading && !errorMsg && cqs.length === 0 && (
          <div className="tokens-empty">{t('views.plugins.noCQsYet')}</div>
        )}

        {activeServer && cqs.length > 0 && (
          <div className="tokens-table-wrap">
            <table className="tokens-table">
              <colgroup>
                <col className="cq-col-name" />
                <col className="cq-col-db" />
                <col className="cq-col-source" />
                <col className="cq-col-destination" />
                <col className="cq-col-interval" />
                <col className="cq-col-status" />
                <col className="cq-col-last-run" />
                <col className="cq-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('views.plugins.name')}</th>
                  <th>{t('views.plugins.db')}</th>
                  <th>{t('views.plugins.source')}</th>
                  <th>{t('views.plugins.destination')}</th>
                  <th>{t('views.plugins.interval')}</th>
                  <th>{t('views.plugins.status')}</th>
                  <th>{t('views.plugins.lastRun')}</th>
                  <th>{t('views.plugins.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {cqs.map(cq => (
                  <tr key={cq.id}>
                    <td>{cq.name}</td>
                    <td>{cq.database}</td>
                    <td>{cq.source_measurement}</td>
                    <td>{cq.destination_measurement}</td>
                    <td>{cq.interval}</td>
                    <td>
                      <button
                        type="button"
                        className={`cq-status-switch ${cq.is_active ? 'on' : 'off'}`}
                        onClick={() => toggleCQStatus(cq)}
                        disabled={isTogglingStatusId === cq.id}
                        title={
                          isTogglingStatusId === cq.id
                            ? t('views.plugins.updatingStatus')
                            : cq.is_active
                            ? t('views.plugins.activeClickToDisable')
                            : t('views.plugins.inactiveClickToEnable')
                        }
                        aria-label={cq.is_active ? t('views.plugins.disableCq') : t('views.plugins.enableCq')}
                      >
                        <span className="cq-toggle-track" aria-hidden>
                          <span className="cq-toggle-thumb" />
                        </span>
                      </button>
                    </td>
                    <td>{cq.last_execution_time ? new Date(cq.last_execution_time).toLocaleString() : '—'}</td>
                    <td>
                      <div className="token-actions">
                        <button type="button" className="icon-btn" title={t('views.plugins.actionRun')} onClick={() => executeCQ(cq, false)} disabled={isExecutingId === cq.id || !cq.is_active}>
                          <Play size={16} />
                        </button>
                        <button type="button" className="icon-btn" title={t('views.plugins.actionHistory')} onClick={() => viewHistory(cq)}>
                          <History size={16} />
                        </button>
                        <button type="button" className="icon-btn" title={t('views.plugins.actionEdit')} onClick={() => openEdit(cq)}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" className="icon-btn danger" title={t('views.plugins.actionDelete')} onClick={() => deleteCQ(cq)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isFormOpen && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={closeForm}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingCQ ? t('views.plugins.editCQ') : t('views.plugins.createCQ')}</h3>
              <button type="button" className="icon-btn" onClick={closeForm}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submitForm}>
              <div className="modal-body" ref={cqModalBodyRef}>
                {cqFormErrorMsg && (
                  <div className="tokens-alert" style={{ marginBottom: 16 }}>
                    {cqFormErrorMsg}
                  </div>
                )}

                <div className="cq-form-grid">
                  <div className="form-group">
                    <label htmlFor="cq-name">{t('views.plugins.name')}</label>
                    <input id="cq-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder={t('views.plugins.namePlaceholder')} />
                  </div>

                  <div className="cq-form-two-cols">
                    <div className="form-group">
                      <label htmlFor="cq-database">{t('views.plugins.database')}</label>
                      <select
                        id="cq-database"
                        value={form.database}
                        onChange={(e) => handleDatabaseChange(e.target.value)}
                        required
                      >
                        <option value="">{isLoadingDatabases ? t('views.plugins.loadingDatabases') : t('views.plugins.selectDatabase')}</option>
                        {availableDatabases.map((db) => (
                          <option key={db} value={db}>
                            {db}
                          </option>
                        ))}
                        {form.database && !availableDatabases.includes(form.database) && (
                          <option value={form.database}>{form.database}</option>
                        )}
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor="cq-src">{t('views.plugins.sourceMeasurement')}</label>
                      <select
                        id="cq-src"
                        value={form.source_measurement}
                        onChange={(e) => handleSourceMeasurementChange(e.target.value)}
                        required
                        disabled={!form.database || isLoadingMeasurements}
                      >
                        <option value="">
                          {!form.database
                            ? t('views.plugins.selectDatabaseFirst')
                            : isLoadingMeasurements
                            ? t('views.plugins.loadingMeasurements')
                            : t('views.plugins.selectSourceMeasurement')}
                        </option>
                        {availableMeasurements.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                        {form.source_measurement && !availableMeasurements.includes(form.source_measurement) && (
                          <option value={form.source_measurement}>{form.source_measurement}</option>
                        )}
                      </select>
                    </div>
                  </div>

                  <div className="cq-form-two-cols">
                    <div className="form-group">
                      <label htmlFor="cq-dst">{t('views.plugins.destinationMeasurement')}</label>
                      <input id="cq-dst" type="text" value={form.destination_measurement} onChange={(e) => setForm({ ...form, destination_measurement: e.target.value })} required />
                    </div>

                    <div className="form-group">
                      <label htmlFor="cq-interval">{t('views.plugins.interval')}</label>
                      <input id="cq-interval" type="text" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })} required placeholder={t('views.plugins.intervalPlaceholder')} />
                    </div>
                  </div>

                  <div className="cq-form-two-cols">
                    <div className="form-group">
                      <label htmlFor="cq-retention">{t('views.plugins.retentionDays')}</label>
                      <input id="cq-retention" type="number" min={0} value={form.retention_days} onChange={(e) => setForm({ ...form, retention_days: e.target.value })} />
                    </div>

                    <div className="form-group">
                      <label htmlFor="cq-del-src">{t('views.plugins.deleteSourceAfter')}</label>
                      <input id="cq-del-src" type="number" min={0} value={form.delete_source_after_days} onChange={(e) => setForm({ ...form, delete_source_after_days: e.target.value })} />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="cq-desc">{t('views.plugins.description')}</label>
                    <textarea
                      id="cq-desc"
                      className="cq-desc-input"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder={t('views.plugins.optional')}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="cq-sql">{t('views.plugins.querySql')}</label>
                    <textarea
                      id="cq-sql"
                      className="plugins-cq-sql"
                      value={form.query}
                      onChange={(e) => setForm({ ...form, query: e.target.value })}
                      required
                      spellCheck={false}
                    />
                    <p className="rbac-hint">{t('views.plugins.sqlHint')}</p>
                  </div>
                </div>
              </div>

              <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
                <button type="button" className="btn btn-outlined" onClick={closeForm}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {isSaving ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                  {isSaving ? t('views.plugins.saving') : editingCQ ? t('views.plugins.save') : t('views.plugins.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyFor && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={() => setHistoryFor(null)}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.plugins.historyTitle', { name: historyFor.name })}</h3>
              <button type="button" className="icon-btn" onClick={() => setHistoryFor(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body cq-history-list">
              {historyLoading && (
                <div className="loading-inline">
                  <Loader2 className="spin" size={18} />
                  {t('views.plugins.loading')}
                </div>
              )}
              {!historyLoading && history.length === 0 && <div className="tokens-empty">{t('views.plugins.noHistoryYet')}</div>}
              {!historyLoading && history.map(item => (
                <div key={item.id} className="cq-history-item">
                  <div className="cq-history-top">
                    <span className={`perm-badge${item.status === 'completed' ? '' : ' muted'}`}>{item.status}</span>
                    <span>{new Date(item.execution_time).toLocaleString()}</span>
                  </div>
                  <div className="cq-history-meta">
                    <span>{t('views.plugins.writtenRecords', { count: item.records_written ?? 0 })}</span>
                    <span>{t('views.plugins.durationSeconds', { seconds: item.execution_duration_seconds.toFixed(3) })}</span>
                    <span>{t('views.plugins.historyId', { id: item.execution_id })}</span>
                  </div>
                  {item.error_message && <div className="tokens-alert" style={{ marginTop: 8 }}>{item.error_message}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Plugins;
