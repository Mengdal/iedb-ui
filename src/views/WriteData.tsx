import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Plus, RefreshCw, Upload } from 'lucide-react';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';
import './WriteData.css';

interface DatabaseItem {
  name: string;
  measurement_count: number;
}

interface MeasurementItem {
  name: string;
}

type ImportMode = 'line-protocol' | 'csv' | 'parquet';

interface WriteState {
  database: string;
  lineProtocol: string;
  file: File | null;
  mode: ImportMode;
  message: string;
  type: 'idle' | 'success' | 'error' | 'info';
}

interface SampleDataset {
  id: string;
  name: string;
  description: string;
  sourceUrl?: string;
  inlineLp?: string;
  precision?: 'ns' | 'us' | 'ms' | 's';
}

const SAMPLE_DATASETS: SampleDataset[] = [
  {
    id: 'home-sensor',
    name: 'Get started home sensor data',
    description: 'Kitchen and Living Room temperature, humidity, and CO.',
    precision: 's',
    inlineLp: `home,room=Living\ Room temp=21.1,hum=35.9,co=0i 1774512000
home,room=Kitchen temp=21.0,hum=35.9,co=0i 1774512000
home,room=Living\ Room temp=22.2,hum=36.0,co=0i 1774522800
home,room=Kitchen temp=22.4,hum=36.0,co=0i 1774522800
home,room=Living\ Room temp=22.8,hum=36.2,co=9i 1774548000
home,room=Kitchen temp=23.3,hum=36.9,co=18i 1774548000`
  },
  {
    id: 'home-actions',
    name: 'Home sensor actions data',
    description: 'Companion actions and alerts generated from home sensor events.',
    precision: 's',
    inlineLp: `home_actions,room=Kitchen,action=cool,level=ok description="Temperature at or above 23°C (23°C). Cooling to 22°C." 1774515600
home_actions,room=Kitchen,action=alert,level=warn description="Carbon monoxide level above normal: 18 ppm." 1774548000
home_actions,room=Living\ Room,action=alert,level=warn description="Carbon monoxide level above normal: 17 ppm." 1774555200`
  },
  { 
    id: 'weather',
    name: 'NOAA Bay Area weather data',
    description: 'Daily weather metrics for Bay Area airports (large dataset).',
    precision: 's',
    sourceUrl: '/__sample_downloads/bay-area-weather.lp'
  },
  {
    id: 'eu-wind',
    name: 'European Union wind data',
    description: 'Hourly wind speed and direction with location tags.',
    precision: 's',
    sourceUrl: '/__sample_downloads/eu-wind-data.lp'
  },
  {
    id: 'bitcoin',
    name: 'Bitcoin price data',
    description: 'Historical bitcoin price dataset from CoinDesk samples.',
    precision: 'ns',
    sourceUrl: '/__sample_downloads/bitcoin.lp'
  },
  {
    id: 'random-numbers',
    name: 'Random numbers sample data',
    description: 'Two random numeric fields over a fixed time range.',
    precision: 'ns',
    sourceUrl: '/__sample_downloads/random-numbers.lp'
  }
];

