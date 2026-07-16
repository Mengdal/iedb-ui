import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  Edit2,
  X,
  Loader2,
  Copy,
  Ban,
  RotateCcw,
  AlertTriangle,
  KeyRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import { useApiFetch } from '../hooks/useApiFetch';
import { copyToClipboard } from '../utils/clipboard';
import { formatTime } from '../utils/formatTime';
import './Tokens.css';

export interface TokenInfo {
  id: number;
  name: string;
  description?: string;
  permissions: string[];
  created_at: string;
  last_used_at?: string;
  enabled: boolean;
  expires_at?: string;
}

const PERM_OPTIONS = ['read', 'write', 'delete', 'admin'] as const;

type PermMode = 'default' | 'custom' | 'rbac';

function permModeFromToken(t: TokenInfo): PermMode {
  if (!t.permissions?.length) return 'rbac';
  const s = new Set(t.permissions);
  if (s.size === 2 && s.has('read') && s.has('write')) return 'default';
  return 'custom';
}

export default function Tokens() {
  const { t, i18n } = useTranslation();
  const { activeServer } = useServers();
  const { apiFetch, resetGate } = useApiFetch({ handleLicense: false, handleFeature: true });
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editToken, setEditToken] = useState<TokenInfo | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [rotateId, setRotateId] = useState<number | null>(null);

  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);



  const fetchTokens = useCallback(async () => {
    if (!activeServer) return;
    setLoading(true);
    setError(null);
    resetGate();
    try {
      const data = await apiFetch('/api/v1/auth/tokens');
      if (data === null) {
        setError(t('views.tokens.authFeatureNotEnabled'));
        setTokens([]);
      } else if (data.success && Array.isArray(data.tokens)) {
        setTokens(data.tokens);
      } else {
        setTokens([]);
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, [activeServer, apiFetch, resetGate, t]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q)
    );
  }, [tokens, search]);

  const copySecret = async (value: string) => {
    await copyToClipboard(value);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('views.tokens.pageTitle')}</h1>
          <p>{t('views.tokens.pageSubtitle')}</p>
        </div>
      </div>

      <div className="page-section">
        <div className="section-header">
          <div className="section-header-text">
            <h2>{t('views.tokens.sectionTitle')}</h2>
            <p>{t('views.tokens.sectionDesc')}</p>
          </div>
          <div className="page-toolbar">
            <input
              className="page-search"
              type="search"
              placeholder={t('views.tokens.filterPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-outlined"
              onClick={() => fetchTokens()}
              disabled={!activeServer || loading}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              {t('common.refresh')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
              disabled={!activeServer}
            >
              <Plus size={16} />
              {t('views.tokens.createToken')}
            </button>
          </div>
        </div>

        {!activeServer && (
          <div className="tokens-empty">
            <AlertTriangle size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            {t('views.tokens.selectServerHint')}
          </div>
        )}

        {activeServer && error && <div className="tokens-alert">{error}</div>}

        {activeServer && loading && tokens.length === 0 && !error && (
          <div className="loading-inline">
            <Loader2 className="spin" size={18} />
            {t('views.tokens.loadingTokens')}
          </div>
        )}

        {activeServer && !loading && !error && tokens.length === 0 && (
          <div className="tokens-empty">{t('views.tokens.noTokensYet')}</div>
        )}

        {activeServer && !loading && !error && tokens.length > 0 && filtered.length === 0 && (
          <div className="tokens-empty">{t('views.tokens.noTokensMatch')}</div>
        )}

        {activeServer && filtered.length > 0 && (
          <div className="tokens-table-wrap">
            <table className="tokens-table">
              <thead>
                <tr>
                  <th>{t('views.tokens.name')}</th>
                  <th>{t('views.tokens.permissions')}</th>
                  <th>{t('views.tokens.status')}</th>
                  <th>{t('views.tokens.created')}</th>
                  <th>{t('views.tokens.lastUsed')}</th>
                  <th>{t('views.tokens.expires')}</th>
                  <th>{t('views.tokens.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="token-name-cell">
                      {item.name}
                      {item.description ? <div className="token-desc">{item.description}</div> : null}
                    </td>
                    <td>
                      <div className="perm-badges">
                        {item.permissions?.length ? (
                          item.permissions.map((p) => (
                            <span key={p} className="perm-badge">
                              {p}
                            </span>
                          ))
                        ) : (
                          <span className="perm-badge muted">{t('views.tokens.rbac')}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${item.enabled ? 'active' : 'revoked'}`}>
                        {item.enabled ? t('views.tokens.active') : t('views.tokens.revoked')}
                      </span>
                    </td>
                    <td>{formatTime(item.created_at, i18n.language)}</td>
                    <td>{formatTime(item.last_used_at, i18n.language)}</td>
                    <td>{formatTime(item.expires_at, i18n.language)}</td>
                    <td>
                      <div className="token-actions">
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditToken(item)}>
                          <Edit2 size={14} />
                          {t('views.tokens.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          disabled={!item.enabled}
                          onClick={() => setRotateId(item.id)}
                        >
                          <RotateCcw size={14} />
                          {t('views.tokens.rotate')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          disabled={!item.enabled}
                          onClick={() => setRevokeId(item.id)}
                        >
                          <Ban size={14} />
                          {t('views.tokens.revoke')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => setDeleteId(item.id)}>
                          <Trash2 size={14} />
                          {t('views.tokens.delete')}
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

      {createOpen && (
        <CreateTokenModal
          onClose={() => setCreateOpen(false)}
          onCreated={(plainToken) => {
            setCreateOpen(false);
            setSecret({
              title: t('views.tokens.tokenCreated'),
              value: plainToken,
            });
            fetchTokens();
          }}
        />
      )}

      {editToken && (
        <EditTokenModal
          token={editToken}
          onClose={() => setEditToken(null)}
          onSaved={() => {
            setEditToken(null);
            fetchTokens();
          }}
        />
      )}

      {secret && (
        <div className="modal-overlay" role="dialog" aria-modal>
          <div className="modal-content">
            <div className="modal-header">
              <h3>{secret.title}</h3>
              <button type="button" className="icon-btn" onClick={() => setSecret(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
                {t('views.tokens.copyNowHint')}
              </p>
              <div className="secret-box">{secret.value}</div>
              <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
                <button type="button" className="btn btn-primary" onClick={() => copySecret(secret.value)}>
                  <Copy size={16} />
                  {t('views.tokens.copyToClipboard')}
                </button>
                <button type="button" className="btn btn-outlined" onClick={() => setSecret(null)}>
                  {t('views.tokens.done')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <ConfirmModal
          title={t('views.tokens.deleteToken')}
          description={t('views.tokens.deleteTokenDesc')}
          confirmLabel={t('views.tokens.delete')}
          danger
          onCancel={() => setDeleteId(null)}
          onConfirm={async () => {
            try {
              await apiFetch(`/api/v1/auth/tokens/${deleteId}`, { method: 'DELETE' });
              setDeleteId(null);
              fetchTokens();
            } catch (e: any) {
              setError(e.message || t('views.tokens.deleteFailed'));
              setDeleteId(null);
            }
          }}
        />
      )}

      {revokeId !== null && (
        <ConfirmModal
          title={t('views.tokens.revokeToken')}
          description={t('views.tokens.revokeTokenDesc')}
          confirmLabel={t('views.tokens.revoke')}
          danger
          onCancel={() => setRevokeId(null)}
          onConfirm={async () => {
            try {
              await apiFetch(`/api/v1/auth/tokens/${revokeId}/revoke`, { method: 'POST' });
              setRevokeId(null);
              fetchTokens();
            } catch (e: any) {
              setError(e.message || t('views.tokens.revokeFailed'));
              setRevokeId(null);
            }
          }}
        />
      )}

      {rotateId !== null && (
        <ConfirmModal
          title={t('views.tokens.rotateToken')}
          description={t('views.tokens.rotateTokenDesc')}
          confirmLabel={t('views.tokens.rotate')}
          onCancel={() => setRotateId(null)}
          onConfirm={async () => {
            try {
              const data = await apiFetch(`/api/v1/auth/tokens/${rotateId}/rotate`, { method: 'POST' });
              const plain = (data as { new_token?: string })?.new_token;
              setRotateId(null);
              fetchTokens();
              if (plain) {
                setSecret({ title: t('views.tokens.newTokenSecret'), value: plain });
              }
            } catch (e: any) {
              setError(e.message || t('views.tokens.rotateFailed'));
              setRotateId(null);
            }
          }}
        />
      )}
    </div>
  );
}

function CreateTokenModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (plain: string) => void;
}) {
  const { t } = useTranslation();
  const { apiFetch } = useApiFetch({ handleLicense: false, handleFeature: true });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permMode, setPermMode] = useState<PermMode>('default');
  const [custom, setCustom] = useState<Record<string, boolean>>({
    read: true,
    write: true,
    delete: false,
    admin: false,
  });
  const [expiresIn, setExpiresIn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalErr(null);
    if (!name.trim()) {
      setLocalErr(t('views.tokens.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
      };
      if (expiresIn) {
        body.expires_in = expiresIn;
      }
      if (permMode === 'rbac') {
        body.permissions = [];
      } else if (permMode === 'custom') {
        const picked = PERM_OPTIONS.filter((p) => custom[p]);
        body.permissions = picked;
      }

      const data = await apiFetch('/api/v1/auth/tokens', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const plain = (data as { token?: string })?.token;
      if (typeof plain === 'string') {
        onCreated(plain);
      } else {
        setLocalErr(t('views.tokens.createdNoToken'));
        onClose();
      }
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : t('views.tokens.requestFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-content modal-wide">
        <div className="modal-header">
          <h3>{t('views.tokens.createApiToken')}</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form className="modal-body" onSubmit={submit}>
          {localErr && <div className="tokens-alert">{localErr}</div>}
          <div className="form-group">
            <label htmlFor="ct-name">{t('views.tokens.name')}</label>
            <input
              id="ct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder={t('views.tokens.tokenNamePlaceholder')}
            />
          </div>
          <div className="form-group">
            <label htmlFor="ct-desc">{t('views.tokens.description')}</label>
            <textarea
              id="ct-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('views.tokens.optional')}
            />
          </div>
          <div className="form-group">
            <label>{t('views.tokens.ossPermissions')}</label>
            <select value={permMode} onChange={(e) => setPermMode(e.target.value as PermMode)}>
              <option value="default">{t('views.tokens.defaultReadWrite')}</option>
              <option value="custom">{t('views.tokens.custom')}</option>
              <option value="rbac">{t('views.tokens.noneRbacOnly')}</option>
            </select>
            <p className="rbac-hint">{t('views.tokens.rbacOnlyHint')}</p>
          </div>
          {permMode === 'custom' && (
            <div className="form-group">
              <label>{t('views.tokens.scopes')}</label>
              <div className="perm-checkboxes">
                {PERM_OPTIONS.map((p) => (
                  <label key={p}>
                    <input
                      type="checkbox"
                      checked={custom[p]}
                      onChange={(e) => setCustom({ ...custom, [p]: e.target.checked })}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="ct-exp">{t('views.tokens.expiresIn')}</label>
            <select id="ct-exp" value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
              <option value="">{t('views.tokens.never')}</option>
              <option value="24h">{t('views.tokens.hours24')}</option>
              <option value="7d">{t('views.tokens.days7')}</option>
              <option value="30d">{t('views.tokens.days30')}</option>
              <option value="90d">{t('views.tokens.days90')}</option>
            </select>
          </div>
          <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
            <button type="button" className="btn btn-outlined" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
              {t('views.tokens.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditTokenModal({
  token,
  onClose,
  onSaved,
}: {
  token: TokenInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { apiFetch } = useApiFetch({ handleLicense: false, handleFeature: true });
  const [name, setName] = useState(token.name);
  const [description, setDescription] = useState(token.description || '');
  const [permMode, setPermMode] = useState<PermMode>(() => permModeFromToken(token));
  const [custom, setCustom] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = { read: false, write: false, delete: false, admin: false };
    for (const p of token.permissions || []) {
      if (p in m) m[p] = true;
    }
    return m;
  });
  const [expiresIn, setExpiresIn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalErr(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
      };
      if (permMode === 'rbac') {
        body.permissions = [];
      } else if (permMode === 'custom') {
        body.permissions = PERM_OPTIONS.filter((p) => custom[p]);
      } else {
        body.permissions = ['read', 'write'];
      }
      if (expiresIn) {
        body.expires_in = expiresIn;
      }

      await apiFetch(`/api/v1/auth/tokens/${token.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : t('views.tokens.requestFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-content modal-wide">
        <div className="modal-header">
          <h3>{t('views.tokens.editToken')}</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form className="modal-body" onSubmit={submit}>
          {localErr && <div className="tokens-alert">{localErr}</div>}
          <div className="form-group">
            <label>{t('views.tokens.name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>{t('views.tokens.description')}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="form-group">
            <label>{t('views.tokens.ossPermissions')}</label>
            <select value={permMode} onChange={(e) => setPermMode(e.target.value as PermMode)}>
              <option value="default">{t('views.tokens.defaultReadWrite')}</option>
              <option value="custom">{t('views.tokens.custom')}</option>
              <option value="rbac">{t('views.tokens.noneRbacOnly')}</option>
            </select>
          </div>
          {permMode === 'custom' && (
            <div className="form-group">
              <label>{t('views.tokens.scopes')}</label>
              <div className="perm-checkboxes">
                {PERM_OPTIONS.map((p) => (
                  <label key={p}>
                    <input
                      type="checkbox"
                      checked={custom[p]}
                      onChange={(e) => setCustom({ ...custom, [p]: e.target.checked })}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="form-group">
            <label>{t('views.tokens.extendExpiry')}</label>
            <select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
              <option value="">{t('views.tokens.doNotChange')}</option>
              <option value="24h">{t('views.tokens.hours24')}</option>
              <option value="7d">{t('views.tokens.days7')}</option>
              <option value="30d">{t('views.tokens.days30')}</option>
              <option value="90d">{t('views.tokens.days90')}</option>
            </select>
            <p className="rbac-hint">{t('views.tokens.extendExpiryHint')}</p>
          </div>
          <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
            <button type="button" className="btn btn-outlined" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <Loader2 className="spin" size={16} /> : null}
              {t('views.tokens.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  description,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-content confirm-modal">
        <div className="modal-header confirm-modal-header">
          <h3 className="confirm-modal-title">
            {danger && <AlertTriangle size={18} className="confirm-modal-danger-icon" />}
            {title}
          </h3>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body confirm-modal-body">
          <p className="confirm-modal-description">{description}</p>
        </div>
        <div className="modal-actions confirm-modal-actions">
          <button type="button" className="btn btn-outlined" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger confirm-action-btn' : 'btn btn-primary confirm-action-btn'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="spin" size={16} /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

