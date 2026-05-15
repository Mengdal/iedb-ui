import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, Edit2, Plus, RefreshCw, Shield, Trash2, UserPlus, Users, X,
  Search, Key, Loader2, Copy, Ban, RotateCcw, KeyRound,
  AlertTriangle, MoreVertical, Check, Minus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import './Rbac.css';

// ─── Types ──────────────────────────────────────────────
type Id = number;
type NodeType = 'organization' | 'team' | 'role';
type TabType = 'rbac' | 'tokens';

interface Organization { id: Id; name: string; description?: string; enabled: boolean; }
interface Team { id: Id; organization_id: Id; name: string; description?: string; enabled: boolean; }
interface Role { id: Id; team_id: Id; database_pattern: string; permissions: string[]; description?: string; enabled: boolean; }
interface MeasurementPermission { id: Id; role_id: Id; measurement_pattern: string; permissions: string[]; }
interface TokenInfo { id: Id; name: string; description?: string; permissions: string[]; created_at: string; last_used_at?: string; enabled: boolean; expires_at?: string; }

const ROLE_PERM_OPTIONS = ['read', 'write', 'delete', 'admin'] as const;
const DEFAULT_MEAS_PERM_MAP: Record<string, boolean> = { read: true, write: true, delete: false, admin: false };

function serverBaseUrl(protocol: string, host: string) { return `${protocol}${host}`.replace(/\/$/, ''); }
function permsToMap(perms: string[]) { return { read: perms.includes('read'), write: perms.includes('write'), delete: perms.includes('delete'), admin: perms.includes('admin') }; }
function mapToPerms(map: Record<string, boolean>) { return ROLE_PERM_OPTIONS.filter((p) => map[p]); }
function permModeLabel(perms: string[]): string { if (!perms.length) return 'RBAC'; const s = new Set(perms); if (s.size === 2 && s.has('read') && s.has('write')) return '默认'; return '自定义'; }
function permModeLabelEn(perms: string[]): string { if (!perms.length) return 'RBAC'; const s = new Set(perms); if (s.size === 2 && s.has('read') && s.has('write')) return 'Default'; return 'Custom'; }
function formatTs(iso?: string) { if (!iso) return '—'; try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } }

// ─── Main Page ──────────────────────────────────────────
export default function Rbac() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.toLowerCase().startsWith('zh');
  const { activeServer } = useServers();
  const [activeTab, setActiveTab] = useState<TabType>('rbac');

  const headers = useMemo(() => activeServer ? { Authorization: `Bearer ${activeServer.token}`, 'Content-Type': 'application/json' as const } : null, [activeServer]);
  const baseUrl = useMemo(() => activeServer ? serverBaseUrl(activeServer.protocol, activeServer.host) : '', [activeServer]);

  const apiJson = useCallback(async (url: string, init?: RequestInit) => {
    if (!headers) throw new Error('No auth headers');
    const res = await fetch(url, { ...init, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }, [headers]);

  return (
    <div className="rbac-page">
      <div className="rbac-header">
        <div>
          <h1>{t('nav.permission')}</h1>
          <p>{isZh ? '管理组织、团队、角色和访问令牌' : 'Manage organizations, teams, roles and access tokens'}</p>
        </div>
      </div>

      {!activeServer && <div className="rbac-alert">{t('views.rbac.selectServerFirst')}</div>}

      <div className="rbac-tabs">
        <button className={`rbac-tab ${activeTab === 'rbac' ? 'active' : ''}`} onClick={() => setActiveTab('rbac')}>
          <Shield size={15} /> {isZh ? 'RBAC 体系' : 'RBAC'}
        </button>
        <button className={`rbac-tab ${activeTab === 'tokens' ? 'active' : ''}`} onClick={() => setActiveTab('tokens')}>
          <Key size={15} /> {isZh ? 'Token 管理' : 'Tokens'}
        </button>
      </div>

      {activeTab === 'rbac' && <RBACTab headers={headers} baseUrl={baseUrl} apiJson={apiJson} />}
      {activeTab === 'tokens' && <TokenTab headers={headers} baseUrl={baseUrl} apiJson={apiJson} />}
    </div>
  );
}

// ─── RBAC Tab ───────────────────────────────────────────
function RBACTab({ headers, baseUrl, apiJson }: { headers: Record<string, string> | null; baseUrl: string; apiJson: (url: string, init?: RequestInit) => Promise<any> }) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.toLowerCase().startsWith('zh');

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [measPerms, setMeasPerms] = useState<MeasurementPermission[]>([]);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [teamTokenIds, setTeamTokenIds] = useState<Id[]>([]);

  const [selectedType, setSelectedType] = useState<NodeType | null>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treeSearch, setTreeSearch] = useState('');

  const [orgModal, setOrgModal] = useState<{ open: boolean; edit?: Organization }>({ open: false });
  const [teamModal, setTeamModal] = useState<{ open: boolean; edit?: Team; orgId?: Id }>({ open: false });
  const [roleModal, setRoleModal] = useState<{ open: boolean; edit?: Role; teamId?: Id }>({ open: false });
  const [measModalOpen, setMeasModalOpen] = useState(false);

  // Token bind modal (single-step)
  const [bindModalOpen, setBindModalOpen] = useState(false);
  const [bindTokenSearch, setBindTokenSearch] = useState('');
  const [bindSelectedTokenId, setBindSelectedTokenId] = useState<Id | null>(null);
  const [bindPermPreview, setBindPermPreview] = useState<any>(null);

  // Resizable tree
  const [treeWidth, setTreeWidth] = useState(340);
  const resizeRef = useRef<HTMLDivElement>(null);

  const selectedOrg = useMemo(() => selectedType === 'organization' ? orgs.find(o => o.id === selectedId) || null : null, [selectedType, selectedId, orgs]);
  const selectedTeam = useMemo(() => selectedType === 'team' ? teams.find(t => t.id === selectedId) || null : null, [selectedType, selectedId, teams]);
  const selectedRole = useMemo(() => selectedType === 'role' ? roles.find(r => r.id === selectedId) || null : null, [selectedType, selectedId, roles]);

  const teamsByOrg = useMemo(() => { const m = new Map<Id, Team[]>(); teams.forEach(t => { const l = m.get(t.organization_id) || []; l.push(t); m.set(t.organization_id, l); }); return m; }, [teams]);
  const rolesByTeam = useMemo(() => { const m = new Map<Id, Role[]>(); roles.forEach(r => { const l = m.get(r.team_id) || []; l.push(r); m.set(r.team_id, l); }); return m; }, [roles]);
  const selectedRoleMeasPerms = useMemo(() => selectedRole ? measPerms.filter(m => m.role_id === selectedRole.id) : [], [selectedRole, measPerms]);
  const teamTokens = useMemo(() => tokens.filter(t => teamTokenIds.includes(t.id)), [tokens, teamTokenIds]);

  // Stats
  const orgTeamCount = useMemo(() => selectedOrg ? teamsByOrg.get(selectedOrg.id)?.length || 0 : 0, [selectedOrg, teamsByOrg]);
  const orgRoleCount = useMemo(() => selectedOrg ? (teamsByOrg.get(selectedOrg.id) || []).reduce((s, t) => s + (rolesByTeam.get(t.id)?.length || 0), 0) : 0, [selectedOrg, teamsByOrg, rolesByTeam]);
  const teamRoleCount = useMemo(() => selectedTeam ? rolesByTeam.get(selectedTeam.id)?.length || 0 : 0, [selectedTeam, rolesByTeam]);

  // Filtered tree
  const filteredOrgs = useMemo(() => {
    if (!treeSearch.trim()) return orgs;
    const q = treeSearch.toLowerCase();
    return orgs.filter(o => {
      if (o.name.toLowerCase().includes(q)) return true;
      const tms = teamsByOrg.get(o.id) || [];
      return tms.some(t => {
        if (t.name.toLowerCase().includes(q)) return true;
        const rls = rolesByTeam.get(t.id) || [];
        return rls.some(r => r.database_pattern.toLowerCase().includes(q));
      });
    });
  }, [orgs, treeSearch, teamsByOrg, rolesByTeam]);

  const loadBase = useCallback(async () => {
    if (!headers || !baseUrl) return;
    const [orgData, tokenData] = await Promise.all([
      apiJson(`${baseUrl}/api/v1/rbac/organizations`),
      apiJson(`${baseUrl}/api/v1/auth/tokens`),
    ]);
    setOrgs(Array.isArray(orgData.organizations) ? orgData.organizations : []);
    setTokens(Array.isArray(tokenData.tokens) ? tokenData.tokens : []);
  }, [headers, baseUrl, apiJson]);

  const loadTeamsForOrg = useCallback(async (orgId: Id) => {
    if (!baseUrl) return;
    const data = await apiJson(`${baseUrl}/api/v1/rbac/organizations/${orgId}/teams`);
    const rows = Array.isArray(data.teams) ? data.teams as Team[] : [];
    setTeams(prev => [...prev.filter(t => t.organization_id !== orgId), ...rows]);
  }, [baseUrl, apiJson]);

  const loadRolesForTeam = useCallback(async (teamId: Id) => {
    if (!baseUrl) return;
    const data = await apiJson(`${baseUrl}/api/v1/rbac/teams/${teamId}/roles`);
    const rows = Array.isArray(data.roles) ? data.roles as Role[] : [];
    setRoles(prev => [...prev.filter(r => r.team_id !== teamId), ...rows]);
  }, [baseUrl, apiJson]);

  const loadMeasurementsForRole = useCallback(async (roleId: Id) => {
    if (!baseUrl) return;
    const data = await apiJson(`${baseUrl}/api/v1/rbac/roles/${roleId}/measurements`);
    const rows = Array.isArray(data.measurement_permissions) ? data.measurement_permissions as MeasurementPermission[] : [];
    setMeasPerms(prev => [...prev.filter(m => m.role_id !== roleId), ...rows]);
  }, [baseUrl, apiJson]);

  const loadTeamMembers = useCallback(async (teamId: Id) => {
    if (!baseUrl || !headers) return;
    const matches = await Promise.all(tokens.map(async tk => {
      const data = await apiJson(`${baseUrl}/api/v1/auth/tokens/${tk.id}/teams`);
      return (Array.isArray(data.teams) && data.teams.some((t: any) => t.id === teamId)) ? tk.id : null;
    }));
    setTeamTokenIds(matches.filter((x): x is number => x !== null));
  }, [baseUrl, headers, tokens, apiJson]);

  useEffect(() => {
    if (!headers || !baseUrl) return;
    (async () => { setLoading(true); setError(null); try { await loadBase(); } catch (e) { setError(e instanceof Error ? e.message : t('views.rbac.loadFailed')); } finally { setLoading(false); } })();
  }, [headers, baseUrl, loadBase]);

  useEffect(() => { if (selectedOrg) loadTeamsForOrg(selectedOrg.id).catch(e => setError(e instanceof Error ? e.message : '')); }, [selectedOrg, loadTeamsForOrg]);
  useEffect(() => { if (selectedTeam) Promise.all([loadRolesForTeam(selectedTeam.id), loadTeamMembers(selectedTeam.id)]).catch(e => setError(e instanceof Error ? e.message : '')); }, [selectedTeam, loadRolesForTeam, loadTeamMembers]);
  useEffect(() => { if (selectedRole) loadMeasurementsForRole(selectedRole.id).catch(e => setError(e instanceof Error ? e.message : '')); }, [selectedRole, loadMeasurementsForRole]);

  // Resizable tree drag
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX; const startW = treeWidth;
    const onMove = (ev: MouseEvent) => { const w = Math.max(260, Math.min(600, startW + ev.clientX - startX)); setTreeWidth(w); };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }, [treeWidth]);

  // CRUD
  const deleteOrganization = async (id: Id) => {
    try { await apiJson(`${baseUrl}/api/v1/rbac/organizations/${id}`, { method: 'DELETE' }); setOrgs(p => p.filter(x => x.id !== id)); setTeams(p => p.filter(x => x.organization_id !== id)); if (selectedType === 'organization' && selectedId === id) { setSelectedType(null); setSelectedId(null); } } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };
  const deleteTeam = async (id: Id) => {
    try { await apiJson(`${baseUrl}/api/v1/rbac/teams/${id}`, { method: 'DELETE' }); setTeams(p => p.filter(x => x.id !== id)); setRoles(p => p.filter(x => x.team_id !== id)); if (selectedType === 'team' && selectedId === id) { setSelectedType(null); setSelectedId(null); } } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };
  const deleteRole = async (id: Id) => {
    try { await apiJson(`${baseUrl}/api/v1/rbac/roles/${id}`, { method: 'DELETE' }); setRoles(p => p.filter(x => x.id !== id)); setMeasPerms(p => p.filter(x => x.role_id !== id)); if (selectedType === 'role' && selectedId === id) { setSelectedType(null); setSelectedId(null); } } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };
  const saveOrg = async (name: string, edit?: Organization) => {
    try { if (edit) { await apiJson(`${baseUrl}/api/v1/rbac/organizations/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); } else { await apiJson(`${baseUrl}/api/v1/rbac/organizations`, { method: 'POST', body: JSON.stringify({ name }) }); } setOrgModal({ open: false }); await loadBase(); } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  };
  const saveTeam = async (name: string, modal: { edit?: Team; orgId?: Id }) => {
    try { if (modal.edit) { await apiJson(`${baseUrl}/api/v1/rbac/teams/${modal.edit.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await loadTeamsForOrg(modal.edit.organization_id); } else if (modal.orgId) { await apiJson(`${baseUrl}/api/v1/rbac/organizations/${modal.orgId}/teams`, { method: 'POST', body: JSON.stringify({ name }) }); await loadTeamsForOrg(modal.orgId); } setTeamModal({ open: false }); } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  };
  const saveRole = async (database_pattern: string, permissionsMap: Record<string, boolean>, modal: { edit?: Role; teamId?: Id }) => {
    const permissions = mapToPerms(permissionsMap); if (!permissions.length) return setError('Permissions cannot be empty');
    try { if (modal.edit) { await apiJson(`${baseUrl}/api/v1/rbac/roles/${modal.edit.id}`, { method: 'PATCH', body: JSON.stringify({ database_pattern, permissions }) }); await loadRolesForTeam(modal.edit.team_id); } else if (modal.teamId) { await apiJson(`${baseUrl}/api/v1/rbac/teams/${modal.teamId}/roles`, { method: 'POST', body: JSON.stringify({ database_pattern, permissions }) }); await loadRolesForTeam(modal.teamId); } setRoleModal({ open: false }); } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  };
  const createMeasurementPermission = async (pattern: string, permsMap: Record<string, boolean>) => {
    if (!selectedRole) return; const permissions = mapToPerms(permsMap); if (!permissions.length) return setError('Permissions cannot be empty');
    try { await apiJson(`${baseUrl}/api/v1/rbac/roles/${selectedRole.id}/measurements`, { method: 'POST', body: JSON.stringify({ measurement_pattern: pattern, permissions }) }); await loadMeasurementsForRole(selectedRole.id); } catch (e) { setError(e instanceof Error ? e.message : 'Create failed'); }
  };
  const deleteMeasurementPermission = async (id: Id) => {
    try { await apiJson(`${baseUrl}/api/v1/rbac/measurement-permissions/${id}`, { method: 'DELETE' }); setMeasPerms(p => p.filter(x => x.id !== id)); } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  // Token bind
  const openBindModal = () => { setBindModalOpen(true); setBindTokenSearch(''); setBindSelectedTokenId(null); setBindPermPreview(null); };
  const bindTokenToTeam = async () => {
    if (!selectedTeam || !bindSelectedTokenId) return;
    try { await apiJson(`${baseUrl}/api/v1/auth/tokens/${bindSelectedTokenId}/teams`, { method: 'POST', body: JSON.stringify({ team_id: selectedTeam.id }) }); setBindModalOpen(false); await loadTeamMembers(selectedTeam.id); } catch (e) { setError(e instanceof Error ? e.message : 'Bind failed'); }
  };
  const unbindTokenFromTeam = async (tokenId: Id) => {
    if (!selectedTeam) return;
    try { await apiJson(`${baseUrl}/api/v1/auth/tokens/${tokenId}/teams/${selectedTeam.id}`, { method: 'DELETE' }); await loadTeamMembers(selectedTeam.id); } catch (e) { setError(e instanceof Error ? e.message : 'Unbind failed'); }
  };

  const filteredTokens = useMemo(() => {
    const q = bindTokenSearch.toLowerCase(); if (!q) return tokens; return tokens.filter(tk => tk.name.toLowerCase().includes(q) || (tk.description || '').toLowerCase().includes(q));
  }, [tokens, bindTokenSearch]);

  useEffect(() => {
    if (!bindSelectedTokenId || !baseUrl) { setBindPermPreview(null); return; }
    (async () => { try { const data = await apiJson(`${baseUrl}/api/v1/auth/tokens/${bindSelectedTokenId}/permissions`); setBindPermPreview(data); } catch { setBindPermPreview(null); } })();
  }, [bindSelectedTokenId, baseUrl, apiJson]);

  return (
    <>
      {error && <div className="rbac-alert">{error} <button className="icon-btn" onClick={() => setError(null)}><X size={14} /></button></div>}

      <div className="rbac-layout" style={{ '--tree-width': `${treeWidth}px` } as React.CSSProperties}>
        <aside className="rbac-tree">
          <div className="rbac-tree-head">
            <strong>{t('views.rbac.resourceTree')}</strong>
            <button className="btn btn-primary btn-small" onClick={() => setOrgModal({ open: true })}><Plus size={14} /> {t('views.rbac.organization')}</button>
          </div>
          <div className="rbac-tree-search">
            <Search size={14} />
            <input placeholder={isZh ? '搜索组织、团队、角色...' : 'Search...'} value={treeSearch} onChange={e => setTreeSearch(e.target.value)} />
            {treeSearch && <button className="icon-btn" onClick={() => setTreeSearch('')}><X size={12} /></button>}
          </div>

          <div className="rbac-tree-content">
            {filteredOrgs.map(org => (
              <div key={org.id} className="tree-node-group">
                <button className={`tree-node ${selectedType === 'organization' && selectedId === org.id ? 'active' : ''} ${!org.enabled ? 'disabled' : ''}`} onClick={() => { setSelectedType('organization'); setSelectedId(org.id); }}>
                  <span className="tree-node-main"><Building2 size={14} /><span>{org.name}</span></span>
                  <span className="node-actions">
                    <span className={`status-dot ${org.enabled ? 'on' : 'off'}`} />
                    <Edit2 size={13} onClick={e => { e.stopPropagation(); setOrgModal({ open: true, edit: org }); }} />
                    <Trash2 size={13} onClick={e => { e.stopPropagation(); deleteOrganization(org.id); }} />
                  </span>
                </button>
                <div className="tree-children">
                  {(teamsByOrg.get(org.id) || []).map(team => (
                    <div key={team.id}>
                      <button className={`tree-node team ${selectedType === 'team' && selectedId === team.id ? 'active' : ''} ${!team.enabled ? 'disabled' : ''}`} onClick={() => { setSelectedType('team'); setSelectedId(team.id); }}>
                        <span className="tree-node-main"><Users size={14} /><span>{team.name}</span></span>
                        <span className="node-actions">
                          <span className={`status-dot ${team.enabled ? 'on' : 'off'}`} />
                          <Edit2 size={13} onClick={e => { e.stopPropagation(); setTeamModal({ open: true, edit: team }); }} />
                          <Trash2 size={13} onClick={e => { e.stopPropagation(); deleteTeam(team.id); }} />
                        </span>
                      </button>
                      <div className="tree-children">
                        {(rolesByTeam.get(team.id) || []).map(role => (
                          <button key={role.id} className={`tree-node role ${selectedType === 'role' && selectedId === role.id ? 'active' : ''} ${!role.enabled ? 'disabled' : ''}`} onClick={() => { setSelectedType('role'); setSelectedId(role.id); }}>
                            <span className="tree-node-main"><Shield size={14} /><span>{role.database_pattern}</span></span>
                            <span className="node-actions">
                              <span className="perm-tags">{role.permissions.map(p => <span key={p} className="perm-tag">{p[0]}</span>)}</span>
                              <span className={`status-dot ${role.enabled ? 'on' : 'off'}`} />
                              <Edit2 size={13} onClick={e => { e.stopPropagation(); setRoleModal({ open: true, edit: role }); }} />
                              <Trash2 size={13} onClick={e => { e.stopPropagation(); deleteRole(role.id); }} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {filteredOrgs.length === 0 && <div className="tree-empty">{isZh ? '无匹配结果' : 'No matches'}</div>}
          </div>
        </aside>

        <div className="rbac-resize-handle" onMouseDown={onResizeStart} ref={resizeRef} />

        <main className="rbac-detail">
          {!selectedType && <div className="placeholder"><Shield size={40} strokeWidth={1} /><p>{t('views.rbac.pickNodeHint')}</p></div>}

          {selectedType === 'organization' && selectedOrg && (
            <div className="detail-card">
              <div className="detail-title-row">
                <div className="detail-title-left">
                  <h3>{selectedOrg.name}</h3>
                  <span className="detail-badge">{t('views.rbac.organizationLabel')}</span>
                  <span className="detail-meta">ID: {selectedOrg.id} · {selectedOrg.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '禁用' : 'Disabled'}</>}</span>
                </div>
                <div className="detail-title-right">
                  <button className="btn btn-outlined btn-small" onClick={() => setOrgModal({ open: true, edit: selectedOrg })}><Edit2 size={14} /> {isZh ? '编辑' : 'Edit'}</button>
                  <button className="btn btn-outlined btn-small" onClick={() => deleteOrganization(selectedOrg.id)}><Trash2 size={14} /> {isZh ? '删除' : 'Delete'}</button>
                </div>
              </div>

              <div className="detail-stats">
                <div className="stat-card"><div className="stat-value">{orgTeamCount}</div><div className="stat-label">{isZh ? '团队' : 'Teams'}</div></div>
                <div className="stat-card"><div className="stat-value">{orgRoleCount}</div><div className="stat-label">{isZh ? '角色' : 'Roles'}</div></div>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{isZh ? '团队列表' : 'Teams'}</h4>
                  <button className="btn btn-primary btn-small" onClick={() => setTeamModal({ open: true, orgId: selectedOrg.id })}><Plus size={14} /> {t('views.rbac.team')}</button>
                </div>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? '名称' : 'Name'}</th><th>{isZh ? '角色数' : 'Roles'}</th><th>{isZh ? '状态' : 'Status'}</th></tr></thead>
                  <tbody>
                    {(teamsByOrg.get(selectedOrg.id) || []).map(tm => (
                      <tr key={tm.id} className="clickable-row" onClick={() => { setSelectedType('team'); setSelectedId(tm.id); }}>
                        <td><Users size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{tm.name}</td>
                        <td>{rolesByTeam.get(tm.id)?.length || 0}</td>
                        <td>{tm.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '禁用' : 'Disabled'}</>}</td>
                      </tr>
                    ))}
                    {(teamsByOrg.get(selectedOrg.id) || []).length === 0 && <tr><td colSpan={3} className="rbac-empty">{isZh ? '暂无团队' : 'No teams'}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedType === 'team' && selectedTeam && (
            <div className="detail-card">
              <div className="detail-title-row">
                <div className="detail-title-left">
                  <h3>{selectedTeam.name}</h3>
                  <span className="detail-badge">{t('views.rbac.teamLabel')}</span>
                  <span className="detail-meta">ID: {selectedTeam.id} · {selectedTeam.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '禁用' : 'Disabled'}</>}</span>
                </div>
                <div className="detail-title-right">
                  <button className="btn btn-outlined btn-small" onClick={() => setTeamModal({ open: true, edit: selectedTeam })}><Edit2 size={14} /> {isZh ? '编辑' : 'Edit'}</button>
                  <button className="btn btn-outlined btn-small" onClick={() => deleteTeam(selectedTeam.id)}><Trash2 size={14} /> {isZh ? '删除' : 'Delete'}</button>
                </div>
              </div>

              <div className="detail-stats">
                <div className="stat-card"><div className="stat-value">{teamRoleCount}</div><div className="stat-label">{isZh ? '角色' : 'Roles'}</div></div>
                <div className="stat-card"><div className="stat-value">{teamTokens.length}</div><div className="stat-label">{isZh ? '成员' : 'Members'}</div></div>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{isZh ? '成员 (Token)' : 'Members (Token)'}</h4>
                  <button className="btn btn-primary btn-small" onClick={openBindModal}><UserPlus size={14} /> {isZh ? '添加成员' : 'Add member'}</button>
                </div>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? '名称' : 'Name'}</th><th>{isZh ? '状态' : 'Status'}</th><th>{isZh ? '权限模式' : 'Perm mode'}</th><th>{isZh ? '操作' : 'Actions'}</th></tr></thead>
                  <tbody>
                    {teamTokens.map(tk => (
                      <tr key={tk.id}>
                        <td>{tk.name}</td>
                        <td>{tk.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '已吊销' : 'Revoked'}</>}</td>
                        <td><span className="perm-mode-badge">{isZh ? permModeLabel(tk.permissions) : permModeLabelEn(tk.permissions)}</span></td>
                        <td><button className="btn btn-ghost btn-small" onClick={() => unbindTokenFromTeam(tk.id)}><Trash2 size={13} /> {t('views.rbac.unbind')}</button></td>
                      </tr>
                    ))}
                    {teamTokens.length === 0 && <tr><td colSpan={4} className="rbac-empty">{t('views.rbac.noTeamTokenMembers')}</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{isZh ? '角色列表' : 'Roles'}</h4>
                  <button className="btn btn-primary btn-small" onClick={() => setRoleModal({ open: true, teamId: selectedTeam.id })}><Plus size={14} /> {t('views.rbac.newRole')}</button>
                </div>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? 'Pattern' : 'Pattern'}</th><th>{isZh ? '权限' : 'Permissions'}</th><th>{isZh ? '测量权限数' : 'Meas. perms'}</th><th>{isZh ? '状态' : 'Status'}</th></tr></thead>
                  <tbody>
                    {(rolesByTeam.get(selectedTeam.id) || []).map(role => (
                      <tr key={role.id} className="clickable-row" onClick={() => { setSelectedType('role'); setSelectedId(role.id); }}>
                        <td><Shield size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{role.database_pattern}</td>
                        <td><div className="perm-badges">{role.permissions.map(p => <span key={p} className="perm-badge">{p}</span>)}</div></td>
                        <td>{measPerms.filter(m => m.role_id === role.id).length}</td>
                        <td>{role.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '禁用' : 'Disabled'}</>}</td>
                      </tr>
                    ))}
                    {(rolesByTeam.get(selectedTeam.id) || []).length === 0 && <tr><td colSpan={4} className="rbac-empty">{t('views.rbac.noData')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedType === 'role' && selectedRole && (
            <div className="detail-card">
              <div className="detail-title-row">
                <div className="detail-title-left">
                  <h3>{selectedRole.database_pattern}</h3>
                  <span className="detail-badge">{t('views.rbac.roleLabel')}</span>
                  <span className="detail-meta">ID: {selectedRole.id} · {selectedRole.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '禁用' : 'Disabled'}</>}</span>
                </div>
                <div className="detail-title-right">
                  <button className="btn btn-outlined btn-small" onClick={() => setRoleModal({ open: true, edit: selectedRole })}><Edit2 size={14} /> {isZh ? '编辑' : 'Edit'}</button>
                  <button className="btn btn-outlined btn-small" onClick={() => deleteRole(selectedRole.id)}><Trash2 size={14} /> {isZh ? '删除' : 'Delete'}</button>
                </div>
              </div>

              <div className="detail-section">
                <h4>{isZh ? '数据库级权限' : 'Database permissions'}</h4>
                <div className="perm-matrix">
                  <table className="perm-matrix-table">
                    <thead><tr>{ROLE_PERM_OPTIONS.map(p => <th key={p}>{p}</th>)}</tr></thead>
                    <tbody><tr>{ROLE_PERM_OPTIONS.map(p => <td key={p}>{selectedRole.permissions.includes(p) ? <Check size={16} className="perm-check" /> : <Minus size={16} className="perm-uncheck" />}</td>)}</tr></tbody>
                  </table>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{t('views.rbac.measurementPermissions')}</h4>
                  <button className="btn btn-primary btn-small" onClick={() => setMeasModalOpen(true)}><Plus size={14} /> {isZh ? '新增' : 'Add'}</button>
                </div>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? 'Pattern' : 'Pattern'}</th><th>{isZh ? '权限' : 'Permissions'}</th><th>{isZh ? '操作' : 'Actions'}</th></tr></thead>
                  <tbody>
                    {selectedRoleMeasPerms.map(m => (
                      <tr key={m.id}>
                        <td>{m.measurement_pattern}</td>
                        <td><div className="perm-badges">{m.permissions.map(p => <span key={p} className="perm-badge">{p}</span>)}</div></td>
                        <td><button className="btn btn-ghost btn-small" onClick={() => deleteMeasurementPermission(m.id)}><Trash2 size={13} /> {t('views.rbac.delete')}</button></td>
                      </tr>
                    ))}
                    {selectedRoleMeasPerms.length === 0 && <tr><td colSpan={3} className="rbac-empty">{t('views.rbac.noData')}</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="detail-section">
                <h4>{isZh ? '权限生效预览' : 'Effective preview'}</h4>
                <div className="perm-preview-box">
                  <div className="perm-preview-row">
                    <span className="perm-preview-db">{selectedRole.database_pattern}</span>
                    <span className="perm-preview-perms">{ROLE_PERM_OPTIONS.map(p => <span key={p} className={`perm-preview-tag ${selectedRole.permissions.includes(p) ? 'on' : 'off'}`}>{p}</span>)}</span>
                  </div>
                  {selectedRoleMeasPerms.map(m => (
                    <div key={m.id} className="perm-preview-row sub">
                      <span className="perm-preview-db">{m.measurement_pattern}</span>
                      <span className="perm-preview-perms">{ROLE_PERM_OPTIONS.map(p => <span key={p} className={`perm-preview-tag ${m.permissions.includes(p) ? 'on' : 'off'}`}>{p}</span>)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      {orgModal.open && <OrgModal title={orgModal.edit ? t('views.rbac.editOrganization') : t('views.rbac.newOrganization')} initialName={orgModal.edit?.name || ''} onClose={() => setOrgModal({ open: false })} onSave={name => saveOrg(name, orgModal.edit)} />}
      {teamModal.open && <TeamModal title={teamModal.edit ? t('views.rbac.editTeam') : t('views.rbac.newTeam')} initialName={teamModal.edit?.name || ''} onClose={() => setTeamModal({ open: false })} onSave={name => saveTeam(name, teamModal)} />}
      {roleModal.open && <RoleModal title={roleModal.edit ? t('views.rbac.editRole') : t('views.rbac.newRole')} initialPattern={roleModal.edit?.database_pattern || '*'} initialPerms={permsToMap(roleModal.edit?.permissions || ['read', 'write'])} onClose={() => setRoleModal({ open: false })} onSave={(pattern, perms) => saveRole(pattern, perms, roleModal)} />}
      {measModalOpen && selectedRole && <MeasurementPermissionModal onClose={() => setMeasModalOpen(false)} onSave={async (pattern, perms) => { await createMeasurementPermission(pattern, perms); setMeasModalOpen(false); }} initialPattern="*" initialPerms={{ ...DEFAULT_MEAS_PERM_MAP }} />}

      {bindModalOpen && selectedTeam && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={() => setBindModalOpen(false)}>
          <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><UserPlus size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />{isZh ? `添加成员到 ${selectedTeam.name}` : `Add member to ${selectedTeam.name}`}</h3>
              <button className="icon-btn" onClick={() => setBindModalOpen(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="bind-search">
                <Search size={14} />
                <input placeholder={isZh ? '搜索 Token...' : 'Search tokens...'} value={bindTokenSearch} onChange={e => setBindTokenSearch(e.target.value)} />
              </div>
              <div className="bind-token-list">
                {filteredTokens.map(tk => (
                  <label key={tk.id} className={`bind-token-item ${bindSelectedTokenId === tk.id ? 'selected' : ''}`}>
                    <input type="radio" name="bindToken" checked={bindSelectedTokenId === tk.id} onChange={() => setBindSelectedTokenId(tk.id)} />
                    <span className="bind-token-name">{tk.name} <span className="bind-token-id">#{tk.id}</span></span>
                    <span className={`status-dot ${tk.enabled ? 'on' : 'off'}`} />
                    <span className="bind-token-perms">{isZh ? permModeLabel(tk.permissions) : permModeLabelEn(tk.permissions)}</span>
                  </label>
                ))}
                {filteredTokens.length === 0 && <div className="rbac-empty">{isZh ? '无匹配 Token' : 'No matching tokens'}</div>}
              </div>
              {bindSelectedTokenId && bindPermPreview && (
                <div className="bind-preview">
                  <h4>{isZh ? '权限预览' : 'Permission preview'}</h4>
                  <PermMatrixPreview data={bindPermPreview} />
                </div>
              )}
            </div>
            <div className="modal-actions modal-actions-bottom">
              <button className="btn btn-outlined" onClick={() => setBindModalOpen(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" disabled={!bindSelectedTokenId} onClick={bindTokenToTeam}>{isZh ? '确认添加' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Token Tab ──────────────────────────────────────────
function TokenTab({ headers, baseUrl, apiJson }: { headers: Record<string, string> | null; baseUrl: string; apiJson: (url: string, init?: RequestInit) => Promise<any> }) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.toLowerCase().startsWith('zh');

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editToken, setEditToken] = useState<TokenInfo | null>(null);
  const [deleteId, setDeleteId] = useState<Id | null>(null);
  const [revokeId, setRevokeId] = useState<Id | null>(null);
  const [rotateId, setRotateId] = useState<Id | null>(null);
  const [rbacToken, setRbacToken] = useState<TokenInfo | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<Id | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchTokens = useCallback(async () => {
    if (!headers || !baseUrl) return; setLoading(true); setError(null);
    try {
      const data = await apiJson(`${baseUrl}/api/v1/auth/tokens`);
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load tokens'); setTokens([]); }
    finally { setLoading(false); }
  }, [headers, baseUrl, apiJson]);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  // Close menu on outside click
  useEffect(() => {
    if (menuOpenId === null) return;
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenId(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  const filtered = useMemo(() => { const q = search.toLowerCase(); if (!q) return tokens; return tokens.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)); }, [tokens, search]);

  const copySecret = async (v: string) => { try { await navigator.clipboard.writeText(v); } catch {} };

  return (
    <>
      {error && <div className="rbac-alert">{error} <button className="icon-btn" onClick={() => setError(null)}><X size={14} /></button></div>}

      <div className="tokens-toolbar-bar">
        <div className="tokens-search-wrap">
          <Search size={14} />
          <input className="tokens-search" type="search" placeholder={t('views.tokens.filterPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-outlined" onClick={fetchTokens} disabled={!headers || loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> {t('common.refresh')}</button>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)} disabled={!headers}><Plus size={16} /> {t('views.tokens.createToken')}</button>
      </div>

      {loading && tokens.length === 0 && <div className="loading-inline"><Loader2 className="spin" size={18} /> {t('views.tokens.loadingTokens')}</div>}
      {!loading && tokens.length === 0 && !error && <div className="tokens-empty">{t('views.tokens.noTokensYet')}</div>}
      {!loading && filtered.length === 0 && tokens.length > 0 && <div className="tokens-empty">{t('views.tokens.noTokensMatch')}</div>}

      {filtered.length > 0 && (
        <div className="tokens-table-wrap">
          <table className="tokens-table">
            <thead>
              <tr>
                <th>{t('views.tokens.name')}</th>
                <th>{isZh ? '权限模式' : 'Perm mode'}</th>
                <th>{isZh ? '所属团队' : 'Teams'}</th>
                <th>{t('views.tokens.status')}</th>
                <th>{t('views.tokens.created')}</th>
                <th>{t('views.tokens.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id}>
                  <td className="token-name-cell">{item.name}{item.description ? <div className="token-desc">{item.description}</div> : null}</td>
                  <td><span className="perm-mode-badge">{isZh ? permModeLabel(item.permissions) : permModeLabelEn(item.permissions)}</span></td>
                  <td className="text-muted">—</td>
                  <td><span className={`status-badge ${item.enabled ? 'active' : 'revoked'}`}>{item.enabled ? t('views.tokens.active') : t('views.tokens.revoked')}</span></td>
                  <td className="text-muted">{formatTs(item.created_at)}</td>
                  <td>
                    <div className="token-actions-cell" style={{ position: 'relative' }}>
                      <button className="btn btn-ghost btn-small" onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}><MoreVertical size={14} /></button>
                      {menuOpenId === item.id && (
                        <div className="token-dropdown-menu" ref={menuRef}>
                          <button onClick={() => { setRbacToken(item); setMenuOpenId(null); }}><Shield size={14} /> RBAC</button>
                          <button onClick={() => { setEditToken(item); setMenuOpenId(null); }}><Edit2 size={14} /> {t('views.tokens.edit')}</button>
                          <button onClick={() => { setRotateId(item.id); setMenuOpenId(null); }} disabled={!item.enabled}><RotateCcw size={14} /> {t('views.tokens.rotate')}</button>
                          <button onClick={() => { setRevokeId(item.id); setMenuOpenId(null); }} disabled={!item.enabled}><Ban size={14} /> {t('views.tokens.revoke')}</button>
                          <div className="dropdown-divider" />
                          <button className="danger" onClick={() => { setDeleteId(item.id); setMenuOpenId(null); }}><Trash2 size={14} /> {t('views.tokens.delete')}</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {createOpen && headers && <CreateTokenModal baseUrl={baseUrl} headers={headers} onClose={() => setCreateOpen(false)} onCreated={plain => { setCreateOpen(false); setSecret({ title: t('views.tokens.tokenCreated'), value: plain }); fetchTokens(); }} />}
      {editToken && headers && <EditTokenModal token={editToken} baseUrl={baseUrl} headers={headers} onClose={() => setEditToken(null)} onSaved={() => { setEditToken(null); fetchTokens(); }} />}
      {secret && (
        <div className="modal-overlay" role="dialog" aria-modal onClick={() => setSecret(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{secret.title}</h3><button className="icon-btn" onClick={() => setSecret(null)}><X size={18} /></button></div>
            <div className="modal-body">
              <p className="hint-text">{t('views.tokens.copyNowHint')}</p>
              <div className="secret-box">{secret.value}</div>
              <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
                <button className="btn btn-primary" onClick={() => copySecret(secret.value)}><Copy size={16} /> {t('views.tokens.copyToClipboard')}</button>
                <button className="btn btn-outlined" onClick={() => setSecret(null)}>{t('views.tokens.done')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteId !== null && headers && <ConfirmModal title={t('views.tokens.deleteToken')} description={t('views.tokens.deleteTokenDesc')} confirmLabel={t('views.tokens.delete')} danger onCancel={() => setDeleteId(null)} onConfirm={async () => { await apiJson(`${baseUrl}/api/v1/auth/tokens/${deleteId}`, { method: 'DELETE' }); setDeleteId(null); fetchTokens(); }} />}
      {revokeId !== null && headers && <ConfirmModal title={t('views.tokens.revokeToken')} description={t('views.tokens.revokeTokenDesc')} confirmLabel={t('views.tokens.revoke')} danger onCancel={() => setRevokeId(null)} onConfirm={async () => { await apiJson(`${baseUrl}/api/v1/auth/tokens/${revokeId}/revoke`, { method: 'POST' }); setRevokeId(null); fetchTokens(); }} />}
      {rotateId !== null && headers && <ConfirmModal title={t('views.tokens.rotateToken')} description={t('views.tokens.rotateTokenDesc')} confirmLabel={t('views.tokens.rotate')} onCancel={() => setRotateId(null)} onConfirm={async () => { const data = await apiJson(`${baseUrl}/api/v1/auth/tokens/${rotateId}/rotate`, { method: 'POST' }); setRotateId(null); fetchTokens(); if (data.new_token) setSecret({ title: t('views.tokens.newTokenSecret'), value: data.new_token }); }} />}
      {rbacToken && headers && <RbacModal token={rbacToken} baseUrl={baseUrl} headers={headers} onClose={() => setRbacToken(null)} />}
    </>
  );
}

// ─── Shared Components ──────────────────────────────────

function PermMatrixPreview({ data }: { data: any }) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.toLowerCase().startsWith('zh');
  if (!data) return null;

  const perms = data.permissions || data.effective_permissions || [];
  if (!Array.isArray(perms) || perms.length === 0) {
    return <div className="rbac-empty">{isZh ? '无生效权限' : 'No effective permissions'}</div>;
  }

  return (
    <div className="perm-matrix-preview">
      <table className="perm-matrix-table">
        <thead><tr><th>{isZh ? '数据库' : 'Database'}</th><th>{isZh ? '来源' : 'Source'}</th>{ROLE_PERM_OPTIONS.map(p => <th key={p}>{p}</th>)}</tr></thead>
        <tbody>
          {perms.map((p: any, i: number) => (
            <tr key={i}>
              <td>{p.database_pattern || p.pattern || '*'}</td>
              <td className="text-muted">{p.source || p.role_name || '—'}</td>
              {ROLE_PERM_OPTIONS.map(perm => <td key={perm}>{(p.permissions || []).includes(perm) ? <Check size={14} className="perm-check" /> : <Minus size={14} className="perm-uncheck" />}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmModal({ title, description, confirmLabel, danger, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void | Promise<void>; }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-overlay" role="dialog" aria-modal onClick={onCancel}>
      <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{danger && <AlertTriangle size={18} style={{ color: '#ef4444', marginRight: 8 }} />}{title}</h3><button className="icon-btn" onClick={onCancel}><X size={18} /></button></div>
        <div className="modal-body"><p className="hint-text">{description}</p></div>
        <div className="modal-actions modal-actions-bottom">
          <button className="btn btn-outlined" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{busy ? <Loader2 className="spin" size={16} /> : null}{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function OrgModal({ title, initialName, onClose, onSave }: { title: string; initialName: string; onClose: () => void; onSave: (name: string) => void; }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  return (
    <div className="modal-overlay" role="dialog" aria-modal onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body"><div className="inline-form"><input value={name} onChange={e => setName(e.target.value)} placeholder={t('views.rbac.organizationName')} autoFocus /></div></div>
        <div className="modal-actions modal-actions-bottom"><button className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" onClick={() => onSave(name.trim())}>{t('common.apply')}</button></div>
      </div>
    </div>
  );
}

function TeamModal({ title, initialName, onClose, onSave }: { title: string; initialName: string; onClose: () => void; onSave: (name: string) => void; }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  return (
    <div className="modal-overlay" role="dialog" aria-modal onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body"><div className="inline-form"><input value={name} onChange={e => setName(e.target.value)} placeholder={t('views.rbac.teamName')} autoFocus /></div></div>
        <div className="modal-actions modal-actions-bottom"><button className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" onClick={() => onSave(name.trim())}>{t('common.apply')}</button></div>
      </div>
    </div>
  );
}

function RoleModal({ title, initialPattern, initialPerms, onClose, onSave }: { title: string; initialPattern: string; initialPerms: Record<string, boolean>; onClose: () => void; onSave: (pattern: string, perms: Record<string, boolean>) => void; }) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.toLowerCase().startsWith('zh');
  const [pattern, setPattern] = useState(initialPattern);
  const [perms, setPerms] = useState(initialPerms);
  return (
    <div className="modal-overlay" role="dialog" aria-modal onClick={onClose}>
      <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="inline-form">
            <p className="hint-text">{isZh ? 'Role permissions 为数据库级权限：匹配到的 database_pattern 会获得对应 read/write/delete/admin 权限。' : 'Role permissions are database-level: matching database_pattern grants the selected read/write/delete/admin permissions.'}</p>
            <input value={pattern} onChange={e => setPattern(e.target.value)} placeholder={t('views.rbac.databasePattern')} />
            <div className="perm-row">{ROLE_PERM_OPTIONS.map(p => <label key={p}><input type="checkbox" checked={perms[p]} onChange={e => setPerms(prev => ({ ...prev, [p]: e.target.checked }))} />{p}</label>)}</div>
          </div>
        </div>
        <div className="modal-actions modal-actions-bottom"><button className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" onClick={() => onSave(pattern.trim(), perms)}>{t('common.apply')}</button></div>
      </div>
    </div>
  );
}

function MeasurementPermissionModal({ initialPattern, initialPerms, onClose, onSave }: { initialPattern: string; initialPerms: Record<string, boolean>; onClose: () => void; onSave: (pattern: string, perms: Record<string, boolean>) => void | Promise<void>; }) {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState(initialPattern || '*');
  const [perms, setPerms] = useState(initialPerms);
  return (
    <div className="modal-overlay" role="dialog" aria-modal onClick={onClose}>
      <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{t('views.rbac.newMeasurementPermission')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="inline-form">
            <p className="hint-text">{t('views.rbac.measurementPermissionHelp')}</p>
            <input value={pattern} onChange={e => setPattern(e.target.value)} placeholder={t('views.rbac.measurementPatternPlaceholder')} />
            <div className="perm-row">{ROLE_PERM_OPTIONS.map(p => <label key={p}><input type="checkbox" checked={perms[p]} onChange={e => setPerms(prev => ({ ...prev, [p]: e.target.checked }))} />{p}</label>)}</div>
          </div>
        </div>
        <div className="modal-actions modal-actions-bottom"><button className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-primary" onClick={() => onSave(pattern.trim(), perms)}>{t('views.rbac.save')}</button></div>
      </div>
    </div>
  );
}

function RbacModal({ token, baseUrl, headers, onClose }: { token: TokenInfo; baseUrl: string; headers: Record<string, string>; onClose: () => void; }) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.toLowerCase().startsWith('zh');
  const [teams, setTeams] = useState<{ id: number; organization_id: number; name: string; enabled: boolean }[]>([]);
  const [allTeams, setAllTeams] = useState<{ id: number; organization_id: number; name: string }[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [permData, setPermData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rbacErr, setRbacErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setRbacErr(null);
    try {
      const [tRes, pRes] = await Promise.all([
        fetch(`${baseUrl}/api/v1/auth/tokens/${token.id}/teams`, { headers }),
        fetch(`${baseUrl}/api/v1/auth/tokens/${token.id}/permissions`, { headers }),
      ]);
      const tData = await tRes.json().catch(() => ({}));
      const pData = await pRes.json().catch(() => ({}));
      if (tRes.ok && tData.success && Array.isArray(tData.teams)) setTeams(tData.teams); else setTeams([]);
      if (pRes.ok && pData.success) setPermData(pData); else setPermData(null);

      // Load all teams for dropdown
      try {
        const orgRes = await fetch(`${baseUrl}/api/v1/rbac/organizations`, { headers });
        const orgData = await orgRes.json().catch(() => ({}));
        if (orgRes.ok && Array.isArray(orgData.organizations)) {
          const all: any[] = [];
          for (const org of orgData.organizations) {
            const tmRes = await fetch(`${baseUrl}/api/v1/rbac/organizations/${org.id}/teams`, { headers });
            const tmData = await tmRes.json().catch(() => ({}));
            if (tmRes.ok && Array.isArray(tmData.teams)) all.push(...tmData.teams);
          }
          setAllTeams(all);
        }
      } catch { /* ignore */ }
    } catch (e) { setRbacErr(e instanceof Error ? e.message : t('views.tokens.failedToLoad')); }
    finally { setLoading(false); }
  }, [baseUrl, headers, token.id, t]);

  useEffect(() => { load(); }, [load]);

  const addTeam = async () => {
    const id = parseInt(selectedTeamId, 10); if (!Number.isFinite(id) || id <= 0) return;
    setBusy(true);
    try { const res = await fetch(`${baseUrl}/api/v1/auth/tokens/${token.id}/teams`, { method: 'POST', headers, body: JSON.stringify({ team_id: id }) }); if (!res.ok) { const d = await res.json().catch(() => ({})); setRbacErr(d.error || t('views.tokens.addFailed')); return; } setSelectedTeamId(''); load(); } finally { setBusy(false); }
  };

  const removeTeam = async (teamId: number) => {
    setBusy(true);
    try { const res = await fetch(`${baseUrl}/api/v1/auth/tokens/${token.id}/teams/${teamId}`, { method: 'DELETE', headers }); if (!res.ok) { setRbacErr(t('views.tokens.removeFailed')); return; } load(); } finally { setBusy(false); }
  };

  const availableTeams = allTeams.filter(t => !teams.some(et => et.id === t.id));

  return (
    <div className="modal-overlay" role="dialog" aria-modal onClick={onClose}>
      <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3><Users size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />{isZh ? `RBAC — ${token.name}` : `RBAC — ${token.name}`}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          {rbacErr && <div className="rbac-alert">{rbacErr}</div>}
          {loading ? <div className="loading-inline"><Loader2 className="spin" size={18} /> {t('views.tokens.loading')}</div> : (
            <>
              <h4>{t('views.tokens.teamMemberships')}</h4>
              {teams.length === 0 && !rbacErr ? <p className="hint-text">{t('views.tokens.noTeams')}</p> : (
                teams.map(tm => (
                  <div key={tm.id} className="rbac-team-row">
                    <div><strong>{tm.name}</strong><span className="text-muted" style={{ marginLeft: 8 }}>id {tm.id} · org {tm.organization_id}</span></div>
                    <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => removeTeam(tm.id)}>{t('views.tokens.remove')}</button>
                  </div>
                ))
              )}

              <div className="rbac-add-row">
                <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
                  <option value="">{isZh ? '选择团队...' : 'Select team...'}</option>
                  {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name} (#{t.id})</option>)}
                </select>
                <button className="btn btn-outlined btn-small" disabled={busy || !selectedTeamId} onClick={addTeam}>{t('views.tokens.addToTeam')}</button>
              </div>

              <h4 style={{ marginTop: 24 }}>{t('views.tokens.effectivePermissions')}</h4>
              <PermMatrixPreview data={permData} />
            </>
          )}
          <div className="modal-actions" style={{ border: 'none', marginTop: 16, paddingTop: 0 }}>
            <button className="btn btn-outlined" onClick={onClose}>{t('common.close')}</button>
            <button className="btn btn-primary" onClick={load} disabled={loading}><RefreshCw size={16} /> {t('views.tokens.reload')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateTokenModal({ baseUrl, headers, onClose, onCreated }: { baseUrl: string; headers: Record<string, string>; onClose: () => void; onCreated: (plain: string) => void; }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permMode, setPermMode] = useState<'default' | 'custom' | 'rbac'>('default');
  const [custom, setCustom] = useState<Record<string, boolean>>({ read: true, write: true, delete: false, admin: false });
  const [expiresIn, setExpiresIn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLocalErr(null); if (!name.trim()) { setLocalErr(t('views.tokens.nameRequired')); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), description: description.trim() || undefined };
      if (expiresIn) body.expires_in = expiresIn;
      if (permMode === 'rbac') body.permissions = []; else if (permMode === 'custom') body.permissions = ROLE_PERM_OPTIONS.filter(p => custom[p]);
      const res = await fetch(`${baseUrl}/api/v1/auth/tokens`, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setLocalErr((data as any).error || t('views.tokens.createFailed')); return; }
      if (typeof data.token === 'string') onCreated(data.token); else { setLocalErr(t('views.tokens.createdNoToken')); onClose(); }
    } catch (err) { setLocalErr(err instanceof Error ? err.message : t('views.tokens.requestFailed')); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-content modal-wide">
        <div className="modal-header"><h3>{t('views.tokens.createApiToken')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <form className="modal-body" onSubmit={submit}>
          {localErr && <div className="rbac-alert">{localErr}</div>}
          <div className="form-group"><label>{t('views.tokens.name')}</label><input value={name} onChange={e => setName(e.target.value)} required placeholder={t('views.tokens.tokenNamePlaceholder')} /></div>
          <div className="form-group"><label>{t('views.tokens.description')}</label><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t('views.tokens.optional')} /></div>
          <div className="form-group">
            <label>{t('views.tokens.ossPermissions')}</label>
            <select value={permMode} onChange={e => setPermMode(e.target.value as any)}>
              <option value="default">{t('views.tokens.defaultReadWrite')}</option>
              <option value="custom">{t('views.tokens.custom')}</option>
              <option value="rbac">{t('views.tokens.noneRbacOnly')}</option>
            </select>
            <p className="hint-text">{t('views.tokens.rbacOnlyHint')}</p>
          </div>
          {permMode === 'custom' && <div className="form-group"><label>{t('views.tokens.scopes')}</label><div className="perm-checkboxes">{ROLE_PERM_OPTIONS.map(p => <label key={p}><input type="checkbox" checked={custom[p]} onChange={e => setCustom({ ...custom, [p]: e.target.checked })} />{p}</label>)}</div></div>}
          <div className="form-group">
            <label>{t('views.tokens.expiresIn')}</label>
            <select value={expiresIn} onChange={e => setExpiresIn(e.target.value)}>
              <option value="">{t('views.tokens.never')}</option>
              <option value="24h">{t('views.tokens.hours24')}</option>
              <option value="7d">{t('views.tokens.days7')}</option>
              <option value="30d">{t('views.tokens.days30')}</option>
              <option value="90d">{t('views.tokens.days90')}</option>
            </select>
          </div>
          <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
            <button type="button" className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />} {t('views.tokens.create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditTokenModal({ token, baseUrl, headers, onClose, onSaved }: { token: TokenInfo; baseUrl: string; headers: Record<string, string>; onClose: () => void; onSaved: () => void; }) {
  const { t } = useTranslation();
  const [name, setName] = useState(token.name);
  const [description, setDescription] = useState(token.description || '');
  const [permMode, setPermMode] = useState<'default' | 'custom' | 'rbac'>(() => { if (!token.permissions?.length) return 'rbac'; const s = new Set(token.permissions); if (s.size === 2 && s.has('read') && s.has('write')) return 'default'; return 'custom'; });
  const [custom, setCustom] = useState<Record<string, boolean>>(() => { const m: Record<string, boolean> = { read: false, write: false, delete: false, admin: false }; for (const p of token.permissions || []) { if (p in m) m[p] = true; } return m; });
  const [expiresIn, setExpiresIn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLocalErr(null); setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), description: description.trim() };
      if (permMode === 'rbac') body.permissions = []; else if (permMode === 'custom') body.permissions = ROLE_PERM_OPTIONS.filter(p => custom[p]); else body.permissions = ['read', 'write'];
      if (expiresIn) body.expires_in = expiresIn;
      const res = await fetch(`${baseUrl}/api/v1/auth/tokens/${token.id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setLocalErr(d.error || t('views.tokens.updateFailed')); return; }
      onSaved();
    } catch (err) { setLocalErr(err instanceof Error ? err.message : t('views.tokens.requestFailed')); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-content modal-wide">
        <div className="modal-header"><h3>{t('views.tokens.editToken')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <form className="modal-body" onSubmit={submit}>
          {localErr && <div className="rbac-alert">{localErr}</div>}
          <div className="form-group"><label>{t('views.tokens.name')}</label><input value={name} onChange={e => setName(e.target.value)} required /></div>
          <div className="form-group"><label>{t('views.tokens.description')}</label><textarea value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div className="form-group"><label>{t('views.tokens.ossPermissions')}</label><select value={permMode} onChange={e => setPermMode(e.target.value as any)}><option value="default">{t('views.tokens.defaultReadWrite')}</option><option value="custom">{t('views.tokens.custom')}</option><option value="rbac">{t('views.tokens.noneRbacOnly')}</option></select></div>
          {permMode === 'custom' && <div className="form-group"><label>{t('views.tokens.scopes')}</label><div className="perm-checkboxes">{ROLE_PERM_OPTIONS.map(p => <label key={p}><input type="checkbox" checked={custom[p]} onChange={e => setCustom({ ...custom, [p]: e.target.checked })} />{p}</label>)}</div></div>}
          <div className="form-group"><label>{t('views.tokens.extendExpiry')}</label><select value={expiresIn} onChange={e => setExpiresIn(e.target.value)}><option value="">{t('views.tokens.doNotChange')}</option><option value="24h">{t('views.tokens.hours24')}</option><option value="7d">{t('views.tokens.days7')}</option><option value="30d">{t('views.tokens.days30')}</option><option value="90d">{t('views.tokens.days90')}</option></select><p className="hint-text">{t('views.tokens.extendExpiryHint')}</p></div>
          <div className="modal-actions" style={{ border: 'none', marginTop: 0, paddingTop: 0 }}>
            <button type="button" className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? <Loader2 className="spin" size={16} /> : null} {t('views.tokens.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
