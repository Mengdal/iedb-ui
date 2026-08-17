import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert, Settings2, Trash2, ArrowDownToLine, Loader2, CheckCircle2, XCircle, X, Table2, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { formatTime } from '../utils/formatTime';
import ConfirmModal from '../components/ConfirmModal';
import './PageLayout.css';
import './Tokens.css';
import './RetentionPolicy.css';
import './TieredStorage.css';

/* ---------- 后端响应类型 ---------- */

interface TierStats {
  tier: 'hot' | 'cold';
  enabled: boolean;
  backend: string;
  file_count: number;
  total_size_mb: number;
}

interface SchedulerStatus {
  running: boolean;
  schedule: string;
  next_run?: string;
  last_run?: string;
}

interface TieringStatus {
  enabled: boolean;
  license_valid: boolean;
  reason?: string;
  tiers?: Record<string, TierStats>;
  scheduler?: SchedulerStatus;
}

interface EffectivePolicy {
  database: string;
  hot_only: boolean;
  hot_max_age_days: number | null;
  source: 'custom' | 'global';
}

interface FileMetadata {
  id: number;
  path: string;
  database: string;
  measurement: string;
  partition_time?: string;
  tier: 'hot' | 'cold';
  size_bytes: number;
  created_at?: string;
  migrated_at?: string;
}

