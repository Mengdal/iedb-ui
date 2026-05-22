import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import './Tokens.css';

interface Measurement {
  measurement: string;
  file_count: number;
  total_size_mb: number;
  storage_path: string;
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
                </tr>
              </thead>
              <tbody>
                {paged.map(m => (
                  <tr key={m.measurement}>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{m.measurement}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{m.file_count}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{m.total_size_mb.toFixed(1)} MB</td>
                    <td className="text-muted" style={{ fontSize: '12px', textAlign: 'center', minWidth: 0 }}>{m.storage_path}</td>
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
    </div>
  );
};

export default DatabaseMeasurements;
