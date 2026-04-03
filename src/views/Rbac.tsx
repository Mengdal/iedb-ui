import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Edit2, Plus, RefreshCw, Shield, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import './Rbac.css';

type Id = number;
type NodeType = 'organization' | 'team' | 'role';

interface Organization {
  id: Id;
  name: string;
  description?: string;
  enabled: boolean;
}

interface Team {
  id: Id;
  organization_id: Id;
  name: string;
  description?: string;
  enabled: boolean;
}

interface Role {
  id: Id;
  team_id: Id;
  database_pattern: string;
  permissions: string[];
  description?: string;
  enabled: boolean;
}

interface MeasurementPermission {
  id: Id;
  role_id: Id;
  measurement_pattern: string;
  permissions: string[];
}

interface TokenInfo {
  id: Id;
  name: string;
  enabled: boolean;
}

const ROLE_PERM_OPTIONS = ['read', 'write', 'delete', 'admin'] as const;

const DEFAULT_MEAS_PERM_MAP: Record<string, boolean> = {
  read: true,
  write: true,
  delete: false,
  admin: false,
};

function serverBaseUrl(protocol: string, host: string) {
  return `${protocol}${host}`.replace(/\/$/, '');
}

function permsToMap(perms: string[]) {
  return {
    read: perms.includes('read'),
    write: perms.includes('write'),
    delete: perms.includes('delete'),
    admin: perms.includes('admin'),
  };
}

function mapToPerms(map: Record<string, boolean>) {
  return ROLE_PERM_OPTIONS.filter((p) => map[p]);
}

