import React, { useEffect, useRef, useState } from 'react';
import { History, Plus, RefreshCw, Play, Pencil, Trash2, X, AlertTriangle, Loader2, ShieldAlert, Info } from 'lucide-react';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';
import { useApiFetch } from '../hooks/useApiFetch';
import { formatTime } from '../utils/formatTime';
import ConfirmModal from '../components/ConfirmModal';
import SlideOutPanel from '../components/SlideOutPanel';
import './Tokens.css';
import './Plugins.css';

interface ContinuousQuery {
  id: number;
  name: string;
  description?: string | null;
  database: string;
  source_measurement: string;
  destination_measurement: string;
  query: string;
  interval: string;
  retention_days?: number | null;
  delete_source_after_days?: number | null;
  is_active: boolean;
  last_execution_time?: string | null;
  last_execution_status?: string | null;
  last_processed_time?: string | null;
  last_records_written?: number | null;
  created_at: string;
  updated_at: string;
}

interface CQExecution {
  id: number;
  query_id: number;
  execution_id: string;
  execution_time: string;
  status: string;
  start_time: string;
  end_time: string;
  records_read?: number | null;
  records_written: number;
  execution_duration_seconds: number;
  error_message?: string | null;
}

interface CQFormState {
  name: string;
  description: string;
  database: string;
  source_measurement: string;
  destination_measurement: string;
  query: string;
  interval: string;
  retention_days: string;
  delete_source_after_days: string;
  is_active: boolean;
}

interface AggOverride {
  field: string;
  function: string;
}

interface OhlcConfig {
  timeColumn: string;
  entityIdColumn: string;
  valueColumn: string;
  timeUnit: 'minute' | 'hour' | 'day' | 'month' | 'year';
  volumeColumn: string;
  lookbackWindow: number;
}

const AGG_OPTIONS = ['sum', 'avg', 'min', 'max', 'count', 'last', 'first', 'median', 'stddev'] as const;
const TIME_UNITS: OhlcConfig['timeUnit'][] = ['minute', 'hour', 'day', 'month', 'year'];
const BUCKET_OPTIONS = ['1m', '5m', '10m', '30m', '1h', '6h', '1d'] as const;

interface SpcConfig {
  bucketInterval: string;
  groupColumns: string[];
  valueColumn: string;
  sigmaMultiplier: number;
  upperSpec: number;
  lowerSpec: number;
  corrColumn: string;
  includeHistogram: boolean;
}

interface AerospaceConfig {
  timeColumn: string;
  valueColumn: string;
  secondMeasurement: string;
  joinKey: string;
  lookbackSeconds: number;
}

interface IotConfig {
  bucketInterval: string;
  entityColumn: string;
  valueColumn: string;
  driftThreshold: number;
}

interface DefenseConfig {
  bucketInterval: string;
  sensorColumn: string;
  classColumn: string;
  corrColumn: string;
}

function generateDownsampleSQL(params: {
  database: string;
  sourceMeasurement: string;
  defaultAgg: string;
  overrides: AggOverride[];
  bucketInterval: string;
  fieldSelection: 'all' | 'include' | 'exclude';
  fieldList: string[];
  availableFields: string[];
}): string {
  const { database, sourceMeasurement, defaultAgg, overrides, bucketInterval, fieldSelection, fieldList, availableFields } = params;
  const db = database || 'your_database';
  const src = sourceMeasurement || 'your_measurement';

  let fields: string[];
  if (fieldSelection === 'include') {
    fields = fieldList.filter(f => f !== 'time');
  } else if (fieldSelection === 'exclude') {
    const exclude = new Set(fieldList);
    fields = availableFields.filter(f => f !== 'time' && !exclude.has(f));
  } else {
    fields = availableFields.filter(f => f !== 'time');
  }

  if (fields.length === 0) {
    // 没有可用字段时生成默认模板
    return [
      'SELECT',
      '  time,',
      `  ${defaultAgg}(value) AS agg_value`,
      `FROM ${db}.${src}`,
      'WHERE time >= {start_time} AND time < {end_time}',
      bucketInterval ? `GROUP BY time(${bucketInterval})` : 'GROUP BY time',
    ].join('\n');
  }

  const overrideMap = new Map(overrides.map(o => [o.field, o.function]));
  const selectParts = fields.map(f => {
    const fn = overrideMap.get(f) || defaultAgg;
    return `  ${fn}(${f}) AS ${f}`;
  });

  return [
    'SELECT',
    '  time,',
    selectParts.join(',\n'),
    `FROM ${db}.${src}`,
    'WHERE time >= {start_time} AND time < {end_time}',
    bucketInterval ? `GROUP BY time(${bucketInterval})` : 'GROUP BY time',
  ].join('\n');
}

function generateOhlcSQL(config: OhlcConfig, database: string, sourceMeasurement: string): string {
  const db = database || 'your_database';
  const src = sourceMeasurement || 'your_measurement';
  const timeCol = config.timeColumn.trim() || 'time';
  const entityCol = config.entityIdColumn.trim() || 'code';
  const valueCol = config.valueColumn.trim() || 'price';
  const unit = config.timeUnit;
  const volumeCol = config.volumeColumn?.trim();
  const window = Math.max(1, Number(config.lookbackWindow) || 20);

  const volumeSelect = volumeCol ? `,\n  sum(${volumeCol}) AS total_volume` : '';
  const volumeSelectOuter = volumeCol ? ',\n  total_volume' : '';

  return `WITH ohlc AS (
  SELECT
    date_trunc('${unit}', ${timeCol}) AS bucket,
    ${entityCol},
    arg_min(${valueCol}, ${timeCol}) AS open,
    max(${valueCol}) AS high,
    min(${valueCol}) AS low,
    arg_max(${valueCol}, ${timeCol}) AS close${volumeSelect}
  FROM ${db}.${src}
  WHERE ${timeCol} >= {start_time} AND ${timeCol} < {end_time}
  GROUP BY bucket, ${entityCol}
),
log_returns AS (
  SELECT
    bucket,
    ${entityCol},
    open,
    high,
    low,
    close${volumeSelectOuter},
    LN(close / LAG(close) OVER (PARTITION BY ${entityCol} ORDER BY bucket)) AS ret
  FROM ohlc
)
SELECT
  CAST(bucket AS VARCHAR) AS bucket,
  ${entityCol},
  open,
  high,
  low,
  close${volumeSelectOuter},
  STDDEV(ret) OVER (PARTITION BY ${entityCol} ORDER BY bucket ROWS BETWEEN ${window - 1} PRECEDING AND CURRENT ROW) AS realized_vol
FROM log_returns`;
}

function generateSpcSQL(config: SpcConfig, database: string, sourceMeasurement: string): string {
  const db = database || 'your_database';
  const src = sourceMeasurement || 'your_measurement';
  const bucket = config.bucketInterval || '5m';
  const valueCol = config.valueColumn.trim() || 'value';
  const groups = Array.from(new Set(config.groupColumns.map(g => g.trim()).filter(Boolean)));
  const k = Number(config.sigmaMultiplier) || 3;
  const upper = Number(config.upperSpec) || 12.15;
  const lower = Number(config.lowerSpec) || 11.85;
  const corrCol = config.corrColumn?.trim();

  const selectLines = [
    `  time_bucket('${bucket}', time) AS bucket`,
    groups.length > 0 ? `  ${groups.join(', ')}` : '',
    `  AVG(${valueCol}) AS mean`,
    `  STDDEV(${valueCol}) AS sigma`,
    `  AVG(${valueCol}) - ${k} * STDDEV(${valueCol}) AS lcl`,
    `  AVG(${valueCol}) + ${k} * STDDEV(${valueCol}) AS ucl`,
    `  (${upper} - AVG(${valueCol})) / (${k} * STDDEV(${valueCol})) AS cpk_upper`,
    `  (AVG(${valueCol}) - ${lower}) / (${k} * STDDEV(${valueCol})) AS cpk_lower`,
    corrCol ? `  CORR(${corrCol}, ${valueCol}) AS corr` : '',
    config.includeHistogram ? `  HISTOGRAM(${valueCol}) AS value_dist` : '',
  ].filter(Boolean);

  const groupBy = groups.length > 0 ? `bucket, ${groups.join(', ')}` : 'bucket';

  return [
    'SELECT',
    selectLines.join(',\n'),
    `FROM ${db}.${src}`,
    'WHERE time >= {start_time} AND time < {end_time}',
    `GROUP BY ${groupBy}`,
  ].join('\n');
}

