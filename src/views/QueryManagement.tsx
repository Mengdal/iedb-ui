import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Loader2, ShieldAlert, XCircle, Plus, Pencil, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { usePolling } from '../hooks/usePolling';
import { formatTime } from '../utils/formatTime';
import Pagination from '../components/Pagination';
import ConfirmModal from '../components/ConfirmModal';
import './PageLayout.css';
import './QueryManagement.css';

interface QueryEntry {
  id: string;
  sql: string;
  token_id: number;
  token_name: string;
  remote_addr: string;
  status: string;
  start_time: string;
  duration_ms: number;
  is_parallel: boolean;
  partition_count: number;
}

type Tab = 'active' | 'history' | 'governance';

interface GovernancePolicy {
  id: number;
  token_id: number;
  token_name?: string;
  rate_limit_per_minute: number;
  rate_limit_per_hour: number;
  max_queries_per_hour: number;
  max_queries_per_day: number;
  max_rows_per_query: number;
  max_scan_duration_sec: number;
}

interface TokenItem {
  id: number;
  name: string;
}

interface PolicyForm {
  token_id: number;
  rate_limit_per_minute: number;
  rate_limit_per_hour: number;
  max_queries_per_hour: number;
  max_queries_per_day: number;
  max_rows_per_query: number;
  max_scan_duration_sec: number;
}

const defaultForm = (): PolicyForm => ({
  token_id: 0,
  rate_limit_per_minute: 0,
  rate_limit_per_hour: 0,
  max_queries_per_hour: 0,
  max_queries_per_day: 0,
  max_rows_per_query: 0,
  max_scan_duration_sec: 0,
});

const PAGE_SIZE = 10;
const AUTO_REFRESH_MS = 5000;

