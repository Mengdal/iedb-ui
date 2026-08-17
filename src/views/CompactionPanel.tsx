import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert, Loader2, CheckCircle2, XCircle, Zap, BarChart3, Table2, X, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { formatTime } from '../utils/formatTime';
import './PageLayout.css';
import './Tokens.css';
import './RetentionPolicy.css';
import './TieredStorage.css';
import './CompactionPanel.css';

/* ---------- 后端响应类型 ---------- */

interface CompactionScheduler {
  enabled?: boolean;
  running?: boolean;
  schedule?: string;
  next_run?: string;
  role_gated?: boolean;
  gate_role?: string;
}

interface CompactionJob {
  database: string;
  measurement: string;
  partition_path: string;
  tier: string;
  files_compacted?: number;
  bytes_before?: number;
  bytes_after?: number;
  success?: boolean;
  compression_ratio?: number;
  error?: string;
}

interface CompactionCandidate {
  database: string;
  measurement: string;
  partition_path: string;
  file_count: number;
  tier: string;
}

interface CompactionStats {
  total_jobs_completed?: number;
  total_jobs_failed?: number;
  total_files_compacted?: number;
  total_bytes_saved_mb?: number;
  cycle_running?: boolean;
  current_cycle_id?: number;
  recent_jobs?: CompactionJob[];
}

interface Props {
  database: string;
}