function generateAerospaceSQL(config: AerospaceConfig, database: string, sourceMeasurement: string): string {
  const db = database || 'your_database';
  const src = sourceMeasurement || 'your_measurement';
  const timeCol = config.timeColumn.trim() || 'time';
  const valueCol = config.valueColumn.trim() || 'value';
  const second = config.secondMeasurement?.trim();
  const joinKey = config.joinKey?.trim();
  const lookback = Math.max(1, Number(config.lookbackSeconds) || 1);

  if (!second || !joinKey) {
    return '-- 请填写第二张表和关联键以生成 ASOF 对齐 SQL (Please fill in second measurement and join key)';
  }

  // ASOF 双测量时间对齐
  return `SELECT
  a.${timeCol},
  a.${joinKey},
  a.${valueCol} AS primary_value,
  e.${valueCol} AS secondary_value
FROM ${db}.${src} a
ASOF LEFT JOIN ${db}.${second} e
  ON a.${joinKey} = e.${joinKey}
  AND a.${timeCol} >= e.${timeCol}
  AND e.${timeCol} BETWEEN {start_time} - INTERVAL '${lookback}s' AND {end_time}
WHERE true`;
}

function generateIotSQL(config: IotConfig, database: string, sourceMeasurement: string): string {
  const db = database || 'your_database';
  const src = sourceMeasurement || 'your_measurement';
  const bucket = config.bucketInterval || '1h';
  const entityCol = config.entityColumn.trim() || 'device';
  const valueCol = config.valueColumn.trim() || 'value';
  const threshold = Number(config.driftThreshold) || 0.001;

  return `SELECT
  time_bucket('${bucket}', time) AS bucket,
  ${entityCol},
  REGR_SLOPE(EXTRACT(EPOCH FROM time), ${valueCol}) AS trend_per_sec,
  CASE
    WHEN REGR_SLOPE(EXTRACT(EPOCH FROM time), ${valueCol}) > ${threshold} THEN 'degrading'
    ELSE 'normal'
  END AS health
FROM ${db}.${src}
WHERE time >= {start_time} AND time < {end_time}
GROUP BY bucket, ${entityCol}`;
}

function generateDefenseSQL(config: DefenseConfig, database: string, sourceMeasurement: string): string {
  const db = database || 'your_database';
  const src = sourceMeasurement || 'your_measurement';
  const bucket = config.bucketInterval || '1m';
  const sensorCol = config.sensorColumn.trim() || 'sensor';
  const classCol = config.classColumn.trim() || 'classification';
  const corrCol = config.corrColumn?.trim();

  const corrLine = corrCol ? `,\n  CORR(${corrCol}, ${sensorCol}) AS sensor_corr` : '';

  return `SELECT
  time_bucket('${bucket}', time) AS bucket,
  ${sensorCol},
  ENTROPY(${classCol}) AS class_entropy,
  COUNT(*) AS track_count${corrLine}
FROM ${db}.${src}
WHERE time >= {start_time} AND time < {end_time}
GROUP BY bucket, ${sensorCol}`;
}

const DEFAULT_CQ_QUERY = `SELECT
  time,
  AVG(value) AS avg_value
FROM production.cpu
WHERE time >= {start_time} AND time < {end_time}
GROUP BY time`;

const buildCQTemplate = (database?: string, measurement?: string) => {
  const db = database?.trim() || 'your_database';
  const src = measurement?.trim() || 'your_measurement';
  return `SELECT
  time,
  AVG(value) AS avg_value
FROM ${db}.${src}
WHERE time >= {start_time} AND time < {end_time}
GROUP BY time`;
};

