import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Plus, Edit2, Trash2, Play, Eye, Loader2, ShieldAlert, X, Zap, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { formatTime } from '../utils/formatTime';
import ConfirmModal from '../components/ConfirmModal';
import './PageLayout.css';
import './Tokens.css';
import './RetentionPolicy.css';

interface RetentionPolicy {
  id: number;
  name: string;
  database: string;
  measurement: string | null;
  retention_days: number;
  buffer_days: number;
  is_active: boolean;
  last_execution_time: string | null;
  last_execution_status: string | null;
  last_deleted_count: number | null;
  created_at: string;
  updated_at: string;
}

interface PolicyForm {
  name: string;
  measurement: string;
  retention_days: string;
  buffer_days: string;
  is_active: boolean;
}

interface ExecuteResult {
  policy_id: number;
  policy_name: string;
  deleted_count: number;
  files_deleted: number;
  execution_time_ms: number;
  dry_run: boolean;
  cutoff_date: string;
  affected_measurements: string[];
}

interface SchedulerStatus {
  running?: boolean;
  enabled?: boolean;
  schedule?: string;
  next_run?: string;
  license_valid?: boolean;
  reason?: string;
}

const emptyForm: PolicyForm = {
  name: '',
  measurement: '',
  retention_days: '30',
  buffer_days: '7',
  is_active: true,
};

interface Props {
  database: string;
  measurements: string[];
}

