import React, { useState, useEffect } from 'react';
import { Database, Plus, RefreshCw, Trash2, Search, X, AlertTriangle, Activity, Server, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import './Databases.css';

interface DatabaseItem {
  name: string;
  measurement_count: number;
}

export default function Databases() {
  const { t } = useTranslation();
  const { activeServer } = useServers();
  const [databases, setDatabases] = useState<DatabaseItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Delete Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [dbToDelete, setDbToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDatabases = async () => {
    if (!activeServer) return;
    setIsLoading(true);
    try {
      const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/v1/databases`, {
        headers: {
          'Authorization': `Bearer ${activeServer.token}`
        }
      });
      const data = await res.json();
      if (data && data.databases) {
        setDatabases(data.databases);
      } else {
        setDatabases([]);
      }
    } catch (err) {
      console.error('Failed to fetch databases:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, [activeServer]);

  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeServer || !newDbName.trim()) return;

    setIsCreating(true);
    try {
      const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/v1/databases`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeServer.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newDbName.trim() })
      });

      const text = await res.text();
      let isSuccess = false;
      try {
        const data = JSON.parse(text);
        if (data.success || res.ok) {
          isSuccess = true;
        }
      } catch {
        if (res.ok) isSuccess = true;
      }

      if (isSuccess || res.ok) {
        setNewDbName('');
        setShowCreateModal(false);
        fetchDatabases();
      } else {
        alert(t('views.databases.createFailed'));
      }
    } catch (err) {
      console.error('Failed to create database:', err);
      alert(t('views.databases.createError'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteDatabase = async () => {
    if (!activeServer || !dbToDelete) return;

    setIsDeleting(true);
    try {
      const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/v1/databases/${encodeURIComponent(dbToDelete)}?confirm=true`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${activeServer.token}`
        }
      });

      if (res.ok) {
        setShowDeleteModal(false);
        setDbToDelete(null);
        fetchDatabases();
      } else {
        const errText = await res.text();
        alert(t('views.databases.deleteFailedWithReason', { reason: errText }));
      }
    } catch (err: any) {
      console.error('Failed to delete database:', err);
      alert(t('views.databases.deleteErrorWithReason', { reason: err.message }));
    } finally {
      setIsDeleting(false);
    }
  };

  if (!activeServer) {
    return (
      <div className="databases-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="empty-state">
          <Server size={48} className="empty-state-icon" />
          <h3>{t('views.databases.noServerTitle')}</h3>
          <p>{t('views.databases.noServerHint')}</p>
        </div>
      </div>
    );
  }

  const filteredDatabases = databases.filter((db) =>
    db.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="databases-container">
      <div className="databases-header">
        <h2>
          <Database size={24} className="text-primary" />
          {t('views.databases.title')}
        </h2>
        <div className="databases-actions">
          <div className="search-bar" style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder={t('views.databases.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'var(--surface-dark)',
                border: '1px solid var(--border-light)',
                borderRadius: '8px',
                padding: '8px 12px 8px 36px',
                color: 'var(--text-primary)',
                width: '240px'
              }}
            />
          </div>
          <button
            className="btn btn-secondary"
            onClick={fetchDatabases}
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
            {t('common.refresh')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={16} />
            {t('views.databases.createDatabase')}
          </button>
        </div>
      </div>

      {isLoading && databases.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <Loader2 size={32} className="spin text-primary" style={{ marginBottom: 16 }} />
          <p>{t('views.databases.loadingDatabases')}</p>
        </div>
      ) : (
        <div className="databases-grid">
          {filteredDatabases.length === 0 ? (
            <div className="empty-state">
              <Database size={48} className="empty-state-icon" />
              <h3>{t('views.databases.noDatabasesFound')}</h3>
              <p>{searchQuery ? t('views.databases.adjustSearchHint') : t('views.databases.createToStartHint')}</p>
            </div>
          ) : (
            filteredDatabases.map((db) => (
              <div key={db.name} className="database-card">
                <div className="db-card-header">
                  <div className="db-card-title">
                    <div className="db-icon-container">
                      <Database size={20} />
                    </div>
                    <div>
                      <h3 className="db-name">{db.name}</h3>
                      <div className="db-meta">
                        <Activity size={14} /> {t('views.databases.activeDatabase')}
                      </div>
                    </div>
                  </div>
                  <div className="db-card-actions">
                    <button
                      className="icon-btn danger"
                      onClick={() => {
                        setDbToDelete(db.name);
                        setShowDeleteModal(true);
                      }}
                      title={t('views.databases.deleteDatabase')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="db-stats">
                  <div className="stat-item">
                    <span className="stat-label">{t('views.databases.measurements')}</span>
                    <span className="stat-value">{db.measurement_count ?? 0}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">{t('views.databases.status')}</span>
                    <span className="stat-value" style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span> {t('views.databases.online')}
                    </span>
                  </div>
                </div>

              </div>
            ))
          )}
        </div>
      )}

      {/* Create Database Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.databases.createDatabase')}</h3>
              <button className="close-btn" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateDatabase}>
              <div className="modal-body create-db-modal-body">
                <div className="form-group">
                  <label htmlFor="dbName">{t('views.databases.databaseName')}</label>
                  <input
                    id="dbName"
                    type="text"
                    className="form-input"
                    placeholder={t('views.databases.databaseNamePlaceholder')}
                    value={newDbName}
                    onChange={(e) => setNewDbName(e.target.value)}
                    autoFocus
                    required
                  />
                  <span className="create-db-hint">
                    {t('views.databases.databaseNameHint')}
                  </span>
                </div>
              </div>
              <div className="modal-footer create-db-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isCreating || !newDbName.trim()}
                >
                  {isCreating ? <Loader2 size={16} className="spin" /> : <Database size={16} />}
                  {t('views.databases.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Database Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
                <AlertTriangle size={20} />
                {t('views.databases.deleteDatabase')}
              </h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-primary)', marginBottom: '16px', lineHeight: '1.5' }}>
                {t('views.databases.confirmDeleteMessage', { name: dbToDelete })}
              </p>
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px', borderRadius: '8px', color: '#ef4444', fontSize: '13px', display: 'flex', gap: '12px' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  {t('views.databases.deleteWarning')}
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowDeleteModal(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteDatabase}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                {t('views.databases.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
