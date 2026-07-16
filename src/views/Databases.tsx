import { useState, useEffect, useMemo } from 'react';
import { Database, Plus, RefreshCw, Trash2, X, Server, Loader2, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import { useApiFetch } from '../hooks/useApiFetch';
import ConfirmModal from '../components/ConfirmModal';
import DatabaseRetentionPolicies from './DatabaseRetentionPolicies';
import DatabaseMeasurements from './DatabaseMeasurements';
import './Databases.css';

interface DatabaseItem {
  name: string;
  measurement_count: number;
}

function Databases() {
  const { t } = useTranslation();
  const { activeServer } = useServers();
  const { apiFetch } = useApiFetch({ handleLicense: false, handleFeature: false });

  const [databases, setDatabases] = useState<DatabaseItem[]>([]);
  const [policyCountMap, setPolicyCountMap] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Detail view
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'retention' | 'measurements'>('retention');
  const [dbMeasurements, setDbMeasurements] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchDatabases = async () => {
    if (!activeServer) return;
    setIsLoading(true);
    try {
      const [dbData, rpData] = await Promise.all([
        apiFetch('/api/v1/databases'),
        apiFetch('/api/v1/retention').catch(() => null),
      ]);
      setDatabases((dbData as any).databases || []);

      if (rpData) {
        const policies = Array.isArray(rpData) ? rpData : [];
        const map: Record<string, number> = {};
        policies.forEach((p: any) => { map[p.database] = (map[p.database] || 0) + 1; });
        setPolicyCountMap(map);
      }
    } catch {
      // handled by UI state
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, [activeServer, apiFetch]);

  // Fetch measurements when entering detail view
  useEffect(() => {
    if (!selectedDb || !activeServer) { setDbMeasurements([]); return; }
    const ctrl = new AbortController();
    apiFetch(`/api/v1/databases/${encodeURIComponent(selectedDb)}/measurements`, { signal: ctrl.signal })
      .then(data => setDbMeasurements((data as any).measurements?.map((m: any) => m.name) || []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [selectedDb, activeServer, apiFetch]);

  const handleCreateDatabase = async () => {
    if (!activeServer || !newDbName.trim()) return;
    setIsCreating(true);
    setErrorMsg('');
    try {
      await apiFetch('/api/v1/databases', {
        method: 'POST',
        body: JSON.stringify({ name: newDbName.trim() }),
      });
      setShowCreateModal(false);
      setNewDbName('');
      fetchDatabases();
    } catch (err: any) {
      setErrorMsg(err.message || t('views.databases.createFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteDatabase = async () => {
    if (!activeServer || !deleteTarget) return;
    setErrorMsg('');
    await apiFetch(`/api/v1/databases/${encodeURIComponent(deleteTarget)}?confirm=true`, { method: 'DELETE' });
    setDeleteTarget(null);
    fetchDatabases();
  };

  const filteredDatabases = useMemo(() =>
    databases.filter(db => db.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [databases, searchQuery]
  );

  // No server selected
  if (!activeServer) {
    return (
      <div className="databases-page">
        <div className="db-empty-state">
          <Server size={48} color="var(--text-muted)" />
          <h3>{t('views.databases.noServer')}</h3>
          <p>{t('views.databases.noServerDesc')}</p>
        </div>
      </div>
    );
  }

  // Detail view
  if (selectedDb) {
    return (
      <div className="databases-page">
        <div className="db-detail-header">
          <div className="db-breadcrumb">
            <button className="db-back-btn" onClick={() => setSelectedDb(null)}>
              <Database size={16} />
              {t('views.databases.title')}
            </button>
            <ChevronRight size={16} className="db-breadcrumb-sep" />
            <span className="db-breadcrumb-current">{selectedDb}</span>
          </div>
          <div className="db-tabs">
            <button
              className={`db-tab-btn ${activeTab === 'retention' ? 'active' : ''}`}
              onClick={() => setActiveTab('retention')}
            >
              {t('views.databases.detail.tabRetention')}
            </button>
            <button
              className={`db-tab-btn ${activeTab === 'measurements' ? 'active' : ''}`}
              onClick={() => setActiveTab('measurements')}
            >
              {t('views.databases.detail.tabMeasurements')}
            </button>
          </div>
        </div>

        {activeTab === 'retention' ? (
          <DatabaseRetentionPolicies database={selectedDb} measurements={dbMeasurements} />
        ) : (
          <DatabaseMeasurements database={selectedDb} />
        )}
      </div>
    );
  }

  // Database list
  return (
    <div className="databases-page">
      {/* Header */}
      <div className="db-header">
        <div className="db-header-left">
          <div className="db-title-row">
            <div>
              <h1 className="db-title">{t('views.databases.title')}</h1>
              <p className="db-subtitle">{t('views.databases.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className="db-header-right">
          <div className="db-search-container">
            <input
              type="text"
              className="db-search-input"
              placeholder={t('views.databases.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            className="btn btn-secondary"
            onClick={fetchDatabases}
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
            {t('views.databases.refresh')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={16} />
            {t('views.databases.create')}
          </button>
        </div>
      </div>

      {/* Content */}
      {errorMsg && <div className="tokens-alert">{errorMsg}</div>}

      {isLoading ? (
        <div className="db-loading">
          <Loader2 size={32} className="spin" />
          <p>{t('views.databases.loading')}</p>
        </div>
      ) : filteredDatabases.length === 0 ? (
        <div className="db-empty-state">
          <Database size={48} color="var(--text-muted)" />
          <h3>{searchQuery ? t('views.databases.noMatch') : t('views.databases.noDatabases')}</h3>
          <p>{searchQuery ? t('views.databases.tryDifferentSearch') : t('views.databases.createFirst')}</p>
        </div>
      ) : (
        <div className="db-grid">
          {filteredDatabases.map((db) => (
            <div
              key={db.name}
              className="database-card"
              onClick={() => { setSelectedDb(db.name); setActiveTab('retention'); }}
            >
              <div className="db-card-header">
                <div className="db-card-icon-container">
                  <Database size={20} color="#3b82f6" />
                </div>
                <div className="db-card-info">
                  <h3 className="db-card-name">{db.name}</h3>
                </div>
                <button
                  className="btn btn-icon btn-danger-ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(db.name);
                  }}
                  title={t('views.databases.delete')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="db-card-stats">
                <div className="db-stat-item">
                  <span className="db-stat-label">{t('views.databases.measurements')}</span>
                  <span className="db-stat-value">{db.measurement_count ?? 0}</span>
                </div>
                <div className="db-stat-item">
                  <span className="db-stat-label">{t('views.databases.retentionPolicies')}</span>
                  <span className="db-stat-value">{policyCountMap[db.name] ?? 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('views.databases.createTitle')}</h2>
              <button className="btn btn-icon" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{t('views.databases.dbName')}</label>
                <input
                  type="text"
                  value={newDbName}
                  onChange={(e) => setNewDbName(e.target.value)}
                  placeholder={t('views.databases.dbNamePlaceholder')}
                  autoFocus
                />
                <p className="form-hint">{t('views.databases.dbNameHint')}</p>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                {t('views.databases.cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateDatabase}
                disabled={!newDbName.trim() || isCreating}
              >
                {isCreating ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                {t('views.databases.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title={t('views.databases.deleteTitle')}
          description={t('views.databases.deleteConfirm', { name: deleteTarget })}
          confirmLabel={t('views.databases.delete')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteDatabase}
        />
      )}
    </div>
  );
}

export default Databases;
