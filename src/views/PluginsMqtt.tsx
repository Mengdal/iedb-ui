import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, Play, Pencil, Trash2, X, AlertTriangle, Loader2, StopCircle, ShieldAlert } from 'lucide-react';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';
import { serverBaseUrl } from '../utils/server';
import ConfirmModal from '../components/ConfirmModal';
import './Tokens.css';
import './PluginsMqtt.css';

interface MqttSubscription {
  id: number;
  name: string;
  broker: string;
  client_id?: string;
  topics?: string[];
  database: string;
  qos: number;
  status?: string;
  topic_mapping?: Record<string, string>;
  username?: string;
  password?: string;
  keep_alive_seconds?: number;
  connect_timeout_seconds?: number;
  reconnect_min_seconds?: number;
  reconnect_max_seconds?: number;
  clean_session?: boolean;
}

interface TopicMappingEntry {
  topic: string;
  database: string;
}

interface MqttFormState {
  name: string;
  broker: string;
  topicFilter: string;
  database: string;
  qos: string;
  autoStart: boolean;
  topicMappings: TopicMappingEntry[];
  username: string;
  password: string;
  keepAlive: string;
  connectTimeout: string;
  reconnectMin: string;
  reconnectMax: string;
  cleanSession: boolean;
}

const PluginsMqtt: React.FC = () => {
  const { activeServer } = useServers();
  const { t } = useTranslation();

  const [mqtts, setMqtts] = useState<MqttSubscription[]>([]);
  const [mqttLoading, setMqttLoading] = useState(false);
  const [mqttErrorMsg, setMqttErrorMsg] = useState('');
  const [featureNotEnabled, setFeatureNotEnabled] = useState(false);

  const [isMqttFormOpen, setIsMqttFormOpen] = useState(false);
  const [editingMqtt, setEditingMqtt] = useState<MqttSubscription | null>(null);
  const [mqttSaving, setMqttSaving] = useState(false);
  const [mqttActionBusyId, setMqttActionBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MqttSubscription | null>(null);

  const mqttModalBodyRef = useRef<HTMLDivElement | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [mqttForm, setMqttForm] = useState<MqttFormState>({
    name: '',
    broker: '',
    topicFilter: '',
    database: 'default',
    qos: '0',
    autoStart: true,
    topicMappings: [],
    username: '',
    password: '',
    keepAlive: '60',
    connectTimeout: '30',
    reconnectMin: '1',
    reconnectMax: '60',
    cleanSession: false
  });

  const baseUrl = useMemo(() => {
    if (!activeServer) return '';
    return serverBaseUrl(activeServer.protocol, activeServer.host);
  }, [activeServer]);

  const mqttApiFetch = async (path: string, init?: RequestInit) => {
    if (!activeServer) throw new Error('No active server');

    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeServer.token}`,
        ...(init?.headers || {})
      }
    });

    if (res.status === 404) {
      setFeatureNotEnabled(true);
      return null;
    }

    const data = await res.json().catch(() => ({}));
    // Some backends return HTTP 200 but include { success:false, error:"..." } in the body.
    if (
      !res.ok ||
      (data &&
        typeof (data as any).success === 'boolean' &&
        (data as any).success === false)
    ) {
      const messageFromBody =
        typeof (data as any)?.error === 'string'
          ? (data as any).error
          : typeof (data as any)?.message === 'string'
            ? (data as any).message
            : typeof (data as any)?.reason === 'string'
              ? (data as any).reason
              : typeof (data as any)?.details === 'string'
                ? (data as any).details
                : data && typeof data === 'object'
                  ? JSON.stringify(data, null, 2)
                  : undefined;

      throw new Error(messageFromBody || `Request failed: ${res.status}`);
    }
    return data;
  };

  const fetchMqttSubscriptions = async () => {
    if (!activeServer) {
      setMqtts([]);
      return;
    }

    setMqttLoading(true);
    setMqttErrorMsg('');
    setFeatureNotEnabled(false);
    try {
      const data = await mqttApiFetch('/api/v1/mqtt/subscriptions');
      if (data) {
        setMqtts(Array.isArray(data?.subscriptions) ? (data.subscriptions as MqttSubscription[]) : []);
      }
    } catch (err: any) {
      setMqttErrorMsg(err.message || t('views.pluginsMqtt.failedToLoad'));
      setMqtts([]);
    } finally {
      setMqttLoading(false);
    }
  };

  useEffect(() => {
    fetchMqttSubscriptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServer]);

  const openCreateMqtt = () => {
    setEditingMqtt(null);
    setMqttForm({
      name: '',
      broker: '',
      topicFilter: '',
      database: 'default',
      qos: '0',
      autoStart: true,
      topicMappings: [],
      username: '',
      password: '',
      keepAlive: '60',
      connectTimeout: '30',
      reconnectMin: '1',
      reconnectMax: '60',
      cleanSession: false
    });
    setMqttErrorMsg('');
    setShowAdvanced(false);
    setIsMqttFormOpen(true);
    setTimeout(() => {
      mqttModalBodyRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const openEditMqtt = (sub: MqttSubscription) => {
    setEditingMqtt(sub);
    const mappings: TopicMappingEntry[] = sub.topic_mapping
      ? Object.entries(sub.topic_mapping).map(([topic, database]) => ({ topic, database }))
      : [];
    setMqttForm({
      name: sub.name || '',
      broker: sub.broker || '',
      topicFilter: sub.topics?.join(', ') || '',
      database: sub.database || 'default',
      qos: Number.isFinite(sub.qos) ? String(sub.qos) : '0',
      autoStart: false,
      topicMappings: mappings,
      username: sub.username || '',
      password: sub.password || '',
      keepAlive: String(sub.keep_alive_seconds ?? 60),
      connectTimeout: String(sub.connect_timeout_seconds ?? 30),
      reconnectMin: String(sub.reconnect_min_seconds ?? 1),
      reconnectMax: String(sub.reconnect_max_seconds ?? 60),
      cleanSession: sub.clean_session ?? false
    });
    setMqttErrorMsg('');
    setShowAdvanced(!!(sub.username || sub.topic_mapping || sub.clean_session));
    setIsMqttFormOpen(true);
    setTimeout(() => {
      mqttModalBodyRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const closeMqttForm = () => {
    setIsMqttFormOpen(false);
    setEditingMqtt(null);
    setMqttErrorMsg('');
    setMqttSaving(false);
  };

  const submitMqttForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeServer) return;

    const topics = mqttForm.topicFilter
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!mqttForm.name.trim() || !mqttForm.broker.trim() || topics.length === 0) {
      setMqttErrorMsg(t('views.pluginsMqtt.missingFields'));
      return;
    }

    const qos = parseInt(mqttForm.qos, 10);
    if (!Number.isFinite(qos) || qos < 0 || qos > 2) {
      setMqttErrorMsg(t('views.pluginsMqtt.invalidQos'));
      return;
    }

    const payload: Record<string, unknown> = {
      name: mqttForm.name.trim(),
      broker: mqttForm.broker.trim(),
      topics,
      database: mqttForm.database.trim(),
      qos
    };

    // Build topic_mapping from form entries
    const validMappings = mqttForm.topicMappings.filter(m => m.topic.trim() && m.database.trim());
    if (validMappings.length > 0) {
      const mapping: Record<string, string> = {};
      validMappings.forEach(m => { mapping[m.topic.trim()] = m.database.trim(); });
      payload.topic_mapping = mapping;
    }

    // Advanced settings
    if (mqttForm.username.trim()) payload.username = mqttForm.username.trim();
    if (mqttForm.password) payload.password = mqttForm.password;
    payload.keep_alive_seconds = parseInt(mqttForm.keepAlive, 10) || 60;
    payload.connect_timeout_seconds = parseInt(mqttForm.connectTimeout, 10) || 30;
    payload.reconnect_min_seconds = parseInt(mqttForm.reconnectMin, 10) || 1;
    payload.reconnect_max_seconds = parseInt(mqttForm.reconnectMax, 10) || 60;
    payload.clean_session = mqttForm.cleanSession;

    // Server accepts `auto_start` on create only.
    if (!editingMqtt) {
      payload.auto_start = mqttForm.autoStart;
    }

    const url = editingMqtt
      ? `/api/v1/mqtt/subscriptions/${editingMqtt.id}`
      : `/api/v1/mqtt/subscriptions`;
    const method = editingMqtt ? 'PUT' : 'POST';

    setMqttSaving(true);
    setMqttErrorMsg('');
    try {
      await mqttApiFetch(url, {
        method,
        body: JSON.stringify(payload)
      });

      closeMqttForm();
      await fetchMqttSubscriptions();
    } catch (err: any) {
      setMqttErrorMsg(err.message || t('views.pluginsMqtt.failedToSave'));
      // Keep the user at the top so they can see full error details.
      setTimeout(() => {
        mqttModalBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }, 0);
    } finally {
      setMqttSaving(false);
    }
  };

  const controlMqttSubscription = async (id: number, action: 'start' | 'stop') => {
    if (!activeServer) return;

    setMqttActionBusyId(id);
    setMqttErrorMsg('');
    try {
      await mqttApiFetch(`/api/v1/mqtt/subscriptions/${id}/${action}`, { method: 'POST' });
      await fetchMqttSubscriptions();
    } catch (err: any) {
      setMqttErrorMsg(err.message || t('views.pluginsMqtt.failedToControl', { action }));
    } finally {
      setMqttActionBusyId(null);
    }
  };

  const deleteMqttSubscription = async (sub: MqttSubscription) => {
    if (!activeServer) return;

    setMqttActionBusyId(sub.id);
    setMqttErrorMsg('');
    try {
      await mqttApiFetch(`/api/v1/mqtt/subscriptions/${sub.id}`, { method: 'DELETE' });
      await fetchMqttSubscriptions();
    } catch (err: any) {
      setMqttErrorMsg(err.message || t('views.pluginsMqtt.failedToDelete'));
    } finally {
      setMqttActionBusyId(null);
    }
  };

  return (
    <div className="page-container plugins-mqtt-page">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('views.pluginsMqtt.title')}</h1>
          <p>{t('views.pluginsMqtt.pageSubtitle')}</p>
        </div>
      </div>

      <div className="page-section">
        <div className="section-header">
          <div className="section-header-text mqtt-section-left">
            <h2>{t('views.pluginsMqtt.sectionTitle')}</h2>
            <p className="mqtt-desc">{t('views.pluginsMqtt.sectionDesc')}</p>
          </div>

          <div className="page-toolbar mqtt-toolbar">
            <button
              type="button"
              className="btn btn-outlined"
              onClick={() => fetchMqttSubscriptions()}
              disabled={!activeServer || mqttLoading}
            >
              <RefreshCw size={16} className={mqttLoading ? 'spin' : ''} />
              {t('views.plugins.refresh')}
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreateMqtt} disabled={!activeServer}>
              <Plus size={16} />
              {t('views.pluginsMqtt.newSubscription')}
            </button>
          </div>
        </div>

        {!activeServer && (
          <div className="tokens-empty">
            <AlertTriangle size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            {t('views.pluginsMqtt.selectServerHint')}
          </div>
        )}

        {activeServer && mqttErrorMsg && <div className="tokens-alert">{mqttErrorMsg}</div>}

        {activeServer && featureNotEnabled && (
          <div className="audit-no-license">
            <ShieldAlert size={40} />
            <p>{t('views.pluginsMqtt.featureNotEnabled')}</p>
          </div>
        )}

        {activeServer && !featureNotEnabled && mqttLoading && mqtts.length === 0 && !mqttErrorMsg && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.pluginsMqtt.loadingSubscriptions')}
          </div>
        )}

        {activeServer && !featureNotEnabled && !mqttLoading && !mqttErrorMsg && mqtts.length === 0 && (
          <div className="tokens-empty">{t('views.pluginsMqtt.noSubscriptions')}</div>
        )}

        {activeServer && !featureNotEnabled && mqtts.length > 0 && (
          <div className="tokens-table-wrap">
            <table className="tokens-table">
              <colgroup>
                <col className="mqtt-col-name" />
                <col className="mqtt-col-db" />
                <col className="mqtt-col-topics" />
                <col className="mqtt-col-qos" />
                <col className="mqtt-col-broker" />
                <col className="mqtt-col-status" />
                <col className="mqtt-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('views.pluginsMqtt.name')}</th>
                  <th>{t('views.pluginsMqtt.db')}</th>
                  <th>{t('views.pluginsMqtt.topics')}</th>
                  <th>{t('views.pluginsMqtt.qos')}</th>
                  <th>{t('views.pluginsMqtt.broker')}</th>
                  <th>{t('views.pluginsMqtt.status')}</th>
                  <th>{t('views.pluginsMqtt.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {mqtts.map((sub) => {
                  const isRunning = (sub.status || 'stopped') === 'running';
                  return (
                    <tr key={sub.id}>
                      <td>{sub.name}</td>
                      <td>{sub.database}</td>
                      <td className="mqtt-topics-cell">
                        <span>{sub.topics?.length ? sub.topics.join(', ') : '—'}</span>
                      </td>
                      <td className="mqtt-qos-cell">
                        <span className="mqtt-qos-badge">QoS: {sub.qos}</span>
                      </td>
                      <td>
                        <code className="mqtt-broker-code">{sub.broker}</code>
                      </td>
                      <td>
                        <span className={`mqtt-status-badge ${isRunning ? 'running' : 'stopped'}`}>
                          {isRunning ? t('views.pluginsMqtt.running') : t('views.pluginsMqtt.stopped')}
                        </span>
                      </td>
                      <td>
                        <div className="token-actions">
                          {isRunning ? (
                            <button
                              type="button"
                              className="icon-btn danger"
                              title={t('views.pluginsMqtt.actionStop')}
                              onClick={() => controlMqttSubscription(sub.id, 'stop')}
                              disabled={mqttActionBusyId === sub.id}
                            >
                              <StopCircle size={16} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="icon-btn"
                              title={t('views.pluginsMqtt.actionStart')}
                              onClick={() => controlMqttSubscription(sub.id, 'start')}
                              disabled={mqttActionBusyId === sub.id}
                            >
                              <Play size={16} />
                            </button>
                          )}

                          <button
                            type="button"
                            className="icon-btn"
                            title={t('views.pluginsMqtt.actionEdit')}
                            onClick={() => openEditMqtt(sub)}
                            disabled={mqttActionBusyId === sub.id}
                          >
                            <Pencil size={16} />
                          </button>

                          <button
                            type="button"
                            className="icon-btn danger"
                            title={t('views.pluginsMqtt.actionDelete')}
                            onClick={() => setDeleteTarget(sub)}
                            disabled={mqttActionBusyId === sub.id}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isMqttFormOpen && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={closeMqttForm}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingMqtt ? t('views.pluginsMqtt.editSubscription') : t('views.pluginsMqtt.createSubscription')}</h3>
              <button type="button" className="icon-btn" onClick={closeMqttForm}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={submitMqttForm}>
              <div className="modal-body" ref={mqttModalBodyRef}>
                {mqttErrorMsg && (
                  <div className="tokens-alert" style={{ marginBottom: 16 }}>
                    {mqttErrorMsg}
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="mqtt-name">{t('views.pluginsMqtt.name')}</label>
                  <input
                    id="mqtt-name"
                    type="text"
                    value={mqttForm.name}
                    onChange={(e) => setMqttForm({ ...mqttForm, name: e.target.value })}
                    required
                    placeholder={t('views.pluginsMqtt.namePlaceholder')}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="mqtt-broker">{t('views.pluginsMqtt.brokerUrl')}</label>
                  <input
                    id="mqtt-broker"
                    type="text"
                    value={mqttForm.broker}
                    onChange={(e) => setMqttForm({ ...mqttForm, broker: e.target.value })}
                    required
                    placeholder={t('views.pluginsMqtt.brokerPlaceholder')}
                  />
                </div>

                <div className="form-group">
                <label htmlFor="mqtt-topic">
                  {t('views.pluginsMqtt.topicFilter')}
                  <span
                    className="topic-hint-icon"
                    title={t('views.pluginsMqtt.topicHint')}
                    aria-label="Topic Filter hint"
                  >
                    ?
                  </span>
                </label>
                  <input
                    id="mqtt-topic"
                    type="text"
                    value={mqttForm.topicFilter}
                    onChange={(e) => setMqttForm({ ...mqttForm, topicFilter: e.target.value })}
                    required
                    placeholder={t('views.pluginsMqtt.topicPlaceholder')}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="mqtt-database">{t('views.pluginsMqtt.targetDatabase')}</label>
                  <input
                    id="mqtt-database"
                    type="text"
                    value={mqttForm.database}
                    onChange={(e) => setMqttForm({ ...mqttForm, database: e.target.value })}
                    required
                    placeholder={t('views.pluginsMqtt.default')}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="mqtt-qos">{t('views.pluginsMqtt.qos')}</label>
                  <select
                    id="mqtt-qos"
                    value={mqttForm.qos}
                    onChange={(e) => setMqttForm({ ...mqttForm, qos: e.target.value })}
                  >
                    <option value="0">{t('views.pluginsMqtt.qos0')}</option>
                    <option value="1">{t('views.pluginsMqtt.qos1')}</option>
                    <option value="2">{t('views.pluginsMqtt.qos2')}</option>
                  </select>
                </div>

                {!editingMqtt && (
                  <div className="form-group perm-checkboxes">
                    <label htmlFor="mqtt-auto-start">
                      <input
                        id="mqtt-auto-start"
                        type="checkbox"
                        checked={mqttForm.autoStart}
                        onChange={(e) => setMqttForm({ ...mqttForm, autoStart: e.target.checked })}
                      />
                      {t('views.pluginsMqtt.autoStart')}
                    </label>
                  </div>
                )}

                {/* Advanced Settings Toggle */}
                <div
                  className="mqtt-advanced-toggle"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <span>{t('views.pluginsMqtt.advancedSettings')}</span>
                  <span className={`mqtt-advanced-chevron ${showAdvanced ? 'open' : ''}`}>›</span>
                </div>

                {showAdvanced && (
                  <div className="mqtt-advanced-section">
                    {/* Topic Mapping */}
                    <div className="form-group">
                      <label>
                        {t('views.pluginsMqtt.topicMapping')}
                        <span className="topic-hint-icon" title={t('views.pluginsMqtt.topicMappingHint')}>?</span>
                      </label>
                      {mqttForm.topicMappings.some(m => m.topic.includes('+') || m.topic.includes('#')) && (
                        <p className="form-hint" style={{ marginBottom: 8, color: '#ef4444' }}>{t('views.pluginsMqtt.topicMappingExact')}</p>
                      )}
                      {mqttForm.topicMappings.map((m, i) => (
                        <div key={i} className="mqtt-mapping-row">
                          <input
                            type="text"
                            value={m.topic}
                            onChange={e => {
                              const next = [...mqttForm.topicMappings];
                              next[i] = { ...next[i], topic: e.target.value };
                              setMqttForm({ ...mqttForm, topicMappings: next });
                            }}
                            placeholder={t('views.pluginsMqtt.mappingTopicPlaceholder')}
                          />
                          <span className="mqtt-mapping-arrow">→</span>
                          <input
                            type="text"
                            value={m.database}
                            onChange={e => {
                              const next = [...mqttForm.topicMappings];
                              next[i] = { ...next[i], database: e.target.value };
                              setMqttForm({ ...mqttForm, topicMappings: next });
                            }}
                            placeholder={t('views.pluginsMqtt.mappingDbPlaceholder')}
                          />
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => {
                              setMqttForm({ ...mqttForm, topicMappings: mqttForm.topicMappings.filter((_, j) => j !== i) });
                            }}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-outlined"
                        style={{ marginTop: 4 }}
                        onClick={() => setMqttForm({ ...mqttForm, topicMappings: [...mqttForm.topicMappings, { topic: '', database: '' }] })}
                      >
                        <Plus size={14} />
                        {t('views.pluginsMqtt.addMapping')}
                      </button>
                    </div>

                    {/* Username & Password */}
                    <div className="mqtt-adv-row">
                      <div className="form-group">
                        <label>{t('views.pluginsMqtt.username')}</label>
                        <input
                          type="text"
                          value={mqttForm.username}
                          onChange={e => setMqttForm({ ...mqttForm, username: e.target.value })}
                          placeholder={t('views.pluginsMqtt.usernamePlaceholder')}
                          autoComplete="off"
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('views.pluginsMqtt.password')}</label>
                        <input
                          type="password"
                          value={mqttForm.password}
                          onChange={e => setMqttForm({ ...mqttForm, password: e.target.value })}
                          placeholder={t('views.pluginsMqtt.passwordPlaceholder')}
                          autoComplete="new-password"
                        />
                      </div>
                    </div>

                    {/* Connection Parameters */}
                    <div className="mqtt-adv-row">
                      <div className="form-group">
                        <label>
                          {t('views.pluginsMqtt.keepAlive')}
                          <span className="topic-hint-icon" title={t('views.pluginsMqtt.keepAliveHint')}>?</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={mqttForm.keepAlive}
                          onChange={e => setMqttForm({ ...mqttForm, keepAlive: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>
                          {t('views.pluginsMqtt.connectTimeout')}
                          <span className="topic-hint-icon" title={t('views.pluginsMqtt.connectTimeoutHint')}>?</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={mqttForm.connectTimeout}
                          onChange={e => setMqttForm({ ...mqttForm, connectTimeout: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="mqtt-adv-row">
                      <div className="form-group">
                        <label>
                          {t('views.pluginsMqtt.reconnectMin')}
                          <span className="topic-hint-icon" title={t('views.pluginsMqtt.reconnectMinHint')}>?</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={mqttForm.reconnectMin}
                          onChange={e => setMqttForm({ ...mqttForm, reconnectMin: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>
                          {t('views.pluginsMqtt.reconnectMax')}
                          <span className="topic-hint-icon" title={t('views.pluginsMqtt.reconnectMaxHint')}>?</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={mqttForm.reconnectMax}
                          onChange={e => setMqttForm({ ...mqttForm, reconnectMax: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="form-group perm-checkboxes">
                      <label htmlFor="mqtt-clean-session">
                        <input
                          id="mqtt-clean-session"
                          type="checkbox"
                          checked={mqttForm.cleanSession}
                          onChange={e => setMqttForm({ ...mqttForm, cleanSession: e.target.checked })}
                        />
                        {t('views.pluginsMqtt.cleanSession')}
                        <span className="topic-hint-icon" title={t('views.pluginsMqtt.cleanSessionHint')}>?</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
                <button type="button" className="btn btn-outlined" onClick={closeMqttForm}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={mqttSaving}>
                  {mqttSaving ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                  {mqttSaving ? t('views.pluginsMqtt.saving') : editingMqtt ? t('views.pluginsMqtt.save') : t('views.pluginsMqtt.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title={t('views.pluginsMqtt.delete')}
          description={t('views.pluginsMqtt.deleteConfirm', { name: deleteTarget.name })}
          confirmLabel={t('common.confirmDelete')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            deleteMqttSubscription(deleteTarget);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
};

export default PluginsMqtt;