const Plugins: React.FC = () => {
  const { activeServer } = useServers();
  const { t, i18n } = useTranslation();
  const { apiJson, featureNotEnabled } = useApiFetch({ handleLicense: false });

  const [cqs, setCqs] = useState<ContinuousQuery[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [databaseFilter, setDatabaseFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCQ, setEditingCQ] = useState<ContinuousQuery | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExecutingId, setIsExecutingId] = useState<number | null>(null);
  const [isTogglingStatusId, setIsTogglingStatusId] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<ContinuousQuery | null>(null);
  const [history, setHistory] = useState<CQExecution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
  const [availableMeasurements, setAvailableMeasurements] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ContinuousQuery | null>(null);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isLoadingMeasurements, setIsLoadingMeasurements] = useState(false);

  const cqSidebarBodyRef = useRef<HTMLDivElement | null>(null);
  const [cqFormErrorMsg, setCqFormErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastAutoQuery, setLastAutoQuery] = useState(DEFAULT_CQ_QUERY);

  // Downsample mode state
  const [formMode, setFormMode] = useState<'sql' | 'downsample' | 'ohlc' | 'spc' | 'aerospace' | 'iot' | 'defense'>('sql');
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [defaultAgg, setDefaultAgg] = useState('avg');
  const [aggOverrides, setAggOverrides] = useState<AggOverride[]>([]);
  const [bucketInterval, setBucketInterval] = useState('1h');
  const [fieldSelection, setFieldSelection] = useState<'all' | 'include' | 'exclude'>('all');
  const [fieldList, setFieldList] = useState<string[]>([]);

  // OHLC mode state
  const [ohlcConfig, setOhlcConfig] = useState<OhlcConfig>({
    timeColumn: 'time',
    entityIdColumn: 'code',
    valueColumn: 'price',
    timeUnit: 'hour',
    volumeColumn: '',
    lookbackWindow: 20,
  });

  // SPC mode state (statistical process control)
  const [spcConfig, setSpcConfig] = useState<SpcConfig>({
    bucketInterval: '5m',
    groupColumns: [],
    valueColumn: '',
    sigmaMultiplier: 3,
    upperSpec: 12.15,
    lowerSpec: 11.85,
    corrColumn: '',
    includeHistogram: false,
  });

  // ASOF dual-measurement time alignment mode state
  const [aerospaceConfig, setAerospaceConfig] = useState<AerospaceConfig>({
    timeColumn: 'time',
    valueColumn: '',
    secondMeasurement: '',
    joinKey: '',
    lookbackSeconds: 1,
  });

  // IoT mode state (regression drift detection)
  const [iotConfig, setIotConfig] = useState<IotConfig>({
    bucketInterval: '1h',
    entityColumn: '',
    valueColumn: '',
    driftThreshold: 0.001,
  });

  // Defense mode state (classification entropy)
  const [defenseConfig, setDefenseConfig] = useState<DefenseConfig>({
    bucketInterval: '1m',
    sensorColumn: '',
    classColumn: '',
    corrColumn: '',
  });

  // 配置变化后清除字段级校验错误
  useEffect(() => {
    setFieldErrors({});
  }, [formMode, aerospaceConfig, spcConfig, iotConfig, defenseConfig]);

  const [form, setForm] = useState<CQFormState>({
    name: '',
    description: '',
    database: '',
    source_measurement: '',
    destination_measurement: '',
    query: DEFAULT_CQ_QUERY,
    interval: '1h',
    retention_days: '',
    delete_source_after_days: '',
    is_active: true
  });

  const cqApiJson = async (path: string, init?: RequestInit) => {
    if (!activeServer) throw new Error('No active server');
    return apiJson(path, init);
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 2200);
  };

  const fetchCQs = async () => {
    if (!activeServer) {
      setCqs([]);
      return;
    }
    setIsLoading(true);
    setErrorMsg('');
    try {
      const params = new URLSearchParams();
      if (databaseFilter) params.set('database', databaseFilter);
      if (activeFilter !== 'all') params.set('is_active', activeFilter);
      const query = params.toString();
      const data = await cqApiJson(`/api/v1/continuous_queries${query ? `?${query}` : ''}`);
      if (data) {
        setCqs(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      if (!featureNotEnabled) {
        setErrorMsg(err.message || t('views.plugins.failedToLoad'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCQs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServer, databaseFilter, activeFilter]);

  useEffect(() => {
    const fetchDatabaseOptions = async () => {
      if (!isFormOpen || !activeServer) return;
      setIsLoadingDatabases(true);
      try {
        const data = await cqApiJson('/api/v1/databases');
        const names = Array.isArray(data?.databases) ? data.databases.map((d: { name: string }) => d.name) : [];
        setAvailableDatabases(names);
      } catch {
        setAvailableDatabases([]);
      } finally {
        setIsLoadingDatabases(false);
      }
    };

    fetchDatabaseOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen, activeServer]);

  useEffect(() => {
    const fetchMeasurementOptions = async () => {
      if (!isFormOpen || !activeServer || !form.database) {
        setAvailableMeasurements([]);
        return;
      }
      setIsLoadingMeasurements(true);
      try {
        const data = await cqApiJson(`/api/v1/databases/${encodeURIComponent(form.database)}/measurements`);
        const names = Array.isArray(data?.measurements) ? data.measurements.map((m: { name: string }) => m.name) : [];
        setAvailableMeasurements(names);
      } catch {
        setAvailableMeasurements([]);
      } finally {
        setIsLoadingMeasurements(false);
      }
    };

    fetchMeasurementOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen, activeServer, form.database]);

  // Fetch available columns (tags + fields) when database + source_measurement selected
  useEffect(() => {
    if (!isFormOpen || !activeServer || !form.database || !form.source_measurement) {
      setAvailableFields([]);
      return;
    }
    setIsLoadingFields(true);
    (async () => {
      try {
        // Schema endpoint returns { success, tags: string[], fields: string[] }
        const schemaData = await cqApiJson(`/api/v1/databases/${encodeURIComponent(form.database)}/measurements/${encodeURIComponent(form.source_measurement)}/schema`);
        if (schemaData?.success !== false) {
          const tags = Array.isArray(schemaData?.tags) ? schemaData.tags : [];
          const fields = Array.isArray(schemaData?.fields) ? schemaData.fields : [];
          // time + tags + fields 全部作为可选列（tag 也是列，可被 GROUP BY / 聚合引用）
          setAvailableFields(Array.from(new Set(['time', ...tags, ...fields])));
        } else {
          // 回退：尝试从 measurement 列表的 fields
          const data = await cqApiJson(`/api/v1/databases/${encodeURIComponent(form.database)}/measurements`);
          const m = data?.measurements?.find((mm: any) => mm.name === form.source_measurement);
          setAvailableFields(Array.isArray(m?.fields) ? m.fields : []);
        }
      } catch {
        setAvailableFields([]);
      } finally {
        setIsLoadingFields(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen, activeServer, form.database, form.source_measurement]);

  // 当可用字段刷新后（如切换来源表），把 OHLC 配置中已不存在的列名清空，
  // 避免下拉框残留上张表的默认值（code/price 等）。time 始终可用，保留。
  useEffect(() => {
    if (formMode !== 'ohlc' || isLoadingFields || availableFields.length === 0) return;
    setOhlcConfig(prev => {
      const has = (c: string) => !c || availableFields.includes(c);
      if (has(prev.timeColumn) && has(prev.entityIdColumn) && has(prev.valueColumn) && has(prev.volumeColumn)) return prev;
      return {
        ...prev,
        timeColumn: has(prev.timeColumn) ? prev.timeColumn : 'time',
        entityIdColumn: has(prev.entityIdColumn) ? prev.entityIdColumn : '',
        valueColumn: has(prev.valueColumn) ? prev.valueColumn : '',
        volumeColumn: has(prev.volumeColumn) ? prev.volumeColumn : '',
      };
    });
  }, [formMode, isLoadingFields, availableFields]);

  // 当可用字段刷新后，为新模式的已选列做兜底清理，避免下拉框残留上张表的列名
  useEffect(() => {
    if (isLoadingFields || availableFields.length === 0) return;
    const has = (c: string) => !c || availableFields.includes(c);
    if (formMode === 'spc') {
      setSpcConfig(prev => {
        if (has(prev.valueColumn) && has(prev.corrColumn) && prev.groupColumns.every(has)) return prev;
        return {
          ...prev,
          valueColumn: has(prev.valueColumn) ? prev.valueColumn : '',
          corrColumn: has(prev.corrColumn) ? prev.corrColumn : '',
          groupColumns: prev.groupColumns.filter(has),
        };
      });
    } else if (formMode === 'aerospace') {
      setAerospaceConfig(prev => {
        if (has(prev.timeColumn) && has(prev.valueColumn) && has(prev.joinKey)) return prev;
        return {
          ...prev,
          timeColumn: has(prev.timeColumn) ? prev.timeColumn : 'time',
          valueColumn: has(prev.valueColumn) ? prev.valueColumn : '',
          joinKey: has(prev.joinKey) ? prev.joinKey : '',
        };
      });
    } else if (formMode === 'iot') {
      setIotConfig(prev => {
        if (has(prev.entityColumn) && has(prev.valueColumn)) return prev;
        return {
          ...prev,
          entityColumn: has(prev.entityColumn) ? prev.entityColumn : '',
          valueColumn: has(prev.valueColumn) ? prev.valueColumn : '',
        };
      });
    } else if (formMode === 'defense') {
      setDefenseConfig(prev => {
        if (has(prev.sensorColumn) && has(prev.classColumn) && has(prev.corrColumn)) return prev;
        return {
          ...prev,
          sensorColumn: has(prev.sensorColumn) ? prev.sensorColumn : '',
          classColumn: has(prev.classColumn) ? prev.classColumn : '',
          corrColumn: has(prev.corrColumn) ? prev.corrColumn : '',
        };
      });
    }
  }, [formMode, isLoadingFields, availableFields]);

  // Auto-generate SQL when downsample / ohlc / spc / asof / iot / defense params change
  useEffect(() => {
    if (formMode === 'ohlc') {
      const sql = generateOhlcSQL(ohlcConfig, form.database, form.source_measurement);
      setForm(prev => ({ ...prev, query: sql }));
      return;
    }
    if (formMode === 'spc') {
      const sql = generateSpcSQL(spcConfig, form.database, form.source_measurement);
      setForm(prev => ({ ...prev, query: sql }));
      return;
    }
    if (formMode === 'aerospace') {
      const sql = generateAerospaceSQL(aerospaceConfig, form.database, form.source_measurement);
      setForm(prev => ({ ...prev, query: sql }));
      return;
    }
    if (formMode === 'iot') {
      const sql = generateIotSQL(iotConfig, form.database, form.source_measurement);
      setForm(prev => ({ ...prev, query: sql }));
      return;
    }
    if (formMode === 'defense') {
      const sql = generateDefenseSQL(defenseConfig, form.database, form.source_measurement);
      setForm(prev => ({ ...prev, query: sql }));
      return;
    }
    if (formMode !== 'downsample') return;
    const sql = generateDownsampleSQL({
      database: form.database,
      sourceMeasurement: form.source_measurement,
      defaultAgg,
      overrides: aggOverrides,
      bucketInterval,
      fieldSelection,
      fieldList,
      availableFields,
    });
    setForm(prev => ({ ...prev, query: sql }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formMode, form.database, form.source_measurement, defaultAgg, aggOverrides, bucketInterval, fieldSelection, fieldList, availableFields, ohlcConfig, spcConfig, aerospaceConfig, iotConfig, defenseConfig]);

  const openCreate = () => {
    setEditingCQ(null);
    const initialTemplate = buildCQTemplate('', '');
    setForm({
      name: '',
      description: '',
      database: '',
      source_measurement: '',
      destination_measurement: '',
      query: initialTemplate,
      interval: '1h',
      retention_days: '',
      delete_source_after_days: '',
      is_active: true
    });
    setLastAutoQuery(initialTemplate);
    setCqFormErrorMsg('');
    setFieldErrors({});
    setFormMode('sql');
    setDefaultAgg('avg');
    setAggOverrides([]);
    setBucketInterval('1h');
    setFieldSelection('all');
    setFieldList([]);
    setAvailableFields([]);
    setOhlcConfig({
      timeColumn: 'time',
      entityIdColumn: 'code',
      valueColumn: 'price',
      timeUnit: 'hour',
      volumeColumn: '',
      lookbackWindow: 20,
    });
    setSpcConfig({
      bucketInterval: '5m',
      groupColumns: [],
      valueColumn: '',
      sigmaMultiplier: 3,
      upperSpec: 12.15,
      lowerSpec: 11.85,
      corrColumn: '',
      includeHistogram: false,
    });
    setAerospaceConfig({
      timeColumn: 'time',
      valueColumn: '',
      secondMeasurement: '',
      joinKey: '',
      lookbackSeconds: 1,
    });
    setIotConfig({
      bucketInterval: '1h',
      entityColumn: '',
      valueColumn: '',
      driftThreshold: 0.001,
    });
    setDefenseConfig({
      bucketInterval: '1m',
      sensorColumn: '',
      classColumn: '',
      corrColumn: '',
    });
    setIsFormOpen(true);
    setTimeout(() => {
      cqSidebarBodyRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const openEdit = (cq: ContinuousQuery) => {
    setEditingCQ(cq);
    setForm({
      name: cq.name || '',
      description: cq.description || '',
      database: cq.database || '',
      source_measurement: cq.source_measurement || '',
      destination_measurement: cq.destination_measurement || '',
      query: cq.query || '',
      interval: cq.interval || '1h',
      retention_days: cq.retention_days == null ? '' : String(cq.retention_days),
      delete_source_after_days: cq.delete_source_after_days == null ? '' : String(cq.delete_source_after_days),
      is_active: !!cq.is_active
    });
    setLastAutoQuery(cq.query || '');
    setCqFormErrorMsg('');
    setFieldErrors({});
    setFormMode('sql');
    setOhlcConfig({
      timeColumn: 'time',
      entityIdColumn: 'code',
      valueColumn: 'price',
      timeUnit: 'hour',
      volumeColumn: '',
      lookbackWindow: 20,
    });
    setSpcConfig({
      bucketInterval: '5m',
      groupColumns: [],
      valueColumn: '',
      sigmaMultiplier: 3,
      upperSpec: 12.15,
      lowerSpec: 11.85,
      corrColumn: '',
      includeHistogram: false,
    });
    setAerospaceConfig({
      timeColumn: 'time',
      valueColumn: '',
      secondMeasurement: '',
      joinKey: '',
      lookbackSeconds: 1,
    });
    setIotConfig({
      bucketInterval: '1h',
      entityColumn: '',
      valueColumn: '',
      driftThreshold: 0.001,
    });
    setDefenseConfig({
      bucketInterval: '1m',
      sensorColumn: '',
      classColumn: '',
      corrColumn: '',
    });
    setIsFormOpen(true);
    setTimeout(() => {
      cqSidebarBodyRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingCQ(null);
    setCqFormErrorMsg('');
    setFieldErrors({});
  };

  const handleDatabaseChange = (database: string) => {
    const shouldAutoUpdateTemplate = !editingCQ && (form.query === lastAutoQuery || !form.query.trim());
    const nextTemplate = buildCQTemplate(database, '');

    setForm((prev) => ({
      ...prev,
      database,
      source_measurement: '',
      query: shouldAutoUpdateTemplate ? nextTemplate : prev.query,
    }));

    if (shouldAutoUpdateTemplate) {
      setLastAutoQuery(nextTemplate);
    }
  };

  const handleSourceMeasurementChange = (sourceMeasurement: string) => {
    const shouldAutoUpdateTemplate = !editingCQ && (form.query === lastAutoQuery || !form.query.trim());
    const nextTemplate = buildCQTemplate(form.database, sourceMeasurement);

    setForm((prev) => ({
      ...prev,
      source_measurement: sourceMeasurement,
      query: shouldAutoUpdateTemplate ? nextTemplate : prev.query,
    }));

    if (shouldAutoUpdateTemplate) {
      setLastAutoQuery(nextTemplate);
    }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeServer) return;

    // 结构化模式必填字段校验，错误直接挂在对应字段下方
    const errors: Record<string, string> = {};
    if (formMode === 'aerospace') {
      if (!aerospaceConfig.valueColumn.trim()) {
        errors['aero-value'] = t('views.plugins.aeroValueRequired', '请选择数值列');
      }
      if (!aerospaceConfig.secondMeasurement.trim()) {
        errors['aero-second'] = t('views.plugins.aeroSecondRequired', '请选择第二张表');
      }
      if (!aerospaceConfig.joinKey.trim()) {
        errors['aero-join'] = t('views.plugins.aeroJoinRequired', '请选择关联键');
      }
    }
    if (formMode === 'spc') {
      if (!spcConfig.valueColumn.trim()) {
        errors['spc-value'] = t('views.plugins.spcValueRequired', '请选择数值列');
      }
    }
    if (formMode === 'iot') {
      if (!iotConfig.entityColumn.trim()) {
        errors['iot-entity'] = t('views.plugins.iotEntityRequired', '请选择实体列');
      }
      if (!iotConfig.valueColumn.trim()) {
        errors['iot-value'] = t('views.plugins.iotValueRequired', '请选择数值列');
      }
    }
    if (formMode === 'defense') {
      if (!defenseConfig.sensorColumn.trim()) {
        errors['def-sensor'] = t('views.plugins.defSensorRequired', '请选择传感器/实体列');
      }
      if (!defenseConfig.classColumn.trim()) {
        errors['def-class'] = t('views.plugins.defClassRequired', '请选择分类列');
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setTimeout(() => {
        const firstId = Object.keys(errors)[0];
        document.getElementById(firstId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
      return;
    }

    setIsSaving(true);
    setCqFormErrorMsg('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        database: form.database.trim(),
        source_measurement: form.source_measurement.trim(),
        destination_measurement: form.destination_measurement.trim(),
        query: form.query,
        interval: form.interval.trim(),
        retention_days: form.retention_days.trim() ? Number(form.retention_days) : null,
        delete_source_after_days: form.delete_source_after_days.trim() ? Number(form.delete_source_after_days) : null,
        is_active: form.is_active
      };

      if (editingCQ) {
        await cqApiJson(`/api/v1/continuous_queries/${editingCQ.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await cqApiJson('/api/v1/continuous_queries', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      closeForm();
      fetchCQs();
    } catch (err: any) {
      setCqFormErrorMsg(err.message || t('views.plugins.failedToSave'));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCQ = async (cq: ContinuousQuery) => {
    try {
      await cqApiJson(`/api/v1/continuous_queries/${cq.id}`, { method: 'DELETE' });
      fetchCQs();
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToDelete'));
    }
  };

  const executeCQ = async (cq: ContinuousQuery, dryRun = false) => {
    setIsExecutingId(cq.id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await cqApiJson(`/api/v1/continuous_queries/${cq.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ dry_run: dryRun })
      });
      showSuccess(t('views.plugins.cqStartedSuccess', { name: cq.name }));
      fetchCQs();
      if (historyFor?.id === cq.id) {
        viewHistory(cq);
      }
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToExecute'));
    } finally {
      setIsExecutingId(null);
    }
  };

  const toggleCQStatus = async (cq: ContinuousQuery) => {
    setIsTogglingStatusId(cq.id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await cqApiJson(`/api/v1/continuous_queries/${cq.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: cq.name,
          description: cq.description || null,
          database: cq.database,
          source_measurement: cq.source_measurement,
          destination_measurement: cq.destination_measurement,
          query: cq.query,
          interval: cq.interval,
          retention_days: cq.retention_days ?? null,
          delete_source_after_days: cq.delete_source_after_days ?? null,
          is_active: !cq.is_active,
        }),
      });
      showSuccess(cq.is_active ? t('views.plugins.cqDisabledSuccess', { name: cq.name }) : t('views.plugins.cqEnabledSuccess', { name: cq.name }));
      fetchCQs();
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToToggle'));
    } finally {
      setIsTogglingStatusId(null);
    }
  };

  const viewHistory = async (cq: ContinuousQuery) => {
    setHistoryFor(cq);
    setHistoryLoading(true);
    try {
      const data = await cqApiJson(`/api/v1/continuous_queries/${cq.id}/executions?limit=30`);
      setHistory(Array.isArray(data?.executions) ? data.executions : []);
    } catch (err: any) {
      setErrorMsg(err.message || t('views.plugins.failedToLoadHistory'));
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="page-container plugins-cq-page">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('views.plugins.title')}</h1>
          <p>{t('views.plugins.pageSubtitle')}</p>
        </div>
      </div>

      <div className="page-section">
        <div className="section-header">
          <div className="section-header-text cq-section-left">
            <h2>{t('views.plugins.sectionTitle')}</h2>
            <p className="cq-desc">{t('views.plugins.sectionDesc')}</p>
          </div>
          <div className="page-toolbar cq-toolbar">
            <input
              className="page-search"
              type="search"
              value={databaseFilter}
              onChange={(e) => setDatabaseFilter(e.target.value)}
              placeholder={t('views.plugins.filterPlaceholder')}
            />
            <select
              className="page-search cq-toolbar-select"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as 'all' | 'true' | 'false')}
            >
              <option value="all">{t('views.plugins.allStatus')}</option>
              <option value="true">{t('views.plugins.activeOnly')}</option>
              <option value="false">{t('views.plugins.inactiveOnly')}</option>
            </select>
            <button type="button" className="btn btn-outlined" onClick={() => fetchCQs()} disabled={!activeServer || isLoading}>
              <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
              {t('views.plugins.refresh')}
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate} disabled={!activeServer}>
              <Plus size={16} />
              {t('views.plugins.newCQ')}
            </button>
          </div>
        </div>

        {!activeServer && (
          <div className="tokens-empty">
            <AlertTriangle size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            {t('views.plugins.selectServerHint')}
          </div>
        )}

        {activeServer && errorMsg && <div className="tokens-alert">{errorMsg}</div>}
        {activeServer && successMsg && <div className="tokens-alert cq-success-alert">{successMsg}</div>}

        {activeServer && featureNotEnabled && (
          <div className="audit-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.plugins.featureNotEnabled')}</p>
          </div>
        )}

        {activeServer && !featureNotEnabled && isLoading && cqs.length === 0 && !errorMsg && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.plugins.loadingCqs')}
          </div>
        )}

        {activeServer && !featureNotEnabled && !isLoading && !errorMsg && cqs.length === 0 && (
          <div className="tokens-empty">{t('views.plugins.noCQsYet')}</div>
        )}

        {activeServer && !featureNotEnabled && cqs.length > 0 && (
          <div className="tokens-table-wrap">
            <table className="tokens-table">
              <colgroup>
                <col className="cq-col-name" />
                <col className="cq-col-db" />
                <col className="cq-col-source" />
                <col className="cq-col-destination" />
                <col className="cq-col-interval" />
                <col className="cq-col-status" />
                <col className="cq-col-last-run" />
                <col className="cq-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('views.plugins.name')}</th>
                  <th>{t('views.plugins.db')}</th>
                  <th>{t('views.plugins.source')}</th>
                  <th>{t('views.plugins.destination')}</th>
                  <th>{t('views.plugins.interval')}</th>
                  <th>{t('views.plugins.status')}</th>
                  <th>{t('views.plugins.lastRun')}</th>
                  <th>{t('views.plugins.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {cqs.map(cq => (
                  <tr key={cq.id}>
                    <td>{cq.name}</td>
                    <td>{cq.database}</td>
                    <td>{cq.source_measurement}</td>
                    <td>{cq.destination_measurement}</td>
                    <td>{cq.interval}</td>
                    <td>
                      <button
                        type="button"
                        className={`cq-status-switch ${cq.is_active ? 'on' : 'off'}`}
                        onClick={() => toggleCQStatus(cq)}
                        disabled={isTogglingStatusId === cq.id}
                        title={
                          isTogglingStatusId === cq.id
                            ? t('views.plugins.updatingStatus')
                            : cq.is_active
                            ? t('views.plugins.activeClickToDisable')
                            : t('views.plugins.inactiveClickToEnable')
                        }
                        aria-label={cq.is_active ? t('views.plugins.disableCq') : t('views.plugins.enableCq')}
                      >
                        <span className="cq-toggle-track" aria-hidden>
                          <span className="cq-toggle-thumb" />
                        </span>
                      </button>
                    </td>
                    <td>{formatTime(cq.last_execution_time, i18n.language)}</td>
                    <td>
                      <div className="token-actions">
                        <button type="button" className="icon-btn" title={t('views.plugins.actionRun')} onClick={() => executeCQ(cq, false)} disabled={isExecutingId === cq.id || !cq.is_active}>
                          <Play size={16} />
                        </button>
                        <button type="button" className="icon-btn" title={t('views.plugins.actionHistory')} onClick={() => viewHistory(cq)}>
                          <History size={16} />
                        </button>
                        <button type="button" className="icon-btn" title={t('views.plugins.actionEdit')} onClick={() => openEdit(cq)}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" className="icon-btn danger" title={t('views.plugins.actionDelete')} onClick={() => setDeleteTarget(cq)}>
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
      </div>

      <SlideOutPanel
        open={isFormOpen}
        onClose={closeForm}
        width={720}
        title={editingCQ ? t('views.plugins.editCQ') : t('views.plugins.createCQ')}
        bodyRef={cqSidebarBodyRef}
        footer={
          <>
            <button type="button" className="btn btn-outlined" onClick={closeForm}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="cq-form" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              {isSaving ? t('views.plugins.saving') : editingCQ ? t('views.plugins.save') : t('views.plugins.create')}
            </button>
          </>
        }
      >
        <form id="cq-form" onSubmit={submitForm}>
                {cqFormErrorMsg && (
                  <div className="tokens-alert" style={{ marginBottom: 16 }}>
                    {cqFormErrorMsg}
                  </div>
                )}

                <div className="cq-form-grid">

                  {/* Section: 基本信息 */}
                  <div className="cq-section">
                    <div className="cq-section-title">{t('views.plugins.sectionBasicInfo', '基本信息')}</div>
                    <div className="form-group">
                      <label htmlFor="cq-name">{t('views.plugins.name')}</label>
                      <input id="cq-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder={t('views.plugins.namePlaceholder')} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="cq-desc">{t('views.plugins.description')}</label>
                      <textarea
                        id="cq-desc"
                        className="cq-desc-input"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder={t('views.plugins.optional')}
                      />
                    </div>
                  </div>

                  {/* Section: 来源与目标 */}
                  <div className="cq-section">
                    <div className="cq-section-title">{t('views.plugins.sectionSourceTarget', '来源与目标')}</div>
                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="cq-database">{t('views.plugins.database')}</label>
                        <select
                          id="cq-database"
                          value={form.database}
                          onChange={(e) => handleDatabaseChange(e.target.value)}
                          required
                        >
                          <option value="">{isLoadingDatabases ? t('views.plugins.loadingDatabases') : t('views.plugins.selectDatabase')}</option>
                          {availableDatabases.map((db) => (
                            <option key={db} value={db}>{db}</option>
                          ))}
                          {form.database && !availableDatabases.includes(form.database) && (
                            <option value={form.database}>{form.database}</option>
                          )}
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="cq-src">{t('views.plugins.sourceMeasurement')}</label>
                        <select
                          id="cq-src"
                          value={form.source_measurement}
                          onChange={(e) => handleSourceMeasurementChange(e.target.value)}
                          required
                          disabled={!form.database || isLoadingMeasurements}
                        >
                          <option value="">
                            {!form.database
                              ? t('views.plugins.selectDatabaseFirst')
                              : isLoadingMeasurements
                              ? t('views.plugins.loadingMeasurements')
                              : t('views.plugins.selectSourceMeasurement')}
                          </option>
                          {availableMeasurements.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          {form.source_measurement && !availableMeasurements.includes(form.source_measurement) && (
                            <option value={form.source_measurement}>{form.source_measurement}</option>
                          )}
                        </select>
                      </div>
                    </div>
                    <div className="form-group">
                      <label htmlFor="cq-dst">{t('views.plugins.destinationMeasurement')}</label>
                      <input id="cq-dst" type="text" value={form.destination_measurement} onChange={(e) => setForm({ ...form, destination_measurement: e.target.value })} required placeholder={t('views.plugins.targetMeasurementPlaceholder', '与来源相同时可选')} />
                    </div>
                  </div>

                  {/* Section: 调度 */}
                  <div className="cq-section">
                    <div className="cq-section-title">{t('views.plugins.sectionSchedule', '调度')}</div>
                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="cq-interval">{t('views.plugins.interval')}</label>
                        <input id="cq-interval" type="text" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })} required placeholder={t('views.plugins.intervalPlaceholder')} />
                      </div>
                      <div className="form-group">
                        <label htmlFor="cq-retention">{t('views.plugins.retentionDays')}</label>
                        <input id="cq-retention" type="number" min={0} value={form.retention_days} onChange={(e) => setForm({ ...form, retention_days: e.target.value })} placeholder={t('views.plugins.optional')} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label htmlFor="cq-del-src">{t('views.plugins.deleteSourceAfter')}</label>
                      <input id="cq-del-src" type="number" min={0} value={form.delete_source_after_days} onChange={(e) => setForm({ ...form, delete_source_after_days: e.target.value })} placeholder={t('views.plugins.optional')} />
                    </div>
                  </div>

                  {/* Mode toggle */}
                  <div className="cq-section">
                    <div className="cq-section-title cq-section-title-with-hint">
                      {t('views.plugins.sectionQueryMode', '查询模式')}
                      <span className="rbac-hint">
                        {formMode === 'sql'
                          ? t('views.plugins.sqlModeHint', '手写 SQL，灵活配置查询逻辑')
                          : formMode === 'downsample'
                          ? t('views.plugins.dsModeHint', '结构化配置，自动生成 SQL')
                          : formMode === 'ohlc'
                          ? t('views.plugins.ohlcModeHint', 'OHLC 结构化配置，自动生成 SQL')
                          : formMode === 'spc'
                          ? t('views.plugins.spcModeHint', '统计过程控制：均值/σ、控制限、Cpk 与相关性')
                          : formMode === 'aerospace'
                          ? t('views.plugins.aerospaceModeHint', 'ASOF 双测量时间对齐')
                          : formMode === 'iot'
                          ? t('views.plugins.iotModeHint', '回归漂移检测：REGR_SLOPE 趋势与 health 标记')
                          : t('views.plugins.defenseModeHint', '分类混合熵：ENTROPY 与 track_count')}
                      </span>
                    </div>
                    <div className="cq-mode-toggle">
                      <button type="button" className={`cq-mode-btn ${formMode === 'sql' ? 'active' : ''}`} onClick={() => setFormMode('sql')}>{t('views.plugins.sqlMode', 'SQL')}</button>
                      <button type="button" className={`cq-mode-btn ${formMode === 'downsample' ? 'active' : ''}`} onClick={() => setFormMode('downsample')}>{t('views.plugins.downsampleMode', 'Downsample')}</button>
                      <button type="button" className={`cq-mode-btn ${formMode === 'ohlc' ? 'active' : ''}`} onClick={() => setFormMode('ohlc')}>{t('views.plugins.ohlcMode', 'OHLC')}</button>
                      <button type="button" className={`cq-mode-btn ${formMode === 'spc' ? 'active' : ''}`} onClick={() => setFormMode('spc')}>{t('views.plugins.spcMode', 'SPC')}</button>
                      <button type="button" className={`cq-mode-btn ${formMode === 'aerospace' ? 'active' : ''}`} onClick={() => setFormMode('aerospace')}>{t('views.plugins.aerospaceMode', 'ASOF')}</button>
                      <button type="button" className={`cq-mode-btn ${formMode === 'iot' ? 'active' : ''}`} onClick={() => setFormMode('iot')}>{t('views.plugins.iotMode', 'IoT Drift')}</button>
                      <button type="button" className={`cq-mode-btn ${formMode === 'defense' ? 'active' : ''}`} onClick={() => setFormMode('defense')}>{t('views.plugins.defenseMode', 'Entropy')}</button>
                    </div>
                  </div>

                  {/* Downsample: 聚合配置 */}
                  {formMode === 'downsample' && (
                    <>
                      <div className="cq-section">
                        <div className="cq-section-title">{t('views.plugins.sectionAggregation', '聚合配置')}</div>
                        <div className="cq-form-two-cols">
                          <div className="form-group">
                            <label>{t('views.plugins.defaultAgg', '默认聚合')}</label>
                            <select value={defaultAgg} onChange={e => setDefaultAgg(e.target.value)}>
                              {AGG_OPTIONS.map(fn => <option key={fn} value={fn}>{fn.toUpperCase()}</option>)}
                            </select>
                            <p className="rbac-hint">{t('views.plugins.defaultAggHint', '应用到所有字段，除非被字段级覆盖')}</p>
                          </div>
                          <div className="form-group">
                            <label>{t('views.plugins.bucketInterval', '聚合桶')}</label>
                            <select value={bucketInterval} onChange={e => setBucketInterval(e.target.value)}>
                              <option value="1m">1 分钟</option>
                              <option value="5m">5 分钟</option>
                              <option value="10m">10 分钟</option>
                              <option value="30m">30 分钟</option>
                              <option value="1h">1 小时</option>
                              <option value="6h">6 小时</option>
                              <option value="1d">1 天</option>
                            </select>
                            <p className="rbac-hint">GROUP BY time 的桶大小</p>
                          </div>
                        </div>

                        <div className="form-group">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <label style={{ margin: 0 }}>{t('views.plugins.fieldOverrides', '字段级聚合覆盖')}</label>
                            <button type="button" className="btn btn-outlined btn-small" onClick={() => setAggOverrides([...aggOverrides, { field: '', function: defaultAgg }])}><Plus size={14} /> 添加字段覆盖</button>
                          </div>
                          {aggOverrides.length === 0 && <p className="rbac-hint" style={{ margin: '4px 0' }}>所有字段默认使用 {defaultAgg.toUpperCase()} 聚合。可添加字段级覆盖：</p>}
                          {aggOverrides.map((o, i) => (
                            <div key={i} className="ds-override-row">
                              <select value={o.field} onChange={e => { const n = [...aggOverrides]; n[i] = { ...n[i], field: e.target.value }; setAggOverrides(n); }}>
                                <option value="">选择字段</option>
                                {availableFields.filter(f => f !== 'time' && !aggOverrides.some((a, j) => j !== i && a.field === f)).map(f => <option key={f} value={f}>{f}</option>)}
                              </select>
                              <select value={o.function} onChange={e => { const n = [...aggOverrides]; n[i] = { ...n[i], function: e.target.value }; setAggOverrides(n); }}>
                                {AGG_OPTIONS.map(fn => <option key={fn} value={fn}>{fn.toUpperCase()}</option>)}
                              </select>
                              <button type="button" className="icon-btn danger" onClick={() => setAggOverrides(aggOverrides.filter((_, j) => j !== i))}><X size={16} /></button>
                            </div>
                          ))}
                        </div>

                        <div className="form-group">
                          <label>{t('views.plugins.sectionFieldSelection', '字段选择')}</label>
                          <div className="ds-field-select-mode">
                            <label><input type="radio" name="dsFieldSel" checked={fieldSelection === 'all'} onChange={() => setFieldSelection('all')} /> 所有字段</label>
                            <label><input type="radio" name="dsFieldSel" checked={fieldSelection === 'include'} onChange={() => setFieldSelection('include')} /> 仅包含</label>
                            <label><input type="radio" name="dsFieldSel" checked={fieldSelection === 'exclude'} onChange={() => setFieldSelection('exclude')} /> 排除</label>
                          </div>
                          {fieldSelection !== 'all' && (
                            <div className="ds-field-checkboxes">
                              {isLoadingFields && <span className="rbac-hint">加载字段中...</span>}
                              {!isLoadingFields && availableFields.length === 0 && <p className="rbac-hint">未获取到字段列表，请先选择数据库和来源表。</p>}
                              {availableFields.filter(f => f !== 'time').map(f => (
                                <label key={f} className="ds-field-checkbox">
                                  <input type="checkbox" checked={fieldList.includes(f)} onChange={e => { if (e.target.checked) setFieldList([...fieldList, f]); else setFieldList(fieldList.filter(x => x !== f)); }} /> {f}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* OHLC: 配置 */}
                  {formMode === 'ohlc' && (
                    <div className="cq-section">
                      <div className="cq-section-title">{t('views.plugins.sectionOhlc', 'OHLC 配置')}</div>

                      {isLoadingFields && <p className="rbac-hint">{t('views.plugins.loadingFields', '正在加载字段列表…')}</p>}
                      {!isLoadingFields && availableFields.length === 0 && (
                        <p className="rbac-hint">{t('views.plugins.noFieldsHint', '未获取到字段列表，请先选择数据库和来源表。')}</p>
                      )}

                      <div className="cq-form-two-cols">
                        <div className="form-group">
                          <label htmlFor="ohlc-unit">{t('views.plugins.ohlcTimeUnit', '时间粒度')}</label>
                          <select
                            id="ohlc-unit"
                            value={ohlcConfig.timeUnit}
                            onChange={(e) => setOhlcConfig(prev => ({ ...prev, timeUnit: e.target.value as OhlcConfig['timeUnit'] }))}
                          >
                            {TIME_UNITS.map(u => (
                              <option key={u} value={u}>{t(`views.plugins.ohlcUnit.${u}`, u)}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group">
                          <label htmlFor="ohlc-lookback" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {t('views.plugins.ohlcLookbackWindow', '波动率回望窗口')}
                            <span title={t('views.plugins.ohlcLookbackHint', '控制 STDDEV 窗口大小（ROWS BETWEEN N-1 PRECEDING AND CURRENT ROW）')} style={{ cursor: 'help', color: 'var(--text-muted)', display: 'inline-flex' }}>
                              <Info size={14} />
                            </span>
                          </label>
                          <input
                            id="ohlc-lookback"
                            type="number"
                            min={1}
                            value={ohlcConfig.lookbackWindow}
                            onChange={(e) => {
                              const v = e.target.value;
                              setOhlcConfig(prev => ({ ...prev, lookbackWindow: v === '' ? 0 : Number(v) }));
                            }}
                          />
                        </div>
                      </div>

                      <div className="cq-form-two-cols">
                        <div className="form-group">
                          <label htmlFor="ohlc-time-col">{t('views.plugins.ohlcTimeColumn', '时间列')}</label>
                          <select
                            id="ohlc-time-col"
                            value={availableFields.includes(ohlcConfig.timeColumn) ? ohlcConfig.timeColumn : ''}
                            onChange={(e) => setOhlcConfig(prev => ({ ...prev, timeColumn: e.target.value }))}
                          >
                            <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                            {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>

                        <div className="form-group">
                          <label htmlFor="ohlc-entity-col">{t('views.plugins.ohlcEntityIdColumn', '实体 ID 列')}</label>
                          <select
                            id="ohlc-entity-col"
                            value={availableFields.includes(ohlcConfig.entityIdColumn) ? ohlcConfig.entityIdColumn : ''}
                            onChange={(e) => setOhlcConfig(prev => ({ ...prev, entityIdColumn: e.target.value }))}
                          >
                            <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                            {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="cq-form-two-cols">
                        <div className="form-group">
                          <label htmlFor="ohlc-value-col">{t('views.plugins.ohlcValueColumn', '价格列')}</label>
                          <select
                            id="ohlc-value-col"
                            value={availableFields.includes(ohlcConfig.valueColumn) ? ohlcConfig.valueColumn : ''}
                            onChange={(e) => setOhlcConfig(prev => ({ ...prev, valueColumn: e.target.value }))}
                          >
                            <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                            {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>

                        <div className="form-group">
                          <label htmlFor="ohlc-volume-col">{t('views.plugins.ohlcVolumeColumn', '成交量列（可选）')}</label>
                          <select
                            id="ohlc-volume-col"
                            value={availableFields.includes(ohlcConfig.volumeColumn) ? ohlcConfig.volumeColumn : ''}
                            onChange={(e) => setOhlcConfig(prev => ({ ...prev, volumeColumn: e.target.value }))}
                          >
                            <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                            {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                {/* SPC: 统计过程控制配置 */}
                {formMode === 'spc' && (
                  <div className="cq-section">
                    <div className="cq-section-title">{t('views.plugins.sectionSpc', '统计过程控制 (SPC) 配置')}</div>

                    {isLoadingFields && <p className="rbac-hint">{t('views.plugins.loadingFields', '正在加载字段列表…')}</p>}
                    {!isLoadingFields && availableFields.length === 0 && (
                      <p className="rbac-hint">{t('views.plugins.noFieldsHint', '未获取到字段列表，请先选择数据库和来源表。')}</p>
                    )}

                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="spc-bucket">{t('views.plugins.bucketInterval', '聚合桶')}</label>
                        <select id="spc-bucket" value={spcConfig.bucketInterval} onChange={e => setSpcConfig(prev => ({ ...prev, bucketInterval: e.target.value }))}>
                          {BUCKET_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label htmlFor="spc-value">{t('views.plugins.spcValueColumn', '数值列')}</label>
                        <select id="spc-value" value={availableFields.includes(spcConfig.valueColumn) ? spcConfig.valueColumn : ''} onChange={e => setSpcConfig(prev => ({ ...prev, valueColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.filter(f => f !== 'time').map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        {fieldErrors['spc-value'] && <p className="field-error" aria-live="polite">{fieldErrors['spc-value']}</p>}
                      </div>
                    </div>

                    <div className="form-group">
                      <label>{t('views.plugins.spcGroupColumns', '分组标签 (GROUP BY)')}</label>
                      <div className="ds-field-checkboxes">
                        {isLoadingFields && <span className="rbac-hint">{t('views.plugins.loadingFields', '正在加载字段列表…')}</span>}
                        {!isLoadingFields && availableFields.length === 0 && <p className="rbac-hint">{t('views.plugins.noFieldsHint', '未获取到字段列表，请先选择数据库和来源表。')}</p>}
                        {!isLoadingFields && availableFields.filter(f => f !== 'time').map(f => (
                          <label key={f} className="ds-field-checkbox">
                            <input type="checkbox" checked={spcConfig.groupColumns.includes(f)} onChange={e => {
                              if (e.target.checked) setSpcConfig(prev => ({ ...prev, groupColumns: [...prev.groupColumns, f] }));
                              else setSpcConfig(prev => ({ ...prev, groupColumns: prev.groupColumns.filter(x => x !== f) }));
                            }} /> {f}
                          </label>
                        ))}
                      </div>
                      <p className="rbac-hint">{t('views.plugins.spcGroupHint', '例如 line / station 等标签，决定控制限的分组维度')}</p>
                    </div>

                    <div className="form-group">
                      <label htmlFor="spc-sigma">{t('views.plugins.spcSigmaMultiplier', 'σ 倍数')}</label>
                      <input id="spc-sigma" type="number" step="0.1" min="0.1" value={spcConfig.sigmaMultiplier} onChange={e => setSpcConfig(prev => ({ ...prev, sigmaMultiplier: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                      <p className="rbac-hint">{t('views.plugins.spcSigmaHint', '控制限 = ±kσ，通常取 3')}</p>
                    </div>

                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="spc-upper">{t('views.plugins.spcUpperSpec', '规格上限')}</label>
                        <input id="spc-upper" type="number" step="0.01" value={spcConfig.upperSpec} onChange={e => setSpcConfig(prev => ({ ...prev, upperSpec: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                      </div>
                      <div className="form-group">
                        <label htmlFor="spc-lower">{t('views.plugins.spcLowerSpec', '规格下限')}</label>
                        <input id="spc-lower" type="number" step="0.01" value={spcConfig.lowerSpec} onChange={e => setSpcConfig(prev => ({ ...prev, lowerSpec: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                      </div>
                    </div>

                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="spc-corr">{t('views.plugins.spcCorrColumn', '相关性列 (可选)')}</label>
                        <select id="spc-corr" value={availableFields.includes(spcConfig.corrColumn) ? spcConfig.corrColumn : ''} onChange={e => setSpcConfig(prev => ({ ...prev, corrColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.filter(f => f !== 'time').map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <p className="rbac-hint">{t('views.plugins.spcCorrHint', '如环境温度列，生成 CORR(该列, 数值列)')}</p>
                      </div>
                      <div className="form-group">
                        <label htmlFor="spc-histogram">{t('views.plugins.spcHistogram', '包含 HISTOGRAM(数值列)')}</label>
                        <select id="spc-histogram" value={spcConfig.includeHistogram ? '1' : '0'} onChange={e => setSpcConfig(prev => ({ ...prev, includeHistogram: e.target.value === '1' }))}>
                          <option value="0">{t('views.plugins.spcHistogramOff', '关闭')}</option>
                          <option value="1">{t('views.plugins.spcHistogramOn', '开启')}</option>
                        </select>
                        <p className="rbac-hint">{t('views.plugins.spcHistogramDesc', '输出值分布直方图')}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ASOF 双测量时间对齐配置 */}
                {formMode === 'aerospace' && (
                  <div className="cq-section">
                    <div className="cq-section-title">{t('views.plugins.sectionAerospace', 'ASOF 双测量时间对齐')}</div>

                    {isLoadingFields && <p className="rbac-hint">{t('views.plugins.loadingFields', '正在加载字段列表…')}</p>}
                    {!isLoadingFields && availableFields.length === 0 && (
                      <p className="rbac-hint">{t('views.plugins.noFieldsHint', '未获取到字段列表，请先选择数据库和来源表。')}</p>
                    )}

                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="aero-time">{t('views.plugins.aeroTimeColumn', '时间列')}</label>
                        <select id="aero-time" value={availableFields.includes(aerospaceConfig.timeColumn) ? aerospaceConfig.timeColumn : ''} onChange={e => setAerospaceConfig(prev => ({ ...prev, timeColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label htmlFor="aero-value">{t('views.plugins.aeroValueColumn', '数值列')}</label>
                        <select id="aero-value" value={availableFields.includes(aerospaceConfig.valueColumn) ? aerospaceConfig.valueColumn : ''} onChange={e => setAerospaceConfig(prev => ({ ...prev, valueColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.filter(f => f !== 'time').map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        {fieldErrors['aero-value'] && <p className="field-error" aria-live="polite">{fieldErrors['aero-value']}</p>}
                      </div>
                    </div>

                    <p className="rbac-hint">{t('views.plugins.aeroAsOfTitle', 'ASOF 双测量时间对齐')}</p>
                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="aero-second">{t('views.plugins.aeroSecondMeasurement', '第二张表')}</label>
                        <select
                          id="aero-second"
                          value={aerospaceConfig.secondMeasurement}
                          onChange={e => setAerospaceConfig(prev => ({ ...prev, secondMeasurement: e.target.value }))}
                          disabled={!form.database || isLoadingMeasurements}
                        >
                          <option value="">
                            {!form.database
                              ? t('views.plugins.selectDatabaseFirst')
                              : isLoadingMeasurements
                              ? t('views.plugins.loadingMeasurements')
                              : t('views.plugins.aeroSecondPlaceholder', '选择第二张表')}
                          </option>
                          {availableMeasurements.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          {aerospaceConfig.secondMeasurement && !availableMeasurements.includes(aerospaceConfig.secondMeasurement) && (
                            <option value={aerospaceConfig.secondMeasurement}>{aerospaceConfig.secondMeasurement}</option>
                          )}
                        </select>
                        {fieldErrors['aero-second'] && <p className="field-error" aria-live="polite">{fieldErrors['aero-second']}</p>}
                      </div>
                      <div className="form-group">
                        <label htmlFor="aero-join">{t('views.plugins.aeroJoinKey', '关联键')}</label>
                        <select id="aero-join" value={availableFields.includes(aerospaceConfig.joinKey) ? aerospaceConfig.joinKey : ''} onChange={e => setAerospaceConfig(prev => ({ ...prev, joinKey: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        {fieldErrors['aero-join'] && <p className="field-error" aria-live="polite">{fieldErrors['aero-join']}</p>}
                      </div>
                    </div>
                    <div className="form-group">
                      <label htmlFor="aero-lookback">{t('views.plugins.aeroLookback', '回看窗口 (秒)')}</label>
                      <input id="aero-lookback" type="number" min={1} value={aerospaceConfig.lookbackSeconds} onChange={e => setAerospaceConfig(prev => ({ ...prev, lookbackSeconds: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                      <p className="rbac-hint">{t('views.plugins.aeroLookbackHint', 'ASOF 对齐时限制第二张表的扫描范围，维持增量特性')}</p>
                    </div>
                  </div>
                )}

                {/* IoT: 回归漂移检测配置 */}
                {formMode === 'iot' && (
                  <div className="cq-section">
                    <div className="cq-section-title">{t('views.plugins.sectionIot', '物联网：回归漂移检测')}</div>

                    {isLoadingFields && <p className="rbac-hint">{t('views.plugins.loadingFields', '正在加载字段列表…')}</p>}
                    {!isLoadingFields && availableFields.length === 0 && (
                      <p className="rbac-hint">{t('views.plugins.noFieldsHint', '未获取到字段列表，请先选择数据库和来源表。')}</p>
                    )}

                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="iot-bucket">{t('views.plugins.bucketInterval', '聚合桶')}</label>
                        <select id="iot-bucket" value={iotConfig.bucketInterval} onChange={e => setIotConfig(prev => ({ ...prev, bucketInterval: e.target.value }))}>
                          {BUCKET_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label htmlFor="iot-threshold">{t('views.plugins.iotDriftThreshold', '漂移阈值')}</label>
                        <input id="iot-threshold" type="number" step="0.0001" value={iotConfig.driftThreshold} onChange={e => setIotConfig(prev => ({ ...prev, driftThreshold: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                      </div>
                    </div>

                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="iot-entity">{t('views.plugins.iotEntityColumn', '实体 ID 列')}</label>
                        <select id="iot-entity" value={availableFields.includes(iotConfig.entityColumn) ? iotConfig.entityColumn : ''} onChange={e => setIotConfig(prev => ({ ...prev, entityColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        {fieldErrors['iot-entity'] && <p className="field-error" aria-live="polite">{fieldErrors['iot-entity']}</p>}
                      </div>
                      <div className="form-group">
                        <label htmlFor="iot-value">{t('views.plugins.iotValueColumn', '数值列')}</label>
                        <select id="iot-value" value={availableFields.includes(iotConfig.valueColumn) ? iotConfig.valueColumn : ''} onChange={e => setIotConfig(prev => ({ ...prev, valueColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.filter(f => f !== 'time').map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        {fieldErrors['iot-value'] && <p className="field-error" aria-live="polite">{fieldErrors['iot-value']}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Defense: 分类混合熵配置 */}
                {formMode === 'defense' && (
                  <div className="cq-section">
                    <div className="cq-section-title">{t('views.plugins.sectionDefense', '国防：分类混合熵')}</div>

                    {isLoadingFields && <p className="rbac-hint">{t('views.plugins.loadingFields', '正在加载字段列表…')}</p>}
                    {!isLoadingFields && availableFields.length === 0 && (
                      <p className="rbac-hint">{t('views.plugins.noFieldsHint', '未获取到字段列表，请先选择数据库和来源表。')}</p>
                    )}

                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="def-bucket">{t('views.plugins.bucketInterval', '聚合桶')}</label>
                        <select id="def-bucket" value={defenseConfig.bucketInterval} onChange={e => setDefenseConfig(prev => ({ ...prev, bucketInterval: e.target.value }))}>
                          {BUCKET_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label htmlFor="def-corr">{t('views.plugins.defCorrColumn', '相关性列 (可选)')}</label>
                        <select id="def-corr" value={availableFields.includes(defenseConfig.corrColumn) ? defenseConfig.corrColumn : ''} onChange={e => setDefenseConfig(prev => ({ ...prev, corrColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.filter(f => f !== 'time').map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <p className="rbac-hint">{t('views.plugins.defCorrHint', '如报告计数，生成 CORR(该列, 传感器列)')}</p>
                      </div>
                    </div>

                    <div className="cq-form-two-cols">
                      <div className="form-group">
                        <label htmlFor="def-sensor">{t('views.plugins.defSensorColumn', '传感器/实体列')}</label>
                        <select id="def-sensor" value={availableFields.includes(defenseConfig.sensorColumn) ? defenseConfig.sensorColumn : ''} onChange={e => setDefenseConfig(prev => ({ ...prev, sensorColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        {fieldErrors['def-sensor'] && <p className="field-error" aria-live="polite">{fieldErrors['def-sensor']}</p>}
                      </div>
                      <div className="form-group">
                        <label htmlFor="def-class">{t('views.plugins.defClassColumn', '分类列')}</label>
                        <select id="def-class" value={availableFields.includes(defenseConfig.classColumn) ? defenseConfig.classColumn : ''} onChange={e => setDefenseConfig(prev => ({ ...prev, classColumn: e.target.value }))}>
                          <option value="">{t('views.plugins.selectField', '选择字段')}</option>
                          {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        {fieldErrors['def-class'] && <p className="field-error" aria-live="polite">{fieldErrors['def-class']}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Section: SQL 预览 */}
                  <div className="cq-section">
                    <div className="cq-section-title">{formMode === 'sql' ? t('views.plugins.querySql') : t('views.plugins.sectionSqlPreview', 'SQL 预览（自动生成）')}</div>
                    <textarea
                      id="cq-sql"
                      className="plugins-cq-sql"
                      value={form.query}
                      onChange={(e) => { if (formMode === 'sql') setForm({ ...form, query: e.target.value }); }}
                      readOnly={formMode !== 'sql'}
                      required={formMode === 'sql'}
                      spellCheck={false}
                    />
                    {formMode === 'sql' && <p className="rbac-hint">{t('views.plugins.sqlHint')}</p>}
                  </div>

                </div>
              </form>
            </SlideOutPanel>

      {historyFor && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={() => setHistoryFor(null)}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('views.plugins.historyTitle', { name: historyFor.name })}</h3>
              <button type="button" className="icon-btn" onClick={() => setHistoryFor(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body cq-history-list">
              {historyLoading && (
                <div className="loading-inline">
                  <Loader2 className="spin" size={18} />
                  {t('views.plugins.loading')}
                </div>
              )}
              {!historyLoading && history.length === 0 && <div className="tokens-empty">{t('views.plugins.noHistoryYet')}</div>}
              {!historyLoading && history.map(item => (
                <div key={item.id} className="cq-history-item">
                  <div className="cq-history-top">
                    <span className={`perm-badge${item.status === 'completed' ? '' : ' muted'}`}>{item.status}</span>
                    <span>{formatTime(item.execution_time, i18n.language)}</span>
                  </div>
                  <div className="cq-history-meta">
                    <span>{t('views.plugins.writtenRecords', { count: item.records_written ?? 0 })}</span>
                    <span>{t('views.plugins.durationSeconds', { seconds: item.execution_duration_seconds.toFixed(3) })}</span>
                    <span>{t('views.plugins.historyId', { id: item.execution_id })}</span>
                  </div>
                  {item.error_message && <div className="tokens-alert" style={{ marginTop: 8 }}>{item.error_message}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title={t('views.plugins.delete')}
          description={t('views.plugins.deleteConfirm', { name: deleteTarget.name })}
          confirmLabel={t('common.confirmDelete')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            deleteCQ(deleteTarget);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
};

export default Plugins;
