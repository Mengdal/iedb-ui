import React, { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Trash2, X, AlertTriangle, Loader2, ShieldAlert, FileText, Upload, Download, ChevronRight } from 'lucide-react';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { formatTime } from '../utils/formatTime';
import ConfirmModal from '../components/ConfirmModal';
import './Plugins.css';
import './Tokens.css';
import './RetentionPolicy.css';
import './BackupManagement.css';

/* ── Types ─────────────────────────────────────────────── */

interface BackupSummary {
  backup_id: string;
  created_at: string;
  backup_type: string;      // 后端契约字段：full（未来 incremental），前端暂未使用
  total_files: number;
  total_size_bytes: number;
  database_count: number;   // 后端契约字段，前端暂未使用
}

interface BackupProgress {
  operation: string;     // "backup" | "restore"
  backup_id: string;
  status: string;        // "running" | "completed" | "failed"
  total_files: number;
  processed_files: number;
  total_bytes: number;
  processed_bytes: number;
  started_at: string;
  completed_at?: string; // 后端契约字段，前端暂未使用
  error?: string;
}

interface MeasurementInfo {
  name: string;
  file_count: number;
  size_bytes: number;
}

interface DatabaseInfo {
  name: string;
  measurements: MeasurementInfo[];
  file_count: number;
  size_bytes: number;
}

interface Manifest {
  version: string;
  backup_id: string;
  created_at: string;
  backup_type: string;
  databases: DatabaseInfo[];
  total_files: number;
  total_size_bytes: number;
  has_metadata: boolean;
  has_config: boolean;
}

/* ── Helpers ───────────────────────────────────────────── */

function formatBytes(bytes: number, t: (key: string) => string): string {
  if (bytes === 0) return '0 ' + t('views.backup.sizeBytes');
  const units = ['sizeBytes', 'sizeKB', 'sizeMB', 'sizeGB'] as const;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + t('views.backup.' + units[i]);
}

/* ── Component ─────────────────────────────────────────── */

