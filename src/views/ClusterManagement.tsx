import React, { useEffect, useState } from 'react';
import { RefreshCw, Loader2, ShieldAlert, X, Trash2, AlertTriangle, CheckCircle2, XCircle, ChevronRight, FileText } from 'lucide-react';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { formatTime } from '../utils/formatTime';
import ConfirmModal from '../components/ConfirmModal';
import './Tokens.css';
import './QueryManagement.css';   // qm-tabs
import './ClusterManagement.css';

/* ── Types ─────────────────────────────────────────────── */

interface NodeStats {
  cpu_usage: number;
  memory_usage: number;
  ingest_rate: number;
  query_rate: number;
  storage_used: number;
  connections: number;
  active_queries: number;
  compaction_jobs: number;
}

interface ClusterNode {
  id: string;
  name: string;
  role: string;
  state: string;
  address: string;
  api_address: string;
  cluster_name: string;
  version: string;
  started_at: string;
  joined_at: string;
  last_heartbeat: string;
  failed_checks: number;
  stats: NodeStats;
}

interface LocalNode extends ClusterNode {
  capabilities?: { can_ingest: boolean; can_query: boolean; can_compact: boolean; can_coordinate: boolean };
}

interface RaftStatus {
  enabled: boolean;     // 后端契约字段
  is_leader?: boolean;
  leader_addr?: string;
  leader_id?: string;
  state?: string;
  stats?: Record<string, string>;  // 后端契约字段（hashicorp/raft Stats()）
}

interface RouterStatus {
  strategy: string;
  timeout_ms: number;
  retries: number;
  reader_index: number; // 后端契约字段
  writer_index: number; // 后端契约字段
  active_connections: Record<string, number>;
}

interface ClusterStatus {
  running: boolean;    // 后端契约字段
  cluster_name: string;
  local_node_id: string;
  local_role: string;
  node_count: number;
  healthy_count: number;
  writers: number;
  readers: number;
  compactors: number;
  nodes: ClusterNode[];
  raft: RaftStatus;
  router?: RouterStatus;
  enabled: boolean;
  mode: string;        // 后端契约字段："cluster" | "standalone"
  total_cores?: number;
  max_cores?: number;
  cores_remaining?: number;
  license?: { valid: boolean; tier: string; features: string[] };
}

interface FileEntry {
  path: string;
  sha256: string;  size_bytes: number;
  database: string;
  measurement: string;
  partition_time: string;
  origin_node_id: string;
  tier: string;
  created_at: string;
  lsn: number;
}

interface FilesResponse {
  files: FileEntry[];
  total: number;
  next_cursor?: string;
}

interface ClusterHealth {
  healthy: number;
  unhealthy: number;
  total: number;
  health_checker: { running: boolean; check_interval_ms: number; check_timeout_ms: number; unhealthy_threshold: number };
}

/* ── Helpers ───────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

type TabKey = 'overview' | 'nodes' | 'files';

const STATE_BADGE: Record<string, string> = {
  healthy: 'healthy',
  unhealthy: 'unhealthy',
  dead: 'dead',
  unknown: 'unknown',
  joining: 'joining',
  leaving: 'leaving',
};

const ROLE_BADGE: Record<string, string> = {
  writer: 'writer',
  reader: 'reader',
  compactor: 'compactor',
  standalone: 'standalone',
};

// 角色分组展示顺序（与 ROLE_BADGE 的 key 一致）
const ROLE_ORDER = ['writer', 'reader', 'compactor', 'standalone'];

const FILES_PAGE_SIZE = 100;

/* ── Component ─────────────────────────────────────────── */