interface MigrationRecord {
  id: number;
  file_path: string;
  database: string;
  from_tier: 'hot' | 'cold';
  to_tier: 'hot' | 'cold';
  size_bytes: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

interface ScanResult {
  files_scanned: number;
  files_registered: number;
  files_skipped: number;
  errors: number; // 扫描过程中的错误计数（后端为 int）
}

interface Props {
  database: string;
}

/** 字节数 → 可读大小 */
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const TieredStoragePanel: React.FC<Props> = ({ database }) => {
  const { t, i18n } = useTranslation();
  const { apiFetch, activeServer, featureNotEnabled } = useApiFetch({ handleLicense: false });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // 状态总览
  const [status, setStatus] = useState<TieringStatus | null>(null);
  // 当前库生效策略
  const [policy, setPolicy] = useState<EffectivePolicy | null>(null);
  // 迁移历史（来自 stats）
  const [recentMigrations, setRecentMigrations] = useState<MigrationRecord[]>([]);
  // 文件列表
  const [showFiles, setShowFiles] = useState(false);
  const [files, setFiles] = useState<FileMetadata[]>([]);
  // 按页签缓存数据（带 limit 版本）：切换页签直接展示缓存，limit 变化后自动失效
  const [filesCache, setFilesCache] = useState<Partial<Record<'all' | 'hot' | 'cold', { list: FileMetadata[]; limit: number }>>>({});
  const [fileTier, setFileTier] = useState<'all' | 'hot' | 'cold'>('all');
  // 始终指向最新页签，供异步回调判断当前展示页签
  const fileTierRef = useRef<'all' | 'hot' | 'cold'>('all');
  fileTierRef.current = fileTier;
  const [fileSearch, setFileSearch] = useState('');
  const [filePage, setFilePage] = useState(1);
  const [filePageSize, setFilePageSize] = useState(10);
  // 文件列表拉取数量上限（后端 limit 参数，下拉选择）
  const [fileLimit, setFileLimit] = useState(100);

  // 策略编辑弹窗
  const [policyFormOpen, setPolicyFormOpen] = useState(false);
  const [policyHotOnly, setPolicyHotOnly] = useState(false);
  const [policyMaxAgeDays, setPolicyMaxAgeDays] = useState('');
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  // 手动操作：执行迁移 = 先扫描 → 预览确认 → 再执行（参考保留策略执行流程）
  const [migrateScanning, setMigrateScanning] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<ScanResult | null>(null);
  const [migrating, setMigrating] = useState(false);
  // 迁移结果通知（右下角 toast，自动消失）
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = (type: 'success' | 'error', text: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ type, text });
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
  };

  const fetchIdRef = useRef(0);

  // 加载状态 / 策略 / 迁移历史（单 effect 单计数器，避免共享 fetchId 导致竞态丢失结果）
  useEffect(() => {
    if (!activeServer) return;
    const id = ++fetchIdRef.current;
    const ctrl = new AbortController();
    const run = async () => {
      setLoading(true);
      setErrorMsg('');
      try {
        const [statusData, policyData, statsData] = await Promise.all([
          apiFetch('/api/v1/tiering/status', { signal: ctrl.signal }),
          apiFetch(`/api/v1/tiering/policies/${encodeURIComponent(database)}/effective`, { signal: ctrl.signal }),
          apiFetch('/api/v1/tiering/stats', { signal: ctrl.signal }),
        ]);
        if (id !== fetchIdRef.current) return;
        setStatus(statusData as TieringStatus | null);
        setPolicy(policyData as EffectivePolicy | null);
        const stats = statsData as { recent_migrations?: MigrationRecord[] } | null;
        setRecentMigrations(Array.isArray(stats?.recent_migrations) ? stats.recent_migrations : []);
      } catch (err: any) {
        if (id !== fetchIdRef.current) return;
        if (err.name !== 'AbortError') setErrorMsg(err.message || t('views.tieredStorage.failedToLoad'));
      } finally {
        if (id === fetchIdRef.current) setLoading(false);
      }
    };
    run();
    return () => { ctrl.abort(); };
  }, [activeServer, database, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 文件列表懒加载：仅点击「数据文件」按钮打开弹窗时才请求，不随页面主数据一起加载
  const filesFetchIdRef = useRef(0);
  const [filesLoading, setFilesLoading] = useState(false);

  const fetchFiles = async (tier?: 'all' | 'hot' | 'cold', limit?: number) => {
    if (!activeServer) return;
    const targetTier = tier ?? fileTier;     // 显式传入避免 setState 异步导致闭包读到旧页签值
    const targetLimit = limit ?? fileLimit;  // 同上：limit 也显式传入，避免请求带旧值
    const id = ++filesFetchIdRef.current;
    setFilesLoading(true);
    try {
      // 单次查询：全部页签不带 tier；热层/冷层页签带 tier（避免 limit 截断时被其他层挤掉）
      const tierParam = targetTier !== 'all' ? `&tier=${targetTier}` : '';
      const data = await apiFetch(
        `/api/v1/tiering/files?database=${encodeURIComponent(database)}${tierParam}&limit=${targetLimit}`
      ) as { files?: FileMetadata[] } | null;
      if (id !== filesFetchIdRef.current) return;
      const list = Array.isArray(data?.files) ? data.files : [];
      setFilesCache(prev => ({ ...prev, [targetTier]: { list, limit: targetLimit } }));
      // 仅当仍是当前展示页签时才更新显示区
      if (targetTier === (tier ?? fileTierRef.current)) {
        setFiles(list);
      }
    } catch (err: any) {
      if (id !== filesFetchIdRef.current) return;
      if (err.name !== 'AbortError') setErrorMsg(err.message || t('views.tieredStorage.failedToLoad'));
    } finally {
      if (id === filesFetchIdRef.current) setFilesLoading(false);
    }
  };

  // 页签切换：缓存与本页签 limit 一致时直接展示（无空白闪烁），否则加载后拉取
  const handleFileTierChange = (tier: 'all' | 'hot' | 'cold') => {
    setFileTier(tier);
    setFilePage(1);
    const cached = filesCache[tier];
    const cacheValid = cached && cached.limit === fileLimit;
    setFiles(cacheValid ? cached.list : []);
    setFilesLoading(!cacheValid); // 有有效缓存时静默刷新
    fetchFiles(tier);
  };

  // 打开弹窗时后台预取其余页签（独立计数器，不影响 fetchFiles 的竞态判断）
  const prefetchIdRef = useRef(0);
  const prefetchOthers = async (skip: 'all' | 'hot' | 'cold') => {
    const tiers: ('all' | 'hot' | 'cold')[] = ['all', 'hot', 'cold'];
    for (const t of tiers) {
      if (t === skip) continue; // 当前页签由 fetchFiles 负责
      const cached = filesCache[t];
      if (cached && cached.limit === fileLimit) continue; // 已有有效缓存
      const id = ++prefetchIdRef.current;
      const tierParam = t !== 'all' ? `&tier=${t}` : '';
      try {
        const data = await apiFetch(
          `/api/v1/tiering/files?database=${encodeURIComponent(database)}${tierParam}&limit=${fileLimit}`
        ) as { files?: FileMetadata[] } | null;
        if (id !== prefetchIdRef.current) continue; // 过期响应丢弃
        const list = Array.isArray(data?.files) ? data.files : [];
        setFilesCache(prev => ({ ...prev, [t]: { list, limit: fileLimit } }));
      } catch { /* 预取失败忽略，切换时会再拉 */ }
    }
  };

  const handleOpenFiles = () => {
    const cached = filesCache[fileTier];
    const cacheValid = cached && cached.limit === fileLimit;
    setFilesLoading(!cacheValid && files.length === 0);
    setShowFiles(true);
    fetchFiles();        // 当前页签（后台刷新）
    prefetchOthers(fileTier); // 其余页签后台预取，切换零等待
  };

  /* ---- 策略编辑 ---- */

  const openPolicyForm = () => {
    // 预填当前生效值；global 时 hot_max_age_days 可能为空（表示用全局默认）
    setPolicyHotOnly(policy?.hot_only ?? false);
    setPolicyMaxAgeDays(policy?.hot_max_age_days != null ? String(policy.hot_max_age_days) : '');
    setPolicyFormOpen(true);
  };

  const handleSavePolicy = async () => {
    if (savingPolicy) return;
    setSavingPolicy(true);
    try {
      const days = policyMaxAgeDays.trim();
      await apiFetch(`/api/v1/tiering/policies/${encodeURIComponent(database)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hot_only: policyHotOnly,
          hot_max_age_days: days ? Number(days) : null,
        }),
      });
      setPolicyFormOpen(false);
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.tieredStorage.failedToSavePolicy'));
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleResetPolicy = async () => {
    setResetConfirmOpen(false);
    try {
      await apiFetch(`/api/v1/tiering/policies/${encodeURIComponent(database)}`, { method: 'DELETE' });
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.tieredStorage.failedToResetPolicy'));
    }
  };

  /* ---- 手动迁移（两段式：先扫描 → 预览确认 → 再执行，参考保留策略执行流程） ---- */

  // 第一步：点击「执行迁移」→ 先调用扫描接口获取预览
  const handleStartMigrate = async () => {
    if (migrateScanning || migrating) return;
    setMigrateScanning(true);
    setErrorMsg('');
    try {
      const result = await apiFetch('/api/v1/tiering/scan', { method: 'POST' });
      setMigrationPreview(result as ScanResult);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.tieredStorage.scanFailed'));
    } finally {
      setMigrateScanning(false);
    }
  };

  // 第二步：用户在预览弹窗中确认后执行迁移
  const executeMigrate = async () => {
    setMigrationPreview(null);
    setMigrating(true);
    try {
      await apiFetch('/api/v1/tiering/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      showNotice('success', t('views.tieredStorage.migrateDone'));
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      showNotice('error', err.message || t('views.tieredStorage.migrateFailed'));
    } finally {
      setMigrating(false);
    }
  };

  /* ---- 文件列表派生数据 ---- */

  const filteredFiles = useMemo(() => {
    // 数据已按当前页签缓存（all 合并 / hot / cold 单独请求），无需再按 tier 过滤
    let list = files;
    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      list = list.filter(f =>
        f.measurement.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q)
      );
    }
    return list;
  }, [files, fileTier, fileSearch]);

  const fileTotalPages = Math.max(1, Math.ceil(filteredFiles.length / filePageSize));
  const safeFilePage = Math.min(filePage, fileTotalPages);
  const currentFiles = filteredFiles.slice((safeFilePage - 1) * filePageSize, safeFilePage * filePageSize);

  const tierStats = (tier: 'hot' | 'cold'): TierStats | undefined => status?.tiers?.[tier];
  const hot = tierStats('hot');
  const cold = tierStats('cold');

  return (
    <div className="ts-root">
      {/* 全局状态总览 Bar（固定） */}
      {activeServer && !featureNotEnabled && status && (
            <div className="ts-status-bar">
              <div className="ts-status-info">
                <span className="rp-scheduler-icon"><Clock size={16} /></span>
                <span className="ts-status-label">{t('views.tieredStorage.title')}</span>

                {status?.scheduler && (
                  <>
                    <span className="ts-status-sep" />
                    {status.scheduler.running && (
                      <span className="ts-status-badge on">{t('views.tieredStorage.schedulerRunning')}</span>
                    )}
                    {status.scheduler.schedule && (
                      <span className="ts-status-detail">
                        {t('views.tieredStorage.schedulerSchedule')}: {status.scheduler.schedule}
                      </span>
                    )}
                    {status.scheduler.next_run && (
                      <span className="ts-status-detail">
                        {t('views.tieredStorage.schedulerNextRun')}: {formatTime(status.scheduler.next_run, i18n.language)}
                      </span>
                    )}
                    {status.scheduler.last_run && (
                      <span className="ts-status-detail">
                        {t('views.tieredStorage.schedulerLastRun')}: {formatTime(status.scheduler.last_run, i18n.language)}
                      </span>
                    )}
                  </>
                )}

                <span className="ts-status-sep" />
                <span className="ts-status-item hot">
                  {t('views.tieredStorage.tierHot')}{hot?.backend && <span className="ts-status-backend">({hot.backend})</span>}：
                  {hot?.file_count ?? '—'} · {hot ? `${hot.total_size_mb}MB` : '—'}
                </span>
                <span className="ts-status-item cold">
                  {t('views.tieredStorage.tierCold')}{cold?.backend && <span className="ts-status-backend">({cold.backend})</span>}：
                  {cold?.file_count ?? '—'} · {cold ? `${cold.total_size_mb}MB` : '—'}
                </span>
              </div>
              <div className="ts-status-actions">
                <button type="button" className="btn btn-outlined btn-small" onClick={openPolicyForm} disabled={!status?.enabled}>
                  <Settings2 size={14} />
                  {policy?.source === 'custom' ? t('views.tieredStorage.editPolicy') : t('views.tieredStorage.customizePolicy')}
                </button>
                <button type="button" className="btn btn-outlined btn-small" onClick={handleStartMigrate} disabled={migrateScanning || migrating || !status?.enabled}>
                  {migrateScanning ? <Loader2 className="spin" size={14} /> : <ArrowDownToLine size={14} />}
                  {migrateScanning ? t('views.tieredStorage.migrateScanning') : t('views.tieredStorage.migrate')}
                </button>
              </div>
            </div>
      )}
      <div className="page-section ts-flex-col" style={{ margin: 0 }}>
        {/* 固定标题行（迁移历史 / 数据文件 / 刷新） */}
        <div className="ts-sticky-header">
        <div className="section-header">
          <div className="section-header-text">
            <h2>{t('views.tieredStorage.historyTitle')}</h2>
          </div>
          <div className="page-toolbar">
            <button type="button" className={`btn btn-outlined ${showFiles ? 'btn-active' : ''}`} onClick={handleOpenFiles}>
              <Table2 size={16} />
              {t('views.tieredStorage.filesButton')}
            </button>
            <button type="button" className="btn btn-outlined" onClick={() => setRefreshKey(k => k + 1)} disabled={!activeServer || loading}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              {t('common.refresh')}
            </button>
          </div>
        </div>
        </div>

        {activeServer && featureNotEnabled && (
          <div className="audit-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.tieredStorage.featureNotEnabled')}</p>
          </div>
        )}

        {activeServer && !featureNotEnabled && errorMsg && (
          <div className="tokens-alert">{errorMsg}</div>
        )}

        {activeServer && !featureNotEnabled && loading && !status && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.tieredStorage.loading')}
          </div>
        )}

        {activeServer && !featureNotEnabled && !loading && (
          <>

            {/* 迁移历史（唯一滚动区域） */}
            <div className="ts-section ts-scroll-body">
              {recentMigrations.length > 0 ? (
                <div className="tokens-table-wrap">
                  <table className="tokens-table">
                    <colgroup>
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '34%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '16%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{t('views.tieredStorage.colTime')}</th>
                        <th style={{ whiteSpace: 'nowrap', textAlign: 'center', width: '34%' }}>{t('views.tieredStorage.colFile')}</th>
                        <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{t('views.tieredStorage.colDirection')}</th>
                        <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{t('views.tieredStorage.colSize')}</th>
                        <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{t('views.tieredStorage.colStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentMigrations.map(m => (
                        <tr key={m.id}>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{formatTime(m.started_at, i18n.language)}</td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }} className="ts-file-path" title={m.file_path}>{m.file_path}</td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                            <span className="ts-tier-badge">{m.from_tier}</span>
                            <span className="ts-direction-arrow">→</span>
                            <span className="ts-tier-badge">{m.to_tier}</span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{formatBytes(m.size_bytes)}</td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                            {m.error ? (
                              <span className="ts-migration-failed" title={m.error}>
                                <XCircle size={12} /> {t('views.tieredStorage.migrationFailed')}
                              </span>
                            ) : (
                              <span className="ts-migration-ok">
                                <CheckCircle2 size={12} /> {t('views.tieredStorage.migrationSuccess')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="tokens-empty">{t('views.tieredStorage.noMigrations')}</div>
              )}
            </div>


          </>
        )}
      </div>

      {/* 自定义策略弹窗 */}
      {policyFormOpen && (
        <div className="modal-overlay" role="dialog" aria-modal onWheel={(e) => e.stopPropagation()} onClick={() => setPolicyFormOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {policy?.source === 'custom'
                  ? t('views.tieredStorage.editPolicy')
                  : t('views.tieredStorage.customizePolicy')}
              </h3>
              <button className="icon-btn" onClick={() => setPolicyFormOpen(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              {policy && (
                <div className="rp-result-grid" style={{ marginBottom: 16 }}>
                  <div className="rp-result-item">
                    <span className="rp-result-label">{t('views.tieredStorage.policySource')}</span>
                    <span className="rp-result-value">
                      {policy.source === 'custom' ? t('views.tieredStorage.sourceCustom') : t('views.tieredStorage.sourceGlobal')}
                    </span>
                  </div>
                  <div className="rp-result-item">
                    <span className="rp-result-label">{t('views.tieredStorage.policyHotOnly')}</span>
                    <span className="rp-result-value">{policy.hot_only ? t('views.tieredStorage.yes') : t('views.tieredStorage.no')}</span>
                  </div>
                  <div className="rp-result-item">
                    <span className="rp-result-label">{t('views.tieredStorage.policyMaxAgeDays')}</span>
                    <span className="rp-result-value">
                      {policy.hot_max_age_days != null
                        ? `${policy.hot_max_age_days} ${t('views.tieredStorage.days')}`
                        : t('views.tieredStorage.globalDefault')}
                    </span>
                  </div>
                </div>
              )}
              <div className="ts-policy-form-hint">{t('views.tieredStorage.policyFormHint', { database })}</div>
              <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={policyHotOnly}
                  onChange={e => setPolicyHotOnly(e.target.checked)}
                />
                <label style={{ margin: 0 }}>{t('views.tieredStorage.policyHotOnly')}</label>
              </div>
              <div className="form-group">
                <label>{t('views.tieredStorage.fieldMaxAgeDays')}</label>
                <input
                  type="number"
                  min="0"
                  placeholder={t('views.tieredStorage.fieldMaxAgePlaceholder')}
                  value={policyMaxAgeDays}
                  onChange={e => setPolicyMaxAgeDays(e.target.value)}
                />
                <span className="ts-policy-form-hint">{t('views.tieredStorage.fieldMaxAgeHint')}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outlined" onClick={() => { setPolicyFormOpen(false); setResetConfirmOpen(true); }} disabled={policy?.source !== 'custom'}>
                <Trash2 size={14} />
                {t('views.tieredStorage.resetDefault')}
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-outlined" onClick={() => setPolicyFormOpen(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleSavePolicy} disabled={savingPolicy}>
                {savingPolicy ? <Loader2 className="spin" size={14} /> : null}
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 恢复默认确认 */}
      {resetConfirmOpen && (
        <ConfirmModal
          title={t('views.tieredStorage.resetConfirmTitle')}
          description={t('views.tieredStorage.resetConfirmDesc', { database })}
          confirmLabel={t('views.tieredStorage.resetDefault')}
          danger
          onCancel={() => setResetConfirmOpen(false)}
          onConfirm={handleResetPolicy}
        />
      )}

      {/* 迁移确认弹窗：先扫描 → 展示结果预览 → 二次确认（参考保留策略执行流程） */}
      {migrationPreview && (
        <div className="modal-overlay" role="dialog" aria-modal onWheel={(e) => e.stopPropagation()} onClick={() => setMigrationPreview(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.tieredStorage.migrateConfirmTitle')}</h3>
              <button className="icon-btn" onClick={() => setMigrationPreview(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="rp-result-grid">
                <div className="rp-result-item">
                  <span className="rp-result-label">{t('views.tieredStorage.previewScanned')}</span>
                  <span className="rp-result-value">{migrationPreview.files_scanned}</span>
                </div>
                <div className="rp-result-item">
                  <span className="rp-result-label">{t('views.tieredStorage.previewRegistered')}</span>
                  <span className="rp-result-value">{migrationPreview.files_registered}</span>
                </div>
                <div className="rp-result-item">
                  <span className="rp-result-label">{t('views.tieredStorage.previewSkipped')}</span>
                  <span className="rp-result-value">{migrationPreview.files_skipped}</span>
                </div>
                <div className="rp-result-item">
                  <span className="rp-result-label">{t('views.tieredStorage.previewErrors')}</span>
                  <span className="rp-result-value">{migrationPreview.errors ?? 0}</span>
                </div>
              </div>
              {(migrationPreview.errors ?? 0) > 0 && (
                <div className="ts-scan-errors">{t('views.tieredStorage.scanErrorsHint', { count: migrationPreview.errors })}</div>
              )}
              <div className="ts-policy-form-hint" style={{ marginTop: 12 }}>
                {t('views.tieredStorage.migrateParamTitle')}
                <br />
                {t('views.tieredStorage.migrateParamRange')}
                <br />
                {t('views.tieredStorage.migrateParamCondition')}
                <br />
                {t('views.tieredStorage.migrateParamTarget')}
              </div>
              <div className="rp-dry-run-hint">{t('views.tieredStorage.migrateConfirmDesc')}</div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outlined" onClick={() => setMigrationPreview(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={executeMigrate}>
                <ArrowDownToLine size={14} />
                {t('views.tieredStorage.confirmExecute')}
              </button>
            </div>
          </div>
        </div>
      )}

            {/* 数据文件弹窗 */}
            {showFiles && (
              <div className="modal-overlay" role="dialog" aria-modal onWheel={(e) => e.stopPropagation()} onClick={() => setShowFiles(false)}>
                <div className="modal-content modal-wide ts-files-modal" onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>{t('views.tieredStorage.filesTitle')}</h3>
                    <button className="icon-btn" onClick={() => setShowFiles(false)}><X size={20} /></button>
                  </div>
                  <div className="modal-body ts-files-modal-body">
                    <div className="ts-files-toolbar">
                      <div className="ts-tabs">
                        {(['all', 'hot', 'cold'] as const).map(tier => (
                          <button
                            key={tier}
                            type="button"
                            className={`ts-tab ${fileTier === tier ? 'active' : ''}`}
                            onClick={() => handleFileTierChange(tier)}
                          >
                            {t(`views.tieredStorage.tierFilter_${tier}`)}
                          </button>
                        ))}
                      </div>
                      <input
                        className="page-search"
                        type="search"
                        placeholder={t('views.tieredStorage.searchFiles')}
                        value={fileSearch}
                        onChange={e => { setFileSearch(e.target.value); setFilePage(1); }}
                      />
                    </div>
                    {filesLoading && files.length === 0 ? (
                      <div className="loading-inline ts-files-loading">
                        <Loader2 className="spin" size={18} />
                        {t('views.tieredStorage.loading')}
                      </div>
                    ) : filteredFiles.length > 0 ? (
                      <>
                        <div className="tokens-table-wrap">
                          <table className="tokens-table ts-center-table">
                            <colgroup>
                              <col style={{ width: '16%' }} />
                              <col style={{ width: '34%' }} />
                              <col style={{ width: '10%' }} />
                              <col style={{ width: '20%' }} />
                              <col style={{ width: '12%' }} />
                            </colgroup>
                            <thead>
                              <tr>
                                <th>{t('views.tieredStorage.colMeasurement')}</th>
                                <th>{t('views.tieredStorage.colFile')}</th>
                                <th>{t('views.tieredStorage.colTier')}</th>
                                <th>{t('views.tieredStorage.colPartition')}</th>
                                <th>{t('views.tieredStorage.colSize')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentFiles.map(f => (
                                <tr key={f.id}>
                                  <td>{f.measurement}</td>
                                  <td className="ts-file-path" title={f.path}>{f.path}</td>
                                  <td><span className="ts-tier-badge">{f.tier}</span></td>
                                  <td>{formatTime(f.partition_time, i18n.language)}</td>
                                  <td>{formatBytes(f.size_bytes)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="rp-pagination-row">
                          <div className="ts-file-limit">
                            <span className="ts-file-limit-label">{t('views.tieredStorage.fileLimitLabel')}</span>
<select
                            value={fileLimit}
                            onChange={e => { const v = Number(e.target.value); setFileLimit(v); setFilePage(1); fetchFiles(undefined, v); }}
                            className="ts-file-limit-select"
                          >
                              <option value={100}>100</option>
                              <option value={200}>200</option>
                              <option value={500}>500</option>
                              <option value={1000}>1000</option>
                              <option value={5000}>5000</option>
                            </select>
                          </div>
                          <select
                            value={filePageSize}
                            onChange={e => { setFilePageSize(Number(e.target.value)); setFilePage(1); }}
                            className="rp-page-size-select"
                          >
                            <option value={10}>10</option>
                            <option value={32}>32</option>
                            <option value={64}>64</option>
                          </select>
                          <span>
                            {t('views.tieredStorage.rowsRangeOf', {
                              from: (safeFilePage - 1) * filePageSize + 1,
                              to: Math.min(safeFilePage * filePageSize, filteredFiles.length),
                              total: filteredFiles.length,
                            })}
                          </span>
                          <button
                            type="button"
                            className="icon-btn-small"
                            disabled={safeFilePage === 1}
                            onClick={() => setFilePage(p => Math.max(1, p - 1))}
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            className="icon-btn-small"
                            disabled={safeFilePage === fileTotalPages}
                            onClick={() => setFilePage(p => Math.min(fileTotalPages, p + 1))}
                          >
                            ›
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="tokens-empty">{t('views.tieredStorage.noFiles')}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

      {/* 迁移结果通知 Toast（成功绿 / 失败红，5s 自动消失） */}
      {notice && (
        <div className={`ts-toast ts-toast-${notice.type}`}>
          {notice.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* 迁移进行中覆盖层（后端同步阻塞，可能耗时数分钟） */}
      {migrating && (
        <div className="ts-migrating-overlay">
          <div className="ts-migrating-box">
            <Loader2 className="spin" size={28} />
            <div className="ts-migrating-title">{t('views.tieredStorage.migratingTitle')}</div>
            <div className="ts-migrating-desc">{t('views.tieredStorage.migratingDesc')}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TieredStoragePanel;