const WriteData: React.FC = () => {
  const { activeServer } = useServers();
  const { t } = useTranslation();
  const [databases, setDatabases] = useState<DatabaseItem[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [measurements, setMeasurements] = useState<MeasurementItem[]>([]);

  const [isRefreshingDbs, setIsRefreshingDbs] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [selectedSampleId, setSelectedSampleId] = useState<string>(SAMPLE_DATASETS[0].id);
  const [isImportingSample, setIsImportingSample] = useState(false);

  const [writeState, setWriteState] = useState<WriteState>({
    database: '',
    lineProtocol: '',
    file: null,
    mode: 'line-protocol',
    message: '',
    type: 'idle'
  });

  const loadDatabases = async () => {
    if (!activeServer) return;
    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/api/v1/databases`, {
      headers: {
        'Authorization': `Bearer ${activeServer.token}`
      }
    });
    const data = await res.json();

    if (data && data.databases) {
      setDatabases(data.databases);
      if (data.databases.length > 0) {
        setSelectedDb(prev => prev || data.databases[0].name);
      } else {
        setSelectedDb('');
      }
    }
  };

  const handleRefreshDatabases = async () => {
    if (!activeServer) return;
    setIsRefreshingDbs(true);
    try {
      await loadDatabases();
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshingDbs(false);
    }
  };

  useEffect(() => {
    if (!activeServer) return;
    loadDatabases().catch(console.error);
  }, [activeServer]);

  useEffect(() => {
    if (!selectedDb || !activeServer) {
      setMeasurements([]);
      return;
    }

    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');
    fetch(`${baseUrl}/api/v1/databases/${selectedDb}/measurements`, {
      headers: {
        'Authorization': `Bearer ${activeServer.token}`
      }
    })
      .then(r => r.json())
      .then(data => {
        if (data && data.measurements) {
          setMeasurements(data.measurements);
        }
      })
      .catch(console.error);
  }, [selectedDb, activeServer]);

  useEffect(() => {
    setWriteState(prev => ({
      ...prev,
      database: prev.database || selectedDb || ''
    }));
  }, [selectedDb]);

  const parseWriteError = async (response: Response): Promise<string> => {
    const fallback = `Write failed (${response.status})`;

    try {
      const text = await response.text();
      if (!text) return fallback;

      try {
        const json = JSON.parse(text);
        return json.error || json.message || json.msg || fallback;
      } catch {
        return text;
      }
    } catch {
      return fallback;
    }
  };

  const acceptedFileTypes = useMemo(() => {
    if (writeState.mode === 'csv') return '.csv,text/csv';
    if (writeState.mode === 'parquet') return '.parquet,application/x-parquet,application/octet-stream';
    return '';
  }, [writeState.mode]);

  const selectedSample = useMemo(
    () => SAMPLE_DATASETS.find(s => s.id === selectedSampleId),
    [selectedSampleId]
  );

  const validateLineProtocol = (raw: string): { valid: boolean; message?: string } => {
    const lines = raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    if (lines.length === 0) {
      return { valid: false, message: t('views.writeData.pleaseEnterLineProtocolData') };
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const firstSpace = line.indexOf(' ');
      if (firstSpace <= 0) {
        return { valid: false, message: t('views.writeData.lineMissingFieldsSectionMessage', { line: i + 1 }) };
      }

      const measurementAndTags = line.slice(0, firstSpace);
      const rest = line.slice(firstSpace + 1).trim();
      if (!measurementAndTags || measurementAndTags.startsWith(',')) {
        return { valid: false, message: t('views.writeData.lineInvalidMeasurementMessage', { line: i + 1 }) };
      }

      if (!rest.includes('=')) {
        return { valid: false, message: t('views.writeData.lineFieldsMustBeKeyValueMessage', { line: i + 1 }) };
      }
    }

    return { valid: true };
  };

  const writeLineProtocolChunks = async (database: string, payload: string, precision: 'ns' | 'us' | 'ms' | 's' = 'ns') => {
    if (!activeServer) return;

    const lines = payload
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    const CHUNK_SIZE = 500;
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      chunks.push(lines.slice(i, i + CHUNK_SIZE).join('\n'));
    }

    const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');

    for (let idx = 0; idx < chunks.length; idx++) {
      let lastErr = '';
      let ok = false;

      for (let attempt = 1; attempt <= 2; attempt++) {
        const response = await fetch(`${baseUrl}/api/v1/write/line-protocol?precision=${precision}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'Authorization': `Bearer ${activeServer.token}`,
            'x-iedb-database': database
          },
          body: chunks[idx]
        });

        if (response.ok || response.status === 204) {
          ok = true;
          break;
        }

        lastErr = await parseWriteError(response);
      }

      if (!ok) {
        throw new Error(`Chunk ${idx + 1}/${chunks.length} failed: ${lastErr || 'unknown error'}`);
      }
    }

    return lines.length;
  };

  const importSampleDataset = async () => {
    if (!activeServer) return;

    const database = (writeState.database || selectedDb || '').trim();
    if (!database) {
      setWriteState(prev => ({ ...prev, type: 'error', message: t('views.writeData.pleaseSelectDatabaseFirst') }));
      return;
    }

    const sample = SAMPLE_DATASETS.find(s => s.id === selectedSampleId);
    if (!sample) {
      setWriteState(prev => ({ ...prev, type: 'error', message: t('views.writeData.pleaseSelectSampleDataset') }));
      return;
    }

    setIsImportingSample(true);
    setWriteState(prev => ({ ...prev, type: 'info', message: t('views.writeData.importingSampleMessage', { name: sample.name }) }));

    try {
      let payload = sample.inlineLp || '';
      if (!payload && sample.sourceUrl) {
        let responseText = '';
        try {
          const r = await fetch(sample.sourceUrl);
          if (!r.ok) {
            throw new Error(`Failed to download sample data: ${r.status}`);
          }
          responseText = await r.text();
        } catch (err) {
          throw new Error(t('views.writeData.browserBlockedDownloadMessage'));
        }
        payload = responseText;
      }

      const validation = validateLineProtocol(payload);
      if (!validation.valid) {
        throw new Error(validation.message || 'Sample data is invalid.');
      }

      const totalLines = await writeLineProtocolChunks(database, payload, sample.precision || 'ns');

      setWriteState(prev => ({
        ...prev,
        database,
        type: 'success',
        message: t('views.writeData.sampleImportedMessage', { name: sample.name, lines: totalLines, database })
      }));

      await handleRefreshDatabases();
      if (selectedDb !== database) {
        setSelectedDb(database);
      }
    } catch (err: any) {
      setWriteState(prev => ({
        ...prev,
        type: 'error',
        message: err?.message || t('views.writeData.failedToImportSampleMessage')
      }));
    } finally {
      setIsImportingSample(false);
    }
  };

  const writeData = async () => {
    if (!activeServer) return;

    const database = (writeState.database || selectedDb || '').trim();
    if (!database) {
      setWriteState(prev => ({ ...prev, type: 'error', message: t('views.writeData.pleaseSelectDatabaseFirst') }));
      return;
    }

    setIsWriting(true);

    try {
      const baseUrl = `${activeServer.protocol}${activeServer.host}`.replace(/\/$/, '');

      if (writeState.mode === 'line-protocol') {
        const payload = writeState.lineProtocol.trim();
        const validation = validateLineProtocol(payload);
        if (!validation.valid) {
          setWriteState(prev => ({ ...prev, type: 'error', message: validation.message || t('views.writeData.invalidLineProtocolMessage') }));
          return;
        }

        const lines = payload
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));

        setWriteState(prev => ({ ...prev, type: 'info', message: t('views.writeData.writingLinesMessage', { count: lines.length }) }));
        const totalLines = await writeLineProtocolChunks(database, payload);

        setWriteState(prev => ({
          ...prev,
          database,
          lineProtocol: '',
          type: 'success',
          message: t('views.writeData.wroteLinesSuccessMessage', { totalLines, database })
        }));
      } else {
        const file = writeState.file;
        if (!file) {
          setWriteState(prev => ({ ...prev, type: 'error', message: t('views.writeData.pleaseChooseFileFirst') }));
          return;
        }

        const isCsv = writeState.mode === 'csv';
        const endpoint = isCsv ? '/api/v1/import/csv' : '/api/v1/import/parquet';

        setWriteState(prev => ({
          ...prev,
          type: 'info',
          message: t('views.writeData.importingFileMessage', { fileName: file.name })
        }));

        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${activeServer.token}`,
            'x-iedb-database': database
          },
          body: formData
        });

        if (!response.ok) {
          const msg = await parseWriteError(response);
          throw new Error(
            msg || t('views.writeData.importFailedMessage', { mode: isCsv ? 'CSV' : 'Parquet' })
          );
        }

        setWriteState(prev => ({
          ...prev,
          database,
          file: null,
          type: 'success',
          message: t('views.writeData.importSucceededMessage', { mode: isCsv ? 'CSV' : 'Parquet', database })
        }));
      }

      await handleRefreshDatabases();
      if (selectedDb !== database) {
        setSelectedDb(database);
      }
    } catch (err: any) {
      setWriteState(prev => ({
        ...prev,
        type: 'error',
        message: err?.message || t('views.writeData.networkWriteErrorMessage')
      }));
    } finally {
      setIsWriting(false);
    }
  };

  if (!activeServer) {
    return (
      <div className="write-data-container write-data-empty">
        <h2>{t('views.writeData.noServerTitle')}</h2>
        <p>{t('views.writeData.noServerHint')}</p>
      </div>
    );
  }

  return (
    <div className="write-data-container">
      <div className="write-data-header">
        <div>
          <h1>{t('views.writeData.title')}</h1>
          <p>{t('views.writeData.subtitle')}</p>
        </div>
        <button
          className="icon-btn-small"
          title={t('views.writeData.refreshDatabasesTooltip')}
          onClick={handleRefreshDatabases}
          disabled={isRefreshingDbs}
          style={{ opacity: isRefreshingDbs ? 0.6 : 1 }}
        >
          <RefreshCw size={14} className={isRefreshingDbs ? 'spin' : ''} />
        </button>
      </div>

      <div className="write-data-panel">
        <div className="write-data-row">
          <label>{t('views.writeData.databaseLabel')}</label>
          <select
            className="write-data-select"
            value={writeState.database}
            onChange={(e) => {
              const value = e.target.value;
              setWriteState(prev => ({ ...prev, database: value, type: 'idle', message: '' }));
              setSelectedDb(value);
            }}
            disabled={isWriting}
          >
            {databases.map(db => (
              <option key={db.name} value={db.name}>
                {db.name}
              </option>
            ))}
            {databases.length === 0 && <option value="">No database</option>}
          </select>
        </div>

        <div className="write-data-row">
          <label>{t('views.writeData.importModeLabel')}</label>
          <div className="mode-switch">
            <button
              className={`mode-switch-btn ${writeState.mode === 'line-protocol' ? 'active' : ''}`}
              onClick={() => setWriteState(prev => ({ ...prev, mode: 'line-protocol', file: null, type: 'idle', message: '' }))}
              disabled={isWriting}
            >
              {t('views.writeData.lineProtocolLabel')}
            </button>
            <button
              className={`mode-switch-btn ${writeState.mode === 'csv' ? 'active' : ''}`}
              onClick={() => setWriteState(prev => ({ ...prev, mode: 'csv', type: 'idle', message: '' }))}
              disabled={isWriting}
            >
              {t('views.writeData.csvModeLabel')}
            </button>
            <button
              className={`mode-switch-btn ${writeState.mode === 'parquet' ? 'active' : ''}`}
              onClick={() => setWriteState(prev => ({ ...prev, mode: 'parquet', type: 'idle', message: '' }))}
              disabled={isWriting}
            >
              {t('views.writeData.parquetModeLabel')}
            </button>
          </div>
        </div>

        {writeState.mode === 'line-protocol' ? (
          <div className="write-data-row">
            <label>{t('views.writeData.lineProtocolLabel')}</label>
            <textarea
              className="write-data-textarea"
              placeholder="cpu,host=server01 usage=42.1 1711525000000000000"
              value={writeState.lineProtocol}
              onChange={(e) => setWriteState(prev => ({ ...prev, lineProtocol: e.target.value, type: 'idle', message: '' }))}
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="write-data-row">
            <label>{writeState.mode === 'csv' ? t('views.writeData.csvFileLabel') : t('views.writeData.parquetFileLabel')}</label>
            <div className="file-picker-wrap">
              <label className="file-picker-btn">
                <Upload size={14} />
                <span>{t('views.writeData.selectFile')}</span>
                <input
                  type="file"
                  accept={acceptedFileTypes}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setWriteState(prev => ({ ...prev, file, type: 'idle', message: '' }));
                  }}
                  disabled={isWriting}
                />
              </label>
              <span className="file-name">{writeState.file ? writeState.file.name : t('views.writeData.noFileSelected')}</span>
            </div>
          </div>
        )}

        <div className="write-data-actions">
          <button
            className="btn btn-primary"
            onClick={writeData}
            disabled={isWriting || !writeState.database || (writeState.mode === 'line-protocol' ? !writeState.lineProtocol.trim() : !writeState.file)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {isWriting ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            {isWriting
              ? (writeState.mode === 'line-protocol' ? t('views.writeData.writing') : t('views.writeData.importing'))
              : (writeState.mode === 'line-protocol' ? t('views.writeData.writeData') : t('views.writeData.importFile'))}
          </button>
          <span className="write-data-hint">
            {writeState.mode === 'line-protocol'
              ? t('views.writeData.supportCommentsHint')
              : t('views.writeData.uploadAndImportHint', { mode: writeState.mode.toUpperCase() })}
          </span>
        </div>

        {writeState.message && (
          <div className={`write-data-message ${writeState.type}`}>
            {writeState.message}
          </div>
        )}
      </div>

      <div className="write-data-samples">
        <div className="write-data-samples-header">
          <div>
            <h3>{t('views.writeData.sampleDatasetsTitle')}</h3>
            <p>{t('views.writeData.sampleDatasetsDesc')}</p>
          </div>
        </div>

        <div className="write-data-samples-body">
          <select
            className="write-data-select"
            value={selectedSampleId}
            onChange={(e) => setSelectedSampleId(e.target.value)}
            disabled={isImportingSample || isWriting}
          >
            {SAMPLE_DATASETS.map(sample => (
              <option key={sample.id} value={sample.id}>
                {sample.name}
              </option>
            ))}
          </select>

          <div className="sample-card">
            <div className="sample-info">
              <strong>{selectedSample?.name}</strong>
              <span>{selectedSample?.description}</span>
              {selectedSample?.sourceUrl && (
                <span className="sample-warning">{t('views.writeData.remoteSampleWarning')}</span>
              )}
            </div>
            <button
              className="btn btn-primary"
              onClick={importSampleDataset}
              disabled={isImportingSample || isWriting || !writeState.database}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isImportingSample ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              {isImportingSample ? t('views.writeData.importingSample') : t('views.writeData.importSample')}
            </button>
          </div>
        </div>
      </div>

      <div className="write-data-preview">
        <h3>{t('views.writeData.currentDatabaseMeasurementsTitle')}</h3>
        {measurements.length > 0 ? (
          <div className="measurement-list">
            {measurements.map(m => (
              <span key={m.name} className="measurement-pill">{m.name}</span>
            ))}
          </div>
        ) : (
          <p className="empty-text">{t('views.writeData.noMeasurementsFound')}</p>
        )}
      </div>
    </div>
  );
};

export default WriteData;