const CompactionPanel: React.FC<Props> = ({ database }) => {
  const { t, i18n } = useTranslation();
  const { apiFetch, activeServer, featureNotEnabled } = useApiFetch({ handleLicense: false });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [status, setStatus] = useState<{ schedulers?: Record<string, CompactionScheduler>; manager?: { active_jobs?: number; total_completed?: number; total_failed?: number } } | null>(null);
  const [stats, setStats] = useState<CompactionStats | null>(null);
  const [candidates, setCandidates] = useState<CompactionCandidate[]>([]);
  const [history, setHistory] = useState<CompactionJob[]>([]);

  // 弹窗开关
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showCandidatesModal, setShowCandidatesModal] = useState(false);

  // 触发压缩（二次确认弹窗）
  const [triggering, setTriggering] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [triggerTier, setTriggerTier] = useState<'all' | 'hourly' | 'daily'>('all');
  const [triggerScope, setTriggerScope] = useState<'current' | 'all'>('current');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = (type: 'success' | 'error', text: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ type, text });
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
  };

  const fetchIdRef = useRef(0);

  // 加载状态 / 统计 / 候选 / 历史（单 effect 单计数器）
  useEffect(() => {
    if (!activeServer) return;
    const id = ++fetchIdRef.current;
    const ctrl = new AbortController();
    const run = async () => {
      setLoading(true);
      setErrorMsg('');
      try {
        const [statusData, statsData, candData, histData] = await Promise.all([
          apiFetch('/api/v1/compaction/status', { signal: ctrl.signal }),
          apiFetch('/api/v1/compaction/stats', { signal: ctrl.signal }),
          apiFetch('/api/v1/compaction/candidates', { signal: ctrl.signal }),
          apiFetch('/api/v1/compaction/history?limit=20', { signal: ctrl.signal }),
        ]);
        if (id !== fetchIdRef.current) return;
        setStatus(statusData as typeof status);
        setStats(statsData as CompactionStats | null);
        const cand = candData as { candidates?: CompactionCandidate[] } | null;
        setCandidates(Array.isArray(cand?.candidates) ? cand.candidates : []);
        const hist = histData as { recent_jobs?: CompactionJob[] } | null;
        setHistory(Array.isArray(hist?.recent_jobs) ? hist.recent_jobs : []);
      } catch (err: any) {
        if (id !== fetchIdRef.current) return;
        if (err.name !== 'AbortError') setErrorMsg(err.message || t('views.compaction.failedToLoad'));
      } finally {
        if (id === fetchIdRef.current) setLoading(false);
      }
    };
    run();
    return () => { ctrl.abort(); };
  }, [activeServer, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 确认弹窗中选择参数后真正执行：异步触发，完成后延迟轮询刷新
  const executeTrigger = async () => {
    if (triggering) return;
    setTriggering(true);
    setConfirmOpen(false);
    setErrorMsg('');
    try {
      const tierParam = triggerTier !== 'all' ? `&tier=${triggerTier}` : '';
      const dbParam = triggerScope === 'current' ? `database=${encodeURIComponent(database)}` : '';
      await apiFetch(
        `/api/v1/compaction/trigger?${dbParam}${tierParam}`,
        { method: 'POST' }
      );
      showNotice('success', t('views.compaction.triggered'));
      // 压缩在后台异步执行，稍后刷新以展示最新结果
      setTimeout(() => setRefreshKey(k => k + 1), 3000);
    } catch (err: any) {
      // 409：已有压缩周期运行中
      if (err.message && err.message.includes('already running')) {
        showNotice('error', t('views.compaction.cycleRunning'));
      } else {
        showNotice('error', err.message || t('views.compaction.triggerFailed'));
      }
    } finally {
      setTriggering(false);
    }
  };

  // 当前库的候选（后端 candidates 返回全库，前端按当前库过滤）
  const dbCandidates = useMemo(
    () => candidates.filter(c => c.database === database),
    [candidates, database]
  );

  const schedulerBar = (name: string, sched?: CompactionScheduler) => (
    <span key={name} className="cm-sched-group">
      <span className="cm-sched-name">{name}</span>
      {sched?.running ? (
        <span className="ts-status-badge on">{t('views.compaction.running')}</span>
      ) : (
        <span className="ts-status-badge off">{t('views.compaction.stopped')}</span>
      )}
      {sched?.schedule && (
        <span className="ts-status-detail">{t('views.compaction.schedule')}: {sched.schedule}</span>
      )}
      {sched?.running && sched.next_run && (
        <span className="ts-status-detail">{t('views.compaction.nextRun')}: {formatTime(sched.next_run, i18n.language)}</span>
      )}
      {sched?.role_gated && (
        <span className="ts-status-detail">{t('views.compaction.roleGated')}</span>
      )}
    </span>
  );

  return (
    <div className="ts-root">
      {/* 状态总览 Bar */}
      {activeServer && !featureNotEnabled && status && (
        <div className="ts-status-bar cm-status-bar">
          <div className="ts-status-info">
            <span className="rp-scheduler-icon"><Clock size={16} /></span>
            <span className="ts-status-label">{t('views.compaction.title')}</span>
            <span className="ts-status-sep" />
            {schedulerBar('hourly', status.schedulers?.hourly)}
            <span className="ts-status-sep" />
            {schedulerBar('daily', status.schedulers?.daily)}
          </div>
          <div className="ts-status-actions">
            <button type="button" className="btn btn-outlined btn-small" onClick={() => setConfirmOpen(true)} disabled={triggering}>
              {triggering ? <Loader2 className="spin" size={14} /> : <Zap size={14} />}
              {t('views.compaction.trigger')}
            </button>
          </div>
        </div>
      )}

      <div className="page-section ts-flex-col cm-body" style={{ margin: 0 }}>
        {/* 固定标题行：压缩历史 + 功能按钮 */}
        <div className="ts-sticky-header">
          <div className="section-header">
            <div className="section-header-text">
              <h2>{t('views.compaction.historyTitle')}</h2>
            </div>
            <div className="page-toolbar">
              <button type="button" className="btn btn-outlined btn-small" onClick={() => setShowStatsModal(true)}>
                <BarChart3 size={14} />
                {t('views.compaction.statsButton')}
              </button>
              <button type="button" className="btn btn-outlined btn-small" onClick={() => setShowCandidatesModal(true)}>
                <Table2 size={14} />
                {t('views.compaction.candidatesButton')}
              </button>
              <button type="button" className="btn btn-outlined btn-small" onClick={() => setRefreshKey(k => k + 1)} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'spin' : ''} />
                {t('common.refresh')}
              </button>
            </div>
          </div>
        </div>

        {activeServer && featureNotEnabled && (
          <div className="audit-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.compaction.featureNotEnabled')}</p>
          </div>
        )}

        {activeServer && !featureNotEnabled && errorMsg && (
          <div className="tokens-alert">{errorMsg}</div>
        )}

        {notice && (
          <div className={`ts-toast ts-toast-${notice.type}`}>
            {notice.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>{notice.text}</span>
          </div>
        )}

        {activeServer && !featureNotEnabled && loading && !status && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.compaction.loading')}
          </div>
        )}

        {activeServer && !featureNotEnabled && !loading && (
          <div className="ts-scroll-body">
            {/* 压缩历史 */}
            <div className="cm-section">
              {history.length > 0 ? (
                <div className="tokens-table-wrap">
                  <table className="tokens-table ts-center-table">
                    <colgroup>
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '34%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '14%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>{t('views.compaction.colDatabase')}</th>
                        <th>{t('views.compaction.colMeasurement')}</th>
                        <th>{t('views.compaction.colPartition')}</th>
                        <th>{t('views.compaction.colFiles')}</th>
                        <th>{t('views.compaction.colRatio')}</th>
                        <th>{t('views.compaction.colStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((j, idx) => (
                        <tr key={idx}>
                          <td>{j.database}</td>
                          <td>{j.measurement}</td>
                          <td className="ts-file-path" title={j.partition_path}>{j.partition_path}</td>
                          <td>{j.files_compacted ?? '—'}</td>
                          <td>
                            {j.compression_ratio != null
                              ? `${(j.compression_ratio * 100).toFixed(1)}%`
                              : '—'}
                          </td>
                          <td>
                            {j.success ? (
                              <span className="ts-migration-ok"><CheckCircle2 size={12} /> {t('views.compaction.success')}</span>
                            ) : (
                              <span className="ts-migration-failed" title={j.error || ''}>
                                <XCircle size={12} /> {t('views.compaction.failed')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="tokens-empty">{t('views.compaction.noHistory')}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 执行压缩确认弹窗：选择参数后二次确认 */}
      {confirmOpen && (
        <div className="modal-overlay" role="dialog" aria-modal onWheel={(e) => e.stopPropagation()} onClick={() => setConfirmOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.compaction.confirmTitle')}</h3>
              <button className="icon-btn" onClick={() => setConfirmOpen(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t('views.compaction.fieldTier')}</label>
                <select
                  value={triggerTier}
                  onChange={e => setTriggerTier(e.target.value as 'all' | 'hourly' | 'daily')}
                >
                  <option value="all">{t('views.compaction.tierAll')}</option>
                  <option value="hourly">{t('views.compaction.tierHourly')}</option>
                  <option value="daily">{t('views.compaction.tierDaily')}</option>
                </select>
                <span className="ts-policy-form-hint" style={{ marginTop: 6 }}>{t('views.compaction.fieldTierHint')}</span>
              </div>
              <div className="form-group">
                <label>{t('views.compaction.fieldScope')}</label>
                <select
                  value={triggerScope}
                  onChange={e => setTriggerScope(e.target.value as 'current' | 'all')}
                >
                  <option value="current">{t('views.compaction.scopeCurrent', { database })}</option>
                  <option value="all">{t('views.compaction.scopeAll')}</option>
                </select>
                <span className="ts-policy-form-hint" style={{ marginTop: 6 }}>{t('views.compaction.fieldScopeHint')}</span>
              </div>
              <div className="rp-dry-run-hint">{t('views.compaction.confirmHint')}</div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outlined" onClick={() => setConfirmOpen(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={executeTrigger} disabled={triggering}>
                {triggering ? <Loader2 className="spin" size={14} /> : <Zap size={14} />}
                {t('views.compaction.confirmExecute')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 统计弹窗 */}
      {showStatsModal && (
        <div className="modal-overlay" role="dialog" aria-modal onWheel={(e) => e.stopPropagation()} onClick={() => setShowStatsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.compaction.statsButton')}</h3>
              <button className="icon-btn" onClick={() => setShowStatsModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="cp-stat-list">
                <div className="cp-stat-row">
                  <span className="cp-stat-label">{t('views.compaction.statCompleted')}</span>
                  <span className="cp-stat-value">{stats?.total_jobs_completed ?? '—'}</span>
                </div>
                <div className="cp-stat-row">
                  <span className="cp-stat-label">{t('views.compaction.statFailed')}</span>
                  <span className="cp-stat-value">{stats?.total_jobs_failed ?? '—'}</span>
                </div>
                <div className="cp-stat-row">
                  <span className="cp-stat-label">{t('views.compaction.statFiles')}</span>
                  <span className="cp-stat-value">{stats?.total_files_compacted ?? '—'}</span>
                </div>
                <div className="cp-stat-row">
                  <span className="cp-stat-label">{t('views.compaction.statSaved')}</span>
                  <span className="cp-stat-value">{stats?.total_bytes_saved_mb != null ? `${stats.total_bytes_saved_mb.toFixed(1)} MB` : '—'}</span>
                </div>
                <div className="cp-stat-row">
                  <span className="cp-stat-label">{t('views.compaction.statCycle')}</span>
                  <span className="cp-stat-value">
                    {stats?.cycle_running ? (
                      <span className="ts-status-badge on">{t('views.compaction.running')}</span>
                    ) : (
                      <span className="ts-status-badge on">{t('views.compaction.idle')}</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 候选弹窗 */}
      {showCandidatesModal && (
        <div className="modal-overlay" role="dialog" aria-modal onWheel={(e) => e.stopPropagation()} onClick={() => setShowCandidatesModal(false)}>
          <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {t('views.compaction.candidatesButton')}
                <span className="cm-count-badge" style={{ marginLeft: 8 }}>{dbCandidates.length}</span>
              </h3>
              <button className="icon-btn" onClick={() => setShowCandidatesModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              {dbCandidates.length > 0 ? (
                <div className="tokens-table-wrap">
                  <table className="tokens-table ts-center-table">
                    <colgroup>
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '38%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '12%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>{t('views.compaction.colDatabase')}</th>
                        <th>{t('views.compaction.colMeasurement')}</th>
                        <th>{t('views.compaction.colPartition')}</th>
                        <th>{t('views.compaction.colFiles')}</th>
                        <th>{t('views.compaction.colTier')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbCandidates.map((c, idx) => (
                        <tr key={idx}>
                          <td>{c.database}</td>
                          <td>{c.measurement}</td>
                          <td className="ts-file-path" title={c.partition_path}>{c.partition_path}</td>
                          <td>{c.file_count}</td>
                          <td><span className="ts-tier-badge">{c.tier}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="tokens-empty">{t('views.compaction.noCandidates')}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompactionPanel;
