import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import './Tokens.css';

interface Measurement {
  measurement: string;
  file_count: number;
  total_size_mb: number;
  storage_path: string;
}

interface DryRunResult {
  deleted_count: number;
  affected_files: number;
  files_processed: string[];
}

// delete modal state
type DeleteStep = 'idle' | 'confirming' | 'preview' | 'deleting';

interface DeleteState {
  step: DeleteStep;
  measurement: string;
  dryRunResult: DryRunResult | null;
  error: string | null;
}

interface Props {
  database: string;
}

const PAGE_SIZE = 10;

const DatabaseMeasurements: React.FC<Props> = ({ database }) => {
  const { t } = useTranslation();
  const { activeServer } = useServers();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const [deleteState, setDeleteState] = useState<DeleteState>({
    step: 'idle',
    measurement: '',
    dryRunResult: null,
    error: null,
  });

  useEffect(() => {
    if (!activeServer || !database) return;
    let ignore = false;
    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
    setLoading(true);
    fetch(`${baseUrl}/api/v1/measurements?database=${encodeURIComponent(database)}`, {
      headers: { 'Authorization': `Bearer ${activeServer.token}` },
    })
      .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json(); })
      .then(data => { if (!ignore) setMeasurements(data.measurements || []); })
      .catch(() => {})
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [activeServer, database, refreshKey]);

  const filtered = useMemo(() => {
    if (!search.trim()) return measurements;
    const q = search.toLowerCase();
    return measurements.filter(m => m.measurement.toLowerCase().includes(q));
  }, [measurements, search]);

  // Reset page when search changes
  useEffect(() => { setOffset(0); }, [search]);

  const openDeleteConfirm = (measurement: string) => {
    setDeleteState({ step: 'confirming', measurement, dryRunResult: null, error: null });
  };

  const runDryRun = async () => {
    if (!activeServer) return;
    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
    setDeleteState(s => ({ ...s, step: 'deleting', error: null }));
    try {
      const res = await fetch(`${baseUrl}/api/v1/delete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeServer.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ database, measurement: deleteState.measurement, where: '1=1', dry_run: true, confirm: true }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: DryRunResult = await res.json();
      setDeleteState(s => ({ ...s, step: 'preview', dryRunResult: data, error: null }));
    } catch (e) {
      setDeleteState(s => ({ ...s, step: 'confirming', error: e instanceof Error ? e.message : t('views.databases.deleteFailed') }));
    }
  };

  const confirmDelete = async () => {
    if (!activeServer) return;
    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
    setDeleteState(s => ({ ...s, step: 'deleting', error: null }));
    try {
      const res = await fetch(`${baseUrl}/api/v1/delete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeServer.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ database, measurement: deleteState.measurement, where: '1=1', confirm: true }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setDeleteState({ step: 'idle', measurement: '', dryRunResult: null, error: null });
      setRefreshKey(k => k + 1);
    } catch (e) {
      setDeleteState(s => ({ ...s, step: 'preview', error: e instanceof Error ? e.message : t('views.databases.deleteFailed') }));
    }
  };

  const closeDeleteModal = () => {
    setDeleteState({ step: 'idle', measurement: '', dryRunResult: null, error: null });
  };

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const paged = filtered.slice(offset, offset + PAGE_SIZE);

  return (
    <div className="page-section" style={{ margin: 0 }}>
      <div className="section-header">
        <div className="section-header-text">
          <h2>{t('views.databases.detail.measurementsTitle')}</h2>
        </div>
        <div className="page-toolbar">
          <input
            className="page-search"
            type="search"
            placeholder={t('views.databases.detail.searchMeasurementPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-outlined"
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={!activeServer || loading}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {loading && (
        <div className="rp-loading"><Loader2 size={24} className="spin" /><span>{t('views.retentionPolicy.loading')}</span></div>
      )}

      {!loading && paged.length === 0 && (
        <div className="tokens-empty">
          {search ? t('views.databases.detail.searchMeasurementPlaceholder') : t('views.databases.detail.noMeasurements')}
        </div>
      )}

      {!loading && paged.length > 0 && (
        <>
          <div className="tokens-table-wrap">
            <table className="tokens-table">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{t('views.databases.detail.colMeasurementName')}</th>
                  <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{t('views.databases.detail.colFileCount')}</th>
                  <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{t('views.databases.detail.colTotalSize')}</th>
                  <th style={{ textAlign: 'center' }}>{t('views.databases.detail.colStoragePath')}</th>
                  <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{t('views.databases.detail.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(m => (
                  <tr key={m.measurement}>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{m.measurement}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{m.file_count}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{m.total_size_mb.toFixed(1)} MB</td>
                    <td className="text-muted" style={{ fontSize: '12px', textAlign: 'center', minWidth: 0 }}>{m.storage_path}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-ghost btn-small"
                        onClick={() => openDeleteConfirm(m.measurement)}
                      >
                        <Trash2 size={13} />
                        {t('views.databases.detail.deleteMeasurement')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="audit-pagination">
            <span className="audit-pagination-info">
              {t('views.auditLog.totalRecords', { count: total })}
            </span>
            <div className="audit-pagination-controls">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {t('views.auditLog.prevPage')}
              </button>
              <span className="audit-pagination-info">
                {t('views.auditLog.pageOf', { page: currentPage, total: totalPages })}
              </span>
              <button
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t('views.auditLog.nextPage')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete Measurement Modal */}
      {deleteState.step !== 'idle' && (
        <div className="modal-overlay" onClick={deleteState.step === 'deleting' ? undefined : closeDeleteModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ marginTop: 0 }}>{t('views.databases.detail.deleteMeasurementTitle')}</h3>

            {deleteState.step === 'confirming' && (
              <>
                <p>{t('views.databases.detail.deleteMeasurementConfirm', { name: deleteState.measurement })}</p>
                <p className="text-muted" style={{ fontSize: 13 }}>{t('views.databases.detail.deleteMeasurementWarning')}</p>
                {deleteState.error && <p style={{ color: 'var(--color-danger, #e53e3e)', fontSize: 13 }}>{deleteState.error}</p>}
                <div className="modal-actions">
                  <button className="btn btn-outlined" onClick={closeDeleteModal}>{t('common.cancel')}</button>
                  <button className="btn btn-danger" onClick={runDryRun}>{t('views.databases.detail.deleteMeasurementPreview')}</button>
                </div>
              </>
            )}

            {(deleteState.step === 'preview' || deleteState.step === 'deleting') && deleteState.dryRunResult && (
              <>
                <p style={{ fontSize: 13 }}>{t('views.databases.detail.deleteMeasurementPreviewDesc', { name: deleteState.measurement })}</p>
                <table className="tokens-table" style={{ marginBottom: 12 }}>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 500 }}>{t('views.databases.detail.deletePreviewRows')}</td>
                      <td>{deleteState.dryRunResult.deleted_count.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 500 }}>{t('views.databases.detail.deletePreviewFiles')}</td>
                      <td>{deleteState.dryRunResult.affected_files}</td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ color: 'var(--color-danger, #e53e3e)', fontSize: 13 }}>{t('views.databases.detail.deleteMeasurementWarning')}</p>
                {deleteState.error && <p style={{ color: 'var(--color-danger, #e53e3e)', fontSize: 13 }}>{deleteState.error}</p>}
                <div className="modal-actions">
                  <button className="btn btn-outlined" onClick={closeDeleteModal} disabled={deleteState.step === 'deleting'}>{t('common.cancel')}</button>
                  <button className="btn btn-danger" onClick={confirmDelete} disabled={deleteState.step === 'deleting'}>
                    {deleteState.step === 'deleting' ? <><Loader2 size={14} className="spin" /> {t('views.databases.detail.deleting')}</> : t('common.confirmDelete')}
                  </button>
                </div>
              </>
            )}

            {deleteState.step === 'deleting' && !deleteState.dryRunResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0' }}>
                <Loader2 size={18} className="spin" />
                <span>{t('views.databases.detail.deleteMeasurementLoading')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DatabaseMeasurements;