export default function Rbac() {
  const { t } = useTranslation();
  const { activeServer } = useServers();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [measPerms, setMeasPerms] = useState<MeasurementPermission[]>([]);

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [teamTokenIds, setTeamTokenIds] = useState<Id[]>([]);

  const [selectedType, setSelectedType] = useState<NodeType | null>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgModal, setOrgModal] = useState<{ open: boolean; edit?: Organization }>({ open: false });
  const [teamModal, setTeamModal] = useState<{ open: boolean; edit?: Team; orgId?: Id }>({ open: false });
  const [roleModal, setRoleModal] = useState<{ open: boolean; edit?: Role; teamId?: Id }>({ open: false });

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardTokenId, setWizardTokenId] = useState<string>('');
  const [wizardPermPreview, setWizardPermPreview] = useState<string>('');

  const [newMeasPattern, setNewMeasPattern] = useState('*');
  const [newMeasPerms, setNewMeasPerms] = useState<Record<string, boolean>>(() => ({ ...DEFAULT_MEAS_PERM_MAP }));
  const [measModalOpen, setMeasModalOpen] = useState(false);

  const headers = useMemo(() => {
    if (!activeServer) return null;
    return {
      Authorization: `Bearer ${activeServer.token}`,
      'Content-Type': 'application/json' as const,
    };
  }, [activeServer]);

  const baseUrl = useMemo(() => {
    if (!activeServer) return '';
    return serverBaseUrl(activeServer.protocol, activeServer.host);
  }, [activeServer]);

  const selectedOrg = useMemo(
    () => (selectedType === 'organization' ? orgs.find((o) => o.id === selectedId) || null : null),
    [selectedType, selectedId, orgs]
  );

  const selectedTeam = useMemo(
    () => (selectedType === 'team' ? teams.find((t) => t.id === selectedId) || null : null),
    [selectedType, selectedId, teams]
  );

  const selectedRole = useMemo(
    () => (selectedType === 'role' ? roles.find((r) => r.id === selectedId) || null : null),
    [selectedType, selectedId, roles]
  );

  const teamsByOrg = useMemo(() => {
    const map = new Map<Id, Team[]>();
    teams.forEach((t) => {
      const list = map.get(t.organization_id) || [];
      list.push(t);
      map.set(t.organization_id, list);
    });
    return map;
  }, [teams]);

  const rolesByTeam = useMemo(() => {
    const map = new Map<Id, Role[]>();
    roles.forEach((r) => {
      const list = map.get(r.team_id) || [];
      list.push(r);
      map.set(r.team_id, list);
    });
    return map;
  }, [roles]);

  const selectedRoleMeasPerms = useMemo(
    () => (selectedRole ? measPerms.filter((m) => m.role_id === selectedRole.id) : []),
    [selectedRole, measPerms]
  );

  const teamTokens = useMemo(() => tokens.filter((t) => teamTokenIds.includes(t.id)), [tokens, teamTokenIds]);

  const apiJson = useCallback(async (url: string, init?: RequestInit) => {
    if (!headers) throw new Error('No auth headers');
    const res = await fetch(url, { ...init, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }, [headers]);

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
    const rows = Array.isArray(data.teams) ? (data.teams as Team[]) : [];
    setTeams((prev) => {
      const rest = prev.filter((t) => t.organization_id !== orgId);
      return [...rest, ...rows];
    });
  }, [baseUrl, apiJson]);

  const loadRolesForTeam = useCallback(async (teamId: Id) => {
    if (!baseUrl) return;
    const data = await apiJson(`${baseUrl}/api/v1/rbac/teams/${teamId}/roles`);
    const rows = Array.isArray(data.roles) ? (data.roles as Role[]) : [];
    setRoles((prev) => {
      const rest = prev.filter((r) => r.team_id !== teamId);
      return [...rest, ...rows];
    });
  }, [baseUrl, apiJson]);

  const loadMeasurementsForRole = useCallback(async (roleId: Id) => {
    if (!baseUrl) return;
    const data = await apiJson(`${baseUrl}/api/v1/rbac/roles/${roleId}/measurements`);
    const rows = Array.isArray(data.measurement_permissions) ? (data.measurement_permissions as MeasurementPermission[]) : [];
    setMeasPerms((prev) => {
      const rest = prev.filter((m) => m.role_id !== roleId);
      return [...rest, ...rows];
    });
  }, [baseUrl, apiJson]);

  const loadTeamMembers = useCallback(async (teamId: Id) => {
    if (!baseUrl || !headers) return;
    const tokenRows = tokens;
    const matches = await Promise.all(
      tokenRows.map(async (tk) => {
        const data = await apiJson(`${baseUrl}/api/v1/auth/tokens/${tk.id}/teams`);
        const inTeam = Array.isArray(data.teams) && (data.teams as Team[]).some((t) => t.id === teamId);
        return inTeam ? tk.id : null;
      })
    );
    setTeamTokenIds(matches.filter((x): x is number => x !== null));
  }, [baseUrl, headers, tokens, apiJson]);

  const refreshAll = useCallback(async () => {
    if (!headers || !baseUrl) return;
    setLoading(true);
    setError(null);
    try {
      await loadBase();
      for (const o of orgs) {
        await loadTeamsForOrg(o.id);
      }
      for (const t of teams) {
        await loadRolesForTeam(t.id);
      }
      if (selectedRole) await loadMeasurementsForRole(selectedRole.id);
      if (selectedTeam) await loadTeamMembers(selectedTeam.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('views.rbac.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [headers, baseUrl, loadBase, orgs, teams, selectedRole, selectedTeam, loadTeamsForOrg, loadRolesForTeam, loadMeasurementsForRole, loadTeamMembers]);

  useEffect(() => {
    if (!headers || !baseUrl) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadBase();
      } catch (e) {
        setError(e instanceof Error ? e.message : t('views.rbac.loadFailed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [headers, baseUrl, loadBase]);

  useEffect(() => {
    if (!selectedOrg) return;
    loadTeamsForOrg(selectedOrg.id).catch((e) => setError(e instanceof Error ? e.message : t('views.rbac.loadTeamsFailed')));
  }, [selectedOrg, loadTeamsForOrg]);

  useEffect(() => {
    if (!selectedTeam) return;
    Promise.all([loadRolesForTeam(selectedTeam.id), loadTeamMembers(selectedTeam.id)]).catch((e) =>
      setError(e instanceof Error ? e.message : 'Load team details failed')
    );
  }, [selectedTeam, loadRolesForTeam, loadTeamMembers]);

  useEffect(() => {
    if (!selectedRole) return;
    loadMeasurementsForRole(selectedRole.id).catch((e) => setError(e instanceof Error ? e.message : 'Load measurements failed'));
  }, [selectedRole, loadMeasurementsForRole]);

  const deleteOrganization = async (id: Id) => {
    try {
      await apiJson(`${baseUrl}/api/v1/rbac/organizations/${id}`, { method: 'DELETE' });
      setOrgs((prev) => prev.filter((x) => x.id !== id));
      setTeams((prev) => prev.filter((x) => x.organization_id !== id));
      if (selectedType === 'organization' && selectedId === id) {
        setSelectedType(null);
        setSelectedId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const deleteTeam = async (id: Id) => {
    try {
      await apiJson(`${baseUrl}/api/v1/rbac/teams/${id}`, { method: 'DELETE' });
      setTeams((prev) => prev.filter((x) => x.id !== id));
      setRoles((prev) => prev.filter((x) => x.team_id !== id));
      if (selectedType === 'team' && selectedId === id) {
        setSelectedType(null);
        setSelectedId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const deleteRole = async (id: Id) => {
    try {
      await apiJson(`${baseUrl}/api/v1/rbac/roles/${id}`, { method: 'DELETE' });
      setRoles((prev) => prev.filter((x) => x.id !== id));
      setMeasPerms((prev) => prev.filter((x) => x.role_id !== id));
      if (selectedType === 'role' && selectedId === id) {
        setSelectedType(null);
        setSelectedId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const saveOrg = async (name: string, edit?: Organization) => {
    try {
      if (edit) {
        await apiJson(`${baseUrl}/api/v1/rbac/organizations/${edit.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
      } else {
        await apiJson(`${baseUrl}/api/v1/rbac/organizations`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
      }
      setOrgModal({ open: false });
      await loadBase();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save organization failed');
    }
  };

  const saveTeam = async (name: string, modal: { edit?: Team; orgId?: Id }) => {
    try {
      if (modal.edit) {
        await apiJson(`${baseUrl}/api/v1/rbac/teams/${modal.edit.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        await loadTeamsForOrg(modal.edit.organization_id);
      } else if (modal.orgId) {
        await apiJson(`${baseUrl}/api/v1/rbac/organizations/${modal.orgId}/teams`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        await loadTeamsForOrg(modal.orgId);
      }
      setTeamModal({ open: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save team failed');
    }
  };

  const saveRole = async (
    database_pattern: string,
    permissionsMap: Record<string, boolean>,
    modal: { edit?: Role; teamId?: Id }
  ) => {
    const permissions = mapToPerms(permissionsMap);
    if (!permissions.length) return setError('Permissions cannot be empty');

    try {
      if (modal.edit) {
        await apiJson(`${baseUrl}/api/v1/rbac/roles/${modal.edit.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ database_pattern, permissions }),
        });
        await loadRolesForTeam(modal.edit.team_id);
      } else if (modal.teamId) {
        await apiJson(`${baseUrl}/api/v1/rbac/teams/${modal.teamId}/roles`, {
          method: 'POST',
          body: JSON.stringify({ database_pattern, permissions }),
        });
        await loadRolesForTeam(modal.teamId);
      }
      setRoleModal({ open: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save role failed');
    }
  };

  const createMeasurementPermission = async (
    pattern: string = newMeasPattern,
    permsMap: Record<string, boolean> = newMeasPerms
  ) => {
    if (!selectedRole) return;
    const permissions = mapToPerms(permsMap);
    if (!permissions.length) return setError('Permissions cannot be empty');
    try {
      await apiJson(`${baseUrl}/api/v1/rbac/roles/${selectedRole.id}/measurements`, {
        method: 'POST',
        body: JSON.stringify({ measurement_pattern: pattern, permissions }),
      });
      setNewMeasPattern('*');
      setNewMeasPerms({ ...DEFAULT_MEAS_PERM_MAP });
      await loadMeasurementsForRole(selectedRole.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create measurement permission failed');
    }
  };

  const deleteMeasurementPermission = async (id: Id) => {
    try {
      await apiJson(`${baseUrl}/api/v1/rbac/measurement-permissions/${id}`, { method: 'DELETE' });
      setMeasPerms((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete measurement permission failed');
    }
  };

  const openWizard = () => {
    setWizardOpen(true);
    setWizardStep(1);
    setWizardTokenId('');
    setWizardPermPreview('');
  };

  const loadWizardPreview = async (tokenId: Id) => {
    try {
      const data = await apiJson(`${baseUrl}/api/v1/auth/tokens/${tokenId}/permissions`);
      setWizardPermPreview(JSON.stringify(data, null, 2));
    } catch {
      setWizardPermPreview('无法加载该 token 的生效权限预览');
    }
  };

  const bindTokenToTeam = async () => {
    if (!selectedTeam || !wizardTokenId) return;
    try {
      await apiJson(`${baseUrl}/api/v1/auth/tokens/${Number(wizardTokenId)}/teams`, {
        method: 'POST',
        body: JSON.stringify({ team_id: selectedTeam.id }),
      });
      setWizardOpen(false);
      await loadTeamMembers(selectedTeam.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bind failed');
    }
  };

  const unbindTokenFromTeam = async (tokenId: Id) => {
    if (!selectedTeam) return;
    try {
      await apiJson(`${baseUrl}/api/v1/auth/tokens/${tokenId}/teams/${selectedTeam.id}`, { method: 'DELETE' });
      await loadTeamMembers(selectedTeam.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbind failed');
    }
  };

  return (
    <div className="rbac-page">
      <div className="rbac-header">
        <div>
          <h1>{t('views.rbac.title')}</h1>
          <p>{t('views.rbac.subtitle')}</p>
        </div>
        <button className="btn btn-outlined" onClick={refreshAll} disabled={!activeServer || loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> {t('common.refresh')}
        </button>
      </div>

      {!activeServer && <div className="rbac-alert">{t('views.rbac.selectServerFirst')}</div>}
      {error && <div className="rbac-alert">{error}</div>}

      <div className="rbac-layout">
        <aside className="rbac-tree">
          <div className="rbac-tree-head">
            <strong>{t('views.rbac.resourceTree')}</strong>
            <button className="btn btn-primary btn-small" onClick={() => setOrgModal({ open: true })}>
              <Plus size={14} /> {t('views.rbac.organization')}
            </button>
          </div>

          {orgs.map((org) => (
            <div key={org.id} className="tree-node-group">
              <button
                className={`tree-node ${selectedType === 'organization' && selectedId === org.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedType('organization');
                  setSelectedId(org.id);
                }}
              >
                <span className="tree-node-main"><Building2 size={14} /><span>{org.name}</span></span>
                <span className="node-actions">
                  <Edit2 size={14} onClick={(e) => { e.stopPropagation(); setOrgModal({ open: true, edit: org }); }} />
                  <Trash2 size={14} onClick={(e) => { e.stopPropagation(); deleteOrganization(org.id); }} />
                </span>
              </button>

              <div className="tree-children">
                {(teamsByOrg.get(org.id) || []).map((team) => (
                  <div key={team.id}>
                    <button
                      className={`tree-node team ${selectedType === 'team' && selectedId === team.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedType('team');
                        setSelectedId(team.id);
                      }}
                    >
                      <span className="tree-node-main"><Users size={14} /><span>{team.name}</span></span>
                      <span className="node-actions">
                        <Edit2 size={14} onClick={(e) => { e.stopPropagation(); setTeamModal({ open: true, edit: team }); }} />
                        <Trash2 size={14} onClick={(e) => { e.stopPropagation(); deleteTeam(team.id); }} />
                      </span>
                    </button>

                    <div className="tree-children">
                      {(rolesByTeam.get(team.id) || []).map((role) => (
                        <button
                          key={role.id}
                          className={`tree-node role ${selectedType === 'role' && selectedId === role.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedType('role');
                            setSelectedId(role.id);
                          }}
                        >
                          <span className="tree-node-main"><Shield size={14} /><span>{role.database_pattern}</span></span>
                          <span className="node-actions">
                            <Edit2 size={14} onClick={(e) => { e.stopPropagation(); setRoleModal({ open: true, edit: role }); }} />
                            <Trash2 size={14} onClick={(e) => { e.stopPropagation(); deleteRole(role.id); }} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main className="rbac-detail">
          {!selectedType && <div className="placeholder">{t('views.rbac.pickNodeHint')}</div>}

          {selectedType === 'organization' && selectedOrg && (
            <div className="detail-card">
              <div className="detail-title-row">
                <div className="detail-title-left">
                  <h3>{t('views.rbac.organizationLabel')}: <span className="detail-name">{selectedOrg.name}</span></h3>
                  <span className="detail-meta">{t('views.rbac.idLabel')}: {selectedOrg.id}</span>
                </div>
                <div className="detail-title-right">
                  <button className="btn btn-primary" onClick={() => setTeamModal({ open: true, orgId: selectedOrg.id })}>
                    <Plus size={14} /> {t('views.rbac.team')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedType === 'team' && selectedTeam && (
            <div className="detail-card">
              <div className="detail-title-row">
                <div className="detail-title-left">
                  <h3>{t('views.rbac.teamLabel')}: <span className="detail-name">{selectedTeam.name}</span></h3>
                  <span className="detail-meta">{t('views.rbac.idLabel')}: {selectedTeam.id} · {t('views.rbac.organizationShort')}: {selectedTeam.organization_id}</span>
                </div>
                <div className="detail-title-right">
                  <div className="detail-actions-row detail-actions-inline">
                    <button className="btn btn-outlined" onClick={openWizard}>
                      <UserPlus size={14} /> {t('views.rbac.tokenBindWizard')}
                    </button>
                    <button className="btn btn-primary" onClick={() => setRoleModal({ open: true, teamId: selectedTeam.id })}>
                      <Plus size={14} /> {t('views.rbac.newRole')}
                    </button>
                  </div>
                </div>
              </div>

                      <h4>{t('views.rbac.teamTokenMembers')}</h4>
              <table className="rbac-table">
                <thead>
                  <tr><th>{t('views.rbac.idLabel')}</th><th>{t('views.rbac.nameLabel')}</th><th>{t('views.rbac.statusLabel')}</th><th>{t('views.rbac.actionLabel')}</th></tr>
                </thead>
                <tbody>
                  {teamTokens.map((tk) => (
                    <tr key={tk.id}>
                      <td>{tk.id}</td>
                      <td>{tk.name}</td>
                      <td>{tk.enabled ? t('views.rbac.active') : t('views.rbac.revoked')}</td>
                      <td>
                        <button className="btn btn-ghost btn-small" onClick={() => unbindTokenFromTeam(tk.id)}>
                          <Trash2 size={14} /> {t('views.rbac.unbind')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {teamTokens.length === 0 && (
                    <tr><td colSpan={4} className="rbac-empty">{t('views.rbac.noTeamTokenMembers')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {selectedType === 'role' && selectedRole && (
            <div className="detail-card">
              <div className="detail-title-row">
                <div className="detail-title-left">
                  <h3>{t('views.rbac.roleLabel')}: <span className="detail-name">{selectedRole.database_pattern}</span></h3>
                  <span className="detail-meta">{t('views.rbac.idLabel')}: {selectedRole.id} · {t('views.rbac.teamShort')}: {selectedRole.team_id}</span>
                  <span className="detail-meta">{t('views.rbac.permissionsLabel')}: {selectedRole.permissions.join(', ')}</span>
                </div>
                <div className="detail-title-right">
                  <button className="btn btn-primary" onClick={() => setMeasModalOpen(true)}>
                    <Plus size={14} /> {t('views.rbac.newMeasurementPermission')}
                  </button>
                </div>
              </div>

              <h4>{t('views.rbac.measurementPermissions')}</h4>

              <table className="rbac-table">
                <thead>
                  <tr><th>{t('views.rbac.idLabel')}</th><th>{t('views.rbac.patternLabel')}</th><th>{t('views.rbac.permissionsLabel')}</th><th>{t('views.rbac.actionLabel')}</th></tr>
                </thead>
                <tbody>
                  {selectedRoleMeasPerms.map((m) => (
                    <tr key={m.id}>
                      <td>{m.id}</td>
                      <td>{m.measurement_pattern}</td>
                      <td>{m.permissions.join(', ')}</td>
                      <td>
                        <button className="btn btn-ghost btn-small" onClick={() => deleteMeasurementPermission(m.id)}>
                          <Trash2 size={14} /> {t('views.rbac.delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {selectedRoleMeasPerms.length === 0 && (
                    <tr><td colSpan={4} className="rbac-empty">{t('views.rbac.noData')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {orgModal.open && (
        <OrgModal
          title={orgModal.edit ? t('views.rbac.editOrganization') : t('views.rbac.newOrganization')}
          initialName={orgModal.edit?.name || ''}
          onClose={() => setOrgModal({ open: false })}
          onSave={(name) => saveOrg(name, orgModal.edit)}
        />
      )}

      {teamModal.open && (
        <TeamModal
          title={teamModal.edit ? t('views.rbac.editTeam') : t('views.rbac.newTeam')}
          initialName={teamModal.edit?.name || ''}
          onClose={() => setTeamModal({ open: false })}
          onSave={(name) => saveTeam(name, teamModal)}
        />
      )}

      {roleModal.open && (
        <RoleModal
          title={roleModal.edit ? t('views.rbac.editRole') : t('views.rbac.newRole')}
          initialPattern={roleModal.edit?.database_pattern || '*'}
          initialPerms={permsToMap(roleModal.edit?.permissions || ['read', 'write'])}
          onClose={() => setRoleModal({ open: false })}
          onSave={(pattern, perms) => saveRole(pattern, perms, roleModal)}
        />
      )}

      {wizardOpen && selectedTeam && (
        <TokenBindWizard
          team={selectedTeam}
          tokens={tokens}
          step={wizardStep}
          tokenId={wizardTokenId}
          preview={wizardPermPreview}
          onClose={() => setWizardOpen(false)}
          onPickToken={async (v) => {
            setWizardTokenId(v);
            if (v) await loadWizardPreview(Number(v));
          }}
          onNext={() => setWizardStep((s) => Math.min(3, s + 1))}
          onPrev={() => setWizardStep((s) => Math.max(1, s - 1))}
          onBind={bindTokenToTeam}
        />
      )}

      {measModalOpen && selectedRole && (
        <MeasurementPermissionModal
          onClose={() => setMeasModalOpen(false)}
          onSave={async (pattern, perms) => {
            await createMeasurementPermission(pattern, perms);
            setMeasModalOpen(false);
          }}
          initialPattern={newMeasPattern}
          initialPerms={newMeasPerms}
        />
      )}
    </div>
  );
}

function ModalShell({
  title,
  children,
  footer,
  onClose,
  size = 'md',
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass = size === 'sm' ? 'modal-sm' : size === 'lg' ? 'modal-wide' : 'modal-md';
  return (
    <div className="modal-overlay" role="dialog" aria-modal onClick={onClose}>
      <div className={`modal-content ${sizeClass}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer}
      </div>
    </div>
  );
}

function OrgModal({ title, initialName, onClose, onSave }: { title: string; initialName: string; onClose: () => void; onSave: (name: string) => void; }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  return (
    <ModalShell
      title={title}
      onClose={onClose}
      size="md"
      footer={
        <div className="modal-actions modal-actions-bottom">
          <button className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={() => onSave(name.trim())}>{t('common.apply')}</button>
        </div>
      }
    >
      <div className="inline-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('views.rbac.organizationName')} />
      </div>
    </ModalShell>
  );
}

function TeamModal({ title, initialName, onClose, onSave }: { title: string; initialName: string; onClose: () => void; onSave: (name: string) => void; }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  return (
    <ModalShell
      title={title}
      onClose={onClose}
      size="md"
      footer={
        <div className="modal-actions modal-actions-bottom">
          <button className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={() => onSave(name.trim())}>{t('common.apply')}</button>
        </div>
      }
    >
      <div className="inline-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('views.rbac.teamName')} />
      </div>
    </ModalShell>
  );
}

function RoleModal({ title, initialPattern, initialPerms, onClose, onSave }: { title: string; initialPattern: string; initialPerms: Record<string, boolean>; onClose: () => void; onSave: (pattern: string, perms: Record<string, boolean>) => void; }) {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState(initialPattern);
  const [perms, setPerms] = useState(initialPerms);
  return (
    <ModalShell
      title={title}
      onClose={onClose}
      size="lg"
      footer={
        <div className="modal-actions modal-actions-bottom">
          <button className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={() => onSave(pattern.trim(), perms)}>{t('common.apply')}</button>
        </div>
      }
    >
      <div className="inline-form">
        <p className="rbac-help-text">
          Role permissions 为数据库级权限：匹配到的 database_pattern 会获得对应 read/write/delete/admin 权限。
        </p>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t('views.rbac.databasePattern')} />
        <div className="perm-row">
          {ROLE_PERM_OPTIONS.map((p) => (
            <label key={p}><input type="checkbox" checked={perms[p]} onChange={(e) => setPerms((prev) => ({ ...prev, [p]: e.target.checked }))} />{p}</label>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

function MeasurementPermissionModal({
  initialPattern,
  initialPerms,
  onClose,
  onSave,
}: {
  initialPattern: string;
  initialPerms: Record<string, boolean>;
  onClose: () => void;
  onSave: (pattern: string, perms: Record<string, boolean>) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState(initialPattern || '*');
  const [perms, setPerms] = useState(initialPerms);

  return (
    <ModalShell
      title={t('views.rbac.newMeasurementPermission')}
      onClose={onClose}
      size="lg"
      footer={
        <div className="modal-actions modal-actions-bottom">
          <button className="btn btn-outlined" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={() => onSave(pattern.trim(), perms)}>{t('views.rbac.save')}</button>
        </div>
      }
    >
      <div className="inline-form">
        <p className="rbac-help-text">{t('views.rbac.measurementPermissionHelp')}</p>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t('views.rbac.measurementPatternPlaceholder')} />
        <div className="perm-row">
          {ROLE_PERM_OPTIONS.map((p) => (
            <label key={p}><input type="checkbox" checked={perms[p]} onChange={(e) => setPerms((prev) => ({ ...prev, [p]: e.target.checked }))} />{p}</label>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

function TokenBindWizard({
  team,
  tokens,
  step,
  tokenId,
  preview,
  onClose,
  onPickToken,
  onNext,
  onPrev,
  onBind,
}: {
  team: Team;
  tokens: TokenInfo[];
  step: number;
  tokenId: string;
  preview: string;
  onClose: () => void;
  onPickToken: (v: string) => void | Promise<void>;
  onNext: () => void;
  onPrev: () => void;
  onBind: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell title={t('views.rbac.tokenBindWizardTitle', { teamName: team.name })} onClose={onClose} size="lg">
      <div className="wizard-step">{t('views.rbac.stepProgress', { step, total: 3 })}</div>

      {step === 1 && (
        <div className="inline-form">
          <label>{t('views.rbac.selectToken')}</label>
          <select value={tokenId} onChange={(e) => onPickToken(e.target.value)}>
            <option value="">{t('views.rbac.pleaseSelect')}</option>
            {tokens.map((t) => <option key={t.id} value={t.id}>{t.name} (#{t.id})</option>)}
          </select>
        </div>
      )}

      {step === 2 && (
        <div>
          <p>{t('views.rbac.confirmBindTargetTeam')}</p>
          <p><strong>{team.name}</strong> ({t('views.rbac.idLower')}: {team.id})</p>
          <p>{t('views.rbac.confirmToken')}: {tokenId || t('views.rbac.notSelected')}</p>
        </div>
      )}

      {step === 3 && (
        <div>
          <p>{t('views.rbac.tokenEffectivePreviewBeforeBind')}</p>
          <pre className="rbac-json">{preview || t('views.rbac.noPreview')}</pre>
        </div>
      )}

      <div className="modal-actions">
        <button className="btn btn-outlined" onClick={onClose}>{t('common.close')}</button>
        {step > 1 && <button className="btn btn-outlined" onClick={onPrev}>{t('views.rbac.prevStep')}</button>}
        {step < 3 && <button className="btn btn-primary" disabled={!tokenId} onClick={onNext}>{t('views.rbac.nextStep')}</button>}
        {step === 3 && <button className="btn btn-primary" onClick={onBind}>{t('views.rbac.confirmBind')}</button>}
      </div>
    </ModalShell>
  );
}