const DatabaseRetentionPolicies: React.FC<Props> = ({ database, measurements }) => {
  const { t, i18n } = useTranslation();
  const { apiFetch, activeServer, featureNotEnabled } = useApiFetch({ handleLicense: false });

  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<RetentionPolicy | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [executingId, setExecutingId] = useState<number | null>(null);
  const [pendingExecutePolicy, setPendingExecutePolicy] = useState<RetentionPolicy | null>(null);
  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);

  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [triggeringAll, setTriggeringAll] = useState(false);
  const [triggerConfirmOpen, setTriggerConfirmOpen] = useState(false);
  const [triggerConfirmed, setTriggerConfirmed] = useState(false);

  const handleTriggerAll = () => {
    setTriggerConfirmOpen(true);
    setTriggerConfirmed(false);
  };

  const executeTriggerAll = async () => {
    setTriggerConfirmOpen(false);
    setTriggerConfirmed(false);
    setTriggeringAll(true);
    try {
      await apiFetch('/api/v1/schedulers/retention/trigger', { method: 'POST' });
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.retentionPolicy.failedToExecute'));
    } finally {
      setTriggeringAll(false);
    }
  };

  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!activeServer) return;
    const id = ++fetchIdRef.current;
    const ctrl = new AbortController();
    const run = async () => {
      setLoading(true);
      setErrorMsg('');
      try {
        const [policiesData, schedData] = await Promise.all([
          apiFetch('/api/v1/retention', { signal: ctrl.signal }),
          apiFetch('/api/v1/schedulers', { signal: ctrl.signal }),
        ]);
        if (id !== fetchIdRef.current) return;
        setPolicies(Array.isArray(policiesData) ? policiesData : []);
        if (schedData?.retention_scheduler) setSchedulerStatus(schedData.retention_scheduler);
      } catch (err: any) {
        if (id !== fetchIdRef.current) return;
        if (err.name !== 'AbortError') setErrorMsg(err.message || t('views.retentionPolicy.failedToLoad'));
      } finally {
        if (id === fetchIdRef.current) setLoading(false);
      }
    };
    run();
    return () => { ctrl.abort(); };
  }, [activeServer, refreshKey]);

  // Filter by current database
  const filteredPolicies = useMemo(() => {
    let list = policies.filter(p => p.database === database);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.measurement && p.measurement.toLowerCase().includes(q))
      );
    }
    return list;
  }, [policies, database, search]);

  const openCreate = () => {
    setEditingPolicy(null);
    setForm({ ...emptyForm });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (policy: RetentionPolicy) => {
    setEditingPolicy(policy);
    setForm({
      name: policy.name,
      measurement: policy.measurement || '',
      retention_days: String(policy.retention_days),
      buffer_days: String(policy.buffer_days),
      is_active: policy.is_active,
    });
    setFormError('');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    const retentionDays = parseInt(form.retention_days, 10);
    const bufferDays = parseInt(form.buffer_days, 10);
    if (isNaN(retentionDays) || retentionDays <= 0) {
      setFormError(t('views.retentionPolicy.failedToSave'));
      return;
    }
    if (isNaN(bufferDays) || bufferDays < 0) {
      setFormError(t('views.retentionPolicy.failedToSave'));
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const body = {
        name: form.name.trim(),
        database,
        measurement: form.measurement.trim() || null,
        retention_days: retentionDays,
        buffer_days: bufferDays,
        is_active: form.is_active,
      };

      if (editingPolicy) {
        await apiFetch(`/api/v1/retention/${editingPolicy.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/api/v1/retention', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      setFormOpen(false);
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      setFormError(err.message || t('views.retentionPolicy.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    await apiFetch(`/api/v1/retention/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    setRefreshKey(k => k + 1);
  };

  const handleExecute = async (policy: RetentionPolicy, dryRunOnly: boolean) => {
    if (!policy.is_active) {
      setErrorMsg(t('views.retentionPolicy.cannotExecuteInactive', { name: policy.name }));
      return;
    }
    setExecutingId(policy.id);
    setPendingExecutePolicy(null);
    try {
      const data = await apiFetch(`/api/v1/retention/${policy.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ dry_run: true, confirm: false }),
      });
      if (data) {
        setExecuteResult(data);
        if (!dryRunOnly) {
          setPendingExecutePolicy(policy);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || t('views.retentionPolicy.failedToExecute'));
    } finally {
      setExecutingId(null);
    }
  };

  const handleConfirmExecute = async () => {
    if (!pendingExecutePolicy) return;
    setExecutingId(pendingExecutePolicy.id);
    try {
      const data = await apiFetch(`/api/v1/retention/${pendingExecutePolicy.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ dry_run: false, confirm: true }),
      });
      if (data) {
        setExecuteResult(data);
        setPendingExecutePolicy(null);
        setRefreshKey(k => k + 1);
      }
    } catch (err: any) {
      setErrorMsg(err.message || t('views.retentionPolicy.failedToExecute'));
    } finally {
      setExecutingId(null);
    }
  };

  const togglePolicyStatus = async (policy: RetentionPolicy) => {
    setTogglingStatusId(policy.id);
    try {
      await apiFetch(`/api/v1/retention/${policy.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: policy.name,
          database: policy.database,
          measurement: policy.measurement || null,
          retention_days: policy.retention_days,
          buffer_days: policy.buffer_days,
          is_active: !policy.is_active,
        }),
      });
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.retentionPolicy.failedToSave'));
    } finally {
      setTogglingStatusId(null);
    }
  };

  return (
    <>
      {/* Scheduler Status Bar */}
      {activeServer && !featureNotEnabled && schedulerStatus && (
        <div className="rp-scheduler-bar">
          <div className="rp-scheduler-info">
            <span className="rp-scheduler-icon"><Clock size={16} /></span>
            <span className="rp-scheduler-label">{t('views.retentionPolicy.schedulerTitle')}</span>
            {schedulerStatus.running ? (
              <span className="rp-scheduler-badge running">{t('views.retentionPolicy.schedulerRunning')}</span>
            ) : schedulerStatus.enabled === false ? (
              <span className="rp-scheduler-badge stopped">{t('views.retentionPolicy.schedulerDisabled')}</span>
            ) : (
              <span className="rp-scheduler-badge stopped">{t('views.retentionPolicy.schedulerStopped')}</span>
            )}
            {schedulerStatus.schedule && (
              <span className="rp-scheduler-detail">{t('views.retentionPolicy.schedulerSchedule')}: {schedulerStatus.schedule}</span>
            )}
            {schedulerStatus.next_run && (
              <span className="rp-scheduler-detail">{t('views.retentionPolicy.schedulerNextRun')}: {formatTime(schedulerStatus.next_run, i18n.language)}</span>
            )}
            {schedulerStatus.reason && !schedulerStatus.running && (
              <span className="rp-scheduler-reason">{schedulerStatus.reason}</span>
            )}
          </div>
          {schedulerStatus.running && (
            <button type="button" className="btn btn-outlined btn-small" onClick={handleTriggerAll} disabled={triggeringAll}>
              {triggeringAll ? <Loader2 className="spin" size={14} /> : <Zap size={14} />}
              {t('views.retentionPolicy.triggerAll')}
            </button>
          )}
        </div>
      )}

      <div className="page-section" style={{ margin: 0 }}>
        <div className="section-header">
          <div className="section-header-text">
            <h2>{t('views.retentionPolicy.sectionTitle')}</h2>
          </div>
          <div className="page-toolbar">
            <input
              className="page-search"
              type="search"
              placeholder={t('views.retentionPolicy.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button type="button" className="btn btn-outlined" onClick={() => setRefreshKey(k => k + 1)} disabled={!activeServer || loading}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              {t('common.refresh')}
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate} disabled={!activeServer}>
              <Plus size={16} />
              {t('views.retentionPolicy.createPolicy')}
            </button>
          </div>
        </div>

        {activeServer && featureNotEnabled && (
          <div className="audit-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.retentionPolicy.featureNotEnabled')}</p>
          </div>
        )}

        {activeServer && !featureNotEnabled && errorMsg && (
          <div className="tokens-alert">{errorMsg}</div>
        )}

        {activeServer && !featureNotEnabled && loading && policies.length === 0 && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.retentionPolicy.loading')}
          </div>
        )}

        {activeServer && !featureNotEnabled && !loading && filteredPolicies.length === 0 && (
          <div className="tokens-empty">
            {search ? t('views.retentionPolicy.searchPlaceholder') : t('views.retentionPolicy.noPolicies')}
          </div>
        )}

        {activeServer && !featureNotEnabled && filteredPolicies.length > 0 && (
          <div className="tokens-table-wrap">
            <table className="tokens-table">
              <colgroup>
                <col style={{ width: '18%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('views.retentionPolicy.colName')}</th>
                  <th>{t('views.retentionPolicy.colMeasurement')}</th>
                  <th>{t('views.retentionPolicy.colRetentionDays')}</th>
                  <th>{t('views.retentionPolicy.colBufferDays')}</th>
                  <th>{t('views.retentionPolicy.colStatus')}</th>
                  <th>{t('views.retentionPolicy.colLastExecution')}</th>
                  <th>{t('views.retentionPolicy.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPolicies.map(p => (
                  <tr key={p.id}>
                    <td title={p.name}>{p.name}</td>
                    <td>{p.measurement || t('views.retentionPolicy.allMeasurements')}</td>
                    <td>{p.retention_days}</td>
                    <td>{p.buffer_days}</td>
                    <td>
                      <button
                        type="button"
                        className={`rp-status-switch ${p.is_active ? 'on' : 'off'}`}
                        onClick={() => togglePolicyStatus(p)}
                        disabled={togglingStatusId === p.id}
                        title={
                          togglingStatusId === p.id
                            ? t('views.retentionPolicy.updatingStatus')
                            : p.is_active
                            ? t('views.retentionPolicy.activeClickToDisable')
                            : t('views.retentionPolicy.inactiveClickToEnable')
                        }
                      >
                        <span className="rp-toggle-track" aria-hidden><span className="rp-toggle-thumb" /></span>
                      </button>
                    </td>
                    <td>
                      {p.last_execution_time ? (
                        <div className="rp-execution-info">
                          <span className="rp-execution-time">{formatTime(p.last_execution_time, i18n.language)}</span>
                          <span className={`rp-execution-status ${p.last_execution_status || ''}`}>
                            {p.last_execution_status === 'completed' ? '✓' : '✗'} {p.last_execution_status}
                            {p.last_deleted_count != null && ` (${p.last_deleted_count})`}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{t('views.retentionPolicy.neverExecuted')}</span>
                      )}
                    </td>
                    <td>
                      <div className="rp-actions">
                        <button className={`icon-btn ${!p.is_active ? 'icon-btn-inactive' : ''}`} title={t('views.retentionPolicy.execute')} onClick={() => handleExecute(p, false)} disabled={executingId === p.id}>
                          {executingId === p.id ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                        </button>
                        <button className="icon-btn" title={t('views.retentionPolicy.dryRun')} onClick={() => handleExecute(p, true)} disabled={executingId === p.id}>
                          <Eye size={14} />
                        </button>
                        <button className="icon-btn" title={t('views.retentionPolicy.edit')} onClick={() => openEdit(p)}>
                          <Edit2 size={14} />
                        </button>
                        <button className="icon-btn" title={t('views.retentionPolicy.delete')} onClick={() => setDeleteId(p.id)}>
                          <Trash2 size={14} />
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

      {/* Create/Edit Modal */}
      {formOpen && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={() => setFormOpen(false)}>
          <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingPolicy ? t('views.retentionPolicy.editTitle') : t('views.retentionPolicy.createTitle')}</h3>
              <button className="icon-btn" onClick={() => setFormOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && <div className="tokens-alert">{formError}</div>}
                <div className="form-group">
                  <label>{t('views.retentionPolicy.fieldName')}</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>{t('views.retentionPolicy.fieldMeasurement')}</label>
                  <select value={form.measurement} onChange={e => setForm(f => ({ ...f, measurement: e.target.value }))}>
                    <option value="">{t('views.retentionPolicy.allMeasurements')}</option>
                    {measurements.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="form-group">
                    <label>{t('views.retentionPolicy.fieldRetentionDays')}</label>
                    <input type="number" min="1" value={form.retention_days} onChange={e => setForm(f => ({ ...f, retention_days: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label>{t('views.retentionPolicy.fieldBufferDays')}</label>
                    <input type="number" min="0" value={form.buffer_days} onChange={e => setForm(f => ({ ...f, buffer_days: e.target.value }))} required />
                  </div>
                </div>
                <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <button type="button" className={`rp-toggle ${form.is_active ? 'on' : ''}`} onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}>
                    <span className="rp-toggle-track"><span className="rp-toggle-thumb" /></span>
                  </button>
                  <label style={{ margin: 0 }}>{t('views.retentionPolicy.fieldIsActive')}</label>
                </div>
              </div>
              <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
                <button type="button" className="btn btn-outlined" onClick={() => setFormOpen(false)}>{t('views.retentionPolicy.cancel')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 className="spin" size={16} /> : null}
                  {saving ? t('views.retentionPolicy.saving') : t('views.retentionPolicy.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <ConfirmModal
          title={t('views.retentionPolicy.delete')}
          description={t('views.retentionPolicy.deleteConfirm', { name: policies.find(p => p.id === deleteId)?.name || '' })}
          confirmLabel={t('views.retentionPolicy.delete')}
          danger
          onCancel={() => setDeleteId(null)}
          onConfirm={handleDelete}
        />
      )}

      {/* Execute Result Modal */}
      {executeResult && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={() => { setExecuteResult(null); setPendingExecutePolicy(null); }}>
          <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{executeResult.dry_run ? t('views.retentionPolicy.dryRunResult') : t('views.retentionPolicy.executeResult')}</h3>
              <button className="icon-btn" onClick={() => { setExecuteResult(null); setPendingExecutePolicy(null); }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              {executeResult.dry_run && pendingExecutePolicy && (
                <div className="rp-dry-run-hint">{t('views.retentionPolicy.dryRunHint', { name: pendingExecutePolicy.name })}</div>
              )}
              <div className="rp-result-grid">
                <div className="rp-result-item">
                  <span className="rp-result-label">{t('views.retentionPolicy.deletedCount')}</span>
                  <span className="rp-result-value">{executeResult.deleted_count.toLocaleString()}</span>
                </div>
                <div className="rp-result-item">
                  <span className="rp-result-label">{t('views.retentionPolicy.filesDeleted')}</span>
                  <span className="rp-result-value">{executeResult.files_deleted}</span>
                </div>
                <div className="rp-result-item">
                  <span className="rp-result-label">{t('views.retentionPolicy.executionTime')}</span>
                  <span className="rp-result-value">{(executeResult.execution_time_ms / 1000).toFixed(2)}s</span>
                </div>
                <div className="rp-result-item">
                  <span className="rp-result-label">{t('views.retentionPolicy.cutoffDate')}</span>
                  <span className="rp-result-value">{formatTime(executeResult.cutoff_date, i18n.language)}</span>
                </div>
              </div>
              {executeResult.affected_measurements.length > 0 && (
                <div className="rp-result-measurements">
                  <div className="rp-result-measurements-label">{t('views.retentionPolicy.affectedMeasurements')}</div>
                  <div className="rp-result-tags">
                    {executeResult.affected_measurements.map(m => (
                      <span key={m} className="rp-result-tag">{m}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-outlined" onClick={() => { setExecuteResult(null); setPendingExecutePolicy(null); }}>
                {pendingExecutePolicy ? t('views.retentionPolicy.cancel') : t('common.close')}
              </button>
              {pendingExecutePolicy && (
                <button className="btn btn-danger" onClick={handleConfirmExecute} disabled={executingId !== null}>
                  {executingId !== null ? <Loader2 className="spin" size={16} /> : null}
                  {t('views.retentionPolicy.confirmExecute')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Trigger All — Step 1: Warning */}
      {triggerConfirmOpen && !triggerConfirmed && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={() => setTriggerConfirmOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.retentionPolicy.triggerAllTitle')}</h3>
              <button className="icon-btn" onClick={() => setTriggerConfirmOpen(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>{t('views.retentionPolicy.triggerAllStep1')}</p>
              <div className="rp-trigger-warning">
                <Zap size={16} />
                <span>{t('views.retentionPolicy.triggerAllScope')}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outlined" onClick={() => setTriggerConfirmOpen(false)}>
                {t('views.retentionPolicy.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => setTriggerConfirmed(true)}>
                {t('views.retentionPolicy.triggerAllContinue')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trigger All — Step 2: Final confirm */}
      {triggerConfirmOpen && triggerConfirmed && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={() => { setTriggerConfirmOpen(false); setTriggerConfirmed(false); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.retentionPolicy.triggerAllConfirmTitle')}</h3>
              <button className="icon-btn" onClick={() => { setTriggerConfirmOpen(false); setTriggerConfirmed(false); }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>{t('views.retentionPolicy.triggerAllStep2')}</p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outlined" onClick={() => { setTriggerConfirmOpen(false); setTriggerConfirmed(false); }}>
                {t('views.retentionPolicy.cancel')}
              </button>
              <button className="btn btn-danger" onClick={executeTriggerAll}>
                {t('views.retentionPolicy.triggerAllConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DatabaseRetentionPolicies;
