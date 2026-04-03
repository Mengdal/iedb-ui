import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, Play, Pencil, Trash2, X, AlertTriangle, Loader2, StopCircle } from 'lucide-react';
import { useServers } from '../contexts/ServerContext';
import { useTranslation } from 'react-i18next';
import './Tokens.css';
import './PluginsMqtt.css';

interface MqttSubscription {
  id: number;
  name: string;
  broker: string;
  topics?: string[];
  database: string;
  qos: number;
  status?: string;
}

interface MqttFormState {
  name: string;
  broker: string;
  topicFilter: string;
  database: string;
  qos: string;
  autoStart: boolean;
}

function serverBaseUrl(protocol: string, host: string) {
  return `${protocol}${host}`.replace(/\/$/, '');
}

const PluginsMqtt: React.FC = () => {
  const { activeServer } = useServers();
  const { t } = useTranslation();

  const [mqtts, setMqtts] = useState<MqttSubscription[]>([]);
  const [mqttLoading, setMqttLoading] = useState(false);
  const [mqttErrorMsg, setMqttErrorMsg] = useState('');

  const [isMqttFormOpen, setIsMqttFormOpen] = useState(false);
  const [editingMqtt, setEditingMqtt] = useState<MqttSubscription | null>(null);
  const [mqttSaving, setMqttSaving] = useState(false);
  const [mqttActionBusyId, setMqttActionBusyId] = useState<number | null>(null);

  const mqttModalBodyRef = useRef<HTMLDivElement | null>(null);

  const [mqttForm, setMqttForm] = useState<MqttFormState>({
    name: '',
    broker: '',
    topicFilter: '',
    database: 'default',
    qos: '0',
    autoStart: true
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
    try {
      const data = await mqttApiFetch('/api/v1/mqtt/subscriptions');
      setMqtts(Array.isArray(data?.subscriptions) ? (data.subscriptions as MqttSubscription[]) : []);
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
      autoStart: true
    });
    setMqttErrorMsg('');
    setIsMqttFormOpen(true);
    setTimeout(() => {
      mqttModalBodyRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const openEditMqtt = (sub: MqttSubscription) => {
    setEditingMqtt(sub);
    setMqttForm({
      name: sub.name || '',
      broker: sub.broker || '',
      topicFilter: sub.topics?.[0] || '',
      database: sub.database || 'default',
      qos: Number.isFinite(sub.qos) ? String(sub.qos) : '0',
      autoStart: false
    });
    setMqttErrorMsg('');
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
    if (!window.confirm(t('views.pluginsMqtt.deleteConfirm', { name: sub.name }))) return;
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
    <div className="tokens-container plugins-mqtt-page">
      <div className="page-header">
        <div>
          <h1 className="page-title-main">{t('views.pluginsMqtt.title')}</h1>
          <p className="page-subtitle">{t('views.pluginsMqtt.pageSubtitle')}</p>
        </div>
      </div>

      <div className="tokens-section">
        <div className="section-header">
          <div className="mqtt-section-left">
            <h2 className="section-title-large">{t('views.pluginsMqtt.sectionTitle')}</h2>
            <p className="section-desc mqtt-desc">{t('views.pluginsMqtt.sectionDesc')}</p>
          </div>

          <div className="tokens-toolbar mqtt-toolbar">
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

        {activeServer && mqttLoading && mqtts.length === 0 && !mqttErrorMsg && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.pluginsMqtt.loadingSubscriptions')}
          </div>
        )}

        {activeServer && !mqttLoading && !mqttErrorMsg && mqtts.length === 0 && (
          <div className="tokens-empty">{t('views.pluginsMqtt.noSubscriptions')}</div>
        )}

        {activeServer && mqtts.length > 0 && (
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
                            onClick={() => deleteMqttSubscription(sub)}
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
    </div>
  );
};

export default PluginsMqtt;