const ClusterManagement: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { activeServer } = useServers();
  const { apiJson, noLicense } = useApiFetch({ handleLicense: true, handleFeature: false });

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [raftExpanded, setRaftExpanded] = useState(false);
  const [routerExpanded, setRouterExpanded] = useState(false);
  const [licenseExpanded, setLicenseExpanded] = useState(false);
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(true);   // 集群信息默认展开，可收起

  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [localNode, setLocalNode] = useState<LocalNode | null>(null);
  const [health, setHealth] = useState<ClusterHealth | null>(null);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [clusterError, setClusterError] = useState('');

  const [detailNode, setDetailNode] = useState<LocalNode | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ClusterNode | null>(null);

  const showError = (msg: string) => {
    setErrorMsg(msg);
    window.setTimeout(() => setErrorMsg(''), 3000);
  };

  /* ── API calls ───────────────────────────────────────── */

  const fetchCluster = async () => {
    if (!activeServer) return;
    try {
      const data = await apiJson('/api/v1/cluster');
      if (data) {
        setCluster(data as ClusterStatus);
        setClusterError('');
      }
    } catch (err: any) {
      if (!noLicense) {
        const msg = err.message || t('views.cluster.failedToLoad');
        showError(msg);
        setClusterError(msg);
      }
    }
  };

  const fetchNodes = async () => {
    if (!activeServer) return;
    setIsLoading(true);
    try {
      const data = await apiJson('/api/v1/cluster/nodes');
      if (data?.nodes) setNodes(Array.isArray(data.nodes) ? data.nodes : []);
    } catch (err: any) {
      if (!noLicense) showError(err.message || t('views.cluster.failedToLoadNodes'));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLocal = async () => {
    if (!activeServer) return;
    try {
      const data = await apiJson('/api/v1/cluster/local');
      if (data) setLocalNode(data as LocalNode);
    } catch {
      // best-effort
    }
  };

  const fetchHealth = async () => {
    if (!activeServer) return;
    try {
      const data = await apiJson('/api/v1/cluster/health');
      if (data) setHealth(data as ClusterHealth);
    } catch {
      // best-effort
    }
  };

  const fetchFiles = async (cursor?: string) => {
    if (!activeServer) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(FILES_PAGE_SIZE));
      if (cursor) params.set('cursor', cursor);
      const data = await apiJson(`/api/v1/cluster/files?${params.toString()}`);
      if (data) {
        const res = data as FilesResponse;
        setFiles(Array.isArray(res.files) ? res.files : []);
        setFilesTotal(res.total || 0);
        setNextCursor(res.next_cursor || null);
      }
    } catch (err: any) {
      if (!noLicense) showError(err.message || t('views.cluster.failedToLoadFiles'));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNodeDetail = async (id: string) => {
    if (!activeServer) return;
    try {
      const data = await apiJson(`/api/v1/cluster/nodes/${encodeURIComponent(id)}`);
      if (data) setDetailNode(data as LocalNode);
    } catch (err: any) {
      showError(err.message || t('views.cluster.failedToLoad'));
    }
  };

  const handleRemoveNode = async () => {
    if (!removeTarget || !cluster) return;
    if (removeTarget.id === cluster.local_node_id) {
      showError(t('views.cluster.cannotRemoveSelf'));
      setRemoveTarget(null);
      return;
    }
    try {
      await apiJson(`/api/v1/cluster/nodes/${encodeURIComponent(removeTarget.id)}`, { method: 'DELETE' });
      setRemoveTarget(null);
      fetchNodes();
      fetchCluster();
    } catch (err: any) {
      showError(err.message || t('views.cluster.failedToRemoveNode'));
    }
  };

  /* ── Tab navigation ──────────────────────────────────── */

  useEffect(() => {
    if (activeTab === 'nodes' && nodes.length === 0) fetchNodes();
    if (activeTab === 'files' && files.length === 0 && !nextCursor) fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeServer]);

  /* ── Lifecycle ───────────────────────────────────────── */

  useEffect(() => {
    setActiveTab('overview');
    setCluster(null);
    setNodes([]);
    setFiles([]);
    setCursorStack([]);
    setNextCursor(null);
    setErrorMsg('');
    if (!activeServer) return;
    fetchCluster();
    fetchLocal();
    fetchHealth();
  }, [activeServer]);

  /* ── Render helpers ──────────────────────────────────── */

  const isEnabled = cluster?.enabled === true;

  const pagePrev = () => {
    if (cursorStack.length === 0) return;
    const rest = cursorStack.slice(0, -1);
    setCursorStack(rest);
    // 栈存的是"进入当前页的游标"；回退后应请求新栈顶（上一页游标，首页为 undefined）
    const prev = rest[rest.length - 1];
    fetchFiles(prev);
  };

  const pageNext = () => {
    if (!nextCursor) return;
    setCursorStack([...cursorStack, nextCursor]);
    fetchFiles(nextCursor);
  };

  const statCard = (value: React.ReactNode, label: string) => (
    <div className="cluster-stat-card">
      <div className="cluster-stat-value">{value}</div>
      <div className="cluster-stat-label">{label}</div>
    </div>
  );

  const renderOverview = () => {
    if (!cluster) return null;
    const raft = cluster.raft;
    const router = cluster.router;
    const st = raft?.stats;

    const kvRow = (label: string, value: React.ReactNode) => (
      <div className="cluster-kv-row">
        <span className="cluster-kv-label">{label}</span>
        <span className="cluster-kv-value">{value === undefined || value === null || value === '' ? '-' : value}</span>
      </div>
    );

    const fmtLastContact = (v?: string) => {
      if (!v || v === '0') return '0';
      const n = Number(v);
      return n > 0 ? `${(n / 1e6).toFixed(1)}s` : v;
    };

    return (
      <>
        {/* Stat cards */}
        <div className="cluster-stat-grid">
          {statCard(cluster.node_count, t('views.cluster.statNodes'))}
          {statCard(cluster.healthy_count, t('views.cluster.statHealthy'))}
          {statCard(cluster.writers, t('views.cluster.statWriters'))}
          {statCard(cluster.readers, t('views.cluster.statReaders'))}
          {statCard(cluster.compactors, t('views.cluster.statCompactors'))}
          {statCard(
            cluster.max_cores
              ? `${(cluster.total_cores ?? 0) - (cluster.cores_remaining ?? 0)} / ${cluster.max_cores}`
              : (cluster.total_cores ?? 0),
            t('views.cluster.statCores')
          )}
        </div>

        {/* Cluster meta block */}
        <div className="cluster-block-card">
          <div className="cluster-block-header">
            <span className="cluster-block-title">{t('views.cluster.metaTitle')}</span>
            <button
              type="button"
              className="cluster-toggle-btn"
              onClick={() => setMetaExpanded(v => !v)}
              title={metaExpanded ? t('views.cluster.collapseDetails') : t('views.cluster.expandDetails')}
            >
              <ChevronRight size={14} className={`cluster-chevron ${metaExpanded ? 'open' : ''}`} />
            </button>
          </div>
          {metaExpanded && (
            <div className="cluster-kv-grid">
              {kvRow(t('views.cluster.metaClusterName'), cluster.cluster_name)}
              {kvRow(t('views.cluster.metaMode'), cluster.mode)}
              {kvRow(
                t('views.cluster.metaRunning'),
                cluster.running ? t('views.cluster.metaRunningTrue') : t('views.cluster.metaRunningFalse')
              )}
              {kvRow(t('views.cluster.metaLocalNode'), cluster.local_node_id)}
              {kvRow(t('views.cluster.metaLocalRole'), cluster.local_role)}
              {kvRow(t('views.cluster.metaNodeCount'), cluster.node_count)}
              {kvRow(t('views.cluster.metaHealthyCount'), cluster.healthy_count)}
              {kvRow(t('views.cluster.metaCoresTotal'), cluster.total_cores ?? '-')}
              {kvRow(t('views.cluster.metaCoresLicensed'), cluster.max_cores ?? '-')}
              {kvRow(t('views.cluster.metaCoresRemaining'), cluster.cores_remaining ?? '-')}
              {localNode?.capabilities && (() => {
                const caps = localNode.capabilities;
                const capItems = [
                  { k: 'can_ingest', label: t('views.cluster.canIngest') },
                  { k: 'can_query', label: t('views.cluster.canQuery') },
                  { k: 'can_compact', label: t('views.cluster.canCompact') },
                  { k: 'can_coordinate', label: t('views.cluster.canCoordinate') },
                ].sort((a, b) => Number(caps[b.k as keyof typeof caps]) - Number(caps[a.k as keyof typeof caps]));
                return (
                  <div className="cluster-kv-row" style={{ gridColumn: 'span 2' }}>
                    <span className="cluster-kv-label">{t('views.cluster.capabilities')}</span>
                    <div className="cluster-cap-row">
                      {capItems.map(c => (
                        <span key={c.k} className={`cluster-cap-badge ${caps[c.k as keyof typeof caps] ? '' : 'off'}`}>
                          {caps[c.k as keyof typeof caps] ? (
                            <CheckCircle2 size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          ) : (
                            <XCircle size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          )}
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Health check block */}
        {health && (
          <div className="cluster-block-card">
            <div className="cluster-block-header">
              <span className="cluster-block-title">{t('views.cluster.healthTitle')}</span>
              <button
                type="button"
                className="cluster-toggle-btn"
                onClick={() => setHealthExpanded(v => !v)}
                title={healthExpanded ? t('views.cluster.collapseDetails') : t('views.cluster.expandDetails')}
              >
                <ChevronRight size={14} className={`cluster-chevron ${healthExpanded ? 'open' : ''}`} />
              </button>
            </div>
            {healthExpanded && (
              <div className="cluster-kv-grid">
                {kvRow(t('views.cluster.metaNodeCount'), health.total)}
                {kvRow(t('views.cluster.metaHealthyCount'), health.healthy)}
                {kvRow(t('views.cluster.healthUnhealthy'), health.unhealthy)}
                {kvRow(t('views.cluster.checkerRunning'), health.health_checker?.running ? t('views.cluster.metaRunningTrue') : t('views.cluster.metaRunningFalse'))}
                {kvRow(t('views.cluster.checkInterval'), health.health_checker ? `${health.health_checker.check_interval_ms}ms` : '-')}
                {kvRow(t('views.cluster.checkTimeout'), health.health_checker ? `${health.health_checker.check_timeout_ms}ms` : '-')}
                {kvRow(t('views.cluster.unhealthyThreshold'), health.health_checker?.unhealthy_threshold ?? '-')}
              </div>
            )}
          </div>
        )}

        {/* Raft block */}
        <div className="cluster-block-card">
          <div className="cluster-block-header">
            <span className="cluster-block-title">{t('views.cluster.raftTitle')}</span>
            <span className={`cluster-status-badge ${raft?.is_leader ? 'good' : 'warn'}`}>
              {raft?.is_leader ? t('views.cluster.raftState') + ': Leader' : (raft?.state || '-')}
            </span>
            <button
              type="button"
              className="cluster-toggle-btn"
              onClick={() => setRaftExpanded(v => !v)}
              title={raftExpanded ? t('views.cluster.collapseDetails') : t('views.cluster.expandDetails')}
            >
              <ChevronRight size={14} className={`cluster-chevron ${raftExpanded ? 'open' : ''}`} />
            </button>
          </div>
          {raftExpanded && (
            <div className="cluster-kv-grid">
              {kvRow(t('views.cluster.leaderId'), raft?.leader_id)}
              {kvRow(t('views.cluster.raftLeaderAddr'), raft?.leader_addr)}
              {kvRow(t('views.cluster.raftEnabled'), raft?.enabled ? t('views.cluster.yes') : t('views.cluster.no'))}
              {kvRow(t('views.cluster.raftTerm'), st?.term)}
              {kvRow(t('views.cluster.raftApplied'), st?.applied_index)}
              {kvRow(t('views.cluster.raftCommitted'), st?.commit_index)}
              {kvRow(t('views.cluster.raftPeers'), st?.num_peers)}
              {kvRow(t('views.cluster.raftProtocol'), st?.protocol_version)}
              {kvRow(t('views.cluster.raftProtocolMax'), st?.protocol_version_max)}
              {kvRow(t('views.cluster.raftProtocolMin'), st?.protocol_version_min)}
              {kvRow(t('views.cluster.raftPending'), st?.fsm_pending)}
              {kvRow(t('views.cluster.raftLastLogIndex'), st?.last_log_index)}
              {kvRow(t('views.cluster.raftLastLogTerm'), st?.last_log_term)}
              {kvRow(t('views.cluster.raftSnapshot'), st?.last_snapshot_index)}
              {kvRow(t('views.cluster.raftSnapshotTerm'), st?.last_snapshot_term)}
              {kvRow(t('views.cluster.raftSnapshotMax'), st?.snapshot_version_max)}
              {kvRow(t('views.cluster.raftSnapshotMin'), st?.snapshot_version_min)}
              {kvRow(t('views.cluster.raftConfigIndex'), st?.latest_configuration_index)}
              {kvRow(t('views.cluster.raftLastContact'), fmtLastContact(st?.last_contact))}
              {kvRow(t('views.cluster.raftConfig'), st?.latest_configuration)}
            </div>
          )}
        </div>

        {/* Router block */}
        {router && (
          <div className="cluster-block-card">
            <div className="cluster-block-header">
              <span className="cluster-block-title">{t('views.cluster.routerTitle')}</span>
              <button
                type="button"
                className="cluster-toggle-btn"
                onClick={() => setRouterExpanded(v => !v)}
                title={routerExpanded ? t('views.cluster.collapseDetails') : t('views.cluster.expandDetails')}
              >
                <ChevronRight size={14} className={`cluster-chevron ${routerExpanded ? 'open' : ''}`} />
              </button>
            </div>
            {routerExpanded && (
              <div className="cluster-kv-grid">
                {kvRow(t('views.cluster.routerStrategy'), router.strategy)}
                {kvRow(t('views.cluster.routerTimeout'), `${router.timeout_ms}ms`)}
                {kvRow(t('views.cluster.routerRetries'), router.retries)}
                {kvRow(t('views.cluster.routerConnections'), Object.keys(router.active_connections || {}).length)}
                {kvRow(t('views.cluster.routerWriterIdx'), router.writer_index)}
                {kvRow(t('views.cluster.routerReaderIdx'), router.reader_index)}
              </div>
            )}
          </div>
        )}

        {/* License block */}
        {cluster.license && (
          <div className="cluster-block-card">
            <div className="cluster-block-header">
              <span className="cluster-block-title">{t('views.cluster.licenseTitle')}</span>
              <span className="cluster-status-detail">{cluster.license.tier}</span>
              <span className={`cluster-status-badge ${cluster.license.valid ? 'good' : 'bad'}`}>
                {cluster.license.valid ? '✓' : '✗'}
              </span>
              {cluster.license.features && cluster.license.features.length > 0 && (
                <button
                  type="button"
                  className="cluster-toggle-btn"
                  onClick={() => setLicenseExpanded(v => !v)}
                  title={licenseExpanded ? t('views.cluster.collapseDetails') : t('views.cluster.licenseFeatures')}
                >
                  <ChevronRight size={14} className={`cluster-chevron ${licenseExpanded ? 'open' : ''}`} />
                </button>
              )}
            </div>
            {licenseExpanded && cluster.license.features && (
              <div className="cluster-license-features">
                {cluster.license.features.map(f => (
                  <span key={f} className="cluster-cap-badge">{f}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  const renderNodes = () => {
    const roleLabel = (role: string) =>
      t(`views.cluster.role${role.charAt(0).toUpperCase()}${role.slice(1)}` as any) || role;
    const grouped = ROLE_ORDER
      .map(role => ({ role, items: nodes.filter(n => n.role === role) }))
      .filter(g => g.items.length > 0);

    return (
      <>
        {isLoading && nodes.length === 0 && !errorMsg && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.cluster.loading')}
          </div>
        )}

        {!isLoading && !errorMsg && nodes.length === 0 && (
          <div className="tokens-empty">{t('views.cluster.noNodes')}</div>
        )}

        {grouped.map(g => (
          <div key={g.role} className="cluster-role-group">
            <div className="cluster-role-group-header">
              <span className={`cluster-role-badge ${ROLE_BADGE[g.role] || 'standalone'}`}>
                {roleLabel(g.role)}
              </span>
              <span className="cluster-role-group-count">
                {t('views.cluster.groupNodeCount', { count: g.items.length })}
              </span>
            </div>
            <div className="tokens-table-wrap">
              <table className="tokens-table cluster-table">
                <colgroup>
                  <col className="cluster-col-id" />
                  <col className="cluster-col-state" />
                  <col className="cluster-col-address" />
                  <col className="cluster-col-api" />
                  <col className="cluster-col-version" />
                  <col className="cluster-col-heartbeat" />
                  <col className="cluster-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('views.cluster.colId')}</th>
                    <th>{t('views.cluster.colState')}</th>
                    <th>{t('views.cluster.colAddress')}</th>
                    <th>{t('views.cluster.colApiAddress')}</th>
                    <th>{t('views.cluster.colVersion')}</th>
                    <th>{t('views.cluster.colHeartbeat')}</th>
                    <th>{t('views.cluster.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map(n => (
                    <tr key={n.id}>
                      <td>
                        <span className="cluster-node-id" onClick={() => fetchNodeDetail(n.id)} title={t('views.cluster.actionDetail')}>
                          {n.id}
                        </span>
                      </td>
                      <td>
                        <span className={`cluster-state-badge ${STATE_BADGE[n.state] || 'unknown'}`}>
                          {t(`views.cluster.state${n.state.charAt(0).toUpperCase()}${n.state.slice(1)}` as any) || n.state}
                        </span>
                      </td>
                      <td>{n.address}</td>
                      <td>{n.api_address}</td>
                      <td>{n.version}</td>
                      <td>{formatTime(n.last_heartbeat, i18n.language)}</td>
                      <td>
                        <div className="token-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            title={t('views.cluster.actionDetail')}
                            onClick={() => fetchNodeDetail(n.id)}
                          >
                            <FileText size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            title={t('views.cluster.actionRemove')}
                            onClick={() => {
                              // 不能删除本地节点（后端同样拒绝），点击给出明确提示
                              if (n.id === cluster?.local_node_id) {
                                showError(t('views.cluster.cannotRemoveSelf'));
                                return;
                              }
                              setRemoveTarget(n);
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </>
    );
  };

  const renderFiles = () => {
    return (
      <>
        {isLoading && files.length === 0 && !errorMsg && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.cluster.loading')}
          </div>
        )}

        {!isLoading && !errorMsg && files.length === 0 && (
          <div className="tokens-empty">{t('views.cluster.noFiles')}</div>
        )}

        {files.length > 0 && (
          <>
            <div className="tokens-table-wrap">
              <table className="tokens-table cluster-files-table">
                <colgroup>
                  <col className="cluster-col-file-path" />
                  <col className="cluster-col-file-db" />
                  <col className="cluster-col-file-meas" />
                  <col className="cluster-col-file-size" />
                  <col className="cluster-col-file-tier" />
                  <col className="cluster-col-file-origin" />
                  <col className="cluster-col-file-partition" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('views.cluster.filePath')}</th>
                    <th>{t('views.cluster.fileDatabase')}</th>
                    <th>{t('views.cluster.fileMeasurement')}</th>
                    <th>{t('views.cluster.fileSize')}</th>
                    <th>{t('views.cluster.fileTier')}</th>
                    <th>{t('views.cluster.fileOrigin')}</th>
                    <th>{t('views.cluster.filePartition')}</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map(f => (
                    <tr key={f.path}>
                      <td className="cluster-file-path">{f.path}</td>
                      <td>{f.database}</td>
                      <td>{f.measurement}</td>
                      <td>{formatBytes(f.size_bytes)}</td>
                      <td>
                        <span className={`cluster-tier-badge ${f.tier === 'cold' ? 'cold' : 'hot'}`}>
                          {f.tier === 'cold' ? t('views.cluster.tierCold') : t('views.cluster.tierHot')}
                        </span>
                      </td>
                      <td>{f.origin_node_id}</td>
                      <td>{formatTime(f.partition_time, i18n.language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cluster-pagination">
              <span>{t('views.cluster.fileTotal', { count: filesTotal.toLocaleString() })}</span>
              <div className="cluster-pagination-controls">
                <button onClick={pagePrev} disabled={cursorStack.length === 0}>
                  {t('views.cluster.prevPage')}
                </button>
                <button onClick={pageNext} disabled={!nextCursor}>
                  {t('views.cluster.nextPage')}
                </button>
              </div>
            </div>
          </>
        )}
      </>
    );
  };

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('views.cluster.title')}</h1>
          <p>{t('views.cluster.pageSubtitle')}</p>
        </div>
      </div>

      <div className="page-section">
        {!activeServer && (
          <div className="tokens-empty">
            <AlertTriangle size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            {t('views.backup.noServer')}
          </div>
        )}

        {activeServer && noLicense && (
          <div className="cluster-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.cluster.notEnabled')}</p>
          </div>
        )}

        {activeServer && !noLicense && !isLoading && !cluster && (
          clusterError ? (
            <div className="tokens-alert">{clusterError}</div>
          ) : (
            <div className="loading-inline">
              <Loader2 className="spin" size={18} />
              {t('views.cluster.loading')}
            </div>
          )
        )}

        {activeServer && !noLicense && cluster && !cluster.enabled && (
          <div className="cluster-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.cluster.notEnabled')}</p>
          </div>
        )}

        {activeServer && !noLicense && cluster && isEnabled && (
          <>
            {errorMsg && <div className="tokens-alert">{errorMsg}</div>}

            {/* Toolbar */}
            <div className="section-header">
              <div className="section-header-text">
                <h2>{cluster.cluster_name || t('views.cluster.title')}</h2>
              </div>
              <div className="page-toolbar">
                <button
                  type="button"
                  className="btn btn-outlined"
                  onClick={() => {
                    fetchCluster();
                    fetchLocal();
                    fetchHealth();
                    if (activeTab === 'nodes') fetchNodes();
                    if (activeTab === 'files') fetchFiles(cursorStack.length ? cursorStack[cursorStack.length - 1] : undefined);
                  }}
                  disabled={isLoading}
                >
                  <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
                  {t('views.cluster.refresh')}
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="qm-tabs">
              <button
                type="button"
                className={`qm-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                {t('views.cluster.tabOverview')}
              </button>
              <button
                type="button"
                className={`qm-tab-btn ${activeTab === 'nodes' ? 'active' : ''}`}
                onClick={() => setActiveTab('nodes')}
              >
                {t('views.cluster.tabNodes')}
              </button>
              <button
                type="button"
                className={`qm-tab-btn ${activeTab === 'files' ? 'active' : ''}`}
                onClick={() => setActiveTab('files')}
              >
                {t('views.cluster.tabFiles')}
              </button>
            </div>

            {activeTab === 'overview' && renderOverview()}
            {activeTab === 'nodes' && renderNodes()}
            {activeTab === 'files' && renderFiles()}
          </>
        )}
      </div>

      {/* ── Node Detail Modal ── */}
      {detailNode && (
        <div className="modal-overlay" onClick={() => setDetailNode(null)}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.cluster.nodeDetailTitle')}</h3>
              <button type="button" className="icon-btn" onClick={() => setDetailNode(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {/* 节点信息组 */}
              <div style={{ marginBottom: 16 }}>
                <div className="section-header-text" style={{ marginBottom: 8 }}>
                  <h2 style={{ fontSize: 14 }}>{t('views.cluster.nodeInfoTitle')}</h2>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.colId')}</span>
                  <span className="cluster-detail-value mono">{detailNode.id}</span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.colName')}</span>
                  <span className="cluster-detail-value">{detailNode.name}</span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.colRole')}</span>
                  <span className="cluster-detail-value">
                    {t(`views.cluster.role${detailNode.role.charAt(0).toUpperCase()}${detailNode.role.slice(1)}` as any) || detailNode.role}
                  </span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.colState')}</span>
                  <span className="cluster-detail-value">
                    {t(`views.cluster.state${detailNode.state.charAt(0).toUpperCase()}${detailNode.state.slice(1)}` as any) || detailNode.state}
                  </span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.colAddress')}</span>
                  <span className="cluster-detail-value mono">{detailNode.address}</span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.colApiAddress')}</span>
                  <span className="cluster-detail-value mono">{detailNode.api_address}</span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.colVersion')}</span>
                  <span className="cluster-detail-value">{detailNode.version}</span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.startedAt')}</span>
                  <span className="cluster-detail-value">{formatTime(detailNode.started_at, i18n.language)}</span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.joinedAt')}</span>
                  <span className="cluster-detail-value">{formatTime(detailNode.joined_at, i18n.language)}</span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.colHeartbeat')}</span>
                  <span className="cluster-detail-value">{formatTime(detailNode.last_heartbeat, i18n.language)}</span>
                </div>
                <div className="cluster-detail-row">
                  <span className="cluster-detail-label">{t('views.cluster.failedChecks')}</span>
                  <span className="cluster-detail-value">{detailNode.failed_checks}</span>
                </div>
              </div>

              {/* 实时指标组 */}
              {detailNode.stats && (
                <div style={{ marginBottom: 16 }}>
                  <div className="section-header-text" style={{ marginBottom: 8 }}>
                    <h2 style={{ fontSize: 14 }}>{t('views.cluster.statsTitle')}</h2>
                  </div>
                  <div className="cluster-detail-row">
                    <span className="cluster-detail-label">{t('views.cluster.statsCpu')}</span>
                    <span className="cluster-detail-value">{detailNode.stats.cpu_usage?.toFixed(1) ?? '-'}%</span>
                  </div>
                  <div className="cluster-detail-row">
                    <span className="cluster-detail-label">{t('views.cluster.statsMemory')}</span>
                    <span className="cluster-detail-value">{detailNode.stats.memory_usage?.toFixed(1) ?? '-'}%</span>
                  </div>
                  <div className="cluster-detail-row">
                    <span className="cluster-detail-label">{t('views.cluster.statsIngest')}</span>
                    <span className="cluster-detail-value">{detailNode.stats.ingest_rate ?? 0}</span>
                  </div>
                  <div className="cluster-detail-row">
                    <span className="cluster-detail-label">{t('views.cluster.statsQuery')}</span>
                    <span className="cluster-detail-value">{detailNode.stats.query_rate ?? 0}</span>
                  </div>
                  <div className="cluster-detail-row">
                    <span className="cluster-detail-label">{t('views.cluster.statsStorage')}</span>
                    <span className="cluster-detail-value">{formatBytes(detailNode.stats.storage_used || 0)}</span>
                  </div>
                  <div className="cluster-detail-row">
                    <span className="cluster-detail-label">{t('views.cluster.statsConnections')}</span>
                    <span className="cluster-detail-value">{detailNode.stats.connections ?? 0}</span>
                  </div>
                  <div className="cluster-detail-row">
                    <span className="cluster-detail-label">{t('views.cluster.statsActiveQueries')}</span>
                    <span className="cluster-detail-value">{detailNode.stats.active_queries ?? 0}</span>
                  </div>
                  <div className="cluster-detail-row">
                    <span className="cluster-detail-label">{t('views.cluster.statsCompactionJobs')}</span>
                    <span className="cluster-detail-value">{detailNode.stats.compaction_jobs ?? 0}</span>
                  </div>
                </div>
              )}

              {/* 能力组：所有节点均返回 capabilities（后端 nodeToMap 按 role 计算） */}
              {detailNode.capabilities && (
                <div>
                  <div className="section-header-text" style={{ marginBottom: 8 }}>
                    <h2 style={{ fontSize: 14 }}>{t('views.cluster.capabilities')}</h2>
                  </div>
                  <div className="cluster-cap-row">
                    <span className={`cluster-cap-badge ${detailNode.capabilities.can_ingest ? '' : 'off'}`}>
                      {detailNode.capabilities.can_ingest ? <CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> : <XCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                      {t('views.cluster.canIngest')}
                    </span>
                    <span className={`cluster-cap-badge ${detailNode.capabilities.can_query ? '' : 'off'}`}>
                      {detailNode.capabilities.can_query ? <CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> : <XCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                      {t('views.cluster.canQuery')}
                    </span>
                    <span className={`cluster-cap-badge ${detailNode.capabilities.can_compact ? '' : 'off'}`}>
                      {detailNode.capabilities.can_compact ? <CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> : <XCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                      {t('views.cluster.canCompact')}
                    </span>
                    <span className={`cluster-cap-badge ${detailNode.capabilities.can_coordinate ? '' : 'off'}`}>
                      {detailNode.capabilities.can_coordinate ? <CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> : <XCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                      {t('views.cluster.canCoordinate')}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outlined" onClick={() => setDetailNode(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove Node Confirm ── */}
      {removeTarget && (
        <ConfirmModal
          title={t('views.cluster.removeConfirmTitle')}
          description={t('views.cluster.removeConfirm', { id: removeTarget.id })}
          confirmLabel={t('views.cluster.actionRemove')}
          onConfirm={handleRemoveNode}
          onCancel={() => setRemoveTarget(null)}
          danger
        />
      )}
    </div>
  );
};

export default ClusterManagement;