const BackupManagement: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { activeServer } = useServers();
  const { apiJson, featureNotEnabled, noLicense } = useApiFetch({ handleLicense: true, handleFeature: true });

  /* State */
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  /* Modals */
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupSummary | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailManifest, setDetailManifest] = useState<Manifest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});

  /* Delete */
  const [deleteTarget, setDeleteTarget] = useState<BackupSummary | null>(null);

  /* Create form */
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  /* Restore form */
  const [restoreData, setRestoreData] = useState(true);
  const [restoreMetadata, setRestoreMetadata] = useState(true);
  const [restoreConfig, setRestoreConfig] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStatusRef = useRef<string>('');
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 本页面会话内是否由用户发起过备份/恢复（只有发起过才显示完成提示）
  const startedByUserRef = useRef(false);

  /* ── API calls ───────────────────────────────────────── */

  const showError = (msg: string) => {
    setErrorMsg(msg);
    window.setTimeout(() => setErrorMsg(''), 8000);
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 3000);
  };

  const fetchBackups = async () => {
    if (!activeServer) {
      setBackups([]);
      return;
    }
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await apiJson('/api/v1/backup');
      if (data?.backups) {
        // 后端 ListBackups 未排序（Go map 遍历顺序随机），前端按创建时间降序兜底
        const list = Array.isArray(data.backups) ? data.backups : [];
        list.sort((a: BackupSummary, b: BackupSummary) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setBackups(list);
      }
    } catch (err: any) {
      if (!featureNotEnabled) {
        showError(err.message || t('views.backup.failedToLoad'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStatus = async () => {
    if (!activeServer) return;
    try {
      const data = await apiJson('/api/v1/backup/status');
      if (data) {
        if (data.status === 'idle') {
          setProgress(null);
          lastStatusRef.current = '';
          stopPolling();
          return;
        }

        const cur = data as BackupProgress;

        // running：更新进度，确保轮询在跑（页面加载时也能自愈）
        if (cur.status === 'running') {
          lastStatusRef.current = 'running';
          setProgress(cur);
          startPolling();
          return;
        }

        // completed / failed 终态
        if (cur.status === 'completed' || cur.status === 'failed') {
          // 非本页面发起的操作（页面刷新/进入时的历史残留）：静默清理，不提示
          if (!startedByUserRef.current) {
            lastStatusRef.current = `done-${cur.status}`;
            setProgress(null);
            stopPolling();
            fetchBackups();
            return;
          }

          // 本页面发起并完成的：顶部状态栏显示完成/失败，短暂展示后消失
          const doneKey = `done-${cur.status}`;
          if (lastStatusRef.current !== doneKey) {
            lastStatusRef.current = doneKey;
            fetchBackups();
          }
          setProgress(cur);
          if (!finishTimerRef.current) {
            finishTimerRef.current = window.setTimeout(() => {
              setProgress(null);
              lastStatusRef.current = '';
              startedByUserRef.current = false;
              finishTimerRef.current = null;
              stopPolling();
            }, 2500);
          }
        }
      }
    } catch {
      // silent — status is best-effort
    }
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleCreate = async () => {
    if (!activeServer) return;
    setIsCreating(true);
    setErrorMsg('');
    try {
      const data = await apiJson('/api/v1/backup', {
        method: 'POST',
        body: JSON.stringify({ include_metadata: includeMetadata, include_config: includeConfig }),
      });
      if (data?.status === 'running') {
        setShowCreateModal(false);
        startedByUserRef.current = true;
        // 顶部状态栏会显示"备份进行中"，无需额外提示
        // fetchStatus 内部对 running 会自动启动轮询
        fetchStatus();
      }
    } catch (err: any) {
      if (err.message?.includes('already in progress')) {
        showError(t('views.backup.alreadyRunning'));
      } else {
        showError(err.message || t('views.backup.failedToCreate'));
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setErrorMsg('');
    try {
      await apiJson(`/api/v1/backup/${encodeURIComponent(deleteTarget.backup_id)}`, { method: 'DELETE' });
      setDeleteTarget(null);
      showSuccess(t('views.backup.deleteSuccess'));
      fetchBackups();
    } catch (err: any) {
      showError(err.message || t('views.backup.failedToDelete'));
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setIsRestoring(true);
    setErrorMsg('');
    try {
      const data = await apiJson('/api/v1/backup/restore', {
        method: 'POST',
        body: JSON.stringify({
          backup_id: restoreTarget.backup_id,
          restore_data: restoreData,
          restore_metadata: restoreMetadata,
          restore_config: restoreConfig,
          confirm: true,
        }),
      });
      if (data?.status === 'running') {
        setShowRestoreModal(false);
        setRestoreConfirmed(false);
        startedByUserRef.current = true;
        // 顶部状态栏会显示"恢复进行中"，无需额外提示
        // fetchStatus 内部对 running 会自动启动轮询
        fetchStatus();
      }
    } catch (err: any) {
      if (err.message?.includes('already in progress')) {
        showError(t('views.backup.alreadyRunning'));
      } else {
        showError(err.message || t('views.backup.failedToRestore'));
      }
    } finally {
      setIsRestoring(false);
    }
  };

  const fetchDetail = async (backup: BackupSummary) => {
    setDetailLoading(true);
    setDetailManifest(null);
    setExpandedDbs({});
    setShowDetailModal(true);
    try {
      const data = await apiJson(`/api/v1/backup/${encodeURIComponent(backup.backup_id)}`);
      setDetailManifest(data as Manifest);
    } catch (err: any) {
      showError(err.message || t('views.backup.failedToLoadDetail'));
      setShowDetailModal(false);
    } finally {
      setDetailLoading(false);
    }
  };

  /* ── Polling ──────────────────────────────────────────── */

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchStatus, 1000);
  };

  useEffect(() => {
    return () => {
      stopPolling();
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current);
        finishTimerRef.current = null;
      }
    };
  }, []);

  /* ── Lifecycle ────────────────────────────────────────── */

  useEffect(() => {
    // 切换服务器/首次进入：重置"本页面发起"标记，避免把历史残留当成本页操作
    startedByUserRef.current = false;
    fetchBackups();
    fetchStatus();
  }, [activeServer]);

  /* ── Filtered backups ─────────────────────────────────── */

  const filteredBackups = backups.filter(b =>
    !searchQuery || b.backup_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  /* ── Render helpers ───────────────────────────────────── */

  const openRestore = (b: BackupSummary) => {
    setRestoreTarget(b);
    setRestoreData(true);
    setRestoreMetadata(true);
    setRestoreConfig(false);
    setRestoreConfirmed(false);
    setShowRestoreModal(true);
  };

  const openCreate = () => {
    setIncludeMetadata(true);
    setIncludeConfig(true);
    setShowCreateModal(true);
  };

  const toggleDbExpand = (name: string) => {
    setExpandedDbs(prev => ({ ...prev, [name]: !prev[name] }));
  };

  /* ── Render ───────────────────────────────────────────── */

  const isRunning = progress?.status === 'running';

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('views.backup.title')}</h1>
          <p>{t('views.backup.pageSubtitle')}</p>
        </div>
      </div>

      <div className="page-section">
        {!activeServer && (
          <div className="tokens-empty">
            <AlertTriangle size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            {t('views.backup.noServer')}
          </div>
        )}

        {(noLicense || featureNotEnabled) && (
          <div className="backup-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.backup.featureNotEnabled')}</p>
          </div>
        )}

        {activeServer && !noLicense && !featureNotEnabled && (
          <>
            {/* Progress bar — 复用保留策略自动调度样式 */}
            {progress && (
              <div className="rp-scheduler-bar backup-progress-bar">
                <div className="rp-scheduler-info">
                  {isRunning ? (
                    <span className="rp-scheduler-icon"><Loader2 size={16} className="spin" /></span>
                  ) : progress.status === 'completed' ? (
                    <span className="rp-scheduler-icon backup-progress-icon-success">✓</span>
                  ) : (
                    <span className="rp-scheduler-icon backup-progress-icon-fail">✗</span>
                  )}
                  <span className="rp-scheduler-label">
                    {progress.status === 'completed'
                      ? (progress.operation === 'backup'
                          ? t('views.backup.backupCompleted')
                          : t('views.backup.restoreCompleted'))
                      : progress.status === 'failed'
                      ? (progress.operation === 'backup'
                          ? t('views.backup.backupFailed')
                          : t('views.backup.restoreFailed'))
                      : (progress.operation === 'backup'
                          ? t('views.backup.progressOperationBackup')
                          : t('views.backup.progressOperationRestore'))}
                  </span>
                  <span className={`rp-scheduler-badge ${progress.status === 'failed' ? 'stopped' : 'running'}`}>
                    {progress.status === 'running'
                      ? t('views.backup.progressRunning')
                      : progress.status === 'completed'
                      ? t('views.backup.progressCompleted')
                      : t('views.backup.progressFailed')}
                  </span>
                  {isRunning && (
                    <>
                      <span className="rp-scheduler-detail">
                        {t('views.backup.progressFiles', {
                          processed: progress.processed_files.toLocaleString(),
                          total: progress.total_files.toLocaleString(),
                        })}
                      </span>
                      <span className="rp-scheduler-detail">
                        {t('views.backup.progressBytes', {
                          processed: formatBytes(progress.processed_bytes, t),
                          total: formatBytes(progress.total_bytes, t),
                        })}
                      </span>
                    </>
                  )}
                  {progress.error && (
                    <span className="rp-scheduler-reason">
                      {t('views.backup.progressError', { error: progress.error })}
                    </span>
                  )}
                </div>
                {isRunning && (
                  <div className="backup-progress-track">
                    <div
                      className={`backup-progress-fill ${progress.operation === 'restore' ? 'restore' : ''}`}
                      style={{
                        width: progress.total_files > 0
                          ? `${Math.min((progress.processed_files / progress.total_files) * 100, 100)}%`
                          : '0%'
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Error / Success alerts */}
            {errorMsg && <div className="tokens-alert">{errorMsg}</div>}
            {successMsg && <div className="tokens-alert backup-success-msg">{successMsg}</div>}

            {/* Toolbar */}
            <div className="section-header">
              <div className="section-header-text">
                <h2>{t('views.backup.sectionTitle')}</h2>
                <p>{t('views.backup.sectionDesc')}</p>
              </div>
              <div className="page-toolbar">
                <input
                  className="page-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('views.backup.searchPlaceholder')}
                />
                <button type="button" className="btn btn-outlined" onClick={fetchBackups} disabled={isLoading}>
                  <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
                  {t('views.backup.refresh')}
                </button>
                <button type="button" className="btn btn-primary" onClick={openCreate} disabled={isRunning}>
                  <Plus size={16} />
                  {t('views.backup.createBackup')}
                </button>
              </div>
            </div>

            {/* Loading */}
            {isLoading && backups.length === 0 && !errorMsg && (
              <div className="loading-inline">
                <Loader2 className="spin" size={18} />
                {t('views.backup.loading')}
              </div>
            )}

            {/* Empty */}
            {!isLoading && !errorMsg && filteredBackups.length === 0 && (
              <div className="tokens-empty">
                <p>{t('views.backup.noBackups')}</p>
              </div>
            )}

            {/* Table */}
            {filteredBackups.length > 0 && (
              <div className="tokens-table-wrap">
                <table className="tokens-table backup-table">
                  <colgroup>
                    <col className="backup-col-id" />
                    <col className="backup-col-time" />
                    <col className="backup-col-type" />
                    <col className="backup-col-files" />
                    <col className="backup-col-size" />
                    <col className="backup-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>{t('views.backup.colId')}</th>
                      <th>{t('views.backup.colTime')}</th>
                      <th>{t('views.backup.colType')}</th>
                      <th>{t('views.backup.colFiles')}</th>
                      <th>{t('views.backup.colSize')}</th>
                      <th>{t('views.backup.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBackups.map(b => (
                      <tr key={b.backup_id}>
                        <td>
                          <span className="backup-id-link" onClick={() => fetchDetail(b)} title={t('views.backup.actionDetail')}>
                            {b.backup_id}
                          </span>
                        </td>
                        <td>{formatTime(b.created_at, i18n.language)}</td>
                        <td>
                          <span className="status-badge active">{t('views.backup.typeFull')}</span>
                        </td>
                        <td>{b.total_files.toLocaleString()}</td>
                        <td>{formatBytes(b.total_size_bytes, t)}</td>
                        <td>
                          <div className="token-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              title={t('views.backup.actionDetail')}
                              onClick={() => fetchDetail(b)}
                            >
                              <FileText size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title={t('views.backup.actionRestore')}
                              onClick={() => openRestore(b)}
                              disabled={isRunning}
                            >
                              <Upload size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              title={t('views.backup.actionDelete')}
                              onClick={() => setDeleteTarget(b)}
                            >
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
          </>
        )}
      </div>

      {/* ── Create Modal ── */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.backup.createTitle')}</h3>
              <button type="button" className="icon-btn" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p className="confirm-modal-description">{t('views.backup.createDesc')}</p>
              <div className="perm-checkboxes" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
                <label>
                  <input type="checkbox" checked={includeMetadata} onChange={(e) => setIncludeMetadata(e.target.checked)} />
                  {t('views.backup.includeMetadata')}
                </label>
                <label>
                  <input type="checkbox" checked={includeConfig} onChange={(e) => setIncludeConfig(e.target.checked)} />
                  {t('views.backup.includeConfig')}
                </label>
              </div>
              <p className="confirm-modal-description">{t('views.backup.createHint')}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outlined" onClick={() => setShowCreateModal(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={isCreating}>
                {isCreating ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                {t('views.backup.startBackup')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Restore Modal ── */}
      {showRestoreModal && restoreTarget && (
        <div className="modal-overlay" onClick={() => setShowRestoreModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><AlertTriangle size={18} style={{ color: '#f59e0b', verticalAlign: 'middle', marginRight: 8 }} />{t('views.backup.restoreTitle')}</h3>
              <button type="button" className="icon-btn" onClick={() => setShowRestoreModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p className="confirm-modal-description">{t('views.backup.restoreDesc', { id: restoreTarget.backup_id })}</p>
              <div className="backup-restore-info">
                <div className="backup-detail-row">
                  <span className="backup-detail-label">{t('views.backup.colId')}</span>
                  <span className="backup-detail-value" style={{ fontSize: 12, fontFamily: 'monospace' }}>{restoreTarget.backup_id}</span>
                </div>
                <div className="backup-detail-row">
                  <span className="backup-detail-label">{t('views.backup.colTime')}</span>
                  <span className="backup-detail-value">{formatTime(restoreTarget.created_at, i18n.language)}</span>
                </div>
                <div className="backup-detail-row">
                  <span className="backup-detail-label">{t('views.backup.colSize')}</span>
                  <span className="backup-detail-value">{formatBytes(restoreTarget.total_size_bytes, t)}</span>
                </div>
              </div>
              <div className="perm-checkboxes" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
                <label>
                  <input type="checkbox" checked={restoreData} onChange={(e) => setRestoreData(e.target.checked)} />
                  {t('views.backup.restoreData')}
                </label>
                <label>
                  <input type="checkbox" checked={restoreMetadata} onChange={(e) => setRestoreMetadata(e.target.checked)} />
                  {t('views.backup.restoreMetadata')}
                </label>
                <label>
                  <input type="checkbox" checked={restoreConfig} onChange={(e) => setRestoreConfig(e.target.checked)} />
                  {t('views.backup.restoreConfig')}
                </label>
              </div>
              <div className="backup-restore-confirm">
                <label>
                  <input type="checkbox" checked={restoreConfirmed} onChange={(e) => setRestoreConfirmed(e.target.checked)} />
                  <span>{t('views.backup.confirmRestore')}</span>
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outlined" onClick={() => setShowRestoreModal(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleRestore}
                disabled={!restoreConfirmed || isRestoring}
              >
                {isRestoring ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                {t('views.backup.startRestore')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {showDetailModal && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.backup.detailTitle')}</h3>
              <button type="button" className="icon-btn" onClick={() => setShowDetailModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {detailLoading && (
                <div className="loading-inline">
                  <Loader2 className="spin" size={18} />
                  {t('views.backup.loading')}
                </div>
              )}
              {!detailLoading && detailManifest && (
                <>
                  {/* Summary */}
                  <div style={{ marginBottom: 16 }}>
                    <div className="backup-detail-row">
                      <span className="backup-detail-label">{t('views.backup.detailId')}</span>
                      <span className="backup-detail-value" style={{ fontSize: 12, fontFamily: 'monospace' }}>{detailManifest.backup_id}</span>
                    </div>
                    <div className="backup-detail-row">
                      <span className="backup-detail-label">{t('views.backup.detailTime')}</span>
                      <span className="backup-detail-value">{formatTime(detailManifest.created_at, i18n.language)}</span>
                    </div>
                    <div className="backup-detail-row">
                      <span className="backup-detail-label">{t('views.backup.detailVersion')}</span>
                      <span className="backup-detail-value">{detailManifest.version}</span>
                    </div>
                    <div className="backup-detail-row">
                      <span className="backup-detail-label">{t('views.backup.detailType')}</span>
                      <span className="backup-detail-value">{t('views.backup.typeFull')}</span>
                    </div>
                    <div className="backup-detail-row">
                      <span className="backup-detail-label">{t('views.backup.detailHasMetadata')}</span>
                      <span className="backup-detail-value">{detailManifest.has_metadata ? t('views.backup.yes') : t('views.backup.no')}</span>
                    </div>
                    <div className="backup-detail-row">
                      <span className="backup-detail-label">{t('views.backup.detailHasConfig')}</span>
                      <span className="backup-detail-value">{detailManifest.has_config ? t('views.backup.yes') : t('views.backup.no')}</span>
                    </div>
                    <div className="backup-detail-row">
                      <span className="backup-detail-label">{t('views.backup.detailTotalFiles')}</span>
                      <span className="backup-detail-value">{detailManifest.total_files.toLocaleString()}</span>
                    </div>
                    <div className="backup-detail-row">
                      <span className="backup-detail-label">{t('views.backup.detailTotalSize')}</span>
                      <span className="backup-detail-value">{formatBytes(detailManifest.total_size_bytes, t)}</span>
                    </div>
                  </div>

                  {/* Databases */}
                  {detailManifest.databases && detailManifest.databases.length > 0 && (
                    <div>
                      <div className="section-header-text" style={{ marginBottom: 8 }}>
                        <h2 style={{ fontSize: 14 }}>{t('views.backup.detailDatabases')} ({detailManifest.databases.length})</h2>
                      </div>
                      <div className="backup-db-tree">
                        {detailManifest.databases.map(db => (
                          <div key={db.name} className={`backup-db-item ${expandedDbs[db.name] ? 'expanded' : ''}`}>
                            <div className="backup-db-header" onClick={() => toggleDbExpand(db.name)}>
                              <span className="backup-db-name">
                                {db.name}
                              </span>
                              <span className="backup-db-meta">
                                <span className="backup-db-stats">
                                  {db.measurements?.length ?? 0} {t('views.backup.detailMeasurements')} · {db.file_count.toLocaleString()} files · {formatBytes(db.size_bytes, t)}
                                </span>
                                <ChevronRight size={14} className={`chevron-icon ${expandedDbs[db.name] ? 'open' : ''}`} />
                              </span>
                            </div>
                            {expandedDbs[db.name] && (
                              <div className="backup-db-measurements">
                                {db.measurements && db.measurements.length > 0 ? (
                                  db.measurements.map(m => (
                                    <div key={m.name} className="backup-measurement-row">
                                      <span className="backup-measurement-name">{m.name}</span>
                                      <span className="backup-measurement-stats">
                                        {m.file_count.toLocaleString()} files · {formatBytes(m.size_bytes, t)}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="backup-measurement-empty">{t('views.backup.noMeasurements')}</div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outlined" onClick={() => setShowDetailModal(false)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteTarget && (
        <ConfirmModal
          title={t('views.backup.deleteConfirmTitle')}
          description={t('views.backup.deleteConfirm', { id: deleteTarget.backup_id })}
          confirmLabel={t('views.backup.actionDelete')}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          danger
        />
      )}
    </div>
  );
};

export default BackupManagement;
