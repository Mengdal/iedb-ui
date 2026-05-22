import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, Edit2, Plus, Shield, Trash2, UserPlus, Users, X,
  Search,
  Check, Minus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import { serverBaseUrl } from '../utils/server';
import ConfirmModal from '../components/ConfirmModal';
import './Rbac.css';

// ─── Types ──────────────────────────────────────────────
type Id = number;
type NodeType = 'organization' | 'team' | 'role';

interface Organization { id: Id; name: string; description?: string; enabled: boolean; }
interface Team { id: Id; organization_id: Id; name: string; description?: string; enabled: boolean; }
interface Role { id: Id; team_id: Id; database_pattern: string; permissions: string[]; description?: string; }
interface MeasurementPermission { id: Id; role_id: Id; measurement_pattern: string; permissions: string[]; }
interface TokenInfo { id: Id; name: string; description?: string; permissions: string[]; created_at: string; last_used_at?: string; enabled: boolean; expires_at?: string; }

const ROLE_PERM_OPTIONS = ['read', 'write', 'delete', 'admin'] as const;
const DEFAULT_MEAS_PERM_MAP: Record<string, boolean> = { read: true, write: true, delete: false, admin: false };

function permsToMap(perms: string[]) { return { read: perms.includes('read'), write: perms.includes('write'), delete: perms.includes('delete'), admin: perms.includes('admin') }; }
function mapToPerms(map: Record<string, boolean>) { return ROLE_PERM_OPTIONS.filter((p) => map[p]); }
function permModeLabel(perms: string[]): string { return perms.length ? perms.join(', ') : 'RBAC'; }
// ─── Main Page ──────────────────────────────────────────
export default function Rbac() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.toLowerCase().startsWith('zh');
  const { activeServer } = useServers();

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
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1>{t('nav.rbac')}</h1>
          <p>{isZh ? '按组织、团队、角色管理数据访问权限' : 'Manage data access by organizations, teams and roles'}</p>
        </div>
      </div>

      {!activeServer && <div className="rbac-alert">{t('views.rbac.selectServerFirst')}</div>}

      <RBACTab headers={headers} baseUrl={baseUrl} apiJson={apiJson} />
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

  // Delete confirmation
  type DeleteTarget =
    | { type: 'organization'; id: Id; name: string }
    | { type: 'team'; id: Id; name: string }
    | { type: 'role'; id: Id; name: string }
    | { type: 'measurement'; id: Id };
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

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
          <p className="tree-hint">{isZh ? '层级：组织 → 团队 → 角色。Token 加入团队后自动继承团队下所有角色的权限。' : 'Hierarchy: Organization → Team → Role. Tokens joined to a team inherit all role permissions.'}</p>
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
                    <Trash2 size={13} onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'organization', id: org.id, name: org.name }); }} />
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
                          <Trash2 size={13} onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'team', id: team.id, name: team.name }); }} />
                        </span>
                      </button>
                      <div className="tree-children">
                        {(rolesByTeam.get(team.id) || []).map(role => (
                          <button key={role.id} className={`tree-node role ${selectedType === 'role' && selectedId === role.id ? 'active' : ''}`} onClick={() => { setSelectedType('role'); setSelectedId(role.id); }}>
                            <span className="tree-node-main"><Shield size={14} /><span>{role.database_pattern}</span></span>
                            <span className="node-actions">
                              <span className="perm-tags">{role.permissions.map(p => <span key={p} className="perm-tag">{p[0]}</span>)}</span>
                              <Edit2 size={13} onClick={e => { e.stopPropagation(); setRoleModal({ open: true, edit: role }); }} />
                              <Trash2 size={13} onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'role', id: role.id, name: role.database_pattern }); }} />
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
                  <span className="detail-meta">{selectedOrg.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '禁用' : 'Disabled'}</>}</span>
                </div>
                <div className="detail-title-right">
                  <button className="btn btn-outlined btn-small" onClick={() => setOrgModal({ open: true, edit: selectedOrg })}><Edit2 size={14} /> {isZh ? '编辑' : 'Edit'}</button>
                  <button className="btn btn-outlined btn-small" onClick={() => setDeleteTarget({ type: 'organization', id: selectedOrg.id, name: selectedOrg.name })}><Trash2 size={14} /> {isZh ? '删除' : 'Delete'}</button>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{isZh ? '团队列表' : 'Teams'}</h4>
                  <button className="btn btn-primary btn-small" onClick={() => setTeamModal({ open: true, orgId: selectedOrg.id })}><Plus size={14} /> {t('views.rbac.team')}</button>
                </div>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? '名称' : 'Name'}</th><th>{isZh ? '状态' : 'Status'}</th></tr></thead>
                  <tbody>
                    {(teamsByOrg.get(selectedOrg.id) || []).map(tm => (
                      <tr key={tm.id} className="clickable-row" onClick={() => { setSelectedType('team'); setSelectedId(tm.id); }}>
                        <td><Users size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{tm.name}</td>
                        <td>{tm.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '禁用' : 'Disabled'}</>}</td>
                      </tr>
                    ))}
                    {(teamsByOrg.get(selectedOrg.id) || []).length === 0 && <tr><td colSpan={2} className="rbac-empty">{isZh ? '暂无团队' : 'No teams'}</td></tr>}
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
                  <span className="detail-meta">{selectedTeam.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '禁用' : 'Disabled'}</>}</span>
                </div>
                <div className="detail-title-right">
                  <button className="btn btn-outlined btn-small" onClick={() => setTeamModal({ open: true, edit: selectedTeam })}><Edit2 size={14} /> {isZh ? '编辑' : 'Edit'}</button>
                  <button className="btn btn-outlined btn-small" onClick={() => setDeleteTarget({ type: 'team', id: selectedTeam.id, name: selectedTeam.name })}><Trash2 size={14} /> {isZh ? '删除' : 'Delete'}</button>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{isZh ? '成员 (Token)' : 'Members (Token)'}</h4>
                  <button className="btn btn-primary btn-small" onClick={openBindModal}><UserPlus size={14} /> {isZh ? '添加成员' : 'Add member'}</button>
                </div>
                <p className="section-hint">{isZh ? '将 Token 绑定到团队，该 Token 即可获得团队下所有角色定义的数据库权限。' : 'Bind a Token to this team to grant it all database permissions defined by the team\'s roles.'}</p>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? '名称' : 'Name'}</th><th>{isZh ? '状态' : 'Status'}</th><th>{isZh ? '权限' : 'Permissions'}</th><th>{isZh ? '操作' : 'Actions'}</th></tr></thead>
                  <tbody>
                    {teamTokens.map(tk => (
                      <tr key={tk.id}>
                        <td>{tk.name}</td>
                        <td>{tk.enabled ? <><span className="status-dot on" /> {isZh ? '启用' : 'Active'}</> : <><span className="status-dot off" /> {isZh ? '已吊销' : 'Revoked'}</>}</td>
                        <td><span className="perm-mode-badge">{permModeLabel(tk.permissions)}</span></td>
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
                <p className="section-hint">{isZh ? '每个角色定义一组 database_pattern + 权限（read/write/delete/admin）。"测量权限数"表示该角色下进一步按 measurement 细化的规则条数。' : 'Each role defines a database_pattern + permissions (read/write/delete/admin). "Meas. perms" counts fine-grained measurement-level rules under this role.'}</p>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? 'Pattern' : 'Pattern'}</th><th>{isZh ? '权限' : 'Permissions'}</th><th>{isZh ? '测量权限数' : 'Meas. perms'}</th></tr></thead>
                  <tbody>
                    {(rolesByTeam.get(selectedTeam.id) || []).map(role => (
                      <tr key={role.id} className="clickable-row" onClick={() => { setSelectedType('role'); setSelectedId(role.id); }}>
                        <td><Shield size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{role.database_pattern}</td>
                        <td><div className="perm-badges">{role.permissions.map(p => <span key={p} className="perm-badge">{p}</span>)}</div></td>
                        <td>{measPerms.filter(m => m.role_id === role.id).length}</td>
                      </tr>
                    ))}
                    {(rolesByTeam.get(selectedTeam.id) || []).length === 0 && <tr><td colSpan={3} className="rbac-empty">{t('views.rbac.noData')}</td></tr>}
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
                </div>
                <div className="detail-title-right">
                  <button className="btn btn-outlined btn-small" onClick={() => setRoleModal({ open: true, edit: selectedRole })}><Edit2 size={14} /> {isZh ? '编辑' : 'Edit'}</button>
                  <button className="btn btn-outlined btn-small" onClick={() => setDeleteTarget({ type: 'role', id: selectedRole.id, name: selectedRole.database_pattern })}><Trash2 size={14} /> {isZh ? '删除' : 'Delete'}</button>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{isZh ? '数据库级权限' : 'Database permissions'}</h4>
                </div>
                <p className="section-hint">{isZh ? '匹配 database_pattern 的数据库将获得对应权限。可用通配符 * 匹配所有数据库。' : 'Databases matching the database_pattern will receive the corresponding permissions. Use * to match all databases.'}</p>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? 'Pattern' : 'Pattern'}</th><th>{isZh ? '权限' : 'Permissions'}</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><Shield size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{selectedRole.database_pattern}</td>
                      <td><div className="perm-badges">{selectedRole.permissions.map(p => <span key={p} className="perm-badge">{p}</span>)}</div></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{t('views.rbac.measurementPermissions')}</h4>
                  <button className="btn btn-primary btn-small" onClick={() => setMeasModalOpen(true)}><Plus size={14} /> {isZh ? '新增' : 'Add'}</button>
                </div>
                <p className="section-hint">{isZh ? '在角色的数据库权限基础上，进一步按 measurement_pattern 限定可访问的表。例如 cpu_* 只允许访问以 cpu_ 开头的 measurement。' : 'On top of the role\'s database permissions, further restrict access by measurement_pattern. E.g. cpu_* only allows access to measurements starting with cpu_.'}</p>
                <table className="rbac-table">
                  <thead><tr><th>{isZh ? 'Pattern' : 'Pattern'}</th><th>{isZh ? '权限' : 'Permissions'}</th><th>{isZh ? '操作' : 'Actions'}</th></tr></thead>
                  <tbody>
                    {selectedRoleMeasPerms.map(m => (
                      <tr key={m.id}>
                        <td>{m.measurement_pattern}</td>
                        <td><div className="perm-badges">{m.permissions.map(p => <span key={p} className="perm-badge">{p}</span>)}</div></td>
                        <td><button className="btn btn-ghost btn-small" onClick={() => setDeleteTarget({ type: 'measurement', id: m.id })}><Trash2 size={13} /> {t('views.rbac.delete')}</button></td>
                      </tr>
                    ))}
                    {selectedRoleMeasPerms.length === 0 && <tr><td colSpan={3} className="rbac-empty">{t('views.rbac.noData')}</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h4>{isZh ? '权限生效预览' : 'Effective preview'}</h4>
                </div>
                <p className="section-hint">{isZh ? '展示该角色最终生效的权限组合：数据库级权限为基底，measurement 级规则在此基础上进一步收窄。' : 'Shows the effective permission combination: database-level permissions as the base, measurement rules further narrow the scope.'}</p>
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
                    <span className="bind-token-perms">{permModeLabel(tk.permissions)}</span>
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

      {deleteTarget && (
        <ConfirmModal
          title={t('views.rbac.delete')}
          description={
            deleteTarget.type === 'organization'
              ? t('views.rbac.deleteOrgConfirm', { name: deleteTarget.name })
              : deleteTarget.type === 'team'
              ? t('views.rbac.deleteTeamConfirm', { name: deleteTarget.name })
              : deleteTarget.type === 'role'
              ? t('views.rbac.deleteRoleConfirm', { name: deleteTarget.name })
              : t('views.rbac.deleteMeasPermConfirm')
          }
          confirmLabel={t('common.confirmDelete')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (deleteTarget.type === 'organization') deleteOrganization(deleteTarget.id);
            else if (deleteTarget.type === 'team') deleteTeam(deleteTarget.id);
            else if (deleteTarget.type === 'role') deleteRole(deleteTarget.id);
            else deleteMeasurementPermission(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
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
