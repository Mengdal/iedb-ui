import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  Archive,
  ArrowLeftRight,
  Ban,
  Braces,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  FileCode,
  FolderOpen,
  Gauge,
  Globe,
  HardDrive,
  Inbox,
  Key,
  Layers,
  Link2,
  Loader2,
  MessageSquare,
  MinusCircle,
  Package,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Shield,
  Sliders,
  Timer,
  Trash2,
  Upload,
  Wifi,
  Zap,
} from 'lucide-react';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';
import TimeseriesCharts from './TimeseriesCharts';
import './SystemOverview.css';

interface Metrics {
  go_version: string;
  uptime_seconds: number;
  num_cpu: number;
  goroutines: number;
  memory_alloc_bytes: number;
  memory_sys_bytes: number;
  http_requests_total: number;
  query_requests_total: number;
  query_rows_total: number;
  query_success_total: number;
  auth_failures_total: number;
  gc_cycles: number;
  [key: string]: any;
}

const StatCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
}> = ({ title, value, subtitle, icon }) => (
  <div className="stat-card">
    <div className="stat-header">
      <span className="stat-title">{title}</span>
      {icon && <span className="stat-icon">{icon}</span>}
    </div>
    <div className="stat-value">{value}</div>
    {subtitle && <div className="stat-subtitle">{subtitle}</div>}
  </div>
);

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor(seconds % (3600*24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

function formatBytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function formatLatency(us: number) {
  if (us < 1000) return `${us} µs`;
  if (us < 1000000) return `${(us / 1000).toFixed(2)} ms`;
  return `${(us / 1000000).toFixed(2)} s`;
}

const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={`collapsible-section ${isOpen ? 'open' : ''}`}>
      <div className="collapsible-header" onClick={() => setIsOpen(!isOpen)}>
        <h3 className="section-title" style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>{title}</h3>
        <span className="collapsible-icon">
          {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </span>
      </div>
      {isOpen && <div className="collapsible-content">
        <div className="cards-wrapper">
          {children}
        </div>
      </div>}
    </div>
  );
};

const SystemOverview: React.FC = () => {
  const { activeServer } = useServers();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, i18n } = useTranslation();

  const fetchMetrics = async () => {
    if (!activeServer) return;
    setLoading(true);
    setError(null);
    try {
      // Avoid trailing slash issues
      const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/v1/metrics`, {
        headers: {
          'Authorization': `Bearer ${activeServer.token}`
        }
      });
      if (!res.ok) {
        throw new Error(`HTTP Error: ${res.status}`);
      }
      const data = await res.json();
      setMetrics(data);
    } catch (err: any) {
      setError(err.message || t('views.systemOverview.errorFailedToFetch'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    // Auto refresh every 10 seconds
    const intervalId = setInterval(fetchMetrics, 10000);
    return () => clearInterval(intervalId);
  }, [activeServer]);

  if (!activeServer) {
    return (
      <div className="overview-container" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <h2>{t('views.systemOverview.noServerTitle')}</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{t('views.systemOverview.noServerHint')}</p>
      </div>
    );
  }

  return (
    <div className="overview-container">
      <div className="page-header">
        <div>
          <h1 className="page-title-main">{t('views.systemOverview.title')}</h1>
          <p className="page-subtitle">{t('views.systemOverview.subtitle', { serverName: activeServer.name })}</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={fetchMetrics} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            {loading ? t('views.systemOverview.refreshing') : t('views.systemOverview.refresh')}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: '16px', backgroundColor: 'rgba(255,0,0,0.1)', border: '1px solid #ff6e6e', color: '#ff6e6e', borderRadius: '8px', marginBottom: '24px' }}>
          <strong>{t('views.systemOverview.errorFetching')}</strong> {error}
        </div>
      ) : null}

      {!metrics && !error && loading ? (
        <div style={{ color: 'var(--text-secondary)' }}>{t('views.systemOverview.loadingMetrics', { host: activeServer.host })}</div>
      ) : metrics ? (
        <div className="stats-grid">

          {/* Top-Level Highlights */}
          <div className="cards-wrapper" style={{ marginBottom: '8px' }}>
            <StatCard 
              title="HTTP Requests" 
              value={(metrics.http_requests_total || 0).toLocaleString(i18n.language)} 
              subtitle={`Success: ${metrics.http_requests_success || 0} | Err: ${metrics.http_requests_error || 0}`} 
              icon={<Globe size={18} />} 
            />
            <StatCard 
              title="Queries Executed" 
              value={(metrics.query_requests_total || 0).toLocaleString(i18n.language)} 
              subtitle={`Avg Latency: ${metrics.query_latency_count > 0 ? formatLatency(metrics.query_latency_sum_us / metrics.query_latency_count) : '0 ms'}`} 
              icon={<Database size={18} />} 
            />
            <StatCard 
              title="Data Ingested" 
              value={metrics.ingest_bytes_total ? formatBytes(metrics.ingest_bytes_total) : '0 MB'} 
              subtitle={`Records: ${(metrics.ingest_records_total || 0).toLocaleString(i18n.language)}`} 
              icon={<Inbox size={18} />} 
            />
            <StatCard 
              title="Memory In Use" 
              value={metrics.memory_alloc_bytes ? formatBytes(metrics.memory_alloc_bytes) : '0 MB'} 
              subtitle={`Sys Alloc: ${metrics.memory_sys_bytes ? formatBytes(metrics.memory_sys_bytes) : '0 MB'}`} 
              icon={<Activity size={18} />} 
            />
          </div>
          
          <TimeseriesCharts />

          <div className="advanced-metrics-container" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
            {/* 1. 基础系统与环境 */}
            <CollapsibleSection title="1. System & Environment">
              <StatCard title="Go Version" value={metrics.go_version || 'N/A'} icon={<Server size={18} />} />
              <StatCard title="Uptime" value={metrics.uptime_seconds ? formatUptime(metrics.uptime_seconds) : '0s'} icon={<Clock size={18} />} subtitle={`Since ${metrics.timestamp ? new Date(metrics.timestamp).toLocaleTimeString(i18n.language) : 'N/A'}`} />
              <StatCard title="CPU Cores" value={metrics.num_cpu || 0} icon={<Cpu size={18} />} subtitle={`${metrics.gomaxprocs || 0} GOMAXPROCS`} />
              <StatCard title="Goroutines" value={(metrics.goroutines || 0).toLocaleString(i18n.language)} icon={<Activity size={18} />} />
            </CollapsibleSection>

            {/* 2. 内存使用情况 */}
            <CollapsibleSection title="2. Memory Usage">
              <StatCard title="Heap In Use" value={metrics.memory_heap_inuse_bytes ? formatBytes(metrics.memory_heap_inuse_bytes) : '0 MB'} icon={<Layers size={18} />} subtitle={`Alloc: ${metrics.memory_heap_alloc_bytes ? formatBytes(metrics.memory_heap_alloc_bytes) : '0 MB'}`} />
              <StatCard title="Sys Memory" value={metrics.memory_sys_bytes ? formatBytes(metrics.memory_sys_bytes) : '0 MB'} icon={<HardDrive size={18} />} subtitle={`Heap Sys: ${metrics.memory_heap_sys_bytes ? formatBytes(metrics.memory_heap_sys_bytes) : '0 MB'}`} />
              <StatCard title="Stack In Use" value={metrics.memory_stack_inuse_bytes ? formatBytes(metrics.memory_stack_inuse_bytes) : '0 MB'} icon={<Layers size={18} />} />
              <StatCard title="Total Allocated" value={metrics.memory_total_alloc_bytes ? formatBytes(metrics.memory_total_alloc_bytes) : '0 MB'} icon={<Activity size={18} />} subtitle="Historical sum" />
            </CollapsibleSection>

            {/* 3. 垃圾回收 */}
            <CollapsibleSection title="3. Garbage Collection">
              <StatCard title="GC Cycles" value={(metrics.gc_cycles || 0).toLocaleString(i18n.language)} icon={<RefreshCw size={18} />} />
              <StatCard title="GC Pause Total" value={metrics.gc_pause_total_ns ? formatLatency(metrics.gc_pause_total_ns / 1000) : '0 ms'} icon={<Clock size={18} />} subtitle="Cumulative pause" />
            </CollapsibleSection>

            {/* 4. HTTP 请求统计 */}
            <CollapsibleSection title="4. HTTP Requests">
              <StatCard title="Total Requests" value={(metrics.http_requests_total || 0).toLocaleString(i18n.language)} icon={<Globe size={18} />} subtitle={`Success: ${metrics.http_requests_success || 0}`} />
              <StatCard title="Errors" value={(metrics.http_requests_error || 0).toLocaleString(i18n.language)} icon={<Shield size={18} />} />
              <StatCard title="Latency Total" value={metrics.http_latency_sum_us ? formatLatency(metrics.http_latency_sum_us) : '0 ms'} icon={<Clock size={18} />} subtitle={`Count: ${metrics.http_latency_count || 0}`} />
            </CollapsibleSection>
            
            {/* 5. 核心查询引擎执行情况 */}
            <CollapsibleSection title="5. Query Engine Execution">
              <StatCard title="Total Queries" value={(metrics.query_requests_total || 0).toLocaleString(i18n.language)} icon={<Database size={18} />} subtitle={`Success: ${metrics.query_success_total || 0}`} />
              <StatCard title="Query Errors" value={(metrics.query_errors_total || 0).toLocaleString(i18n.language)} icon={<AlertCircle size={18} />} subtitle={`Timeouts: ${metrics.query_timeouts_total || 0}`} />
              <StatCard title="Rows Returned" value={(metrics.query_rows_total || 0).toLocaleString(i18n.language)} icon={<Layers size={18} />} />
              <StatCard title="Latency Sum" value={metrics.query_latency_sum_us ? formatLatency(metrics.query_latency_sum_us) : '0 ms'} icon={<Timer size={18} />} subtitle={`Count: ${metrics.query_latency_count || 0}`} />
              <StatCard title="Active Queries" value={(metrics.query_mgmt_active_queries || 0).toLocaleString(i18n.language)} icon={<Loader2 size={18} />} subtitle={`Cancelled: ${metrics.query_mgmt_cancelled_total || 0}`} />
            </CollapsibleSection>

            {/* 6. 底部数据库连接池 */}
            <CollapsibleSection title="6. Database Connections">
              <StatCard title="Open Connections" value={(metrics.db_connections_open || 0).toLocaleString(i18n.language)} icon={<Database size={18} />} />
              <StatCard title="In Use / Idle" value={`${metrics.db_connections_in_use || 0} / ${metrics.db_connections_idle || 0}`} icon={<Link2 size={18} />} />
              <StatCard title="DB Queries" value={(metrics.db_queries_total || 0).toLocaleString(i18n.language)} icon={<Database size={18} />} subtitle={`Errors: ${metrics.db_query_errors_total || 0}`} />
            </CollapsibleSection>

            {/* 7. 认证与审计安全 */}
            <CollapsibleSection title="7. Auth & Audit">
              <StatCard title="Auth Requests" value={(metrics.auth_requests_total || 0).toLocaleString(i18n.language)} icon={<Shield size={18} />} subtitle={`Failures: ${metrics.auth_failures_total || 0}`} />
              <StatCard title="Cache Hits / Misses" value={`${metrics.auth_cache_hits || 0} / ${metrics.auth_cache_misses || 0}`} icon={<Key size={18} />} />
              <StatCard title="Audit Events" value={(metrics.audit_events_total || 0).toLocaleString(i18n.language)} icon={<ClipboardList size={18} />} subtitle={`Write Errors: ${metrics.audit_write_errors || 0}`} />
            </CollapsibleSection>

            {/* 8. 数据摄入与解析 */}
            <CollapsibleSection title="8. Ingest & Parsers">
              <StatCard title="Ingest Bytes" value={metrics.ingest_bytes_total ? formatBytes(metrics.ingest_bytes_total) : '0 MB'} icon={<Inbox size={18} />} subtitle={`Records: ${metrics.ingest_records_total || 0}`} />
              <StatCard title="Ingest Batches" value={(metrics.ingest_batches_total || 0).toLocaleString(i18n.language)} icon={<Package size={18} />} subtitle={`Errors: ${metrics.ingest_errors_total || 0}`} />
              <StatCard title="LineProtocol Bytes" value={metrics.lineprotocol_bytes_total ? formatBytes(metrics.lineprotocol_bytes_total) : '0 MB'} icon={<FileCode size={18} />} subtitle={`Reqs: ${metrics.lineprotocol_requests_total || 0}`} />
              <StatCard title="MsgPack Bytes" value={metrics.msgpack_bytes_total ? formatBytes(metrics.msgpack_bytes_total) : '0 MB'} icon={<Braces size={18} />} subtitle={`Reqs: ${metrics.msgpack_requests_total || 0}`} />
            </CollapsibleSection>

            {/* 9. 缓冲与队列 */}
            <CollapsibleSection title="9. Buffer & Queue">
              <StatCard title="Queue Depth" value={(metrics.buffer_queue_depth || 0).toLocaleString(i18n.language)} icon={<Layers size={18} />} />
              <StatCard title="Records Buffered" value={(metrics.buffer_records_buffered || 0).toLocaleString(i18n.language)} icon={<Archive size={18} />} subtitle={`Written: ${metrics.buffer_records_written || 0}`} />
              <StatCard title="Flushes" value={(metrics.buffer_flushes_total || 0).toLocaleString(i18n.language)} icon={<Send size={18} />} subtitle={`Errors: ${metrics.buffer_errors_total || 0}`} />
              <StatCard title="Decomp Discards" value={(metrics.decomp_buffer_discards || 0).toLocaleString(i18n.language)} icon={<Trash2 size={18} />} />
            </CollapsibleSection>

            {/* 10. 存储引擎层 */}
            <CollapsibleSection title="10. Storage Engine">
              <StatCard title="Reads / Writes" value={`${metrics.storage_reads_total || 0} / ${metrics.storage_writes_total || 0}`} icon={<HardDrive size={18} />} subtitle={`Errors: ${metrics.storage_errors_total || 0}`} />
              <StatCard title="Read Bytes" value={metrics.storage_read_bytes_total ? formatBytes(metrics.storage_read_bytes_total) : '0 MB'} icon={<Download size={18} />} />
              <StatCard title="Write Bytes" value={metrics.storage_write_bytes_total ? formatBytes(metrics.storage_write_bytes_total) : '0 MB'} icon={<Upload size={18} />} />
            </CollapsibleSection>

            {/* 11. 数据压缩优化 */}
            <CollapsibleSection title="11. Compaction">
              <StatCard title="Compaction Jobs" value={(metrics.compaction_jobs_total || 0).toLocaleString(i18n.language)} icon={<Zap size={18} />} subtitle={`Succ: ${metrics.compaction_jobs_success || 0} | Fail: ${metrics.compaction_jobs_failed || 0}`} />
              <StatCard title="Files Compacted" value={(metrics.compaction_files_compacted || 0).toLocaleString(i18n.language)} icon={<FolderOpen size={18} />} subtitle={`Manifests Recov: ${metrics.compaction_manifests_recovered || 0}`} />
              <StatCard title="Bytes R / W" value={`${metrics.compaction_bytes_read ? formatBytes(metrics.compaction_bytes_read) : '0 MB'} / ${metrics.compaction_bytes_written ? formatBytes(metrics.compaction_bytes_written) : '0 MB'}`} icon={<ArrowLeftRight size={18} />} />
            </CollapsibleSection>

            {/* 12. 预写日志 */}
            <CollapsibleSection title="12. WAL (Write-Ahead Log)">
              <StatCard title="Records Preserved" value={(metrics.wal_records_preserved || 0).toLocaleString(i18n.language)} icon={<Copy size={18} />} />
              <StatCard title="Recovery Total" value={(metrics.wal_recovery_total || 0).toLocaleString(i18n.language)} icon={<RotateCcw size={18} />} subtitle={`Records: ${metrics.wal_recovery_records || 0}`} />
            </CollapsibleSection>

            {/* 13. MQTT 通信 */}
            <CollapsibleSection title="13. MQTT Protocol">
              <StatCard title="Connected" value={(metrics.mqtt_connected || 0).toLocaleString(i18n.language)} icon={<Wifi size={18} />} subtitle={`Reconnects: ${metrics.mqtt_reconnects || 0}`} />
              <StatCard title="Msgs Received" value={(metrics.mqtt_messages_received || 0).toLocaleString(i18n.language)} icon={<MessageSquare size={18} />} subtitle={`Failed: ${metrics.mqtt_messages_failed || 0}`} />
              <StatCard title="Bytes Received" value={metrics.mqtt_bytes_received ? formatBytes(metrics.mqtt_bytes_received) : '0 MB'} icon={<Radio size={18} />} subtitle={`Decode Succ: ${metrics.mqtt_decode_success || 0} | Err: ${metrics.mqtt_decode_errors || 0}`} />
            </CollapsibleSection>

            {/* 14. 限流与配额治理 */}
            <CollapsibleSection title="14. Governance & Limits">
              <StatCard title="Active Policies" value={(metrics.governance_policies_active || 0).toLocaleString(i18n.language)} icon={<Sliders size={18} />} />
              <StatCard title="Quota Exhausted" value={(metrics.governance_quota_exhausted_total || 0).toLocaleString(i18n.language)} icon={<Gauge size={18} />} />
              <StatCard title="Rate Limited" value={(metrics.governance_rate_limited_total || 0).toLocaleString(i18n.language)} icon={<Ban size={18} />} />
            </CollapsibleSection>

            {/* 15. 数据复制 */}
            <CollapsibleSection title="15. Replication">
              <StatCard title="Sequence Gaps" value={(metrics.replication_sequence_gaps_total || 0).toLocaleString(i18n.language)} icon={<Copy size={18} />} />
              <StatCard title="Entries Dropped" value={(metrics.replication_entries_dropped_total || 0).toLocaleString(i18n.language)} icon={<MinusCircle size={18} />} />
            </CollapsibleSection>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SystemOverview;