const QueryManagement: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { apiFetch, activeServer, noLicense, featureNotEnabled, resetGate } = useApiFetch();

  const [tab, setTab] = useState<Tab>('active');
  const [activeQueries, setActiveQueries] = useState<QueryEntry[]>([]);
  const [historyQueries, setHistoryQueries] = useState<QueryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [offset, setOffset] = useState(0);

  // Governance state
  const [policies, setPolicies] = useState<GovernancePolicy[]>([]);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<GovernancePolicy | null>(null);
  const [policyForm, setPolicyForm] = useState<PolicyForm>(defaultForm());
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [govNotAvailable, setGovNotAvailable] = useState(false);
  const [policyError, setPolicyError] = useState('');

  // Delete confirmation
  const [deleteQueryId, setDeleteQueryId] = useState<string | null>(null);
  const [deletePolicy, setDeletePolicy] = useState<GovernancePolicy | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const fetchActive = useCallback(async () => {
    if (!activeServer) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const resp = await apiFetch('/api/v1/queries/active', { signal: abortRef.current?.signal });
      if (resp) {
        const data = resp.queries ?? resp.data ?? [];
        setActiveQueries(Array.isArray(data) ? data : []);
      }
    } catch {
      // silently ignore
    }
  }, [activeServer, apiFetch]);

  const fetchHistory = useCallback(async () => {
    if (!activeServer) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const resp = await apiFetch('/api/v1/queries/history?limit=1000');
      if (resp) {
        const data = (resp as any).queries ?? (resp as any).data ?? [];
        setHistoryQueries(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      setErrorMsg(err.message || t('views.queryManagement.failedToLoadHistory'));
    } finally {
      setLoading(false);
    }
  }, [activeServer, apiFetch, t]);

  const fetchPolicies = useCallback(async () => {
    if (!activeServer) return;
    setLoading(true);
    setErrorMsg('');
    setGovNotAvailable(false);
    try {
      const data = await apiFetch('/api/v1/governance/policies');
      if (data === null) {
        setGovNotAvailable(true);
        setPolicies([]);
        return;
      }
      setPolicies(Array.isArray((data as any).policies) ? (data as any).policies : []);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.queryManagement.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [activeServer, apiFetch, t]);

  const fetchTokens = useCallback(async () => {
    if (!activeServer) return;
    try {
      const data = await apiFetch('/api/v1/auth/tokens');
      setTokens(Array.isArray((data as any).tokens) ? (data as any).tokens : (Array.isArray(data) ? data : []));
    } catch {
      // ignore
    }
  }, [activeServer, apiFetch]);

  const fetchCurrent = useCallback(async () => {
    if (!activeServer) {
      setActiveQueries([]);
      setHistoryQueries([]);
      return;
    }
    resetGate();
    setErrorMsg('');
    if (tab === 'active') {
      await fetchActive();
    } else if (tab === 'history') {
      await fetchHistory();
    } else {
      await fetchPolicies();
    }
  }, [activeServer, tab, fetchActive, fetchHistory, fetchPolicies]);

  // Initial fetch + tab change
  useEffect(() => {
    fetchCurrent();
  }, [fetchCurrent, refreshKey]);

  // Reset offset on tab change
  useEffect(() => {
    setOffset(0);
    setShowPolicyModal(false);
    setEditingPolicy(null);
  }, [tab]);

  // Auto-refresh for active tab with AbortController
  usePolling(fetchActive, AUTO_REFRESH_MS, {
    enabled: tab === 'active' && !!activeServer && !noLicense && !featureNotEnabled,
    immediate: false,
  });

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const cancelQuery = async (id: string) => {
    setCancelingId(id);
    try {
      await apiFetch(`/api/v1/queries/${id}`, { method: 'DELETE' });
      await fetchActive();
    } catch {
      // ignore
    } finally {
      setCancelingId(null);
    }
  };

  const openCreatePolicy = () => {
    setEditingPolicy(null);
    setPolicyForm(defaultForm());
    setPolicyError('');
    setShowPolicyModal(true);
    fetchTokens();
  };

  const openEditPolicy = (p: GovernancePolicy) => {
    setEditingPolicy(p);
    setPolicyForm({
      token_id: p.token_id,
      rate_limit_per_minute: p.rate_limit_per_minute,
      rate_limit_per_hour: p.rate_limit_per_hour,
      max_queries_per_hour: p.max_queries_per_hour,
      max_queries_per_day: p.max_queries_per_day,
      max_rows_per_query: p.max_rows_per_query,
      max_scan_duration_sec: p.max_scan_duration_sec,
    });
    setPolicyError('');
    setShowPolicyModal(true);
  };

  const handleSavePolicy = async () => {
    if (!activeServer || !policyForm.token_id) return;
    setSavingPolicy(true);
    setPolicyError('');
    try {
      if (editingPolicy) {
        await apiFetch(`/api/v1/governance/policies/${editingPolicy.token_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(policyForm),
        });
      } else {
        await apiFetch('/api/v1/governance/policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(policyForm),
        });
      }
      setShowPolicyModal(false);
      await fetchPolicies();
    } catch (err: any) {
      setPolicyError(err.message || 'Save failed');
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleDeletePolicy = async (p: GovernancePolicy) => {
    if (!activeServer) return;
    try {
      await apiFetch(`/api/v1/governance/policies/${p.token_id}`, { method: 'DELETE' });
      await fetchPolicies();
    } catch (err: any) {
      setErrorMsg(err.message || t('views.queryManagement.failedToLoad'));
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const translateStatus = (status: string) => {
    const key = `views.queryManagement.status.${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  };

  const allQueries = tab === 'active' ? activeQueries : historyQueries;
  const total = allQueries.length;
  const pageQueries = allQueries.slice(offset, offset + PAGE_SIZE);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('views.queryManagement.title')}</h1>
          <p>{t('views.queryManagement.pageSubtitle')}</p>
        </div>
      </div>

      <div className="page-section">
        <div className="section-header">
          <div className="section-header-text">
            <h2>{tab === 'governance' ? t('views.queryManagement.governance.sectionTitle') : t('views.queryManagement.sectionTitle')}</h2>
            <p>{tab === 'governance' ? t('views.queryManagement.governance.sectionDesc') : t('views.queryManagement.sectionDesc')}</p>
          </div>
          <div className="page-toolbar">
            {tab === 'governance' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreatePolicy}
              >
                <Plus size={16} />
                {t('views.queryManagement.governance.addPolicy')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-outlined"
              onClick={() => { setRefreshKey(k => k + 1); setOffset(0); }}
              disabled={!activeServer || loading}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              {t('views.queryManagement.refresh')}
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
            <p>{t('views.queryManagement.noLicense')}</p>
          </div>
        )}

        {activeServer && featureNotEnabled && (
          <div className="audit-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.queryManagement.featureNotEnabled')}</p>
          </div>
        )}

        {activeServer && !noLicense && !featureNotEnabled && errorMsg && (
          <div className="tokens-alert">{errorMsg}</div>
        )}

        {activeServer && !noLicense && !featureNotEnabled && (
          <>
            <div className="qm-tabs">
              <button
                className={`qm-tab-btn ${tab === 'active' ? 'active' : ''}`}
                onClick={() => setTab('active')}
              >
                {t('views.queryManagement.tabActive')}
              </button>
              <button
                className={`qm-tab-btn ${tab === 'history' ? 'active' : ''}`}
                onClick={() => setTab('history')}
              >
                {t('views.queryManagement.tabHistory')}
              </button>
              <button
                className={`qm-tab-btn ${tab === 'governance' ? 'active' : ''}`}
                onClick={() => setTab('governance')}
              >
                {t('views.queryManagement.governance.tabGovernance')}
              </button>
            </div>

            {/* Governance Tab */}
            {tab === 'governance' && (
              <>
                {govNotAvailable ? (
                  <div className="audit-no-license">
                    <ShieldAlert size={40} />
                    <p>{t('views.queryManagement.governance.notAvailable')}</p>
                  </div>
                ) : (
                <>
                {loading && policies.length === 0 && (
                  <div className="loading-inline">
                    <Loader2 className="spin" size={18} />
                    {t('views.queryManagement.loading')}
                  </div>
                )}

                {!loading && policies.length === 0 && (
                  <div className="tokens-empty">
                    {t('views.queryManagement.governance.noPolicies')}
                  </div>
                )}

                {policies.length > 0 && (
                  <>
                    <div className="tokens-table-wrap">
                      <table className="tokens-table">
                        <colgroup>
                          <col className="qm-col-g-token" />
                          <col className="qm-col-g-rmin" />
                          <col className="qm-col-g-rhour" />
                          <col className="qm-col-g-qhour" />
                          <col className="qm-col-g-qday" />
                          <col className="qm-col-g-rows" />
                          <col className="qm-col-g-scan" />
                          <col className="qm-col-g-actions" />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>{t('views.queryManagement.governance.colToken')}</th>
                            <th>{t('views.queryManagement.governance.colRateMin')}</th>
                            <th>{t('views.queryManagement.governance.colRateHour')}</th>
                            <th>{t('views.queryManagement.governance.colQueryHour')}</th>
                            <th>{t('views.queryManagement.governance.colQueryDay')}</th>
                            <th>{t('views.queryManagement.governance.colMaxRows')}</th>
                            <th>{t('views.queryManagement.governance.colMaxScan')}</th>
                            <th>{t('views.queryManagement.colActions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {policies.slice(offset, offset + PAGE_SIZE).map(p => (
                            <tr key={p.id}>
                              <td>{p.token_name || `Token #${p.token_id}`}</td>
                              <td className={`qm-gov-limit-val ${p.rate_limit_per_minute === 0 ? 'unlimited' : ''}`}>
                                {p.rate_limit_per_minute === 0 ? t('views.queryManagement.governance.unlimited') : p.rate_limit_per_minute}
                              </td>
                              <td className={`qm-gov-limit-val ${p.rate_limit_per_hour === 0 ? 'unlimited' : ''}`}>
                                {p.rate_limit_per_hour === 0 ? t('views.queryManagement.governance.unlimited') : p.rate_limit_per_hour}
                              </td>
                              <td className={`qm-gov-limit-val ${p.max_queries_per_hour === 0 ? 'unlimited' : ''}`}>
                                {p.max_queries_per_hour === 0 ? t('views.queryManagement.governance.unlimited') : p.max_queries_per_hour}
                              </td>
                              <td className={`qm-gov-limit-val ${p.max_queries_per_day === 0 ? 'unlimited' : ''}`}>
                                {p.max_queries_per_day === 0 ? t('views.queryManagement.governance.unlimited') : p.max_queries_per_day}
                              </td>
                              <td className={`qm-gov-limit-val ${p.max_rows_per_query === 0 ? 'unlimited' : ''}`}>
                                {p.max_rows_per_query === 0 ? t('views.queryManagement.governance.unlimited') : p.max_rows_per_query}
                              </td>
                              <td className={`qm-gov-limit-val ${p.max_scan_duration_sec === 0 ? 'unlimited' : ''}`}>
                                {p.max_scan_duration_sec === 0 ? t('views.queryManagement.governance.unlimited') : p.max_scan_duration_sec}
                              </td>
                              <td>
                                <div className="qm-gov-actions">
                                  <button type="button" className="icon-btn" onClick={() => openEditPolicy(p)}>
                                    <Pencil size={16} />
                                  </button>
                                  <button type="button" className="icon-btn danger" onClick={() => setDeletePolicy(p)}>
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <Pagination
                      offset={offset}
                      pageSize={PAGE_SIZE}
                      total={policies.length}
                      onOffsetChange={setOffset}
                    />
                  </>
                )}

                {/* Policy Create/Edit Modal */}
                {showPolicyModal && (
                  <div className="modal-overlay" onClick={() => setShowPolicyModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                      <div className="modal-header">
                        <h2>{editingPolicy ? t('views.queryManagement.governance.editPolicy') : t('views.queryManagement.governance.addPolicy')}</h2>
                        <button type="button" className="icon-btn" onClick={() => setShowPolicyModal(false)}><X size={20} /></button>
                      </div>
                      <div className="modal-body">
                        {policyError && <div className="tokens-alert">{policyError}</div>}
                        <div className="qm-form-grid">
                          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                            <label>{t('views.queryManagement.governance.colToken')}</label>
                            <select
                              value={policyForm.token_id}
                              onChange={e => setPolicyForm(f => ({ ...f, token_id: Number(e.target.value) }))}
                              disabled={!!editingPolicy}
                            >
                              <option value={0}>{t('views.queryManagement.governance.selectToken')}</option>
                              {tokens.map(tk => (
                                <option key={tk.id} value={tk.id}>{tk.name || `Token #${tk.id}`}</option>
                              ))}
                            </select>
                          </div>
                          <div className="form-group">
                            <label>{t('views.queryManagement.governance.colRateMin')}</label>
                            <input type="number" min={0} value={policyForm.rate_limit_per_minute}
                              onChange={e => setPolicyForm(f => ({ ...f, rate_limit_per_minute: Number(e.target.value) }))} />
                            <p className="form-hint">0 = {t('views.queryManagement.governance.unlimited')}</p>
                          </div>
                          <div className="form-group">
                            <label>{t('views.queryManagement.governance.colRateHour')}</label>
                            <input type="number" min={0} value={policyForm.rate_limit_per_hour}
                              onChange={e => setPolicyForm(f => ({ ...f, rate_limit_per_hour: Number(e.target.value) }))} />
                            <p className="form-hint">0 = {t('views.queryManagement.governance.unlimited')}</p>
                          </div>
                          <div className="form-group">
                            <label>{t('views.queryManagement.governance.colQueryHour')}</label>
                            <input type="number" min={0} value={policyForm.max_queries_per_hour}
                              onChange={e => setPolicyForm(f => ({ ...f, max_queries_per_hour: Number(e.target.value) }))} />
                            <p className="form-hint">0 = {t('views.queryManagement.governance.unlimited')}</p>
                          </div>
                          <div className="form-group">
                            <label>{t('views.queryManagement.governance.colQueryDay')}</label>
                            <input type="number" min={0} value={policyForm.max_queries_per_day}
                              onChange={e => setPolicyForm(f => ({ ...f, max_queries_per_day: Number(e.target.value) }))} />
                            <p className="form-hint">0 = {t('views.queryManagement.governance.unlimited')}</p>
                          </div>
                          <div className="form-group">
                            <label>{t('views.queryManagement.governance.colMaxRows')}</label>
                            <input type="number" min={0} value={policyForm.max_rows_per_query}
                              onChange={e => setPolicyForm(f => ({ ...f, max_rows_per_query: Number(e.target.value) }))} />
                            <p className="form-hint">0 = {t('views.queryManagement.governance.unlimited')}</p>
                          </div>
                          <div className="form-group">
                            <label>{t('views.queryManagement.governance.colMaxScan')}</label>
                            <input type="number" min={0} value={policyForm.max_scan_duration_sec}
                              onChange={e => setPolicyForm(f => ({ ...f, max_scan_duration_sec: Number(e.target.value) }))} />
                            <p className="form-hint">0 = {t('views.queryManagement.governance.unlimited')}</p>
                          </div>
                        </div>
                      </div>
                      <div className="modal-actions">
                        <button className="btn btn-secondary" onClick={() => setShowPolicyModal(false)}>
                          {t('views.queryManagement.governance.cancel')}
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={handleSavePolicy}
                          disabled={!policyForm.token_id || savingPolicy}
                        >
                          {savingPolicy ? <Loader2 size={16} className="spin" /> : null}
                          {t('views.queryManagement.governance.save')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                </>
                )}
              </>
            )}

            {/* Active & History Tabs */}
            {tab !== 'governance' && (
              <>
                {loading && allQueries.length === 0 && (
                  <div className="loading-inline">
                    <Loader2 className="spin" size={18} />
                    {t('views.queryManagement.loading')}
                  </div>
                )}

                {!loading && allQueries.length === 0 && (
                  <div className="tokens-empty">
                    {tab === 'active'
                      ? t('views.queryManagement.noActive')
                      : t('views.queryManagement.noHistory')}
                  </div>
                )}

                {pageQueries.length > 0 && (
                  <>
                    <div className="tokens-table-wrap">
                      {tab === 'active' ? (
                        <table className="audit-log-table">
                          <colgroup>
                            <col className="qm-col-id" />
                            <col className="qm-col-sql" />
                            <col className="qm-col-token" />
                            <col className="qm-col-ip" />
                            <col className="qm-col-duration" />
                            <col className="qm-col-parallel" />
                            <col className="qm-col-partitions" />
                            <col className="qm-col-actions" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>{t('views.queryManagement.colId')}</th>
                              <th>{t('views.queryManagement.colSql')}</th>
                              <th>{t('views.queryManagement.colToken')}</th>
                              <th>{t('views.queryManagement.colSource')}</th>
                              <th>{t('views.queryManagement.colDuration')}</th>
                              <th>{t('views.queryManagement.colParallel')}</th>
                              <th>{t('views.queryManagement.colPartitions')}</th>
                              <th>{t('views.queryManagement.colActions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageQueries.map(q => (
                              <tr key={q.id}>
                                <td title={q.id} style={{ fontFamily: 'monospace', fontSize: 12 }}>{q.id}</td>
                                <td className="qm-sql-cell" title={q.sql}>{q.sql}</td>
                                <td title={q.token_name}>{q.token_name || '—'}</td>
                                <td>{q.remote_addr || '—'}</td>
                                <td>{formatDuration(q.duration_ms)}</td>
                                <td>{q.is_parallel ? t('views.queryManagement.yes') : t('views.queryManagement.no')}</td>
                                <td>{q.partition_count}</td>
                                <td>
                                  <button
                                    className="qm-cancel-btn"
                                    onClick={() => setDeleteQueryId(q.id)}
                                    disabled={cancelingId === q.id}
                                  >
                                    <XCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                    {t('views.queryManagement.cancel')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <table className="audit-log-table">
                          <colgroup>
                            <col className="qm-col-h-id" />
                            <col className="qm-col-h-sql" />
                            <col className="qm-col-h-token" />
                            <col className="qm-col-h-status" />
                            <col className="qm-col-h-duration" />
                            <col className="qm-col-h-time" />
                            <col className="qm-col-h-ip" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>{t('views.queryManagement.colId')}</th>
                              <th>{t('views.queryManagement.colSql')}</th>
                              <th>{t('views.queryManagement.colToken')}</th>
                              <th>{t('views.queryManagement.colStatus')}</th>
                              <th>{t('views.queryManagement.colDuration')}</th>
                              <th>{t('views.queryManagement.colStartTime')}</th>
                              <th>{t('views.queryManagement.colSource')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageQueries.map(q => (
                              <tr key={q.id}>
                                <td title={q.id} style={{ fontFamily: 'monospace', fontSize: 12 }}>{q.id}</td>
                                <td className="qm-sql-cell" title={q.sql}>{q.sql}</td>
                                <td title={q.token_name}>{q.token_name || '—'}</td>
                                <td>
                                  <span className={`qm-status-badge ${q.status}`}>
                                    {translateStatus(q.status)}
                                  </span>
                                </td>
                                <td>{formatDuration(q.duration_ms)}</td>
                                <td title={q.start_time}>{formatTime(q.start_time, i18n.language)}</td>
                                <td>{q.remote_addr || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
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
          </>
        )}
      </div>

      {deleteQueryId && (
        <ConfirmModal
          title={t('views.queryManagement.cancelConfirmTitle')}
          description={t('views.queryManagement.cancelConfirm')}
          confirmLabel={t('views.queryManagement.cancel')}
          danger
          onCancel={() => setDeleteQueryId(null)}
          onConfirm={() => {
            cancelQuery(deleteQueryId);
            setDeleteQueryId(null);
          }}
        />
      )}

      {deletePolicy && (
        <ConfirmModal
          title={t('views.queryManagement.governance.deletePolicyTitle')}
          description={t('views.queryManagement.governance.deleteConfirm')}
          confirmLabel={t('common.confirmDelete')}
          danger
          onCancel={() => setDeletePolicy(null)}
          onConfirm={() => {
            handleDeletePolicy(deletePolicy);
            setDeletePolicy(null);
          }}
        />
      )}
    </div>
  );
};

export default QueryManagement;
